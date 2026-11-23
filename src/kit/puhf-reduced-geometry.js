/* Reduce measured sections while retaining path, storage and junction identities. */
(function(K){
  const W=K.world, {check,id,record,vector}=W.data;
  const finite=Number.isFinite, positive=n=>finite(n)&&n>0;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;

  function rows(sections){
    check(Array.isArray(sections)&&integer(sections.length,1,32768),'A reduction needs measured sections');
    return Array.from(sections,(row,i)=>{
      const {span,area,sectionLength,perimeter,minimumOpening}=row??{};
      check(Array.isArray(span)&&span.length===2&&span.every(finite)&&span[0]>=0&&span[1]>span[0]&&
        (!i||span[0]===sections[i-1].span[1])&&finite(area)&&area>=0&&
        finite(sectionLength)&&Math.abs(span[1]-span[0]-sectionLength)<=1e-10,
      'Reduction needs contiguous, complete measured sections at index '+i);
      return {start:span[0],end:span[1],length:span[1]-span[0],area,perimeter,minimumOpening,id:row.id??i};
    });
  }

  function profile(sections,{segments=8,areaPower=1}={}){
    const input=rows(sections), count=input.length;
    check(integer(segments,1,256)&&finite(areaPower)&&areaPower>=0.5&&areaPower<=3,
      'Geometry reduction needs 1–256 segments and areaPower from 0.5 to 3');
    const totalLength=input.at(-1).end-input[0].start;
    const volume=input.reduce((sum,row)=>sum+row.area*row.length,0);
    const mean=volume/totalLength;
    const weight=new Float64Array(count+1), moment=new Float64Array(count+1), square=new Float64Array(count+1);
    for(let i=0;i<count;i++){
      const {length,area}=input[i], deviation=area-mean;
      weight[i+1]=weight[i]+length;
      moment[i+1]=moment[i]+deviation*length;
      square[i+1]=square[i]+deviation*deviation*length;
    }
    const squaredError=(a,b)=>{
      if(b-a===1)return 0;
      const d=moment[b]-moment[a];
      return Math.max(0,square[b]-square[a]-d*d/(weight[b]-weight[a]));
    };
    function group(start,end){
      const error=squaredError(start,end);
      let split=0, improvement=0;
      for(let i=start+1;i<end;i++){
        const delta=error-squaredError(start,i)-squaredError(i,end);
        if(delta>improvement){improvement=delta;split=i;}
      }
      return {start,end,split,improvement};
    }
    const groups=[group(0,count)];
    const wanted=Math.min(count,segments);
    while(groups.length<wanted){
      let best=0;
      for(let i=1;i<groups.length;i++)if(groups[i].improvement>groups[best].improvement)best=i;
      const {start,end,split}=groups[best];
      if(!split||groups[best].improvement<=square[count]*1e-14)break;
      groups.splice(best,1,group(start,split),group(split,end));
    }
    let error=0, maxAreaError=0, representedVolume=0, totalResistance=0, areaResistance=0;
    const spans=groups.map(({start,end},index)=>{
      const members=input.slice(start,end), length=members.at(-1).end-members[0].start;
      const volume=members.reduce((sum,row)=>sum+row.area*row.length,0), area=volume/length;
      const minArea=Math.min(...members.map(row=>row.area)), maxArea=Math.max(...members.map(row=>row.area));
      let resistance=0, boundary=0, minimumOpening=Infinity;
      for(const row of members){
        const difference=row.area-area;
        error+=row.length*difference*difference;
        maxAreaError=Math.max(maxAreaError,Math.abs(difference));
        if(row.area>0){
          const geometricResistance=row.length/row.area**areaPower;
          check(positive(geometricResistance),'Section resistance exceeded the numeric range');
          resistance+=geometricResistance;
        }
        boundary+=finite(row.perimeter)&&row.perimeter>=0?row.perimeter*row.length:NaN;
        if(finite(row.minimumOpening)&&row.minimumOpening>=0)minimumOpening=Math.min(minimumOpening,row.minimumOpening);
      }
      check(finite(resistance),'Span resistance exceeded the numeric range');
      if(minArea===0){resistance=Infinity;minimumOpening=0;}
      const uniformResistance=area===0?Infinity:length/area**areaPower;
      totalResistance+=resistance; areaResistance+=uniformResistance; representedVolume+=volume;
      return {index,span:[members[0].start,members.at(-1).end],length,volume,area,minArea,maxArea,
        perimeter:finite(boundary)?boundary/length:null,minimumOpening:finite(minimumOpening)?minimumOpening:null,
        resistance:finite(resistance)?resistance:null,conductance:finite(resistance)?1/resistance:0,
        reference:{first:members[0].id,last:members.at(-1).id,count:end-start}};
    });
    check([volume,representedVolume,error,maxAreaError].every(finite)&&
      spans.every(row=>finite(row.conductance)),'Reduced geometry exceeded the numeric range');
    return {range:{arc:[input[0].start,input.at(-1).end],sourceSections:count},areaPower,spans,
      volume:representedVolume,resistance:finite(totalResistance)?totalResistance:null,
      error:{volume:representedVolume-volume,areaRMSE:Math.sqrt(error/totalLength),maxAreaError,
        relativeAreaRMSE:mean?Math.sqrt(error/totalLength)/mean:0,
        uniformAreaResistance:finite(areaResistance)?areaResistance:null,
        uniformAreaResistanceError:finite(areaResistance)&&finite(totalResistance)?areaResistance-totalResistance:null}};
  }

  function network(domain,options){
    check(domain?.format===W.domains.compiledFormat&&domain.version===1&&domain.complete===true&&id(domain.id)&&
      record(domain.nodes)&&record(domain.tubes)&&record(domain.ports)&&record(domain.observations),
    'Network reduction needs a complete compiled branched domain');
    const tubes=Object.entries(domain.tubes), nodes={}, links={}, paths={};
    check(integer(tubes.length,1,512)&&integer(Object.keys(domain.nodes).length,2,512),'Invalid reduced network size');
    for(const [name,node] of Object.entries(domain.nodes)){
      check(id(name)&&finite(node?.volume)&&node.volume>=0&&vector(node.point)&&record(node.sockets),
        'Invalid reduced network node');
      const sockets=Object.fromEntries(Object.entries(node.sockets).map(([key,socket])=>{
        check(id(key)&&vector(socket?.point),'Invalid reduced network socket');
        return [key,socket.point];
      }));
      nodes[name]={kind:node.kind,position:node.point,volume:node.volume,sockets,
        ...(node.geometry!==undefined&&{geometry:node.geometry})};
    }
    let sourceSections=0, edgeCount=0, length=0;
    for(const [name,tube] of tubes){
      check(id(name)&&Object.hasOwn(nodes,tube.from.node)&&Object.hasOwn(nodes,tube.to.node),'Invalid reduced network tube');
      const reduced=profile(tube.sections,options), route=K.procedural.routes.polyline(tube.points);
      const ids=[];
      let from=tube.from.node;
      for(const segment of reduced.spans){
        const key=name+'/'+segment.index, last=segment.index===reduced.spans.length-1;
        const to=last?tube.to.node:key;
        if(!last)nodes[to]={kind:'section',position:route.sample(segment.span[1]/route.length).point,volume:0};
        links[key]={from,to,tube:name,...segment};
        ids.push(key);
        from=to;
      }
      edgeCount+=ids.length;
      sourceSections+=tube.sections.length;
      length+=tube.length;
      check(edgeCount<=32768&&sourceSections<=32768,'Reduced network exceeds its geometry budget');
      paths[name]={links:ids,range:reduced.range,reference:{path:tube.path,geometry:tube.geometry},
        volume:reduced.volume,resistance:reduced.resistance,error:reduced.error};
    }
    const observations=Object.fromEntries(Object.entries(domain.observations).map(([name,site])=>{
      if(site.kind!=='tube')return [name,{node:site.node,socket:site.socket,point:site.point}];
      const route=paths[site.tube].links;
      const link=route.find(key=>site.distance<links[key].span[1])??route.at(-1);
      return [name,{link,distance:site.distance,point:site.point}];
    }));
    const pathValues=Object.values(paths);
    return {range:{length,sourceSections,tubes:tubes.length},areaPower:options?.areaPower??1,nodes,links,paths,
      ports:Object.fromEntries(Object.entries(domain.ports).map(([key,{kind,node,socket,point}])=>[key,{kind,node,socket,point}])),
      observations,volume:pathValues.reduce((sum,row)=>sum+row.volume,0),
      error:{
        volume:pathValues.reduce((sum,row)=>sum+row.error.volume,0),
        maxAreaError:Math.max(...pathValues.map(row=>row.error.maxAreaError)),
        areaRMSE:Math.sqrt(pathValues.reduce((sum,row)=>sum+row.error.areaRMSE**2*(row.range.arc[1]-row.range.arc[0]),0)/length)
      }};
  }

  W.reducedGeometry=Object.freeze({profile,network});
})(KIT);
