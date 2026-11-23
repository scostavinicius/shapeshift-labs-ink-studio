/* Integrate solid and shell moments in a local origin, then combine SI masses. */
(function(K) {
  const W=K.world, P=K.procedural, {V,M}=K;
  const {check,id,record,own}=W.data, {freeze}=P.data;
  const format='ink-studio/mass-properties-plan', reportFormat='ink-studio/mass-properties';
  const maxTriangles=500000;
  const units={coordinates:'world',volume:'m^3',area:'m^2',mass:'kg',density:'kg/m^3',inertia:'kg*m^2',thickness:'m'};
  const number=n=>Number.isFinite(n)&&Math.abs(n)<=1e8;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
  const positive=n=>number(n)&&n>0;
  const array=o=>Array.isArray(o)||ArrayBuffer.isView(o)&&typeof o.length==='number';
  const tuple=(o,n,test=number)=>Array.isArray(o)&&o.length===n&&Array.from(o).every(test);
  const fields=(o,keys)=>record(o)&&Object.keys(o).every(key=>keys.includes(key));
  const zero=()=>[0,0,0];
  const diagonal=(a,b,c)=>[a,0,0,0,b,0,0,0,c];
  const outer=(a,b=a)=>a.flatMap(x=>b.map(y=>x*y));
  const plus=(a,b)=>a.map((v,i)=>v+b[i]);
  const scale=(a,f)=>a.map(v=>v*f);
  const tensor=c=>[
    c[4]+c[8],-c[1],-c[2],
    -c[3],c[0]+c[8],-c[5],
    -c[6],-c[7],c[0]+c[4]
  ];
  const rotate=(matrix,rotation)=>M.mul(M.mul(rotation,matrix),M.tr(rotation));

  function poses(raw) {
    const {translate=zero(),rotation=M.id()}=raw??{};
    check((raw===undefined||fields(raw,['translate','rotation']))&&tuple(translate,3)&&tuple(rotation,9),
      'A physical part pose needs a finite translation and a rotation matrix');
    const test=M.mul(rotation,M.tr(rotation)), identity=M.id();
    check(test.every((v,i)=>Math.abs(v-identity[i])<=1e-7)&&Math.abs(M.det(rotation)-1)<=1e-7,
      'Physical part rotations must be orthonormal and right-handed');
    return {point:p=>V.add(M.app(rotation,p),translate),local:p=>M.app(M.tr(rotation),V.sub(p,translate)),rotation};
  }

  function interval(a,b) {
    const lo=Math.max(0,a),hi=Math.min(1,b);
    return hi>lo?[lo,hi]:null;
  }
  function axial(a,d,r) {
    if(d===0)return Math.abs(a)<r?[0,1]:null;
    const lo=(-r-a)/d,hi=(r-a)/d;
    return interval(Math.min(lo,hi),Math.max(lo,hi));
  }
  function radial(a,d,r) {
    const q=V.dot(d,d),linear=V.dot(a,d),constant=V.dot(a,a)-r*r;
    if(q===0)return constant<0?[0,1]:null;
    const discriminant=linear*linear-q*constant;
    if(discriminant<=0)return null;
    const root=Math.sqrt(discriminant);
    return interval((-linear-root)/q,(-linear+root)/q);
  }
  function intersect(a,b) {
    return a&&b?interval(Math.max(a[0],b[0]),Math.min(a[1],b[1])):null;
  }

  function analytic(source) {
    const {center=zero(),kind}=source;
    check(tuple(center,3),'Analytic mass properties need a finite centre');
    let volume,area,moment,span,inside;
    if(kind==='box'){
      const h=source.half;
      check(tuple(h,3,positive),'A physical box needs positive half extents');
      const [x,y,z]=h;
      volume=8*x*y*z; area=8*(x*y+x*z+y*z);
      moment=diagonal(x*x/3,y*y/3,z*z/3);
      span=(a,d)=>h.reduce((prior,n,i)=>intersect(prior,axial(a[i],d[i],n)),[0,1]);
      inside=p=>p.every((v,i)=>Math.abs(v)<h[i]);
    }else if(kind==='sphere'){
      const r=source.radius;
      check(positive(r),'A physical sphere needs a positive radius');
      volume=4*Math.PI*r**3/3; area=4*Math.PI*r*r;
      moment=diagonal(r*r/5,r*r/5,r*r/5);
      span=(a,d)=>radial(a,d,r);
      inside=p=>V.len(p)<r;
    }else{
      const {radius:r,innerRadius:inner=0,height}=source;
      check(positive(r)&&positive(height)&&number(inner)&&inner>=0&&inner<r,'A physical cylinder needs valid outer and inner radii and height');
      volume=Math.PI*(r*r-inner*inner)*height;
      area=2*Math.PI*((r+inner)*height+r*r-inner*inner);
      const transverse=(r*r+inner*inner)/4;
      moment=diagonal(transverse,height*height/12,transverse);
      const flat=([x,_y,z])=>[x,0,z];
      span=(a,d)=>intersect(radial(flat(a),flat(d),r),axial(a[1],d[1],height/2));
      inside=p=>{
        const radius=Math.hypot(p[0],p[2]);
        return Math.abs(p[1])<height/2&&radius<r&&(inner===0||radius>inner);
      };
      if(inner>0){
        const envelope=span;
        span=(a,d)=>{
          const full=envelope(a,d);
          if(!full)return [];
          const hole=intersect(full,radial(flat(a),flat(d),inner));
          return hole?[[full[0],hole[0]],[hole[1],full[1]]].filter(([lo,hi])=>hi>lo):[full];
        };
      }
    }
    return {method:'analytic',volume,area,center:center.slice(),moment,probes(a,b){
      const p=V.sub(a,center),q=V.sub(b,center),hit=span(p,V.sub(q,p));
      return {spans:hit?.length?(Array.isArray(hit[0])?hit:[hit]):[],clipped:inside(p)||inside(q)};
    }};
  }

  function indexed(mesh,weld=true) {
    const flat=mesh?.pos??mesh?.positions, indices=mesh?.tri??mesh?.indices??mesh?.triangles;
    let rawPoints=mesh?.points, faces=mesh?.faces;
    if(rawPoints===undefined&&faces===undefined){
      check(array(flat)&&flat.length>=9&&flat.length%3===0&&flat.length/3<=maxTriangles*3&&
        (indices===undefined?flat.length%9===0:array(indices)&&indices.length>=3&&indices.length%3===0)&&
        (indices===undefined?flat.length/9:indices.length/3)<=maxTriangles,'Mass properties need flat triangle positions and valid indices');
      rawPoints=Array.from({length:flat.length/3},(_,i)=>[flat[i*3],flat[i*3+1],flat[i*3+2]]);
      faces=Array.from({length:indices===undefined?flat.length/9:indices.length/3},(_,i)=>
        [0,1,2].map(j=>indices===undefined?i*3+j:indices[i*3+j]));
    }
    check(Array.isArray(rawPoints)&&integer(rawPoints.length,3,maxTriangles*3)&&Array.isArray(faces)&&
      integer(faces.length,1,maxTriangles)&&typeof weld==='boolean','Expected an indexed mesh with bounded faces and vertices');
    const vertices=[], aliases=new Map();
    const mapping=Array.from(rawPoints,(point,i)=>{
      check(tuple(point,3),'Invalid physical mesh vertex '+i);
      const key=weld?point.join(','):i;
      if(!aliases.has(key)){
        aliases.set(key,vertices.length);
        vertices.push(point);
      }
      return aliases.get(key);
    });
    const triangles=[];
    for(const face of faces){
      check(Array.isArray(face)&&integer(face.length,3,64)&&Array.from(face).every(i=>integer(i,0,mapping.length-1)),
        'Invalid physical mesh face');
      for(let j=1;j+1<face.length;j++){
        const row=[mapping[face[0]],mapping[face[j]],mapping[face[j+1]]];
        const [a,b,c]=row.map(i=>vertices[i]);
        check(V.len(V.cross(V.sub(b,a),V.sub(c,a)))>0,'Physical mesh has a degenerate triangle');
        triangles.push(row);
      }
      check(triangles.length<=maxTriangles,'Physical mesh exceeds its triangle budget');
    }
    return {vertices,triangles};
  }

  function oriented(edges,triangle) {
    for(let i=0;i<3;i++){
      const a=triangle[i],b=triangle[(i+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);
      let row=edges.get(key);
      if(!row){row=[0,0];edges.set(key,row);}
      row[0]++;
      row[1]+=a<b?1:-1;
    }
  }

  function quadrature(vertices,triangles,shellThickness,shellClosed) {
    const {min,max}=P.spatial.boxOf(vertices), origin=V.lerp(min,max,0.5);
    let sum=0,area=0,first=zero(),second=Array(9).fill(0);
    for(const row of triangles){
      const [a,b,c]=row.map(index=>V.sub(vertices[index],origin)), normal=V.cross(V.sub(b,a),V.sub(c,a));
      const measure=V.len(normal)*0.5;
      area+=measure;
      if(!shellClosed&&shellThickness===undefined)continue;
      const s=V.add(a,V.add(b,c));
      const weight=shellThickness===undefined?V.dot(a,V.cross(b,c))/6:measure*shellThickness;
      sum+=weight;
      first=V.mad(first,s,weight/(shellThickness===undefined?4:3));
      const raw=plus(outer(s),plus(outer(a),plus(outer(b),outer(c))));
      second=plus(second,scale(raw,weight/(shellThickness===undefined?20:12)));
      if(shellThickness!==undefined)
        second=plus(second,scale(outer(V.mul(normal,1/(measure*2))),weight*shellThickness**2/12));
    }
    if(!shellClosed&&shellThickness===undefined)return {area,volume:null,center:null,moment:null};
    const volume=Math.abs(sum);
    check(Number.isFinite(volume)&&volume>0,'Physical solid has zero or invalid signed volume');
    const centroid=V.mul(first,1/sum), moment=plus(scale(second,1/sum),scale(outer(centroid),-1));
    check(tuple(moment,9,Number.isFinite),'Physical solid moments exceeded their numeric range');
    return {area,volume,center:V.add(origin,centroid),moment};
  }

  function contact(vertices,triangles) {
    const positions=triangles.flatMap(row=>row.flatMap(i=>vertices[i]));
    return P.contacts.index({positions,groups:[{start:0,count:positions.length/3,surface:'solid',owner:'body'}]},
      {maxTriangles});
  }

  function geometry(source) {
    if(['box','sphere','cylinder'].includes(source.kind))return analytic(source);
    let input, method, expected, resolution;
    if(source.kind==='mesh'){
      input=source.mesh; method='mesh';
    }else if(source.kind==='sdf'){
      const field=source.field;
      const fn=typeof field==='function'?field:
        typeof field?.sdf==='function'?field.sdf.bind(field):typeof field?.sd==='function'?field.sd.bind(field):null;
      resolution=source.resolution??0.05;
      const maxCells=source.maxCells??250000;
      check(fn&&positive(resolution)&&integer(maxCells,8,500000),'SDF mass properties need a field, resolution, and bounded grid');
      const bounds=source.bounds??field.modelBounds?.(resolution*2)??(field.lo&&field.hi?{min:field.lo,max:field.hi}:undefined);
      input=K.model.fromSdf(fn,{bounds,resolution,maxCells,method:source.method??'auto'});
      method='sdf-mesh';
    }else if(source.kind==='discretization'){
      const domain=source.domain;
      check(domain?.format===W.discretization.compiledFormat&&domain.version===1&&domain.dimension===3&&
        Array.isArray(domain.vertices)&&Array.isArray(domain.faces)&&Number.isFinite(domain.measure)&&domain.measure>0,
        'Mass properties need a compiled 3D discretization');
      input={points:domain.vertices,faces:domain.faces.filter(face=>face.neighbor===null).map(face=>face.vertices)};
      method='discretization'; expected=domain.measure;
    }else throw Error('Unknown mass properties source '+source.kind);
    const {shellThickness}=source;
    check(shellThickness===undefined||source.kind==='mesh'&&positive(shellThickness),'A thin shell needs a positive authored thickness');
    const {vertices,triangles}=indexed(input,source.weld??true), edges=new Map();
    if(expected===undefined)for(const row of triangles)oriented(edges,row);
    const closed=expected!==undefined||[...edges.values()].every(([count,balance])=>count===2&&balance===0);
    if(source.kind==='sdf')check(closed,'SDF extraction did not produce a consistently wound closed mesh');
    const result=quadrature(vertices,triangles,shellThickness,closed);
    if(expected!==undefined)check(Math.abs(result.volume-expected)<=expected*1e-7,
      'Discretization boundary volume disagrees with its cells');
    let index;
    return {...result,method:shellThickness===undefined?method:'thin-shell',
      ...(resolution!==undefined&&{resolution}),...(shellThickness!==undefined&&{shellThickness}),
      ...(closed&&shellThickness===undefined&&{probes(a,b){
        index??=contact(vertices,triangles);
        const values=[0,...index.crossings(a,b).filter(t=>t>0&&t<1),1],spans=[];
        for(let i=0;i+1<values.length;i++){
          const lo=values[i],hi=values[i+1];
          if(!index.contains(V.lerp(a,b,(lo+hi)/2),false))continue;
          if(spans.at(-1)?.[1]===lo)spans.at(-1)[1]=hi;
          else spans.push([lo,hi]);
        }
        return {spans,clipped:index.contains(a,false)||index.contains(b,false)};
      }})};
  }

  function measureThickness(list,shape,pose,factor) {
    check(Array.isArray(list)&&list.length<=64,'A physical part needs a bounded thickness probe list');
    const names=new Set();
    return Array.from(list,row=>{
      check(fields(row,['id','from','to'])&&id(row.id)&&!names.has(row.id)&&tuple(row.from,3)&&tuple(row.to,3)&&
        V.dist(row.from,row.to)>1e-8,'Invalid physical thickness probe');
      names.add(row.id);
      const {id:probe,from,to}=row, length=V.dist(from,to)*factor;
      if(!shape.probes)return {id:probe,status:'unavailable',from:from.slice(),to:to.slice(),spans:[],materialLength:null,minimum:null};
      const {spans,clipped}=shape.probes(pose.local(from),pose.local(to));
      const segments=spans.map(([lo,hi])=>({from:V.lerp(from,to,lo),to:V.lerp(from,to,hi),length:(hi-lo)*length}));
      return {id:probe,status:clipped?'clipped':segments.length?'ok':'miss',from:from.slice(),to:to.slice(),spans:segments,
        materialLength:segments.reduce((sum,s)=>sum+s.length,0),
        minimum:!clipped&&segments.length?Math.min(...segments.map(s=>s.length)):null};
    });
  }

  function weighted(rows,key,center) {
    const base=rows[0][center], weight=rows.reduce((sum,row)=>sum+row[key],0);
    let offset=zero();
    for(const row of rows)offset=V.mad(offset,V.sub(row[center],base),row[key]/weight);
    return {weight,center:V.add(base,offset)};
  }
  function shifted(row,point,factor) {
    const cross=scale(outer(V.sub(row.centerOfMass,point)),row.mass*factor**2);
    return plus(row.inertia,tensor(cross));
  }

  function measure(raw,{catalog}={}) {
    check(fields(raw,['format','version','id','revision','metersPerUnit','about','assetPacks','parts'])&&
      raw.format===format&&raw.version===1&&id(raw.id)&&integer(raw.revision,1,Number.MAX_SAFE_INTEGER)&&record(raw.parts),
      'Expected a version 1 mass properties plan');
    const {metersPerUnit:factor=1,about,assetPacks=[]}=raw, entries=Object.entries(raw.parts).sort(([a],[b])=>a<b?-1:a>b?1:0);
    check(Number.isFinite(factor)&&factor>=1e-8&&factor<=1e8&&(about===undefined||tuple(about,3))&&
      Array.isArray(assetPacks)&&assetPacks.length<=128&&integer(entries.length,1,64),'Invalid mass properties scale, pivot or part table');
    catalog??=assetPacks.length?K.authoring.assetPacks.create({packs:assetPacks}):undefined;
    const parts=Object.fromEntries(entries.map(([name,spec])=>{
      check(id(name)&&fields(spec,['source','pose','material','wetness','density','probes'])&&record(spec.source)&&
        (spec.material===undefined||typeof spec.material==='string')&&(spec.wetness===undefined||spec.material!==undefined),
      'Invalid physical part '+name);
      const profile=spec.material===undefined?null:W.materials.profile(W.materials.requireAsset(catalog,spec.material),spec.wetness??0);
      const density=spec.density??profile?.density??null;
      check(density===null||Number.isFinite(density)&&density>0&&density<=1e12,'Invalid density for '+name);
      const pose=poses(spec.pose), shape=geometry(spec.source);
      const volume=shape.volume===null?null:shape.volume*factor**3, area=shape.area*factor**2;
      const volumeCentroid=shape.center===null?null:pose.point(shape.center);
      const mass=volume===null||density===null?null:volume*density;
      const inertia=mass===null?null:scale(tensor(rotate(shape.moment,pose.rotation)),mass*factor**2);
      const probes=measureThickness(spec.probes??[],shape,pose,factor);
      const thicknesses=probes.filter(row=>row.minimum!==null).map(row=>row.minimum);
      if(shape.shellThickness!==undefined)thicknesses.push(shape.shellThickness*factor);
      return [name,{id:name,source:spec.source.kind,method:shape.method,
        status:volume===null?'unclosed-surface':density===null?'missing-density':'ok',
        ...(shape.resolution!==undefined&&{resolution:shape.resolution}),material:profile,density,volume,area,volumeCentroid,
        mass,centerOfMass:mass===null?null:volumeCentroid,inertia,
        ...(about!==undefined&&{about:{point:about.slice(),tensor:mass===null?null:shifted({mass,inertia,centerOfMass:volumeCentroid},about,factor)}}),
        ...(shape.shellThickness!==undefined&&{shellThickness:shape.shellThickness*factor}),
        thickness:thicknesses.length?Math.min(...thicknesses):null,probes}];
    }));
    const rows=Object.values(parts), haveVolume=rows.every(row=>row.volume!==null), haveMass=rows.every(row=>row.mass!==null);
    const volumetric=haveVolume?weighted(rows,'volume','volumeCentroid'):null;
    const massive=haveMass?weighted(rows,'mass','centerOfMass'):null;
    const inertia=massive?rows.reduce((sum,row)=>plus(sum,shifted(row,massive.center,factor)),Array(9).fill(0)):null;
    const aboutTensor=massive&&about!==undefined?shifted({mass:massive.weight,inertia,centerOfMass:massive.center},about,factor):null;
    check(rows.every(row=>Number.isFinite(row.area)&&(row.volume===null||row.volume>0&&Number.isFinite(row.volume))&&
      (row.mass===null||row.mass>0&&Number.isFinite(row.mass)&&row.inertia.every(Number.isFinite)&&
        (row.about===undefined||row.about.tensor.every(Number.isFinite))))&&
      (!inertia||inertia.every(Number.isFinite))&&(!aboutTensor||aboutTensor.every(Number.isFinite)),'Physical properties exceeded their numeric range');
    return freeze({format:reportFormat,version:1,id:raw.id,revision:raw.revision,metersPerUnit:factor,units,parts,
      volume:volumetric?.weight??null,volumeCentroid:volumetric?.center??null,area:rows.reduce((sum,row)=>sum+row.area,0),
      mass:massive?.weight??null,centerOfMass:massive?.center??null,inertia,
      ...(about!==undefined&&{about:{point:about.slice(),tensor:aboutTensor}}),
      missingMass:rows.filter(row=>row.mass===null).map(row=>row.id)});
  }
  W.massProperties=Object.freeze({format,reportFormat,measure});
})(KIT);
