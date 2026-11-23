/* Normalize geometry and pressure/flow boundary conditions for both wave solvers. */
(function(K){
  const W=K.world, {check,record,id,own,copy}=W.data, {hash}=K.procedural.data;
  const format='ink-studio/wave-network', finite=Number.isFinite;
  const positive=n=>finite(n)&&n>0, nonnegative=n=>finite(n)&&n>=0;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const array=v=>Array.isArray(v)||ArrayBuffer.isView(v)&&typeof v.length==='number';
  const fields=(v,keys)=>record(v)&&Object.keys(v).every(key=>keys.includes(key));
  function table(v,max,label){
    check(record(v)&&Object.keys(v).length<=max&&Object.keys(v).every(id),'Invalid wave '+label+' table');
    return Object.entries(v);
  }

  function compile(raw,settings){
    const native=raw?.format===W.domains.compiledFormat;
    check((native&&raw.complete===true||raw?.format===format)&&raw.version===1&&id(raw.id)&&
      integer(raw.revision??1,1,Number.MAX_SAFE_INTEGER),'Expected a version 1 wave network or complete compiled branched domain');
    check(fields(settings,['method','sampleRate','soundSpeed','density','metersPerUnit','loss','losses','cellLength','cfl',
      'terminations','sources','probes','maxWork','conditions']),'Unknown wave settings');
    const {method='distributed',sampleRate=48000,soundSpeed=343,density=1.2,metersPerUnit=1,loss=0,losses={},
      cellLength=soundSpeed/sampleRate,cfl=.95,maxWork=80000000}=settings;
    check(['distributed','delay'].includes(method)&&integer(sampleRate,1000,192000)&&positive(soundSpeed)&&
      positive(density)&&positive(metersPerUnit)&&nonnegative(loss)&&positive(cellLength)&&positive(cfl)&&cfl<=.99&&
      integer(maxWork,1,200000000),'Invalid wave medium, resolution, or work limit');

    const nodes=table(raw.nodes,256,'node').map(([name,row])=>{
      check(record(row),'Invalid wave node '+name);
      return {name,admittance:0,outside:0,released:false,source:-1};
    });
    const named=nodes.length, lookup=new Map(nodes.map((node,i)=>[node.name,i]));
    const index=name=>{
      check(lookup.has(name),'Unknown wave node '+name);
      return lookup.get(name);
    };
    const ports=new Map(table(raw.ports??{},256,'port').map(([name,row])=>[name,index(native?row?.node:row)]));
    const site=row=>{
      check(record(row)&&['node','port'].filter(key=>own(row,key)).length===1,'Wave site needs a node or port');
      if(row.node!==undefined)return index(row.node);
      check(ports.has(row.port),'Unknown wave port '+row.port);
      return ports.get(row.port);
    };
    const tubeList=table(raw.tubes,256,'tube');
    check(named>=2&&tubeList.length>0,'Wave network needs at least two nodes and one tube');
    check(table(losses,256,'loss').every(([name,value])=>own(raw.tubes,name)&&nonnegative(value)),
      'Per-tube loss needs a known tube and nonnegative attenuation');
    const segments=[], tubes=new Map();
    let sections=0;
    for(const [name,row] of tubeList){
      const from=index(native?row?.from?.node:row?.from), to=index(native?row?.to?.node:row?.to);
      check(from!==to&&Array.isArray(row.sections)&&row.sections.length>0&&
        (sections+=row.sections.length)<=32768,'Invalid wave tube '+name);
      const parts=[];
      let length=0;
      for(const section of row.sections){
        if(!native)check(fields(section,['length','area','loss']),'Invalid wave section on '+name);
        const size=(native?section?.sectionLength:section?.length)*metersPerUnit;
        const area=section?.area*metersPerUnit**2, attenuation=(native?undefined:section?.loss)??losses[name]??loss;
        check(positive(size)&&positive(area)&&nonnegative(attenuation),
          'Wave sections need finite positive length and area on '+name+'; use a sealed end at a closure');
        const previous=parts.at(-1);
        if(previous&&previous.area===area&&previous.loss===attenuation)previous.length+=size;
        else parts.push({name,at:length,length:size,area,loss:attenuation});
        length+=size;
      }
      check(positive(length)&&parts.every(row=>positive(row.length))&&segments.length+parts.length<=2048,
        'Wave topology exceeds its length or segment budget');
      let prev=from;
      const links=[];
      for(const [i,part] of parts.entries()){
        const next=i===parts.length-1?to:nodes.push({name:name+'/'+i,admittance:0,outside:0,released:false,source:-1})-1;
        const y=part.area/(density*soundSpeed);
        check(positive(y),'Wave characteristic admittance exceeded numeric range');
        nodes[prev].admittance+=y;
        nodes[next].admittance+=y;
        links.push(segments.length);
        segments.push({...part,from:prev,to:next,y});
        prev=next;
      }
      tubes.set(name,{length,links});
    }
    check(nodes.every(row=>positive(row.admittance)),'Wave nodes need a connected tube and finite admittance');

    const conditions=settings.conditions, applied=conditions===undefined?null:
      W.boundaryConditions.bound(conditions,['ends','drives']).waves(conditions);
    function merged(legacy,authored,label){
      const combined=Object.fromEntries(table(legacy??{},256,label));
      for(const [key,row] of Object.entries(authored??{})){
        check(!own(combined,key),'Repeated '+label+' '+key);
        combined[key]=row;
      }
      return combined;
    }
    const ended=new Set();
    for(const [key,row] of table(merged(settings.terminations,applied?.terminations,'termination'),256,'termination')){
      const where=indexOrPort(key), n=nodes[where], {kind,coefficient,impedance}=row??{};
      check(!ended.has(where)&&fields(row,['kind',...(kind==='reflect'?['coefficient']:kind==='impedance'?['impedance']:[])])&&
        ['sealed','open','matched','reflect','impedance'].includes(kind)&&
        (kind!=='reflect'||finite(coefficient)&&Math.abs(coefficient)<=1)&&
        (kind!=='impedance'||nonnegative(impedance)),'Invalid or repeated wave termination '+key);
      ended.add(where);
      if(kind==='open'||kind==='reflect'&&coefficient===-1||kind==='impedance'&&impedance===0)n.released=true;
      else if(kind==='impedance')n.outside=1/impedance;
      else if(kind==='matched')n.outside=n.admittance;
      else if(kind==='reflect')n.outside=n.admittance*(1-coefficient)/(1+coefficient);
      check(nonnegative(n.outside)&&positive(n.outside+n.admittance),'Wave termination exceeded numeric range on '+key);
    }
    function indexOrPort(key){
      check(!(lookup.has(key)&&ports.has(key)&&lookup.get(key)!==ports.get(key)),
        'Ambiguous wave termination '+key);
      return ports.has(key)?ports.get(key):index(key);
    }

    const sources=table(merged(settings.sources,applied?.sources,'source'),32,'source').map(([name,row],i)=>{
      check(fields(row,['kind','node','port'])&&['flow','pressure'].includes(row.kind),'Invalid wave source '+name);
      const at=site(row), n=nodes[at];
      check(n.source<0&&(!n.released||row.kind==='pressure')&&
        (row.kind!=='pressure'||n.outside===0),'Wave source conflicts with another source or termination on '+name);
      n.source=i;
      n.pressureSource=row.kind==='pressure';
      return {name,kind:row.kind,at};
    });

    const authored=Object.fromEntries(table(raw.observations??{},64,'observation').map(([name,row])=>{
      if(!native)return [name,row];
      if(row?.kind==='socket')return [name,{node:row.node}];
      check(row?.kind==='tube','Invalid compiled wave observation '+name);
      return [name,{tube:row.tube,distance:row.distance}];
    }));
    check(settings.probes===undefined||record(settings.probes),'Expected a wave probe table');
    const probeTable={...authored,...settings.probes};
    if(!Object.keys(probeTable).length)probeTable[nodes[0].name]={node:nodes[0].name};
    const probes=table(probeTable,64,'probe').map(([name,row])=>{
      if(!own(row,'tube')){
        check(fields(row,['node','port']),'Invalid wave probe '+name);
        return {name,node:site(row)};
      }
      const tube=tubes.get(row.tube);
      check(fields(row,['tube','distance','t'])&&tube&&!(own(row,'distance')&&own(row,'t'))&&
        (!own(row,'distance')||nonnegative(row.distance))&&(!own(row,'t')||nonnegative(row.t)&&row.t<=1),
      'Invalid wave tube probe '+name);
      const distance=own(row,'distance')?row.distance*metersPerUnit:tube.length*(row.t??.5);
      check(finite(distance)&&distance<=tube.length+1e-12*Math.max(1,tube.length),'Wave probe lies outside its tube: '+name);
      const section=tube.links.find(i=>distance<segments[i].at+segments[i].length)??tube.links.at(-1);
      const part=segments[section];
      return {name,section,ratio:Math.min(1,Math.max(0,(distance-part.at)/part.length))};
    });
    const normalized={method,sampleRate,soundSpeed,density,metersPerUnit,cellLength,cfl,nodes,segments,sources,probes,
      ...(applied&&{conditions:{asset:applied.identity,ends:conditions.ends??{},drives:conditions.drives??{}}})};
    const identity={id:raw.id,revision:raw.revision??1,signature:hash(JSON.stringify(normalized))};
    return {...normalized,identity,maxWork,named,tubeCount:tubes.size,defaults:applied?.defaults,driveWork:applied?.work??0};
  }

  W.waveTopology=Object.freeze({format,compile,finite,integer,array});
})(KIT);
