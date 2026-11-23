/* Versioned authored, analytic and measured-geometry modal assets. */
(function(K){
  const W=K.world,{V}=K,{check,record,vector,id,own,copy}=W.data, {freeze}=K.procedural.data;
  const planFormat='ink-studio/resonant-mode-plan', assetFormat='ink-studio/resonant-modes';
  const finite=Number.isFinite, positive=n=>finite(n)&&n>0, nonnegative=n=>finite(n)&&n>=0;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const fields=(v,keys)=>record(v)&&Object.keys(v).every(key=>keys.includes(key));
  const inputKinds=['authored','string','rectangle','mesh'];
  const originDefault=[0,0,0], axesDefault=[[1,0,0],[0,1,0]];
  const meshSettings=['count','speed','density','fixed','fixedVertices','decay','decayPerHz',
    'maxSweeps','tolerance','residualTolerance','maxWork'];

  function direction(value){
    const size=vector(value)?V.len(value):0;
    check(positive(size),'Modal axis must be a finite direction');
    return V.mul(value,1/size);
  }

  function analytic(source){
    const {kind,count=12,speed,density=1,decay=4,decayPerHz=0,origin=originDefault}=source;
    const line=kind==='string';
    const sizes=line?[source.length]:source.size, rawAxes=line?[source.axis??axesDefault[0]]:source.axes??axesDefault;
    check(fields(source,['kind','count','speed','density','decay','decayPerHz','origin',...(line?['axis','length']:['axes','size'])])&&
      integer(count,1,64)&&positive(speed)&&positive(density)&&nonnegative(decay)&&nonnegative(decayPerHz)&&vector(origin)&&
      vector(sizes,line?1:2)&&sizes.every(positive)&&Array.isArray(rawAxes)&&rawAxes.length===sizes.length,
    'Invalid analytic modal settings');
    const axes=Array.from(rawAxes,direction);
    check(line||Math.abs(V.dot(axes[0],axes[1]))<=1e-10,'Modal rectangle axes must be orthogonal');
    const normalization=Math.sqrt(2**sizes.length/(density*sizes.reduce((a,b)=>a*b,1)));
    check(positive(normalization),'Analytic modal mass normalization exceeded range');
    const candidates=[];
    for(let i=1;i<=count;i++)for(let j=1;j<=(line?1:count);j++){
      const order=line?[i]:[i,j], hz=speed*.5*Math.hypot(...order.map((n,k)=>n/sizes[k]));
      candidates.push({hz,order});
    }
    candidates.sort((a,b)=>a.hz-b.hz||a.order[0]-b.order[0]||(a.order[1]??0)-(b.order[1]??0));
    const modes=candidates.slice(0,count).map(({hz,order},i)=>({id:'mode-'+(i+1),hz,decay:decay+decayPerHz*hz,order}));
    return {modes,geometry:{kind,origin,axes,sizes,normalization},evidence:{algorithm:'analytic-pinned-'+kind}};
  }

  function validateModes(modes,geometry){
    const kind=geometry.kind, seen=new Set();
    check(Array.isArray(modes)&&integer(modes.length,1,64),'Modal asset needs 1–64 modes');
    for(const mode of modes){
      const fieldsByKind=kind==='mesh'?['shape','relativeResidual']:kind==='authored'?[]:['order'];
      check(fields(mode,['id','hz','decay',...fieldsByKind])&&id(mode.id)&&!seen.has(mode.id)&&positive(mode.hz)&&nonnegative(mode.decay),
        'Invalid or duplicate resonant mode');
      seen.add(mode.id);
      if(kind==='mesh')check(vector(mode.shape,geometry.vertices.length)&&nonnegative(mode.relativeResidual),'Invalid mesh mode shape');
      else if(kind!=='authored')check(vector(mode.order,geometry.sizes.length)&&mode.order.every(n=>integer(n,1,64)),
        'Invalid analytic mode order');
    }
  }

  function locator(geometry,modes){
    const {kind}=geometry;
    check(inputKinds.includes(kind),'Unknown modal geometry');
    let sample;
    if(kind==='mesh'){
      const {dimension,vertices,elements}=geometry;
      check([2,3].includes(dimension)&&Array.isArray(vertices)&&integer(vertices.length,dimension+1,4096)&&
        Array.from(vertices).every(v=>vector(v))&&Array.isArray(elements)&&integer(elements.length,1,4096),
      'Invalid modal asset mesh geometry');
      const extrema=[...vertices[0]], highs=extrema.slice();
      for(const row of vertices)for(let i=0;i<3;i++){extrema[i]=Math.min(extrema[i],row[i]);highs[i]=Math.max(highs[i],row[i]);}
      const planeTol=1e-8*V.len(V.sub(highs,extrema))+8*Number.EPSILON*Math.max(...extrema.map(Math.abs),...highs.map(Math.abs));
      const cells=Array.from(elements,indices=>{
        check(Array.isArray(indices)&&indices.length===dimension+1&&indices.every(i=>integer(i,0,vertices.length-1)),
          'Invalid modal asset simplex indices');
        return {indices,...W.modalMesh.simplex(vertices,indices,dimension)};
      });
      sample=point=>{
        for(const cell of cells){
          const delta=V.sub(point,cell.point);
          if(cell.normal&&Math.abs(V.dot(delta,cell.normal))>planeTol)continue;
          const tail=cell.tails.map(g=>V.dot(g,delta)), weights=[1-tail.reduce((a,b)=>a+b,0),...tail];
          if(weights.some(value=>value< -1e-8||value>1+1e-8))continue;
          const clipped=weights.map(value=>Math.min(1,Math.max(0,value))), scale=clipped.reduce((a,b)=>a+b,0);
          return modes.map(mode=>cell.indices.reduce((sum,j,i)=>sum+mode.shape[j]*clipped[i]/scale,0));
        }
        throw Error('Modal site lies outside the mesh');
      };
    }else if(kind!=='authored'){
      const {origin,axes,sizes,normalization}=geometry, dim=kind==='string'?1:2;
      check(vector(origin)&&Array.isArray(axes)&&axes.length===dim&&Array.from(axes).every(axis=>vector(axis)&&
        Math.abs(V.len(axis)-1)<1e-9)&&(dim===1||Math.abs(V.dot(axes[0],axes[1]))<1e-9)&&
        vector(sizes,dim)&&sizes.every(positive)&&positive(normalization),'Invalid analytic modal geometry');
      sample=point=>{
        const delta=V.sub(point,origin), distance=axes.map(axis=>V.dot(delta,axis));
        const off=axes.reduce((left,axis,i)=>V.mad(left,axis,-distance[i]),delta);
        const precision=Math.max(...sizes)*1e-8+8*Number.EPSILON*Math.max(...origin.map(Math.abs),...point.map(Math.abs));
        check(V.len(off)<=precision&&distance.every((u,i)=>u>=-precision&&u<=sizes[i]+precision),
          'Modal site lies outside the analytic resonator');
        const s=distance.map((u,i)=>Math.max(0,Math.min(1,u/sizes[i])));
        return modes.map(mode=>s.reduce((gain,u,i)=>gain*(u===0||u===1?0:Math.sin(Math.PI*mode.order[i]*u)),normalization));
      };
    }
    validateModes(modes,geometry);
    function site(row,name){
      check(fields(row,kind==='authored'?['point','gains']:['point'])&&vector(row.point)&&
        (kind!=='authored'||vector(row.gains,modes.length)),'Invalid modal site '+name);
      const gains=sample?sample(row.point):row.gains.slice();
      check(gains.every(finite),'Modal site gain exceeded numeric range '+name);
      return {point:row.point.slice(),gains};
    }
    return {site,sample};
  }

  function siteTable(table,location,label){
    check(record(table)&&integer(Object.keys(table).length,1,32)&&Object.keys(table).every(id),'Invalid modal '+label+' table');
    return Object.fromEntries(Object.entries(table).map(([name,row])=>[name,location.site(row,name)]));
  }

  function bake(plan){
    check(fields(plan,['format','version','id','revision','source','excitations','pickups'])&&plan.format===planFormat&&
      plan.version===1&&id(plan.id)&&integer(plan.revision??1,1,Number.MAX_SAFE_INTEGER)&&record(plan.source)&&
      inputKinds.includes(plan.source.kind),'Expected a version 1 resonant mode plan');
    const {source,excitations,pickups}=plan, {kind}=source;
    let result;
    if(kind==='authored'){
      check(fields(source,['kind','modes']),'Invalid authored modal settings');
      result={modes:source.modes,geometry:{kind},evidence:{algorithm:'authored'}};
    }else if(kind==='mesh'){
      check(fields(source,['kind','domain','mesh',...meshSettings])&&own(source,'domain')!==own(source,'mesh'),
        'Mesh modes need a compiled domain or inline simplex mesh');
      const domain=source.domain??W.discretization.compile({format:W.discretization.format,version:1,
        id:plan.id,revision:plan.revision??1,source:{kind:'mesh',mesh:source.mesh}});
      result=W.modalMesh.solve(domain,source);
      result.evidence.domain={id:domain.id,revision:domain.revision};
    }else result=analytic(source);
    const loc=locator(result.geometry,result.modes);
    siteTable(excitations,loc,'excitation');
    siteTable(pickups,loc,'pickup');
    return freeze(copy({format:assetFormat,version:1,id:plan.id,revision:plan.revision??1,
      ...result,excitations,pickups}));
  }

  function bind(asset,{excitations,pickups}={}){
    check(asset?.format===assetFormat&&asset.version===1&&id(asset.id)&&integer(asset.revision,1,Number.MAX_SAFE_INTEGER)&&
      record(asset.geometry)&&record(asset.excitations)&&record(asset.pickups)&&
      (excitations===undefined||record(excitations))&&(pickups===undefined||record(pickups)),'Expected a version 1 resonant mode asset');
    const location=locator(asset.geometry,asset.modes);
    return {modes:asset.modes.map(({id,hz,decay})=>({id,hz,decay})),
      excitations:siteTable({...asset.excitations,...excitations},location,'excitation'),
      pickups:siteTable({...asset.pickups,...pickups},location,'pickup')};
  }

  function shape(asset,point){
    check(asset?.format===assetFormat&&asset.version===1&&record(asset.geometry)&&vector(point),
      'Expected a resonant mode asset and XYZ sample point');
    const {sample}=locator(asset.geometry,asset.modes);
    check(sample,'Authored modes need explicit site gains');
    const gains=sample(point);
    check(gains.every(finite),'Modal point sample exceeded numeric range');
    return gains;
  }

  W.modalAssets=Object.freeze({planFormat,assetFormat,bake,bind,shape,integer});
})(KIT);
