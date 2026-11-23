/* Solve feedback through trial settlements, then post the chosen exchange once. */
(function (K) {
  const W=K.world, T=W.transfers, {check,copy,endpoint,id,own,record}=W.data;
  const {freeze}=K.procedural.data;
  const marker=Symbol('transfer coupling'), laws=new Map();
  const maxLinks=64, maxIterations=64, maxWorldTrials=16384;
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const revisionOK=n=>Number.isSafeInteger(n)&&n>0;
  const nonnegative=n=>Number.isFinite(n)&&n>=0;
  const positive=n=>Number.isFinite(n)&&n>0;
  const idle=status=>({status,iterations:0,residualRatio:0,committed:false,links:{}});
  const idleStates=['ready','disabled'];
  const finiteAmount=value=>Number.isFinite(value)||Array.isArray(value)&&
    (value.length===2||value.length===3)&&Array.from(value).every(Number.isFinite);
  const limitReasons=['source','destination','precision','access'];

  function registerLaw(kind,factory,{revision=1}={}) {
    check(id(kind)&&revisionOK(revision)&&typeof factory==='function','Invalid transfer coupling law');
    const versions=laws.get(kind)??new Map();
    check(!versions.has(revision),'Duplicate transfer coupling law '+kind+' revision '+revision);
    versions.set(revision,factory);
    laws.set(kind,versions);
    return kind;
  }

  function settings(config) {
    check(fields(config,['law','revision','parameters','links','iteration','enabled']) && id(config.law) &&
      revisionOK(config.revision??1) && record(config.parameters??{}) &&
      (config.enabled===undefined||typeof config.enabled==='boolean') &&
      record(config.links),'Invalid transfer coupling configuration');
    const entries=Object.entries(config.links).sort(([a],[b])=>a<b?-1:a>b?1:0);
    check(entries.length>0&&entries.length<=maxLinks,'A transfer coupling needs 1–64 links');
    const {maxIterations:iterations=16,relaxation=0.65,onLimit='reject'}=config.iteration??{};
    check(fields(config.iteration??{},['maxIterations','relaxation','onLimit']) &&
      revisionOK(iterations) && iterations<=maxIterations && positive(relaxation) && relaxation<=1 &&
      ['reject','accept','error'].includes(onLimit),'Invalid transfer coupling iteration settings');
    const links=entries.map(([name,raw])=>{
      check(id(name)&&fields(raw,['from','to','mode','tolerance','relativeTolerance']) &&
        ['partial','exact'].includes(raw.mode??'partial') &&
        positive(raw.tolerance??1e-8) && nonnegative(raw.relativeTolerance??0),'Invalid coupling link '+name);
      endpoint(raw.from);
      endpoint(raw.to);
      return {id:name,from:raw.from,to:raw.to,mode:raw.mode??'partial',
        tolerance:raw.tolerance??1e-8,relativeTolerance:raw.relativeTolerance??0};
    });
    const revision=config.revision??1, factory=laws.get(config.law)?.get(revision);
    check(factory,'Unregistered transfer coupling law '+config.law+' revision '+revision);
    const parameters=freeze(copy(config.parameters??{}));
    return freeze({law:config.law,revision,parameters,links,iterations,relaxation,onLimit,factory});
  }

  function create(config,transfers) {
    const spec=settings(config), byAccount=new Map(transfers.describe().map(row=>[row.name,row]));
    return compile(spec,transfers,byAccount);
  }

  function compile(spec,transfers,byAccount) {
    const {iterations,relaxation,onLimit}=spec, participants=new Set();
    const links=spec.links.map(row=>{
      const from=byAccount.get(row.from), to=byAccount.get(row.to);
      check(from&&to&&from.type!=='integer','A coupling link needs continuous transfer accounts: '+row.id);
      const {type,resource,units}=from;
      const zero=T.components(type==='vec2'?[0,0]:type==='vec3'?[0,0,0]:0,type);
      transfers.validate({from:row.from,to:row.to,mode:row.mode,amount:T.shape(type,zero)},true);
      participants.add(endpoint(row.from)[0]);
      participants.add(endpoint(row.to)[0]);
      return {...row,type,resource,units,zero};
    });
    const owners=Array.from(participants), names=new Set(links.map(row=>row.id));
    const interfaceLinks=freeze(Object.fromEntries(links.map(({id,from,to,type,resource,units})=>
      [id,{from,to,type,resource,units}])));
    const law=spec.factory(spec.parameters,interfaceLinks);
    check(typeof law==='function'&&Object.prototype.toString.call(law)==='[object Function]',
      'A transfer coupling law must prepare a synchronous function');
    const maxTrials=iterations+1, maxSettlements=(maxTrials+(relaxation===1?0:iterations-1))*links.length;
    const describe=freeze({law:spec.law,revision:spec.revision,participants:owners,
      maxIterations:iterations,relaxation,onLimit,maxTrials,maxSettlements,
      links:links.map(({zero,...link})=>link)});

    function solve(states,{tick,dt,requester,root,enabled=true}) {
      check(Number.isSafeInteger(tick)&&tick>0&&positive(dt)&&id(requester)&&typeof root==='function' &&
        typeof enabled==='boolean'&&record(states)&&owners.every(name=>own(states,name)),
        'Invalid transfer coupling boundary');
      if (!enabled) return {requests:[],report:idle('disabled')};
      const time=tick*dt;
      check(Number.isFinite(time),'Invalid transfer coupling time');
      const timing=Object.freeze({tick,time,dt});

      function propose(trial) {
        const accounts=new Map();
        function sample(name) {
          if (!accounts.has(name)) accounts.set(name,freeze(transfers.observe(trial,name,timing)));
          return accounts.get(name);
        }
        const choices=law(Object.freeze({...timing,link(name) {
          check(names.has(name),'Unknown exchange link '+name);
          const {from,to}=interfaceLinks[name];
          return Object.freeze({from:sample(from),to:sample(to)});
        }}));
        check(record(choices)&&Object.keys(choices).length===links.length&&links.every(row=>own(choices,row.id)),
          'A coupling law must return one amount per link');
        return links.map(row=>T.components(choices[row.id],row.type));
      }

      function project(amounts) {
        const trial=Object.fromEntries(owners.map(name=>[name,states[name]])), requests=[], applied=[], receipts=[];
        for (let i=0;i<links.length;i++) {
          const {id,from,to,type,mode,zero}=links[i], amount=amounts[i];
          if (!amount.some(n=>n!==0)) {
            applied.push(zero);
            receipts.push(null);
            continue;
          }
          const reverse=amount.length===1&&amount[0]<0;
          const request={id,from:reverse?to:from,to:reverse?from:to,mode,
            amount:reverse?-amount[0]:T.shape(type,amount)};
          const receipt=transfers.settle(trial,request,tick,requester,root);
          requests.push(request);
          receipts.push(receipt);
          applied.push(reverse?[receipt.applied===0?0:-receipt.applied]:T.components(receipt.applied,type));
        }
        return {trial,requests,applied,receipts,amounts};
      }

      let current=project(propose(states));
      for (let iteration=1;iteration<=iterations;iteration++) {
        const next=project(propose(current.trial));
        const errors=links.map(({tolerance,relativeTolerance},i)=>{
          let residual=0, ratio=0;
          for (let j=0;j<current.applied[i].length;j++) {
            const a=current.applied[i][j], b=next.applied[i][j], difference=Math.abs(a-b);
            const scale=tolerance+relativeTolerance*Math.max(Math.abs(a),Math.abs(b));
            residual=Math.max(residual,difference);
            ratio=Math.max(ratio,difference/scale);
            check(Number.isFinite(residual)&&Number.isFinite(scale)&&Number.isFinite(ratio),
              'Transfer coupling residual exceeds the numeric range');
          }
          return {residual,ratio};
        });
        const worst=errors.reduce((best,row,i)=>row.ratio>errors[best].ratio?i:best,0);
        const residualRatio=errors[worst].ratio, converged=residualRatio<=1;
        if (converged||iteration===iterations) {
          if (!converged&&onLimit==='error')
            throw Error('Transfer coupling '+requester+' did not converge at tick '+tick+
              ' (connection '+links[worst].id+', residual ratio '+residualRatio+')');
          const committed=converged||onLimit==='accept';
          const report=links.map(({id,units,type,zero},i)=>{
            const receipt=current.receipts[i];
            return [id,{units,requested:T.shape(type,current.amounts[i]),estimate:T.shape(type,current.applied[i]),
              applied:T.shape(type,committed?current.applied[i]:zero),residual:errors[i].residual,
              ratio:errors[i].ratio,capacity:receipt?.status??'idle',limitedBy:receipt?.limitedBy??[]}];
          });
          return {requests:committed?current.requests:[],report:{status:converged?'converged':'limit',
            iterations:iteration,residualRatio,committed,links:Object.fromEntries(report)}};
        }
        current=relaxation===1?next:project(current.applied.map((value,i)=>
          value.map((n,j)=>(1-relaxation)*n+relaxation*next.applied[i][j])));
      }
    }
    return Object.freeze({describe,solve});
  }

  function bind(systems,transfers,schedule) {
    const groups=Object.keys(systems).sort().filter(name=>systems[name][marker]);
    if (!groups.length) return [];
    const accounts=new Map(transfers.describe().map(row=>[row.name,row]));
    let work=0;
    return groups.map(name=>{
      const plan=compile(systems[name][marker],transfers,accounts);
      const fixed=system=>schedule.rates[system].every===1&&schedule.rates[system].substeps===1&&
        !schedule.chunks?.managed.has(system);
      check([name,...plan.describe.participants].every(fixed),
        'Transfer coupling requires fixed tick scheduling for the group and its accounts: '+name);
      work+=plan.describe.maxSettlements;
      check(work<=maxWorldTrials,'World transfer coupling exceeds its per-tick trial budget');
      return {name,...plan};
    });
  }

  function system(config) {
    const spec=settings(config);
    return {
      [marker]:spec, inputs:{enabled:{type:'bool',default:config.enabled??true}},
      outputs:{converged:'bool',iterations:'number',residualRatio:'number',committed:'bool'},
      initial:()=>idle('ready'),
      validateState(state) {
        const valid='Invalid transfer coupling checkpoint';
        check(fields(state,['status','iterations','residualRatio','committed','links']) &&
          Number.isSafeInteger(state.iterations)&&nonnegative(state.residualRatio)&&record(state.links),valid);
        if (idleStates.includes(state.status)) {
          check(state.iterations===0&&state.residualRatio===0&&state.committed===false&&!Object.keys(state.links).length,valid);
          return;
        }
        const converged=state.residualRatio<=1;
        check(state.iterations>0&&state.iterations<=spec.iterations&&Object.keys(state.links).length===spec.links.length&&
          state.status===(converged?'converged':'limit') &&
          (converged||state.iterations===spec.iterations&&spec.onLimit!=='error') &&
          state.committed===(converged||spec.onLimit==='accept'),valid);
        let maximum=0;
        for (const {id} of spec.links) {
          const row=state.links[id];
          check(fields(row,['units','requested','estimate','applied','residual','ratio','capacity','limitedBy']) &&
            typeof row.units==='string'&&row.units.trim() &&
            [row.requested,row.estimate,row.applied].every(finiteAmount)&&nonnegative(row.residual)&&nonnegative(row.ratio)&&
            ['idle','full','partial','blocked'].includes(row.capacity)&&Array.isArray(row.limitedBy)&&
            row.limitedBy.every(reason=>limitReasons.includes(reason)),valid);
          maximum=Math.max(maximum,row.ratio);
        }
        check(maximum===state.residualRatio,valid);
      },
      output:state=>({converged:state.status==='converged',iterations:state.iterations,
        residualRatio:state.residualRatio,committed:state.committed}),
      fields:{coupling:{type:'record',read:({state})=>W.query.ok(state)}}
    };
  }

  registerLaw('proportional',(parameters,links)=>{
    check(fields(parameters,['gain'])&&positive(parameters.gain??1)&&Object.values(links).every(row=>row.type==='number'),
      'Proportional coupling needs scalar accounts and a positive gain');
    const gain=parameters.gain??1, names=Object.keys(links);
    return ({dt,link})=>Object.fromEntries(names.map(name=>{
      const {from,to}=link(name);
      return [name,(from.balance-to.balance)*gain*dt];
    }));
  });
  W.runtime.register('transfer-coupling',system);
  W.transferCoupling=Object.freeze({registerLaw,create,bind});
})(KIT);
