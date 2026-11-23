/* Compile finite-volume cells and oriented faces in authored world coordinates. */
(function(K) {
  const W=K.world, P=K.procedural, {V}=K;
  const {check,id,own,record}=W.data, {freeze}=P.data;
  const format='ink-studio/discretization-plan', compiledFormat='ink-studio/compiled-discretization';
  const xyz=['x','y','z'], uv=['u0','u1','v0','v1'];
  const sides=[...xyz.flatMap(a=>[a+'0',a+'1']),...uv];
  const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
  const number=v=>Number.isFinite(v)&&Math.abs(v)<=1e7;
  const tuple=(p,n,test=number)=>Array.isArray(p)&&p.length===n&&Array.from(p).every(test);
  const selectors=(o,keys)=>record(o)&&Object.keys(o).every(k=>keys.includes(k));
  const keyOf=a=>a.join(',');
  const faceKey=ids=>ids.slice().sort((a,b)=>a-b).join(':');
  const array=v=>Array.isArray(v)||ArrayBuffer.isView(v)&&typeof v.length==='number';
  const positive=v=>Number.isFinite(v)&&v>0;
  const average=points=>points.reduce((acc,p)=>V.mad(acc,p,1/points.length),[0,0,0]);
  const unit=p=>V.mul(p,1/V.len(p));

  function polygon(points) {
    let area=0, weight=[0,0,0], vector=[0,0,0];
    const a=points[0];
    for(let i=1;i+1<points.length;i++){
      const b=V.sub(points[i],a), c=V.sub(points[i+1],a), cross=V.cross(b,c), measure=V.len(cross)*0.5;
      area+=measure;
      vector=V.add(vector,cross);
      weight=V.mad(weight,V.add(b,c),measure/3);
    }
    return positive(area)&&positive(V.len(vector)) ?
      {area,center:V.mad(a,weight,1/area),normal:unit(vector)} : null;
  }

  function shell(faces) {
    const origin=average(faces.flatMap(face=>face.points)), surface=[];
    let volume=0, moment=[0,0,0];
    for(const face of faces){
      let points=face.points;
      const geometry=polygon(points);
      if(!geometry)continue;
      if(V.dot(geometry.normal,V.sub(geometry.center,origin))<0)points=points.slice().reverse();
      const a=V.sub(points[0],origin);
      for(let i=1;i+1<points.length;i++){
        const b=V.sub(points[i],origin),c=V.sub(points[i+1],origin);
        const weight=V.dot(a,V.cross(b,c))/6;
        volume+=weight;
        moment=V.mad(moment,V.add(a,V.add(b,c)),weight/4);
      }
      surface.push({...face,points});
    }
    return positive(volume)?{volume,center:V.mad(origin,moment,1/volume),surface}:null;
  }

  function storage(dimension,tolerance,maxCells,maxFaces) {
    const vertices=[],cells=[],faces=[],keys=new Map(),points=new Map();
    function vertex(point,key=keyOf(point)) {
      if(!points.has(key)){
        check(vertices.length<maxFaces*4,'Discretization exceeds its vertex budget');
        check(tuple(point,3),'Discretization vertex exceeds its coordinate range');
        points.set(key,vertices.length);
        vertices.push(point.slice());
      }
      return points.get(key);
    }
    function sameFace(a,b) {
      return a.length===b.length&&a.every(i=>b.some(j=>V.dist(vertices[i],vertices[j])<=tolerance));
    }
    function add(cell,descriptors) {
      check(cells.length<maxCells,'Discretization exceeds its cell budget');
      check(positive(cell.measure)&&tuple(cell.center,3),'Degenerate discretization cell '+cell.id);
      const index=cells.length, out={...cell,faces:[],neighbors:[],signs:[]};
      cells.push(out);
      for(const {indices,origin,key} of descriptors){
        const ps=indices.map(i=>vertices[i]);
        const edge=ps.length===2, stats=edge ? {
          area:V.dist(ps[0],ps[1]),center:V.lerp(ps[0],ps[1],0.5),
          normal:V.cross(V.sub(ps[1],ps[0]),cell.normal)
        } : polygon(ps);
        check(stats&&positive(stats.area)&&positive(V.len(stats.normal)),'Degenerate face on '+cell.id);
        const {area,center}=stats, outward=unit(stats.normal);
        const sign=V.dot(outward,V.sub(center,cell.center))>=0?1:-1;
        const normal=V.mul(outward,sign), oriented=sign===1?indices:indices.slice().reverse();
        const distance=V.dot(normal,V.sub(center,cell.center));
        check(positive(distance),'Cell centre lies on its face: '+cell.id);
        const previous=keys.get(key);
        if(previous===undefined){
          const next=faces.length;
          check(next<maxFaces,'Discretization exceeds its face budget');
          keys.set(key,next);
          faces.push({id:next,owner:index,neighbor:null,vertices:oriented,center,normal,area,
            ownerDistance:distance,neighborDistance:null,neighborNormal:null,origin,region:null});
          out.faces.push(next);
          out.neighbors.push(null);
          out.signs.push(1);
        }else{
          const face=faces[previous], owner=cells[face.owner];
          check(face.neighbor===null&&face.owner!==index,'Non-manifold face on '+cell.id);
          check(sameFace(face.vertices,oriented)&&Math.abs(face.area-area)<=Math.max(tolerance**(dimension-1),area*1e-6),
            'Adjacent cells disagree on face geometry at '+cell.id);
          check(dimension===2||V.dot(face.normal,normal)<-1+1e-6,'Volume cells overlap at '+cell.id);
          face.neighbor=index;
          face.origin={...face.origin,kind:'interior'};
          face.neighborDistance=distance;
          face.neighborNormal=normal;
          owner.neighbors[owner.faces.indexOf(previous)]=index;
          out.faces.push(previous);
          out.neighbors.push(face.owner);
          out.signs.push(-1);
        }
      }
      return index;
    }
    return {vertices,cells,faces,vertex,add};
  }

  function grids(source,limits) {
    const native=source.grid;
    const counts=source.size??native?.counts??(source.depth===undefined?
      [source.width,source.height]:[source.width,source.height,source.depth]);
    const dimension=counts?.length;
    const inputSpacing=source.spacing??native?.spacing??1;
    const spacing=typeof inputSpacing==='number'?Array(dimension).fill(inputSpacing):inputSpacing;
    const plane=source.plane??'xy', flat=dimension===2&&plane==='xz';
    const axes=dimension===3?[0,1,2]:flat?[0,2]:[0,1];
    const rawOrigin=source.origin??native?.origin??Array(dimension).fill(0);
    const origin=dimension===2&&Array.isArray(rawOrigin)&&rawOrigin.length===2?
      flat?[rawOrigin[0],0,rawOrigin[1]]:[...rawOrigin,0] : rawOrigin;
    const {blocks,cutPlanes=[],mask}=source;
    check((dimension===2||dimension===3)&&tuple(counts,dimension,n=>integer(n,1,1000000))&&
      tuple(spacing,dimension,n=>number(n)&&n>=1e-4)&&tuple(origin,3)&&
      (mask===undefined||typeof mask==='function')&&Array.isArray(cutPlanes)&&cutPlanes.length<=24&&
      (dimension===3?source.plane===undefined:cutPlanes.length===0&&['xy','xz'].includes(plane))&&(!native||['image','volume'].includes(native.kind)&&
        tuple(native.boundary,dimension,value=>value==='closed')&&Array.isArray(native.cells)),
    'Invalid regular grid, cut planes, or native grid boundary');
    check(counts.every((n,i)=>number(origin[axes[i]]+n*spacing[i])),'Grid exceeds its coordinate range');
    const active=native?new Set(native.cells.map(cell=>keyOf(cell.address))):null;
    const cuts=new Map();
    for(const row of cutPlanes){
      check(selectors(row,['id','normal','offset','tag'])&&id(row.id)&&!cuts.has(row.id)&&tuple(row.normal,3)&&
        V.len(row.normal)>1e-8&&number(row.offset)&&(row.tag===undefined||id(row.tag)),'Invalid cut plane');
      const length=V.len(row.normal);
      cuts.set(row.id,{normal:V.mul(row.normal,1/length),offset:row.offset/length,tag:'cut:'+row.id,
        region:row.tag??row.id,id:row.id});
    }
    const blockEntries=blocks===undefined?[['grid',{index:Array(dimension).fill(0),size:counts}]]:
      record(blocks)?Object.entries(blocks).sort(([a],[b])=>a<b?-1:a>b?1:0):[];
    check(blockEntries.length>=1&&blockEntries.length<=4096,'Grid needs a bounded sparse block table');
    const candidates=new Map(), blockRows=Object.create(null);
    let budget=0;
    for(const [name,block] of blockEntries){
      check(id(name)&&record(block)&&tuple(block.index,dimension,n=>integer(n,0,1000000))&&
        tuple(block.size,dimension,n=>integer(n,1,1000000))&&
        block.index.every((n,i)=>n+block.size[i]<=counts[i]),'Invalid sparse block '+name);
      const {index,size}=block, row={id:name,index:index.slice(),size:size.slice(),cells:[]};
      budget+=size.reduce((a,b)=>a*b,1);
      check(budget<=limits.maxCells,'Grid candidate cells exceed the cell budget');
      blockRows[name]=row;
      for(let z=0;z<(size[2]??1);z++)for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++){
        const address=dimension===2?[index[0]+x,index[1]+y]:[index[0]+x,index[1]+y,index[2]+z];
        const key=keyOf(address);
        check(!candidates.has(key),'Overlapping sparse blocks at '+key);
        candidates.set(key,{address,block:name});
      }
    }
    const out=storage(dimension,limits.tolerance,limits.maxCells,limits.maxFaces);
    const planeData=[...cuts.values()];
    const point=at=>{
      const p=origin.slice();
      for(let i=0;i<dimension;i++)p[axes[i]]+=at[i]*spacing[i];
      return p;
    };
    const references=[...candidates.values()].sort((a,b)=>
      ((a.address[2]??0)-(b.address[2]??0))||a.address[1]-b.address[1]||a.address[0]-b.address[0]);
    const step=(at,n,d)=>at.map((v,i)=>v+(i===n?d:0));
    function sideFace(at,axis,side,coords){
      const plane=step(at,axis,side), exposed=plane[axis]===0||plane[axis]===counts[axis];
      const key='grid:'+axis+':'+keyOf(plane);
      return {indices:coords.map(p=>out.vertex(p)),key,
        origin:{kind:exposed?'outer':'inactive',...(exposed&&{side:xyz[axes[axis]]+side}),address:plane}};
    }
    for(const {address,block} of references){
      const key=keyOf(address), center=point(address.map(v=>v+0.5));
      if(active&&!active.has(key)||mask&&!mask({id:key,address:address.slice(),position:center.slice()}))continue;
      const common={id:key,address,...(blocks!==undefined&&{block})};
      let index;
      if(dimension===2){
        const points=[address,step(address,0,1),address.map(n=>n+1),step(address,1,1)].map(point);
        const edges=[[1,0,0,1],[0,1,1,2],[1,1,2,3],[0,0,3,0]];
        index=out.add({...common,center,normal:flat?[0,1,0]:[0,0,1],measure:spacing[0]*spacing[1]},
          edges.map(([axis,side,a,b])=>sideFace(address,axis,side,[points[a],points[b]])));
      }else{
        const cube=[];
        for(let axis=0;axis<3;axis++){
          const u=(axis+1)%3,v=(axis+2)%3;
          for(let side=0;side<2;side++){
            const start=step(address,axis,side), a=step(start,u,1), b=step(start,v,1);
            const ring=[start,a,step(a,v,1),b].map(point);
            cube.push({points:side===0?ring.reverse():ring,tag:axis*2+side});
          }
        }
        const volume=spacing.reduce((a,b)=>a*b,1);
        const clipped=planeData.length?P.geometry.clipConvexFaces(cube,planeData):cube;
        if(!clipped.length)continue;
        const solid=shell(clipped);
        if(!solid||solid.volume<=volume*1e-12)continue;
        const descriptors=solid.surface.map(({points,tag})=>{
          if(typeof tag==='number')return sideFace(address,tag>>1,tag%2,points);
          const cut=cuts.get(tag.slice(4));
          return {indices:points.map(p=>out.vertex(p)),key:key+':'+tag,origin:{kind:'cut',cut:cut.id}};
        });
        index=out.add({...common,center:solid.center,measure:solid.volume,
          fraction:Math.min(1,solid.volume/volume)},descriptors);
      }
      blockRows[block].cells.push(index);
    }
    // A plane coincident with a lattice face can expose the face without creating a cap polygon.
    for(const face of out.faces)if(face.neighbor===null&&face.origin.kind!=='cut'){
      const cut=planeData.find(row=>V.dot(row.normal,face.normal)>1-1e-8&&face.vertices.every(i=>
        Math.abs(V.dot(row.normal,out.vertices[i])-row.offset)<=Math.min(1e-8,limits.tolerance)));
      if(cut)face.origin={...face.origin,kind:'cut',cut:cut.id};
    }
    return {...out,dimension,cutTags:new Map(planeData.map(row=>[row.id,row.region])),
      layout:{size:counts.slice(),spacing:spacing.slice(),origin:origin.slice(),...(dimension===2&&{plane}),
        ...(planeData.length&&{cutPlanes:planeData.map(({id,normal,offset,region})=>({id,normal,offset,tag:region}))}),
        ...(blocks!==undefined&&{blocks:blockRows})}};
  }

  function mesh(source,limits) {
    const data=source.mesh??source, positions=data.pos??data.positions;
    const tets=source.tetrahedra??data.tetrahedra;
    const indices=tets??data.tri??data.indices, dimension=tets===undefined?2:3, stride=dimension+1;
    const weld=source.weld??(indices===undefined);
    check(array(positions)&&positions.length>=3*stride&&positions.length%3===0&&
      (indices===undefined?positions.length%(3*stride)===0:array(indices)&&indices.length>=stride&&indices.length%stride===0)&&
      typeof weld==='boolean','Mesh discretization needs flat vertices and triangle or tetrahedron indices');
    const elements=indices===undefined?positions.length/(3*stride):indices.length/stride;
    const count=positions.length/3;
    check(elements<=limits.maxCells&&count<=limits.maxCells*4,'Mesh exceeds its element or vertex budget');
    const out=storage(dimension,limits.tolerance,limits.maxCells,limits.maxFaces), authored=[], seen=new Set();
    for(let i=0;i<count;i++){
      const p=[positions[i*3],positions[i*3+1],positions[i*3+2]];
      authored.push(out.vertex(p,weld?keyOf(p):'vertex:'+i));
    }
    const canonical=ids=>{
      check(tuple(ids,dimension,n=>integer(n,0,count-1)),'Invalid mesh boundary vertex selector');
      return faceKey(ids.map(i=>authored[i]));
    };
    for(let i=0;i<elements;i++){
      const ids=Array.from({length:stride},(_,j)=>{
        const n=indices===undefined?i*stride+j:indices[i*stride+j];
        check(integer(n,0,count-1),'Mesh element index out of range');
        return authored[n];
      });
      const element=faceKey(ids);
      check(new Set(ids).size===stride&&!seen.has(element),'Duplicate or collapsed mesh element '+i);
      seen.add(element);
      const pts=ids.map(n=>out.vertices[n]);
      const references=dimension===2?[[0,1],[1,2],[2,0]]:[[0,2,1],[0,1,3],[1,2,3],[2,0,3]];
      const volume=dimension===3?Math.abs(V.dot(V.sub(pts[1],pts[0]),V.cross(V.sub(pts[2],pts[0]),V.sub(pts[3],pts[0]))))/6:null;
      const triangle=dimension===2?polygon(pts):null;
      out.add({id:String(i),center:average(pts),measure:volume??triangle?.area,
        ...(dimension===2&&{normal:triangle?.normal})},references.map(face=>{
        const indices=face.map(i=>ids[i]);
        return {indices,key:faceKey(indices),origin:{kind:'mesh'}};
      }));
    }
    return {...out,dimension,canonical,layout:{weld}};
  }

  function charts(source,limits) {
    const {charts:rows,seams=[]}=source;
    check(Array.isArray(rows)&&integer(rows.length,1,64)&&Array.isArray(seams)&&seams.length<=128,
      'Invalid discretization chart table');
    const out=storage(2,limits.tolerance,limits.maxCells,limits.maxFaces), layout=[], byId=new Map(), joins=new Map();
    let size=0;
    for(const row of rows){
      const {id:name,width,height,carrier,mask}=row??{};
      check(id(name)&&!byId.has(name)&&integer(width,1,512)&&integer(height,1,512)&&
        typeof carrier?.sample==='function'&&(mask===undefined||typeof mask==='function'),'Invalid discretization chart');
      size+=width*height;
      check(size<=limits.maxCells,'Chart candidate cells exceed the cell budget');
      byId.set(name,row);
      layout.push({id:name,width,height});
    }
    const joinLayouts=[];
    function endpoint(at) {
      const chart=byId.get(at?.[0]), side=at?.[1];
      check(Array.isArray(at)&&at.length===2&&chart&&uv.includes(side),'Invalid chart seam endpoint');
      return {base:at[0]+':'+side,count:side[0]==='u'?chart.height:chart.width};
    }
    for(const [i,row] of seams.entries()){
      check(selectors(row,['a','b','reverse'])&&(row.reverse===undefined||typeof row.reverse==='boolean'),'Invalid chart seam');
      const a=endpoint(row.a),b=endpoint(row.b);
      check(a.base!==b.base&&!joins.has(a.base)&&!joins.has(b.base)&&a.count===b.count,
        'Chart seams need distinct unused sides and matching counts');
      joins.set(a.base,k=>'seam:'+i+':'+k);
      joins.set(b.base,k=>'seam:'+i+':'+(row.reverse?a.count-1-k:k));
      joinLayouts.push({a:row.a.slice(),b:row.b.slice(),reverse:row.reverse??false});
    }
    for(const {id:name,width,height,carrier,mask} of rows){
      const corners=new Map();
      function corner(x,y){
        const key=name+'/'+x+','+y;
        if(!corners.has(key))corners.set(key,out.vertex(carrier.sample([x/width,y/height])?.p,key));
        return corners.get(key);
      }
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const address=[name,x,y], id=name+'/'+x+','+y, q=[(x+0.5)/width,(y+0.5)/height];
        if(mask&&!mask({id,address:address.slice(),uv:q,position:carrier.sample(q)?.p?.slice()}))continue;
        const polygonIds=[corner(x,y),corner(x+1,y),corner(x+1,y+1),corner(x,y+1)];
        const face=polygon(polygonIds.map(i=>out.vertices[i]));
        check(face,'Degenerate chart cell '+id);
        const edges=[[y===0?'v0':null,x],[x===width-1?'u1':null,y],
          [y===height-1?'v1':null,x],[x===0?'u0':null,y]];
        out.add({id,address,center:face.center,measure:face.area,normal:face.normal},
          edges.map(([side,position],i)=>{
            const indices=[polygonIds[i],polygonIds[(i+1)%4]], key=joins.get(name+':'+side)?.(position)??faceKey(indices);
            return {indices,key,origin:{kind:side?'chart':'inactive',chart:name,...(side&&{side})}};
          }));
      }
    }
    return {...out,dimension:2,layout:{charts:layout,seams:joinLayouts}};
  }

  function regionsFor(compiled,rules,defaultRegion) {
    const result=Object.create(null);
    const touch=tag=>result[tag]??(result[tag]={faces:[],area:0});
    const normalized=Array.from(rules,row=>{
      check(selectors(row,['tag','side','chart','cut','bounds','vertices','kind'])&&id(row.tag)&&
        Object.keys(row).length>=2&&(row.side===undefined||sides.includes(row.side))&&
        (row.chart===undefined||id(row.chart))&&(row.cut===undefined||id(row.cut))&&
        (row.kind===undefined||['outer','inactive','cut','mesh','chart'].includes(row.kind))&&
        (row.bounds===undefined||tuple(row.bounds?.min,3)&&tuple(row.bounds?.max,3)&&
          row.bounds.min.every((n,i)=>n<=row.bounds.max[i]))&&
        (row.vertices===undefined||compiled.canonical&&Array.isArray(row.vertices)&&row.vertices.length<=8192),
      'Invalid boundary region rule');
      touch(row.tag);
      return {row,faces:row.vertices===undefined?null:new Set(Array.from(row.vertices,compiled.canonical))};
    });
    for(const [i,face] of compiled.faces.entries()){
      if(face.neighbor!==null)continue;
      const match=normalized.find(({row,faces})=>
        ['kind','side','chart','cut'].every(key=>row[key]===undefined||row[key]===face.origin[key])&&
        (row.bounds===undefined||face.center.every((v,axis)=>v>=row.bounds.min[axis]&&v<=row.bounds.max[axis]))&&
        (!faces||faces.has(faceKey(face.vertices))));
      const tag=match?.row.tag??compiled.cutTags?.get(face.origin.cut)??defaultRegion;
      face.region=tag;
      const entry=touch(tag);
      entry.faces.push(i);
      entry.area+=face.area;
    }
    return result;
  }

  function compile(plan) {
    check(selectors(plan,['format','version','id','revision','units','source','regions','defaultRegion','tolerance','maxCells','maxFaces'])&&
      plan.format===format&&plan.version===1&&id(plan.id)&&integer(plan.revision,1,Number.MAX_SAFE_INTEGER)&&
      record(plan.source),'Expected a version 1 discretization plan');
    const {source,units='world',regions=[],defaultRegion='wall',tolerance=1e-6,maxCells=65536,maxFaces=430000}=plan;
    check(typeof units==='string'&&units.trim()&&units.length<=48&&id(defaultRegion)&&Array.isArray(regions)&&regions.length<=128&&
      Number.isFinite(tolerance)&&tolerance>=1e-8&&tolerance<=0.05&&integer(maxCells,1,65536)&&integer(maxFaces,1,430000),
    'Invalid discretization units, boundary settings or work limits');
    const limit={tolerance,maxCells,maxFaces};
    const run=source.kind==='grid'?grids:source.kind==='charts'?charts:source.kind==='mesh'?mesh:null;
    check(run,'Unknown discretization source kind');
    const result=run(source,limit);
    check(result.cells.length>0,'Discretization has no active cells');
    const {dimension,layout,vertices,cells,faces}=result;
    const boundaries=regionsFor(result,regions,defaultRegion);
    const measure=cells.reduce((sum,row)=>sum+row.measure,0);
    return freeze({format:compiledFormat,version:1,id:plan.id,revision:plan.revision,kind:source.kind,dimension,units,layout,
      vertices,cells,faces,boundaries,measure});
  }
  W.discretization=Object.freeze({format,compiledFormat,compile});
})(KIT);
