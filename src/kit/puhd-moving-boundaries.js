/* Measure a seat and a corresponding moving surface along the seat normal. */
(function(K) {
  const W=K.world, {V,M}=K, {freeze}=K.procedural.data;
  const {check,copy,endpoint,id,record,own}=W.data;
  const fields=(o,keys)=>record(o)&&Object.keys(o).every(key=>keys.includes(key));
  const bounded=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const point=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(n=>bounded(n,-1e8,1e8));
  const nonnegative=n=>Number.isFinite(n)&&n>=0;
  const finiteOrNull=n=>n===null||Number.isFinite(n);
  const unit=v=>V.mul(v,1/V.len(v));
  const surfaceKey=face=>face.slice().sort((a,b)=>a-b).join(':');

  function anchor(value,offset=false) {
    return fields(value,offset?['entity','socket','offset']:['entity','socket'])&&
      id(value.entity)&&(value.socket===undefined||id(value.socket))&&
      (value.offset===undefined||point(value.offset));
  }

  function frame(query,selector) {
    const result=query?.frame?.({entity:selector.entity,...(selector.socket!==undefined&&{socket:selector.socket})});
    return point(result?.point)?result:null;
  }

  function worldPoint(query,selector) {
    if(point(selector))return selector;
    const at=frame(query,selector);
    if(!at)return null;
    if(selector.offset===undefined)return at.point;
    return V.add(at.point,at.rotation?M.app(at.rotation,selector.offset):selector.offset);
  }

  // Integrate the positive piece of an affine height function over a reference triangle.
  function positivePatch(a,b,c) {
    if(Math.max(a,b,c)<=0)return [0,0];
    if(Math.min(a,b,c)>=0)return [1,(a+b+c)/3];
    const triangle=[[0,0,a],[1,0,b],[0,1,c]], kept=[];
    for(let i=0;i<3;i++){
      const p=triangle[i], q=triangle[(i+1)%3];
      if(p[2]>0)kept.push(p);
      if((p[2]>0)!==(q[2]>0)){
        const t=p[2]/(p[2]-q[2]);
        kept.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1]),0]);
      }
    }
    let area=0, integral=0;
    const [x,y,h]=kept[0];
    for(let i=1;i+1<kept.length;i++){
      const [u,v,g]=kept[i], [s,t,k]=kept[i+1];
      const weight=Math.abs((u-x)*(t-y)-(v-y)*(s-x));
      area+=weight;
      integral+=weight*(h+g+k)/3;
    }
    return [area,integral];
  }

  function positiveEdge(a,b) {
    if(Math.min(a,b)>=0)return (a+b)/2;
    const high=Math.max(a,b);
    return high<=0?0:0.5*high*(high/Math.abs(a-b));
  }

  function prepare(raw) {
    check(fields(raw,['seat','moving','mode','sealGap','referenceVolume','maxSlip'])&&
      fields(raw.seat,['points','triangles','normal','frame']),'Moving boundary needs seat geometry and moving vertices');
    const spec=freeze(copy(raw)), {seat,moving,mode='curtain',sealGap=0,referenceVolume,maxSlip}=spec;
    const {points,triangles,normal,frame:placement}=seat;
    check(['curtain','projected'].includes(mode)&&bounded(sealGap,0,1e8)&&
      (referenceVolume===undefined||nonnegative(referenceVolume))&&(maxSlip===undefined||bounded(maxSlip,0,1e8))&&
      Array.isArray(points)&&integer(points.length,3,1024)&&Array.from(points).every(point)&&
      Array.isArray(triangles)&&integer(triangles.length,1,2048)&&point(normal)&&V.len(normal)>1e-8&&
      (placement===undefined||anchor(placement)),'Invalid moving boundary seat or settings');
    const isVertex=index=>integer(index,0,points.length-1);
    const n=unit(normal), origin=points[0], edges=new Map(), seen=new Set(), used=new Set();
    check(points.every(p=>Math.abs(V.dot(V.sub(p,origin),n))<=1e-7),
      'Moving boundary seat must be planar');
    let seatArea=0;
    const patches=Array.from(triangles,face=>{
      check(Array.isArray(face)&&face.length===3&&Array.from(face).every(isVertex)&&new Set(face).size===3,
        'Invalid moving boundary triangle');
      const key=surfaceKey(face);
      check(!seen.has(key),'Duplicate moving boundary triangle');
      seen.add(key);
      const [a,b,c]=face.map(i=>points[i]);
      const twice=V.dot(V.cross(V.sub(b,a),V.sub(c,a)),n), area=Math.abs(twice)/2;
      check(Number.isFinite(area)&&area>0,'Degenerate moving boundary triangle');
      seatArea+=area;
      const ids=twice>0?face:face.slice().reverse();
      for(let i=0;i<3;i++){
        const a=ids[i],b=ids[(i+1)%3], key=Math.min(a,b)+':'+Math.max(a,b), prior=edges.get(key);
        used.add(a);
        if(prior){
          check(!prior.shared&&prior.a===b&&prior.b===a,'Non-manifold or overlapping moving boundary triangles');
          prior.shared=true;
        }else edges.set(key,{a,b,length:V.dist(points[a],points[b])});
      }
      return {indices:ids,area};
    });
    check(used.size===points.length,'Every moving boundary vertex must belong to the seat');
    const rim=[...edges.values()].filter(edge=>!edge.shared);
    check(rim.length>0&&Number.isFinite(seatArea),'A moving boundary needs a finite seat with a rim');
    const active=mode==='curtain'?[...new Set(rim.flatMap(({a,b})=>[a,b]))]:[...used];
    const cloth=!Array.isArray(moving);
    if(cloth){
      check(fields(moving,['field','shape','nodes'])&&typeof moving.field==='string'&&id(moving.shape)&&
        Array.isArray(moving.nodes)&&moving.nodes.length===points.length&&
        Array.from(moving.nodes).every(value=>integer(value,0,2047))&&new Set(moving.nodes).size===points.length,
      'Cloth boundaries need a surface field, shape, and one node per seat vertex');
      endpoint(moving.field);
    }else check(moving.length===points.length&&Array.from(moving).every(value=>point(value)||anchor(value,true)),
      'Moving boundary needs one world point or socket per seat vertex');
    const needed=cloth?patches.map(({indices})=>surfaceKey(indices.map(i=>moving.nodes[i]))):[];

    function evaluate(positions,{seatOrigin,seatRotation,reference=referenceVolume}={}) {
      check(Array.isArray(positions)&&positions.length===points.length&&Array.from(positions).every(point),
        'Moving boundary positions must match its seat');
      check((seatOrigin===undefined||point(seatOrigin))&&(seatRotation===undefined||
        Array.isArray(seatRotation)&&seatRotation.length===9&&seatRotation.every(Number.isFinite))&&
        (reference===undefined||nonnegative(reference)),'Invalid moving boundary frame or reference volume');
      if(seatRotation){
        const gram=M.mul(seatRotation,M.tr(seatRotation)), identity=M.id();
        check(gram.every((v,i)=>Math.abs(v-identity[i])<=1e-7)&&Math.abs(M.det(seatRotation)-1)<=1e-7,
          'Moving boundary seat frame must be a rigid rotation');
      }
      const rotate=p=>seatRotation?M.app(seatRotation,p):p;
      const direction=rotate(n);
      const world=points.map(p=>seatOrigin?V.add(seatOrigin,rotate(p)):rotate(p));
      let slip=0;
      const gaps=positions.map((p,i)=>{
        const delta=V.sub(p,world[i]), gap=V.dot(delta,direction);
        if(maxSlip!==undefined)slip=Math.max(slip,V.len(V.mad(delta,direction,-gap)));
        return gap;
      });
      if(maxSlip!==undefined&&slip>maxSlip)return {status:'unavailable',reason:'seat correspondence exceeded maxSlip'};
      const clearance=gaps.map(gap=>gap-sealGap);
      let openArea=0,pocketVolume=0,curtainArea=0;
      for(const {indices,area} of patches){
        const [fraction,height]=positivePatch(...indices.map(i=>gaps[i]));
        openArea+=area*(sealGap===0?fraction:positivePatch(...indices.map(i=>clearance[i]))[0]);
        pocketVolume+=area*height;
      }
      if(mode==='curtain')for(const {a,b,length} of rim)
        curtainArea+=length*positiveEdge(clearance[a],clearance[b]);
      const effective=Math.min(seatArea,mode==='curtain'?curtainArea:openArea);
      const sealed=active.every(i=>clearance[i]<=0);
      const aperture=sealed?0:effective;
      const rawGap=active.map(i=>gaps[i]), hydraulic=active.map(i=>clearance[i]);
      return {status:sealed?'sealed':'open',seatArea,aperture,opening:aperture/seatArea,openArea:Math.min(seatArea,openArea),
        minGap:Math.max(0,Math.min(...hydraulic)),maxGap:Math.max(0,Math.max(...hydraulic)),
        penetration:Math.max(0,-Math.min(...rawGap)),pocketVolume,
        displacedVolume:reference===undefined?null:reference-pocketVolume};
    }

    function sample(query,reference) {
      const placed=placement?frame(query,placement):null;
      if(placement&&!placed)return {status:'unavailable',reason:'seat frame is missing'};
      let locations;
      if(cloth){
        const read=query?.probe?.(moving.field), value=read?.value;
        const row=read?.status==='ok'&&own(value,moving.shape)?value[moving.shape]:null;
        if(!Array.isArray(row?.points)||!Array.isArray(row.faces))return {status:'unavailable',reason:'cloth shape is missing'};
        const active=new Set(row.faces.filter(Boolean).map(surfaceKey));
        if(!needed.every(key=>active.has(key)))return {status:'unavailable',reason:'cloth patch is missing or torn'};
        locations=moving.nodes.map(i=>row.points[i]);
      }else locations=moving.map(value=>worldPoint(query,value));
      if(!locations.every(point))return {status:'unavailable',reason:'moving vertex is missing'};
      return evaluate(locations,{seatOrigin:placed?.point,seatRotation:placed?.rotation??undefined,reference});
    }
    return Object.freeze({evaluate,sample,seatArea,referenceVolume,field:cloth?moving.field:undefined});
  }

  function system(config) {
    check(fields(config,['boundaries','conditions'])&&record(config.boundaries)&&integer(Object.keys(config.boundaries).length,1,64),
      'Moving boundary system needs a table of named boundaries');
    let vertices=0;
    const applied=config.conditions===undefined?null:W.boundaryConditions.bound(config.conditions,[]);
    const plans=Object.entries(config.boundaries).map(([name,spec])=>{
      check(id(name)&&name.length<=75,'Invalid moving boundary ID');
      const fromAsset=fields(spec,['rule'])&&id(spec.rule);
      check(!fromAsset||applied,'Moving-wall rule needs a boundary set');
      const plan=fromAsset?applied.wall(spec.rule):prepare(spec);
      vertices+=fromAsset?plan.vertexCount:spec.seat.points.length;
      check(vertices<=4096,'Moving boundary system exceeds its seat vertex budget');
      return [name,plan];
    });
    const properties={aperture:'number',opening:'number','min-gap':'number','max-gap':'number',
      'displaced-volume':'number','volume-change':'number',sealed:'bool',available:'bool'};
    const outputs=Object.fromEntries(plans.flatMap(([name])=>Object.entries(properties).map(([key,type])=>[key+'.'+name,type])));
    function measure(state,query,emit,time=0) {
      return Object.fromEntries(plans.map(([name,plan])=>{
        const prior=state[name], reference=prior?.reference??plan.referenceVolume;
        const result=plan.sample(query,reference,time);
        if(result.status==='unavailable')return [name,{...result,reference:reference??null,volumeChange:null}];
        const baseline=reference??result.pocketVolume;
        const volumeChange=prior?.pocketVolume===undefined?0:prior.pocketVolume-result.pocketVolume;
        if(prior&&prior.status!=='unavailable'&&prior.status!==result.status)
          emit?.(result.status==='sealed'?'boundary-sealed':'boundary-opened',
            {boundary:name,aperture:result.aperture,maxGap:result.maxGap});
        return [name,{...result,reference:baseline,displacedVolume:baseline-result.pocketVolume,volumeChange}];
      }));
    }
    return {combinational:true,outputs,initial:()=>({}),settleInitial:(state,{query})=>measure(state,query),
      checkFields(query) {
        for(const [name,plan] of plans)if(plan.field)
          check(query.field(plan.field)?.role==='deformable-surfaces','Moving boundary '+name+' needs a deformable surfaces field');
      },
      step:(state,{query,emit,time})=>measure(state,query,emit,time),
      validateState(state) {
        check(record(state)&&Object.keys(state).length===plans.length,'Invalid moving boundary checkpoint');
        for(const [name,plan] of plans){
          const row=state[name];
          check(record(row)&&['unavailable','open','sealed'].includes(row.status)&&
            (row.reference===null||nonnegative(row.reference))&&finiteOrNull(row.volumeChange),
          'Invalid moving boundary checkpoint '+name);
          if(row.status==='unavailable')check(typeof row.reason==='string'&&row.volumeChange===null,'Invalid unavailable boundary');
          else check(row.seatArea===plan.seatArea&&['aperture','opening','openArea','minGap','maxGap','penetration','pocketVolume','reference']
            .every(key=>nonnegative(row[key]))&&row.aperture<=row.seatArea&&row.openArea<=row.seatArea&&
            row.opening===row.aperture/row.seatArea&&row.minGap<=row.maxGap&&(row.status==='sealed')===(row.aperture===0)&&
            row.displacedVolume===row.reference-row.pocketVolume&&Number.isFinite(row.volumeChange),'Invalid measured boundary '+name);
        }
      },
      output(state) {
        const result={};
        for(const [name] of plans){
          const row=state[name], available=row?.status==='open'||row?.status==='sealed';
          const values={aperture:row?.aperture,opening:row?.opening,'min-gap':row?.minGap,'max-gap':row?.maxGap,
            'displaced-volume':row?.displacedVolume,'volume-change':row?.volumeChange,sealed:row?.status==='sealed',available};
          for(const [key,value] of Object.entries(values))result[key+'.'+name]=value??0;
        }
        return result;
      },
      fields:{boundaries:{type:'record',selector:true,read({state,args}){
        const {boundary}=args;
        return boundary===undefined?W.query.ok(state):own(state,boundary)?W.query.ok(state[boundary]):W.query.missing('unknown moving boundary');
      }}}
    };
  }
  W.movingBoundaries=Object.freeze({prepare});
  W.runtime.register('moving-boundaries',system);
})(KIT);
