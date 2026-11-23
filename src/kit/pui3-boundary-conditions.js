/* Versioned boundary and source laws with solver-specific bindings. */
(function(K){
  const W=K.world,{V}=K,{check,record,id,vector,copy,own}=W.data,{freeze,hash}=K.procedural.data;
  const {fields,finite,nonnegative,positive,interval,tape}=W.boundarySignals;
  const format='ink-studio/boundary-set', reportFormat='ink-studio/boundary-sample';
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const measures=['density','total'];

  function entries(table,max,label){
    check(record(table)&&Object.keys(table).length<=max&&Object.keys(table).every(id),'Invalid '+label+' table');
    return Object.entries(table);
  }
  function mean(signal,time,dt){
    const end=interval(time,dt);
    const value=dt===0?signal.value(time):signal.integral(time,end)/(end-time);
    check(finite(value),'Boundary signal exceeded numeric range');
    return value;
  }

  function moving(row){
    const {geometry,motion}=row, base=W.movingBoundaries.prepare(geometry), drive=motion===undefined?null:tape(motion);
    const vectors=Array.isArray(geometry.moving)&&geometry.moving.every(value=>vector(value))&&!geometry.seat.frame;
    check(!drive||vectors,'Authored wall motion needs standalone vertices and seat');
    const normal=V.norm(geometry.seat.normal);
    function at(time,reference){
      interval(time,0);
      check(vectors,'Wall needs a live scene pose for this geometry');
      const offset=drive?mean(drive,time,0):0;
      return base.evaluate(geometry.moving.map(point=>V.mad(point,normal,offset)),{reference});
    }
    function rate(time,dt){
      const end=interval(time,dt);
      check(dt>0,'Moving wall drive needs a positive interval');
      const before=at(time),after=at(end);
      check(before.status!=='unavailable'&&after.status!=='unavailable','Moving wall could not measure its volume');
      const value=(before.pocketVolume-after.pocketVolume)/(end-time);
      check(finite(value),'Moving wall volume rate exceeded numeric range');
      return value;
    }
    return Object.freeze({evaluate:base.evaluate,seatArea:base.seatArea,referenceVolume:base.referenceVolume,field:base.field,
      sample:(query,reference,time=0)=>drive?at(time,reference):base.sample(query,reference),
      at,rate,static:vectors,vertexCount:geometry.seat.points.length,
      work:2*(geometry.seat.points.length+geometry.seat.triangles.length*4)});
  }

  function prepare(asset){
    check(fields(asset,['format','version','id','revision','rules'])&&asset.format===format&&asset.version===1&&
      id(asset.id)&&integer(asset.revision,1,Number.MAX_SAFE_INTEGER),'Expected a version 1 boundary set');
    const definition=freeze(copy(asset));
    const identity=freeze({id:definition.id,revision:definition.revision,signature:hash(JSON.stringify(definition))});
    const law=new Map(entries(definition.rules,128,'boundary rule').map(([name,row])=>{
      const kind=row?.kind;
      if(kind==='fixed-value'||kind==='flux'||kind==='disturbance'){
        const basis=kind==='flux'?(row.basis??'density'):undefined;
        check(fields(row,['kind','signal','quantity',...(kind==='flux'?['basis']:[])])&&
          (basis===undefined||measures.includes(basis)),'Invalid boundary signal rule '+name);
        const signal=tape(row.signal), quantity=K.quantities.normalize(row.quantity,'Boundary rule '+name);
        return [name,{kind,signal,basis,quantity}];
      }
      if(kind==='moving-wall'){
        check(fields(row,['kind','geometry','motion']),'Invalid moving wall rule '+name);
        return [name,{kind,wall:moving(row)}];
      }
      if(kind==='impedance'){
        check(fields(row,['kind','value'])&&nonnegative(row.value),'Invalid nonnegative boundary impedance '+name);
        return [name,{kind,term:{kind:'impedance',impedance:row.value}}];
      }
      check(fields(row,['kind'])&&['absorbing','sealed'].includes(kind),'Unknown boundary rule '+name);
      return [name,{kind,term:{kind:kind==='absorbing'?'matched':'sealed'}}];
    }));
    check(law.size>0,'Boundary set needs at least one rule');
    function find(name){
      check(law.has(name),'Unknown boundary rule '+name);
      return law.get(name);
    }
    function wall(name){
      const row=find(name);
      check(row.kind==='moving-wall','Boundary rule '+name+' is not a moving wall');
      return row.wall;
    }
    function level(name,time=0,dt=0){
      const row=find(name);
      check(row.signal||row.wall,'Boundary rule '+name+' has no drive level');
      return row.signal?mean(row.signal,time,dt):row.wall.rate(time,dt);
    }
    function sample(time=0,dt=0){
      interval(time,dt);
      const rules=Object.fromEntries([...law].map(([name,row])=>{
        let detail;
        if(row.signal){
          const average=mean(row.signal,time,dt), amount=average*dt;
          check(finite(amount),'Boundary signal integral exceeded numeric range');
          detail={value:mean(row.signal,time,0),average,...(dt>0&&{integral:amount}),
            ...(row.basis&&{basis:row.basis}),...(row.quantity&&{quantity:row.quantity})};
        }
        else if(row.wall)detail=row.wall.static?{measurement:row.wall.at(time),
          ...(dt>0&&{volumeRate:row.wall.rate(time,dt)})}:{measurement:null};
        else detail={termination:{...row.term}};
        return [name,{kind:row.kind,...detail}];
      }));
      return {format:reportFormat,version:1,asset:identity,time,dt,rules};
    }

    function grid({boundaries={},disturbances={}}={},layout){
      const {cells,faces,regions}=layout;
      const regionSet=new Set(regions);
      const area=new Map(regions.map(tag=>[tag,0]));
      for(const face of faces)if(face.region!==null)
        area.set(face.region,(area.get(face.region)??0)+face.area);
      const bindings=entries(boundaries,256,'grid boundary binding').map(([tag,name])=>{
        const row=find(name);
        check(regionSet.has(tag)&&['fixed-value','flux','moving-wall','sealed'].includes(row.kind),'Invalid grid boundary binding '+tag);
        const total=row.basis==='total'||row.kind==='moving-wall', measure=area.get(tag);
        check(!total||positive(measure),'Integrated boundary drive needs a nonempty region '+tag);
        check(row.kind!=='moving-wall'||row.wall.static,'Grid wall drive needs standalone motion '+tag);
        return {tag,row,divisor:total?measure:1};
      });
      let selections=0;
      const added=entries(disturbances,32,'grid disturbance binding').map(([name,binding])=>{
        const {rule,target,distribution='total',scale=1}=binding??{}, row=find(rule);
        check(fields(binding,['rule','target','distribution','scale'])&&row.kind==='disturbance'&&
          measures.includes(distribution)&&finite(scale)&&(target===undefined||
            fields(target,['min','max'])&&vector(target.min)&&vector(target.max)&&target.min.every((v,i)=>v<=target.max[i])),
        'Invalid grid disturbance '+name);
        const indices=[];
        let measure=0;
        for(const [i,cell] of cells.entries())if(!target||cell.center.every((v,j)=>v>=target.min[j]&&v<=target.max[j])){
          check(++selections<=2000000,'Grid disturbance selections exceeded the binding budget');
          indices.push(i);measure+=cell.measure;
        }
        check(indices.length>0&&positive(measure),'Grid disturbance has no target cells '+name);
        return {row,indices,factor:distribution==='total'?scale/measure:scale};
      });
      function boundary(time,dt){
        interval(time,dt);
        return Object.fromEntries(bindings.map(({tag,row,divisor})=>{
          if(row.kind==='sealed')return [tag,{kind:'closed'}];
          if(row.kind==='fixed-value')return [tag,{kind:'value',value:mean(row.signal,time,dt)}];
          const level=row.kind==='moving-wall'?(dt>0?row.wall.rate(time,dt):0):mean(row.signal,time,dt);
          return [tag,{kind:'flux',value:-level/divisor}];
        }));
      }
      function source(time,dt){
        if(!added.length)return null;
        const values=new Float64Array(cells.length);
        for(const {row,indices,factor} of added){
          const level=mean(row.signal,time,dt)*factor;
          for(const i of indices)values[i]+=level;
        }
        check(values.every(finite),'Grid disturbance exceeded numeric range');
        return values;
      }
      return {boundary,source,identity};
    }

    function waves({ends={},drives={}}={}){
      const terminations=Object.fromEntries(entries(ends,256,'wave end binding').map(([node,name])=>{
        const row=find(name);
        check(row.term,'Wave end '+node+' needs an absorbing, impedance, or sealed rule');
        return [node,{...row.term}];
      }));
      const prepared=entries(drives,32,'wave drive binding').map(([name,binding])=>{
        const {rule,kind,node,port}=binding??{}, row=find(rule);
        const expected=row.kind==='fixed-value'?'pressure':row.kind==='disturbance'?(kind??'flow'):'flow';
        check(fields(binding,['rule','kind','node','port'])&&(node===undefined)!==(port===undefined)&&
          id(node??port)&&['pressure','flow'].includes(expected)&&(kind===undefined||kind===expected)&&
          ['fixed-value','flux','disturbance','moving-wall'].includes(row.kind)&&
          (row.kind!=='flux'||row.basis==='total')&&(!row.wall||row.wall.static),
        'Invalid wave drive '+name+'; volume flux requires total basis and a wall needs standalone motion');
        if(row.quantity)K.quantities.assertLink({unit:row.quantity.unit},{unit:expected==='pressure'?'Pa':'m^3/s'},
          'boundary '+rule,'wave '+name);
        return {name,source:{kind:expected,...(node===undefined?{port}:{node})},work:row.wall?.work??1,
          level:row.wall?(time,dt)=>row.wall.rate(time,dt):(time,dt)=>mean(row.signal,time,dt)};
      });
      return {terminations,sources:Object.fromEntries(prepared.map(({name,source})=>[name,source])),
        defaults:Object.fromEntries(prepared.map(({name,level})=>[name,level])),
        work:prepared.reduce((sum,row)=>sum+row.work,0),identity};
    }
    return Object.freeze({identity,wall,level,sample,grid,waves});
  }

  function bound(binding,allowed){
    check(fields(binding,['asset','revision',...allowed])&&(binding.revision===undefined||
      binding.asset?.revision===binding.revision),'Invalid or mismatched boundary set binding');
    return prepare(binding.asset);
  }
  W.boundaryConditions=Object.freeze({format,reportFormat,prepare,bound});
})(KIT);
