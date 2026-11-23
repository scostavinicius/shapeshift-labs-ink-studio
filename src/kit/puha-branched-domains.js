/* Assemble sectioned tubes and storage nodes at explicit domain sockets. */
(function(K) {
  const W=K.world, P=K.procedural, {V,M}=K;
  const {check,id,own,record,endpoint,copy}=W.data, {freeze}=P.data;
  const format='ink-studio/branched-domain', compiledFormat='ink-studio/compiled-branched-domain';
  const fields=(value,names)=>record(value)&&Object.keys(value).every(key=>names.includes(key));
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
  const revision=n=>integer(n,1,Number.MAX_SAFE_INTEGER);
  const point=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(n=>Number.isFinite(n)&&Math.abs(n)<=1e8);
  const text=value=>typeof value==='string'&&!!value.trim()&&value.length<=1024;
  const nodeKinds=['junction','cavity','reservoir','terminal'];
  const sourceKinds=['mesh','sdf','contours'];

  function table(value,label,max,parse) {
    check(record(value)&&Object.keys(value).length<=max,'Invalid domain '+label+' table');
    return Object.fromEntries(Object.keys(value).sort().map(name=>{
      check(id(name)&&record(value[name]),'Invalid domain '+label+' '+name);
      return [name,parse(value[name],name)];
    }));
  }

  function locate(raw,query,label) {
    if(point(raw))return {point:raw.slice(),placement:raw.slice()};
    check(fields(raw,['entity','socket'])&&id(raw.entity)&&(raw.socket===undefined||id(raw.socket)),
      label+' needs a world point or an entity/socket selector');
    const frame=query?.frame?.(raw);
    check(point(frame?.point),label+' cannot resolve '+raw.entity+(raw.socket===undefined?'':'/'+raw.socket));
    return {point:frame.point.slice(),rotation:frame.rotation,placement:copy(raw)};
  }

  function components(nodes,tubes) {
    const neighbors=new Map(Object.keys(nodes).map(name=>[name,[]])), visited=new Set(), groups=[];
    for(const tube of Object.values(tubes)){
      neighbors.get(tube.from.node).push(tube);
      if(tube.from.node!==tube.to.node)neighbors.get(tube.to.node).push(tube);
    }
    for(const root of neighbors.keys()){
      if(visited.has(root))continue;
      const names=[root], edges=new Set();
      visited.add(root);
      for(let i=0;i<names.length;i++)for(const tube of neighbors.get(names[i])){
        edges.add(tube.id);
        const next=tube.from.node===names[i]?tube.to.node:tube.from.node;
        if(!visited.has(next)){
          visited.add(next);
          names.push(next);
        }
      }
      groups.push({nodes:names.sort(),tubes:[...edges].sort()});
    }
    return groups;
  }

  function compile(raw,{query,resolveSource,snapshot}={}) {
    check(fields(raw,['format','version','id','revision','tolerance','maxWork','nodes','paths','geometries',
      'tubes','ports','observations'])&&raw.format===format&&raw.version===1&&id(raw.id)&&revision(raw.revision),
    'Expected a version 1 branched domain with an ID and a positive revision');
    const {tolerance=1e-5,maxWork=24000000}=raw;
    check(Number.isFinite(tolerance)&&tolerance>=1e-8&&tolerance<=0.1&&integer(maxWork,1,100000000)&&
      (resolveSource===undefined||typeof resolveSource==='function')&&
      (snapshot===undefined||fields(snapshot,['world','tick'])&&id(snapshot.world)&&integer(snapshot.tick,0,W.runtime.maxTick)),
    'Invalid branched domain compile settings');

    const geometries=table(raw.geometries??{},'geometry',512,({revision:rev=1,asset,source,...extra},name)=>{
      check(!Object.keys(extra).length&&revision(rev)&&(asset===undefined||text(asset))&&
        (source===undefined||record(source)&&sourceKinds.includes(source.kind)&&
          (source.file===undefined||text(source.file))),'Invalid geometry entry '+name);
      return {id:name,revision:rev,...(asset!==undefined&&{asset}),
        ...(source&&{kind:source.kind,...(source.file!==undefined&&{file:source.file})})};
    });

    const nodes=table(raw.nodes,'node',512,(node,name)=>{
      const {kind,at,sockets,geometry,volume=0}=node, label='Domain node '+name;
      check(fields(node,['kind','at','sockets','geometry','volume'])&&nodeKinds.includes(kind)&&
        Number.isFinite(volume)&&volume>=0&&(!['cavity','reservoir'].includes(kind)||volume>0)&&
        (geometry===undefined||id(geometry)&&own(geometries,geometry)),label+' needs a kind, valid volume, and known geometry');
      const placement=locate(at,query,label);
      const pins=table(sockets??{},'socket',32,(pin,key)=>{
        const label='Domain socket '+name+'/'+key;
        check(fields(pin,['at','offset'])&&(pin.at===undefined||pin.offset===undefined),label+' needs at or offset');
        if(pin.at!==undefined){
          const located=locate(pin.at,query,label);
          return {point:located.point,placement:located.placement,tubes:[]};
        }
        const offset=pin.offset??[0,0,0];
        check(point(offset),label+' needs a finite XYZ offset');
        const position=V.add(placement.point,placement.rotation?M.app(placement.rotation,offset):offset);
        check(point(position),label+' is outside the coordinate range');
        return {point:position,offset:offset.slice(),tubes:[]};
      });
      if(!own(pins,'center'))pins.center={point:placement.point.slice(),offset:[0,0,0],tubes:[]};
      return {id:name,kind,point:placement.point,placement:placement.placement,volume,sockets:pins,tubes:[],
        ...(geometry!==undefined&&{geometry:geometries[geometry]})};
    });

    function socket(value,label) {
      const [node,key]=endpoint(value);
      check(own(nodes,node)&&own(nodes[node].sockets,key),label+' references unknown socket '+value);
      return {node,socket:key,point:nodes[node].sockets[key].point};
    }

    let retainedPoints=0;
    const paths=table(raw.paths,'path',512,(path,name)=>{
      const {points,guides,up,revision:rev=1}=path, polyline=points??guides;
      check(fields(path,['points','guides','up','revision'])&&(points===undefined)!==(guides===undefined)&&
        Array.isArray(polyline)&&integer(polyline.length,points===undefined?0:2,points===undefined?4095:4097)&&
        revision(rev)&&(up===undefined||point(up)&&V.len(up)>1e-8),'Invalid domain path '+name);
      retainedPoints+=polyline.length;
      check(retainedPoints<=65536,'Branched domain exceeds its path point budget');
      const placements=Array.from(polyline,value=>locate(value,query,'Domain path '+name));
      return {id:name,revision:rev,mode:points===undefined?'guides':'points',
        points:placements.map(row=>row.point),placements:placements.map(row=>row.placement),
        ...(up!==undefined&&{up:up.slice()})};
    });

    let work=0, sectionCount=0, contourPoints=0;
    const resolved=new Map(), routes=new Map();
    const tubes=table(raw.tubes,'tube',512,(tube,name)=>{
      const {from,to,path,geometry,sampling={}}=tube, label='Domain tube '+name;
      check(fields(tube,['from','to','path','geometry','sampling'])&&from!==to&&id(path)&&own(paths,path)&&
        id(geometry)&&own(geometries,geometry)&&geometries[geometry].kind&&
        fields(sampling,['samples','distances','selection','contours','epsilon']),
      label+' needs distinct sockets, a path, and measurable geometry');
      const start=socket(from,label), end=socket(to,label), track=paths[path];
      let points;
      if(track.mode==='guides')points=[start.point,...track.points,end.point];
      else {
        check(V.dist(track.points[0],start.point)<=tolerance&&V.dist(track.points.at(-1),end.point)<=tolerance,
          label+' path endpoints do not match its sockets');
        points=[start.point,...track.points.slice(1,-1),end.point];
      }
      const route=P.routes.polyline(points,{up:track.up});
      routes.set(name,route);
      if(!resolved.has(geometry)){
        const rawSource=raw.geometries[geometry].source;
        const source=resolveSource?resolveSource(rawSource,geometry):rawSource;
        check(source?.kind===geometries[geometry].kind,label+' geometry resolver changed the source kind');
        resolved.set(geometry,source);
      }
      check(work<maxWork,'Branched domain exceeds its total measurement budget');
      const measured=P.pathSections.measure({...sampling,path:points,up:track.up,
        source:resolved.get(geometry),maxWork:maxWork-work});
      work+=measured.work;
      sectionCount+=measured.sections.length;
      check(sectionCount<=32768,'Branched domain exceeds its section budget');
      const pathRef={id:path,revision:track.revision}, geometryRef=geometries[geometry];
      let volume=0;
      const rows=measured.sections.map(row=>{
        if(row.area!==null)volume+=row.area*row.sectionLength;
        for(const contour of row.contours??[])contourPoints+=contour.points.length;
        check(contourPoints<=1000000,'Branched domain exceeds its contour output budget');
        return {...row,id:name+'/'+row.index,origin:{path:pathRef,geometry:geometryRef,station:row.index}};
      });
      check(Number.isFinite(volume),label+' estimate exceeds the volume range');
      for(const attachment of [start,end]){
        const node=nodes[attachment.node];
        node.sockets[attachment.socket].tubes.push(name);
        if(node.tubes.at(-1)!==name)node.tubes.push(name);
      }
      return {id:name,from:start,to:end,path:pathRef,geometry:geometryRef,points:route.points,length:measured.pathLength,
        complete:measured.complete,volume:measured.complete?volume:null,minima:measured.minima,sections:rows};
    });

    const ports=table(raw.ports??{},'port',512,(port,name)=>{
      check(fields(port,['kind','socket'])&&['inlet','outlet'].includes(port.kind),
        'Domain port '+name+' needs an inlet or outlet kind and a socket');
      return {id:name,kind:port.kind,...socket(port.socket,'Domain port '+name)};
    });
    const observations=table(raw.observations??{},'observation',1024,(row,name)=>{
      const label='Domain observation '+name;
      if(own(row,'socket')){
        check(fields(row,['socket']),label+' must select one site');
        return {id:name,kind:'socket',...socket(row.socket,label)};
      }
      check(fields(row,['tube','section','t','distance'])&&id(row.tube)&&own(tubes,row.tube)&&
        ['section','t','distance'].filter(key=>own(row,key)).length===1,label+' needs a tube and one station selector');
      const tube=tubes[row.tube];
      if(own(row,'section')){
        check(integer(row.section,0,tube.sections.length-1),label+' section index is outside the tube');
        const section=tube.sections[row.section];
        return {id:name,kind:'tube',tube:tube.id,section:section.id,distance:section.distance,t:section.t,point:section.point};
      }
      const distance=own(row,'t')?row.t*tube.length:row.distance;
      check((!own(row,'t')||Number.isFinite(row.t))&&Number.isFinite(distance)&&distance>=0&&distance<=tube.length,
        label+' arc position is outside the tube');
      const current=tube.sections.find(section=>distance<section.span[1])??tube.sections.at(-1);
      const t=distance/tube.length;
      return {id:name,kind:'tube',tube:tube.id,section:current.id,distance,t,point:routes.get(tube.id).sample(t).point};
    });

    check(Object.keys(nodes).length>1&&Object.keys(tubes).length>0,'A branched domain needs nodes and at least one tube');
    return freeze({format:compiledFormat,version:1,id:raw.id,revision:raw.revision,...(snapshot&&{snapshot:copy(snapshot)}),
      complete:Object.values(tubes).every(tube=>tube.complete),nodes,paths,geometries,tubes,ports,observations,
      components:components(nodes,tubes),sectionCount,work});
  }

  function trace(domain,name) {
    check(domain?.format===compiledFormat&&domain.version===1,'Expected a compiled branched domain');
    const [tubeID,station]=endpoint(name);
    const tube=own(domain.tubes,tubeID)?domain.tubes[tubeID]:undefined;
    const section=/^(0|[1-9]\d*)$/.test(station)?tube?.sections?.[Number(station)]:undefined;
    check(section?.id===name,'Unknown domain section '+name);
    const {id,revision,snapshot}=domain;
    return freeze(copy({domain:{id,revision,...(snapshot&&{snapshot})},tube:tubeID,from:tube.from,to:tube.to,
      path:domain.paths[section.origin.path.id],section}));
  }

  W.domains=Object.freeze({format,compiledFormat,compile,trace});
})(KIT);
