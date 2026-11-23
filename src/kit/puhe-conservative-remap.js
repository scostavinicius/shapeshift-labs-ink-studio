/* Transfer piecewise-constant extensive cell quantities by geometric overlap. */
(function(K) {
  const W=K.world, P=K.procedural, {V}=K, {freeze}=P.data;
  const {check,id,own,record}=W.data;
  const format='ink-studio/state-remap-plan', reportFormat='ink-studio/state-remap';
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const fields=(o,keys)=>record(o)&&Object.keys(o).every(key=>keys.includes(key));
  const array=o=>Array.isArray(o)||ArrayBuffer.isView(o)&&typeof o.length==='number';
  const vector=v=>Array.isArray(v)&&v.length===3&&Array.from(v).every(Number.isFinite);
  const positive=n=>Number.isFinite(n)&&n>0;

  function describe(domain) {
    check(domain?.format===W.discretization.compiledFormat&&domain.version===1&&id(domain.id)&&
      integer(domain.revision,1,Number.MAX_SAFE_INTEGER)&&typeof domain.units==='string'&&domain.units.trim().length>0&&
      (domain.dimension===3&&['grid','mesh'].includes(domain.kind)||domain.dimension===2&&domain.kind==='grid')&&
      Array.isArray(domain.cells)&&integer(domain.cells.length,1,65536)&&Array.isArray(domain.faces)&&Array.isArray(domain.vertices),
    'State remap needs a compiled grid or tetrahedral volume');
    const {dimension,layout}=domain;
    const axes=dimension===3?[0,1,2]:layout?.plane==='xz'?[0,2]:[0,1];
    const height=dimension===2?layout?.origin?.[layout.plane==='xz'?1:2]:null;
    check(dimension===3||['xy','xz'].includes(layout?.plane)&&Number.isFinite(height),
      'State remap needs a valid planar grid');
    const seen=new Set();
    const cells=Array.from(domain.cells,(cell,index)=>{
      check(typeof cell?.id==='string'&&cell.id.length>0&&!seen.has(cell.id)&&positive(cell.measure)&&
        vector(cell.center)&&Array.isArray(cell.faces)&&integer(cell.faces.length,dimension===2?3:4,32),
      'Invalid remap cell '+index);
      seen.add(cell.id);
      const points=[], planes=[];
      for(const i of cell.faces){
        const face=domain.faces[i], owner=face?.owner===index;
        const normal=owner?face?.normal:face?.neighborNormal;
        check((owner||face?.neighbor===index)&&vector(normal)&&Math.abs(V.len(normal)-1)<1e-6&&
          Array.isArray(face.vertices)&&integer(face.vertices.length,dimension===2?2:3,64),
        'Invalid remap face on '+cell.id);
        const vertices=face.vertices.map(j=>domain.vertices[j]);
        check(vertices.every(vector),'Invalid remap face vertices on '+cell.id);
        points.push(...vertices);
        planes.push({normal,point:vertices[0]});
      }
      const {min,max}=P.spatial.boxOf(points);
      const boxMeasure=axes.reduce((volume,axis)=>volume*(max[axis]-min[axis]),1);
      const box=domain.kind==='grid'&&
        (dimension===2||cell.fraction===1&&planes.length===6&&planes.every(({normal})=>normal.some(n=>Math.abs(n)===1)));
      check(positive(boxMeasure)&&cell.measure<=boxMeasure*(1+1e-6),'Invalid remap cell measure '+cell.id);
      return {id:cell.id,index,min,max,measure:cell.measure,planes:box?[]:planes};
    });
    return {cells,axes,height,dimension,identity:{id:domain.id,revision:domain.revision,cells:cells.length,units:domain.units}};
  }

  const cube=[
    {points:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]},
    {points:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]},
    {points:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},
    {points:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]]},
    {points:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]},
    {points:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]}
  ];

  function boundedOverlap(a,b,axes) {
    const start=a.min.map((v,i)=>Math.max(v,b.min[i]));
    const widths=a.max.map((v,i)=>Math.min(v,b.max[i])-start[i]);
    if(axes.some(axis=>widths[axis]<=0))return 0;
    const size=axes.reduce((value,axis)=>value*widths[axis],1);
    if(axes.length===2||!a.planes.length&&!b.planes.length)return size;

    // Work in the overlap box so clipping tolerance does not depend on world translation or cell size.
    const planes=[...a.planes,...b.planes].map(({normal,point})=>{
      const scaled=normal.map((v,i)=>v*widths[i]), length=V.len(scaled);
      return {normal:V.mul(scaled,1/length),offset:V.dot(normal,V.sub(point,start))/length};
    });
    const shell=P.geometry.clipConvexFaces(cube,planes);
    const origin=[0.5,0.5,0.5];
    let volume=0;
    for(const {points} of shell){
      const a=V.sub(points[0],origin);
      for(let i=1;i+1<points.length;i++)
        volume+=V.dot(a,V.cross(V.sub(points[i],origin),V.sub(points[i+1],origin)))/6;
    }
    check(Number.isFinite(volume)&&volume>=-1e-9&&volume<=1+1e-8,'Invalid convex overlap measure');
    return size*Math.min(1,Math.max(0,volume));
  }

  function sumOf(values) {
    let total=0, correction=0;
    for(const value of values){
      const next=total+value;
      correction+=Math.abs(total)>=Math.abs(value)?(total-next)+value:(value-next)+total;
      total=next;
    }
    return total+correction;
  }

  function accumulators(count) {
    const sums=new Float64Array(count), correction=new Float64Array(count);
    return {sums,add(i,value){
      const adjusted=value-correction[i], next=sums[i]+adjusted;
      correction[i]=(next-sums[i])-adjusted;
      sums[i]=next;
    },clear(){sums.fill(0);correction.fill(0);}};
  }

  function prepare(sourceDomain,targetDomain,{maxPairs=500000,tolerance=1e-7}={}) {
    check(integer(maxPairs,1,2000000)&&Number.isFinite(tolerance)&&tolerance>=1e-9&&tolerance<=1e-5,
      'Invalid overlap work budget or tolerance');
    const source=describe(sourceDomain), target=describe(targetDomain);
    check(source.dimension===target.dimension&&source.identity.units===target.identity.units&&
      source.axes.every((axis,i)=>axis===target.axes[i])&&source.height===target.height,
    'State remap needs matching dimension, units and plane');
    const a=source.cells, b=target.cells, tree=W.spatial.create();
    for(const cell of b)tree.set(cell.index,{...cell,rank:cell.index,value:cell});
    const links=[], from=accumulators(a.length), to=accumulators(b.length);
    const coverageA=from.sums, coverageB=to.sums;
    let candidates=0;
    for(const cell of a){
      const hits=[];
      tree.overlap(cell.min,cell.max,({value})=>{
        check(++candidates<=maxPairs,'State remap exceeded its overlap candidate budget');
        hits.push(value);
      });
      hits.sort((p,q)=>p.index-q.index);
      for(const next of hits){
        const measure=boundedOverlap(cell,next,source.axes);
        if(measure<=0)continue;
        links.push({from:cell.index,to:next.index,measure});
        from.add(cell.index,measure);
        to.add(next.index,measure);
      }
    }

    function limit(cells,coverage) {
      return Float64Array.from(coverage,(covered,index)=>{
        const {measure,id}=cells[index];
        check(covered<=measure*(1+tolerance),'Overlapping or inconsistent remap cells at '+id);
        return covered>measure?measure/covered:1;
      });
    }
    const capA=limit(a,coverageA), capB=limit(b,coverageB);
    from.clear();
    to.clear();
    for(const link of links){
      link.measure*=Math.min(capA[link.from],capB[link.to]);
      from.add(link.from,link.measure);
      to.add(link.to,link.measure);
    }

    function uncovered(cells,coverage) {
      return Float64Array.from(cells,({measure},i)=>{
        const remainder=measure-coverage[i];
        return remainder>32*Number.EPSILON*measure?remainder:0;
      });
    }
    const lost=uncovered(a,coverageA), opened=uncovered(b,coverageB);
    const denominators=Float64Array.from(a,({measure},i)=>lost[i]===0&&coverageA[i]>0?coverageA[i]:measure);
    const geometry=freeze({dimension:source.dimension,units:source.identity.units,
      source:sumOf(a.map(row=>row.measure)),target:sumOf(b.map(row=>row.measure)),
      overlap:sumOf(links.map(row=>row.measure)),escaped:sumOf(lost),opened:sumOf(opened),candidates,overlaps:links.length});

    function transfer(raw,{details=false}={}) {
      check(record(raw)&&typeof details==='boolean','State remap needs channel data');
      const entries=Object.entries(raw);
      check(integer(entries.length,1,32)&&(a.length+b.length)*entries.length<=2000000,'State remap exceeds its channel budget');
      const channels={},ledger={};
      for(const [name,spec] of entries){
        check(id(name)&&fields(spec,['units','values','initializeDensity'])&&
          typeof spec.units==='string'&&spec.units.trim().length>0&&spec.units.length<=64&&
          array(spec.values)&&spec.values.length===a.length&&Array.from(spec.values).every(Number.isFinite),
        'State remap needs one finite extensive value per source cell: '+name);
        const density=spec.initializeDensity===undefined?0:spec.initializeDensity;
        check(Number.isFinite(density)||array(density)&&density.length===b.length&&Array.from(density).every(Number.isFinite),
          'State remap initialization needs finite density in target cell order: '+name);
        const mapped=accumulators(b.length), values=mapped.sums;
        for(const {from,to,measure} of links)mapped.add(to,spec.values[from]*(measure/denominators[from]));
        const escaped=Float64Array.from(lost,(measure,i)=>spec.values[i]*(measure/a[i].measure));
        const initialized=Float64Array.from(opened,(measure,i)=>measure*(typeof density==='number'?density:density[i]));
        const input=sumOf(spec.values), moved=sumOf(values), removed=sumOf(escaped), seeded=sumOf(initialized);
        for(let i=0;i<values.length;i++)values[i]+=initialized[i];
        const output=sumOf(values), sourceBalanceError=input-moved-removed, balanceError=input-removed+seeded-output;
        check([input,moved,removed,seeded,output,sourceBalanceError,balanceError].every(Number.isFinite)&&values.every(Number.isFinite),
          'State remap overflow in '+name);
        channels[name]={units:spec.units,values:Array.from(values)};
        ledger[name]={units:spec.units,input,moved,escaped:removed,initialized:seeded,output,balanceError,sourceBalanceError,
          ...(details&&{escapedBySource:Array.from(escaped),initializedByTarget:Array.from(initialized)})};
      }
      return freeze({format:reportFormat,version:1,source:source.identity,target:target.identity,geometry,channels,ledger,
        ...(details&&{coverage:{
          source:a.map(({id},i)=>({id,covered:coverageA[i],escaped:lost[i]})),
          target:b.map(({id},i)=>({id,covered:coverageB[i],opened:opened[i]})),links
        }})});
    }

    return Object.freeze({transfer,geometry});
  }
  W.stateRemap=Object.freeze({format,reportFormat,prepare,
    transfer:(source,target,channels,{details,maxPairs,tolerance}={})=>
      prepare(source,target,{maxPairs,tolerance}).transfer(channels,{details})});
})(KIT);
