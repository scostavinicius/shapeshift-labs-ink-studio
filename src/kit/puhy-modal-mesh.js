/* Scalar simplex wave modes with mass weighting and independent eigenpair checks. */
(function(K){
  const W=K.world,{V}=K,{check,record,vector}=W.data,finite=Number.isFinite;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const positive=n=>finite(n)&&n>0;

  function simplex(vertices,indices,dimension){
    const [point,b,c,d]=indices.map(i=>vertices[i]), u=V.sub(b,point),v=V.sub(c,point);
    let tails,measure,normal;
    if(dimension===2){
      const cross=V.cross(u,v), size=V.len(cross);
      check(positive(size),'Degenerate modal triangle');
      measure=size/2;
      normal=V.mul(cross,1/size);
      tails=[V.mul(V.cross(v,normal),1/size),V.mul(V.cross(normal,u),1/size)];
    }else{
      const w=V.sub(d,point), dual=V.cross(v,w), det=V.dot(u,dual);
      check(positive(Math.abs(det)),'Degenerate modal tetrahedron');
      measure=Math.abs(det)/6;
      tails=[dual,V.cross(w,u),V.cross(u,v)].map(q=>V.mul(q,1/det));
    }
    const gradients=[V.mul(tails.reduce(V.add,[0,0,0]),-1),...tails];
    check(positive(measure)&&gradients.every(q=>vector(q)),'Modal simplex exceeded its numeric range');
    return {point,tails,normal,gradients,measure};
  }

  function meshGeometry(domain,fixed,fixedVertices){
    check(domain?.format===W.discretization.compiledFormat&&domain.version===1&&domain.kind==='mesh'&&
      [2,3].includes(domain.dimension)&&Array.isArray(domain.cells)&&integer(domain.cells.length,1,4096)&&
      Array.isArray(domain.vertices)&&integer(domain.vertices.length,3,4096)&&Array.from(domain.vertices).every(p=>vector(p))&&
      Array.isArray(domain.faces)&&integer(domain.faces.length,1,16384)&&record(domain.boundaries),'Modal bake needs a compiled triangle or tetrahedron mesh');
    const {dimension,vertices}=domain;
    check(fixed==='boundary'||Array.isArray(fixed)&&fixed.every(tag=>Object.hasOwn(domain.boundaries,tag)),
      'Modal fixed boundary needs boundary or known region tags');
    check(Array.isArray(fixedVertices)&&fixedVertices.every(i=>integer(i,0,vertices.length-1)),'Invalid modal pinned vertices');
    const pins=new Set(fixedVertices);
    for(const face of domain.faces){
      check(record(face)&&Array.isArray(face.vertices)&&face.vertices.length===dimension&&
        face.vertices.every(i=>integer(i,0,vertices.length-1)),'Invalid modal mesh face');
      if(face.neighbor===null&&(fixed==='boundary'||fixed.includes(face.region)))for(const i of face.vertices)pins.add(i);
    }
    const elements=Array.from(domain.cells,cell=>{
      check(Array.isArray(cell?.faces)&&cell.faces.length===dimension+1&&
        cell.faces.every(i=>integer(i,0,domain.faces.length-1)),'Invalid modal mesh cell');
      const ids=[...new Set(cell.faces.flatMap(i=>domain.faces[i].vertices))].sort((a,b)=>a-b);
      check(ids.length===dimension+1,'Modal mesh cells must be simplices');
      return ids;
    });
    return {dimension,vertices,elements,pins};
  }

  function diagonalize(a,{maxSweeps,tolerance,maxWork}){
    const n=a.length, v=Array.from({length:n},(_,i)=>{
      const row=new Float64Array(n);row[i]=1;return row;
    });
    let sweeps=0,rotations=0,workUsed=0,off=0;
    // A fixed cyclic order makes degenerate subspaces reproducible on a pinned mesh.
    for(;sweeps<maxSweeps;sweeps++){
      let changed=false;
      for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
        const b=a[i][j];
        check(++workUsed<=maxWork,'Modal eigensolve exceeded its work limit');
        if(Math.abs(b)<=tolerance)continue;
        workUsed+=n*2;
        check(workUsed<=maxWork,'Modal eigensolve exceeded its work limit');
        const p=a[i][i],q=a[j][j], tau=(q-p)/(2*b);
        const t=(tau<0?-1:1)/(Math.abs(tau)+Math.hypot(1,tau)), c=1/Math.hypot(1,t), s=t*c;
        a[i][i]=p-t*b;
        a[j][j]=q+t*b;
        a[i][j]=a[j][i]=0;
        for(let k=0;k<n;k++){
          if(k!==i&&k!==j){
            const x=a[k][i],y=a[k][j];
            a[k][i]=a[i][k]=c*x-s*y;
            a[k][j]=a[j][k]=s*x+c*y;
          }
          const x=v[k][i],y=v[k][j];
          v[k][i]=c*x-s*y;
          v[k][j]=s*x+c*y;
        }
        changed=true;
        rotations++;
      }
      if(!changed)break;
    }
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)off=Math.max(off,Math.abs(a[i][j]));
    check(off<=tolerance,'Modal eigensolve did not converge within its sweep limit');
    return {v,sweeps,rotations,workUsed,off};
  }

  function solve(domain,{count=12,speed,density=1,fixed='boundary',fixedVertices=[],decay=4,decayPerHz=0,
    maxSweeps=32,tolerance=2e-14,residualTolerance=1e-7,maxWork=240000000}={}){
    check(integer(count,1,64)&&positive(speed)&&positive(density)&&finite(decay)&&decay>=0&&
      finite(decayPerHz)&&decayPerHz>=0&&integer(maxSweeps,1,64)&&positive(tolerance)&&tolerance<=1e-8&&
      positive(residualTolerance)&&residualTolerance<=1e-4&&integer(maxWork,1,600000000),'Invalid mesh mode settings');
    const {dimension,vertices,elements,pins}=meshGeometry(domain,fixed,fixedVertices);
    const n=vertices.length, indexed=new Int32Array(n).fill(-1), free=[];
    for(let i=0;i<n;i++)if(!pins.has(i)){indexed[i]=free.length;free.push(i);}
    const dofs=free.length;
    check(integer(dofs,1,384),'Modal mesh needs 1–384 free degrees of freedom');
    const mass=new Float64Array(dofs);
    const matrix=Array.from({length:dofs},()=>new Float64Array(dofs));
    for(const ids of elements){
      const {measure,gradients}=simplex(vertices,ids,dimension), local=ids.map(i=>indexed[i]);
      for(let i=0;i<local.length;i++){
        const a=local[i];
        if(a<0)continue;
        mass[a]+=measure*density/local.length;
        for(let j=0;j<=i;j++){
          const b=local[j];
          if(b<0)continue;
          const entry=measure*density*V.dot(gradients[i],gradients[j]);
          matrix[a][b]+=entry;
          if(a!==b)matrix[b][a]+=entry;
        }
      }
    }
    check(mass.every(positive),'Modal mesh has unused or invalid free vertices');
    const inverse=mass.map(value=>1/Math.sqrt(value));
    let scale=0;
    for(let i=0;i<dofs;i++){
      for(let j=0;j<dofs;j++)matrix[i][j]*=inverse[i]*inverse[j];
      scale=Math.max(scale,matrix[i][i]);
    }
    check(positive(scale),'Invalid modal stiffness normalization');
    for(const row of matrix)for(let j=0;j<dofs;j++)row[j]/=scale;
    const work=matrix.map(row=>row.slice()), {v,sweeps,rotations,workUsed,off}=diagonalize(work,{maxSweeps,tolerance,maxWork});
    const eigen=work.map((row,i)=>({value:row[i],column:i})).sort((a,b)=>a.value-b.value||a.column-b.column);
    const zeroCut=Math.max(1e-12,tolerance*dofs*8);
    check(eigen.every(row=>finite(row.value)&&row.value>=-zeroCut),'Modal stiffness has an invalid negative eigenvalue');
    const nonzero=eigen.filter(row=>row.value>zeroCut).slice(0,count);
    check(nonzero.length>0,'Modal mesh has no positive wave modes');
    const orthogonal=[];
    let maxRelativeResidual=0,maxOrthonormalError=0;
    const modes=nonzero.map(({value,column},i)=>{
      const normal=v.map(row=>row[column]);
      let sign=0;
      for(let j=1;j<normal.length;j++)if(Math.abs(normal[j])>Math.abs(normal[sign]))sign=j;
      if(normal[sign]<0)for(let j=0;j<normal.length;j++)normal[j]*=-1;
      let residualSquared=0,normSquared=0;
      for(let j=0;j<dofs;j++){
        let result=0;
        for(let k=0;k<dofs;k++)result+=matrix[j][k]*normal[k];
        residualSquared+=(result-value*normal[j])**2;
        normSquared+=normal[j]**2;
      }
      const relativeResidual=Math.sqrt(residualSquared/normSquared)/value;
      check(finite(relativeResidual)&&relativeResidual<=residualTolerance,'Mesh eigenpair failed its residual tolerance at mode '+(i+1));
      maxRelativeResidual=Math.max(maxRelativeResidual,relativeResidual);
      maxOrthonormalError=Math.max(maxOrthonormalError,Math.abs(normSquared-1));
      for(const previous of orthogonal){
        let dot=0;
        for(let j=0;j<dofs;j++)dot+=normal[j]*previous[j];
        maxOrthonormalError=Math.max(maxOrthonormalError,Math.abs(dot));
      }
      orthogonal.push(normal);
      const hz=Math.sqrt(scale*value)*speed/(2*Math.PI);
      check(positive(hz)&&finite(decay+decayPerHz*hz),'Modal frequency or decay exceeded numeric range');
      return {id:'mode-'+(i+1),hz,decay:decay+decayPerHz*hz,relativeResidual,
        shape:Array.from(indexed,j=>j<0?0:normal[j]*inverse[j])};
    });
    check(maxOrthonormalError<=residualTolerance,'Mesh modes failed mass-orthonormality checks');
    return {modes,geometry:{kind:'mesh',dimension,vertices,elements},
      evidence:{algorithm:'mass-lumped-scalar-simplex',dofs,fixedVertices:[...pins].sort((a,b)=>a-b),
        skippedZeroModes:eigen.filter(row=>row.value<=zeroCut).length,sweeps,rotations,workUsed,off,
        maxRelativeResidual,maxOrthonormalError,residualTolerance}};
  }

  W.modalMesh=Object.freeze({solve,simplex});
})(KIT);
