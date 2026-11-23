/* Bounded, comparable diagnostic evidence from physical solvers. */
(function(K){
  const W=K.world,{check,record,id,copy}=W.data;
  const format='ink-studio/simulation-diagnostics', finite=Number.isFinite;
  const nonnegative=n=>finite(n)&&n>=0;
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const order={pass:0,warning:1,error:2};

  function create(options={}){
    if(options===true)options={};
    check(fields(options,['absoluteTolerance','relativeTolerance','nearLimit','tolerances','maxFindings']),'Invalid diagnostic options');
    const {absoluteTolerance=1e-12,relativeTolerance=1e-8,nearLimit=.9,tolerances={},maxFindings=8}=options;
    check(nonnegative(absoluteTolerance)&&nonnegative(relativeTolerance)&&relativeTolerance<=1&&
      finite(nearLimit)&&nearLimit>0&&nearLimit<=1&&record(tolerances)&&Object.keys(tolerances).length<=64&&
      Number.isSafeInteger(maxFindings)&&maxFindings>=1&&maxFindings<=64,
    'Invalid diagnostic thresholds');
    const limits=new Map(Object.entries(tolerances).map(([code,row])=>{
      check(id(code)&&fields(row,['absolute','relative'])&&nonnegative(row.absolute??absoluteTolerance)&&
        nonnegative(row.relative??relativeTolerance)&&(row.relative??relativeTolerance)<=1,'Invalid diagnostic tolerance '+code);
      return [code,{absolute:row.absolute??absoluteTolerance,relative:row.relative??relativeTolerance}];
    }));
    const normalized={absoluteTolerance,relativeTolerance,nearLimit,maxFindings,tolerances:Object.fromEntries(limits)};
    const metrics=new Map(), findings=[];
    const outranks=(severity,weight,value,row)=>order[severity]>order[row.severity]||
      severity===row.severity&&(weight>row.weight||weight===row.weight&&Math.abs(value)>Math.abs(row.value));
    let first=null;

    function add(code,value,threshold,severity,location,time,details){
      const weight=threshold===0?(value===0?0:Infinity):Math.abs(value)/threshold, previous=metrics.get(code);
      const replace=!previous||outranks(severity,weight,value,previous);
      const retain=severity!=='pass'&&(findings.length<maxFindings||outranks(severity,weight,value,findings.at(-1)));
      if(!replace&&!retain&&(first||severity==='pass'))return;
      check(id(code)&&(!replace||metrics.has(code)||metrics.size<64)&&(time===undefined||finite(time)),
        'Invalid diagnostic metric, time, or metric budget exceeded');
      const row={code,severity,value,threshold,ratio:finite(weight)?weight:null,location:copy(location),
        ...(time!==undefined&&{time}),...(details!==undefined&&{details:copy(details)})};
      if(!first&&severity!=='pass')first=row;
      const ranked={...row,weight};
      if(replace)metrics.set(code,ranked);
      if(retain){
        const key=code+':'+JSON.stringify(location), old=findings.findIndex(item=>item.key===key);
        if(old>=0){
          if(!outranks(severity,weight,value,findings[old]))return;
          findings.splice(old,1);
        }
        const ahead=findings.findIndex(item=>outranks(severity,weight,value,item));
        if(ahead<0)findings.push({...ranked,key});
        else findings.splice(ahead,0,{...ranked,key});
        if(findings.length>maxFindings)findings.pop();
      }
    }
    function threshold(code,scale){
      const override=limits.get(code);
      return Math.max(override?.absolute??absoluteTolerance,(override?.relative??relativeTolerance)*scale);
    }
    function error(code,value,scale,location,time,details){
      check(finite(value)&&nonnegative(scale),'Invalid diagnostic measurement '+code);
      const bound=threshold(code,scale);
      add(code,value,bound,Math.abs(value)>bound?'error':'pass',location,time,details);
    }
    function limit(code,value,bound,location,time,details){
      check(nonnegative(value)&&nonnegative(bound),'Invalid diagnostic limit '+code);
      const severity=value>bound?'error':bound>0&&value>=bound*nearLimit?'warning':'pass';
      add(code,value,bound,severity,location,time,details);
    }
    function residual(code,value,bound,location,time,details){
      check(finite(value)&&nonnegative(bound),'Invalid diagnostic residual '+code);
      add(code,value,bound,Math.abs(value)>bound?'error':'pass',location,time,details);
    }
    function failure(code,location,time,details){add(code,1,0,'error',location,time,details);}
    function report(context={}){
      const evidence=Array.from(metrics.values(),({weight,...row})=>row);
      const status=evidence.some(row=>row.severity==='error')?'error':first?'warning':'pass';
      return copy({format,version:1,status,context,firstFinding:first,metrics:evidence,
        findings:findings.map(({weight,key,...row})=>row)});
    }
    function merge(other){
      const {firstFinding,findings,metrics:rows}=other.report();
      const insert=({code,value,threshold,severity,location,time,details})=>
        add(code,value,threshold,severity,location,time,details);
      if(firstFinding)insert(firstFinding);
      for(const row of findings)insert(row);
      for(const row of rows)insert(row);
    }
    return Object.freeze({limit,error,residual,failure,report,merge,fork:()=>create(normalized)});
  }

  function coupling(state,options={},context={}){
    const review=create(options);
    check(record(state)&&record(state.links)&&['ready','disabled','converged','limit'].includes(state.status)&&
      Number.isSafeInteger(state.iterations)&&state.iterations>=0&&typeof state.committed==='boolean',
    'Expected a world transfer coupling report');
    const links=Object.entries(state.links), active=['converged','limit'].includes(state.status);
    check(active?state.iterations>0&&links.length>0:state.iterations===0&&links.length===0,'Invalid coupling review state');
    for(const [link,row] of links){
      check(id(link)&&record(row)&&nonnegative(row.ratio)&&nonnegative(row.residual)&&typeof row.units==='string',
        'Invalid coupling diagnostic '+link);
      review.residual('coupling-residual',row.ratio,1,{kind:'connection',link},context.time,
        {residual:row.residual,units:row.units,committed:state.committed});
    }
    return review.report({...context,solver:'transfer-coupling',iterations:state.iterations,status:state.status});
  }

  function solve(result,options={}){
    const review=create(options), {method,status,converged,residual,work}=result;
    const location=residual?.row!==undefined?{kind:'row',row:residual.row}:
      method==='root'?{kind:'bracket',interval:result.bracket}:{kind:'system',method};
    if(method==='root'){
      // A root can converge on interval width with a nonzero function value.
      if(!converged)review.failure('root-solve',location,undefined,{status,root:result.root,value:result.value});
    }else{
      if(residual!==null)review.residual('linear-residual',residual.signed??residual.absolute,residual.threshold,location,undefined,
        {absolute:residual.absolute,relative:residual.relative});
      if(!converged)review.failure('linear-solve',status==='singular'?{kind:'pivot',column:work.steps}:location,
        undefined,{status});
    }
    return review.report({solver:method,status,work,...(method==='root'&&{root:result.root,residual,reason:result.reason})});
  }

  function remap(result,options={}){
    const review=create(options);
    for(const [channel,row] of Object.entries(result.ledger)){
      const {input,moved,escaped,initialized,output,units}=row;
      const sourceBalanceError=input-moved-escaped, balanceError=input-escaped+initialized-output;
      review.error('remap-source-balance',sourceBalanceError,Math.max(Math.abs(input),Math.abs(moved),Math.abs(escaped)),
        {kind:'channel',channel,domain:result.source.id},undefined,{unit:units,input,moved,escaped});
      review.error('remap-target-balance',balanceError,Math.max(Math.abs(input),Math.abs(output),Math.abs(initialized),Math.abs(escaped)),
        {kind:'channel',channel,domain:result.target.id},undefined,{unit:units,input,output,escaped,initialized});
    }
    return review.report({solver:'state-remap',source:result.source,target:result.target});
  }

  W.diagnostics=Object.freeze({format,create,coupling,solve,remap});
})(KIT);
