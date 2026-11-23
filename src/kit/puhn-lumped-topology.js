/* Compile effort/flow networks and factor their fixed junction conductance. */
(function(K){
  const W=K.world, {check,record,id,own,copy}=W.data, {freeze,hash}=K.procedural.data;
  const format='ink-studio/lumped-network';
  const finite=Number.isFinite, positive=n=>finite(n)&&n>0, nonnegative=n=>finite(n)&&n>=0;
  const fields=(v,keys)=>record(v)&&Object.keys(v).every(key=>keys.includes(key));
  const nodeKinds={
    reference:['effort'],
    storage:['capacity','initialEffort'],
    junction:[]
  };
  const elementKinds={
    resistor:['resistance','head'],
    damper:['damping','head'],
    inertance:['inertance','resistance','initialFlow','head'],
    spring:['stiffness','initialDisplacement'],
    'flow-source':['flow']
  };
  const nodeMeasures=['effort','flow','stored'], elementMeasures=['flow','drop','displacement'];
  const ledgerMeasures=['energy','supplied','dissipated','balance','sourcePower','lossPower','junctionResidual'];

  function table(v,max,label){
    check(record(v)&&Object.keys(v).length<=max&&Object.keys(v).every(id),'Invalid '+label+' table');
    return Object.entries(v);
  }

  function factor(nodes,elements,junctions){
    const n=junctions.length, linked=nodes.map(()=>[]);
    const lower=Array.from({length:n},()=>new Float64Array(n));
    for(const {from,to,conductance:g} of elements)if(g>0){
      const a=nodes[from].junction,b=nodes[to].junction;
      linked[from].push(to);
      linked[to].push(from);
      if(a>=0)lower[a][a]+=g;
      if(b>=0)lower[b][b]+=g;
      if(a>=0&&b>=0)lower[Math.max(a,b)][Math.min(a,b)]-=g;
    }
    const anchored=nodes.flatMap((row,i)=>row.junction<0?[i]:[]);
    const seen=new Set(anchored);
    for(const i of anchored)for(const j of linked[i])if(!seen.has(j)){
      seen.add(j);
      anchored.push(j);
    }
    for(const i of junctions)check(seen.has(i),'Floating junction '+nodes[i].name+' needs a resistive path to storage or reference');
    for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
      let value=lower[i][j];
      for(let k=0;k<j;k++)value-=lower[i][k]*lower[j][k];
      if(i===j){
        check(positive(value),'Singular or poorly scaled junction conductance at '+nodes[junctions[i]].name);
        lower[i][i]=Math.sqrt(value);
      }else lower[i][j]=value/lower[j][j];
    }
    return function solve(rhs){
      for(let i=0;i<n;i++){
        let next=rhs[i];
        for(let j=0;j<i;j++)next-=lower[i][j]*rhs[j];
        rhs[i]=next/lower[i][i];
      }
      for(let i=n-1;i>=0;i--){
        let next=rhs[i];
        for(let j=i+1;j<n;j++)next-=lower[j][i]*rhs[j];
        rhs[i]=next/lower[i][i];
      }
    };
  }

  function compile(raw){
    check(fields(raw,['format','version','id','revision','units','inputs','nodes','elements','outputs','numerics'])&&
      raw.format===format&&raw.version===1&&id(raw.id)&&Number.isSafeInteger(raw.revision??1)&&(raw.revision??1)>0,
    'Expected a version 1 lumped network');
    const doc=copy(raw), units=doc.units??{}, numeric=doc.numerics??{};
    check(fields(units,['effort','flow'])&&Object.values(units).every(unit=>typeof unit==='string'),'Invalid network units');
    for(const unit of Object.values(units))K.quantities.unit(unit);
    check(fields(numeric,['method','step','minStep','maxStep','absoluteTolerance','relativeTolerance','maxSteps'])&&
      ['rk4','adaptive'].includes(numeric.method??'rk4'),'Network numerics need RK4 or adaptive integrator settings');
    const initial=[], junctions=[];
    const inputs=Object.fromEntries(table(doc.inputs??{},64,'network input').map(([name,row])=>{
      check(fields(row,['default','quantity'])&&finite(row.default??0),'Invalid network input '+name);
      const quantity=K.quantities.normalize(row.quantity,'Network input '+name);
      return [name,{type:'number',default:row.default??0,...(quantity&&{quantity})}];
    }));

    function driver(value,label){
      if(finite(value))return {value};
      check(fields(value,['input','scale','offset'])&&own(inputs,value.input)&&
        finite(value.scale??1)&&finite(value.offset??0),'Invalid network drive '+label);
      return {input:value.input,scale:value.scale??1,offset:value.offset??0};
    }

    const nodes=table(doc.nodes,256,'network node').map(([name,row],i)=>{
      check(own(nodeKinds,row?.kind)&&fields(row,['kind',...nodeKinds[row.kind]]),'Invalid network node '+name);
      if(row.kind==='junction'){
        const junction=junctions.length;
        junctions.push(i);
        return {name,kind:row.kind,junction};
      }
      if(row.kind==='reference')return {name,kind:row.kind,junction:-1,drive:driver(row.effort??0,name)};
      const {capacity,initialEffort=0}=row;
      check(positive(capacity)&&finite(initialEffort),'Storage '+name+' needs positive capacity and finite initial effort');
      const state=initial.push(initialEffort)-1;
      return {name,kind:row.kind,junction:-1,capacity,state};
    });
    check(nodes.length>=2&&junctions.length<=64,'Network needs 2–256 nodes and at most 64 junctions');
    const nodeIndex=new Map(nodes.map((row,i)=>[row.name,i]));
    const elements=table(doc.elements,512,'network element').map(([name,row])=>{
      const {kind,from,to}=row??{};
      check(own(elementKinds,kind)&&fields(row,['kind','from','to',...elementKinds[kind]])&&
        nodeIndex.has(from)&&nodeIndex.has(to)&&from!==to,'Invalid network element '+name);
      const edge={name,kind,from:nodeIndex.get(from),to:nodeIndex.get(to),conductance:0};
      if(kind==='resistor'||kind==='damper'){
        const g=kind==='resistor'?1/row.resistance:row.damping;
        check(positive(g)&&(kind!=='resistor'||positive(row.resistance)),'Invalid '+kind+' coefficient on '+name);
        edge.conductance=g;
        edge.drive=driver(row.head??0,name);
      }else if(kind==='flow-source'){
        edge.drive=driver(row.flow,name);
      }else if(kind==='inertance'){
        const {inertance,resistance=0,initialFlow=0}=row;
        check(positive(inertance)&&nonnegative(resistance)&&finite(initialFlow),'Invalid inertance on '+name);
        edge.state=initial.push(initialFlow)-1;
        Object.assign(edge,{inertance,resistance,drive:driver(row.head??0,name)});
      }else{
        const {stiffness,initialDisplacement=0}=row;
        check(positive(stiffness)&&finite(initialDisplacement),'Invalid spring on '+name);
        edge.state=initial.push(initialDisplacement)-1;
        edge.stiffness=stiffness;
      }
      return edge;
    });
    check(elements.length>0,'Network needs at least one element');
    const elementIndex=new Map(elements.map((row,i)=>[row.name,i]));
    const solve=factor(nodes,elements,junctions);
    const outputs=Object.fromEntries(table(doc.outputs??{},128,'network output').map(([name,row])=>{
      check(fields(row,['node','element','ledger','measure','quantity'])&&
        ['node','element','ledger'].filter(key=>own(row,key)).length===1,'Invalid network output '+name);
      let group,index,measure;
      if(own(row,'node')){
        group='nodes';
        index=nodeIndex.get(row.node);
        measure=row.measure??'effort';
        check(index!==undefined&&nodeMeasures.includes(measure)&&
          (measure!=='stored'||nodes[index].kind==='storage'),'Invalid node output '+name);
      }else if(own(row,'element')){
        group='elements';
        index=elementIndex.get(row.element);
        measure=row.measure??'flow';
        check(index!==undefined&&elementMeasures.includes(measure)&&
          (measure!=='displacement'||elements[index].kind==='spring'),'Invalid element output '+name);
      }else{
        group='ledger';
        measure=row.ledger;
        check(row.measure===undefined&&ledgerMeasures.includes(measure),'Invalid ledger output '+name);
      }
      const unit=measure==='effort'||measure==='drop'?units.effort:measure==='flow'?units.flow:undefined;
      const quantity=K.quantities.normalize(row.quantity??(unit===undefined?undefined:{unit}),'Network output '+name);
      if(unit!==undefined&&row.quantity!==undefined)
        K.quantities.assertLink({unit},{unit:quantity.unit},'network '+measure,name);
      return [name,{group,index,measure,port:{type:'number',...(quantity&&{quantity})}}];
    }));
    const layout=freeze({id:doc.id,revision:doc.revision??1,signature:hash(JSON.stringify(doc)),
      nodes:nodes.length,elements:elements.length,junctions:junctions.length,physicalStates:initial.length,units});
    initial.push(0,0);
    return {layout,initial,inputs,outputs,numeric,nodes,elements,junctions,solve};
  }

  W.lumpedTopology=Object.freeze({format,compile});
})(KIT);
