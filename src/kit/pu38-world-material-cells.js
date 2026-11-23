/* One conserved material parcel can occupy a lattice cell or travel in a rigid compound. */
(function (K) {
  const W=K.world, Q=W.query, Bonds=W.materialBonds, {V,M}=K, {freeze}=K.procedural.data;
  const {check,record,vector,own,id,copy,equal}=W.data;
  const zero=[0,0,0], rotation=M.id(), absoluteZero=-273.15, maxTemperature=10000;
  const normals=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const velocity=value=>vector(value)&&value.every(n=>Math.abs(n)<=1000);
  const bodyId=value=>id(value)&&!own(Object.prototype,value)&&!value.startsWith('cell.');
  const sum=(rows,read)=>rows.reduce((total,row)=>total+read(row),0);

  function materialCells(config,env) {
    const {id:system,world}=env;
    const {size, origin=zero, cell=1, initial:placements=[], materials, ambient=20,
      cooling=0, conduction=0, settle=false, ground=origin?.[1], gravity=[0,-9.81,0], drag=.08, phase}=config;
    check(vector(size)&&size.every(n=>integer(n,1,64))&&size.reduce((a,b)=>a*b,1)<=32768&&
      vector(origin)&&origin.every(n=>Math.abs(n)<=1000)&&finite(cell,.04,5)&&finite(ground,-1000,1000)&&
      velocity(gravity)&&finite(drag,0,100)&&finite(ambient,absoluteZero,maxTemperature)&&
      finite(cooling,0,100)&&finite(conduction,0,100)&&typeof settle==='boolean','Invalid material-cell lattice or climate');
    const bounds=freeze({min:origin.slice(),max:V.add(origin,V.mul(size,cell))});
    const [nx,ny,nz]=size, count=nx*ny*nz, half=[cell/2,cell/2,cell/2], eps=cell*1e-7;
    const index=at=>Array.isArray(at)&&at.length===3&&Array.from(at).every((n,i)=>integer(n,0,size[i]-1))?
      at[0]+nx*(at[1]+ny*at[2]):-1;
    const address=i=>[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))];
    const center=i=>address(i).map((n,k)=>origin[k]+(n+.5)*cell);
    const location=point=>point.map((n,i)=>Math.floor((n-origin[i])/cell));
    const neighbors=i=>normals.map(n=>index(V.add(address(i),n)));
    const adjacent=Array.from({length:count},(_,i)=>neighbors(i));
    const solidBox=(i,point)=>{
      const d=V.sub(point,center(i)).map(n=>Math.abs(n)-cell/2);
      return Math.hypot(...d.map(n=>Math.max(0,n)))+Math.min(0,Math.max(...d));
    };

    check(record(materials)&&integer(Object.keys(materials).length,1,64),'Expected named cell materials');
    const profiles=new Map();
    for(const [name,spec] of Object.entries(materials)){
      check(id(name)&&keys(spec,['density','specificHeat','ramp','hotAt']),'Invalid cell material '+name);
      const {density=1,specificHeat=1,ramp=[0x677d7a],hotAt=Math.min(maxTemperature,Math.max(900,ambient+1))}=spec;
      check(finite(density,.001,1e5)&&finite(specificHeat,.001,1e5)&&
        finite(hotAt,ambient+.01,maxTemperature)&&Array.isArray(ramp)&&integer(ramp.length,1,16)&&
        Array.from(ramp).every(color=>integer(color,0,0xffffff)),'Invalid thermal or palette settings for '+name);
      const mass=density*cell**3;
      profiles.set(name,{mass,capacity:mass*specificHeat,ramp:ramp.slice(),hotAt});
    }
    const mass=row=>profiles.get(row.material).mass;
    const capacity=row=>profiles.get(row.material).capacity;
    let phases;
    if(phase!==undefined){
      check(record(phase)&&profiles.has(phase.material),'Material phases need a named rigid material');
      phases=W.materialPhases.prepare(phase,{size,cell,origin,profile:profiles.get(phase.material),
        dt:world.dt,ground,absoluteZero,maxTemperature});
    }
    const temperature=row=>{
      const degrees=absoluteZero+row.energy/capacity(row);
      if(!row.phase)return degrees;
      return row.energy<phases.meltEnergy?Math.min(degrees,phases.meltingPoint):degrees-phases.latentDegrees;
    };
    const heatLimit=row=>capacity(row)*(maxTemperature-absoluteZero)+(row.phase?phases.latent:0);
    const safeHeat=row=>finite(row.energy,0,heatLimit(row));
    check(Array.isArray(placements)&&placements.length<=512,'Material cells allow up to 512 occupied parcels');
    const authored={}, initialParcels=new Map();
    for(const row of placements){
      check(keys(row,['at','material','temperature','wetness','data']),'Invalid initial material cell');
      const {at,material,temperature=ambient,wetness=0,data}=row, key=index(at);
      check(key>=0&&!own(authored,key)&&profiles.has(material)&&finite(wetness,0,1)&&
        finite(temperature,absoluteZero,maxTemperature)&&center(key)[1]-half[1]>=ground-eps&&
        (data===undefined||record(data)),'Invalid, overlapping or below-ground material cell');
      const parcel=freeze({id:key,material,wetness,energy:profiles.get(material).capacity*(temperature-absoluteZero),
        ...(data!==undefined&&{data:copy(data)})});
      authored[key]=parcel;
      initialParcels.set(key,parcel);
    }
    const pool=phases?.totals(phases.start);
    const initialEnergy=sum(Object.values(authored),row=>row.energy)+(pool?pool.fieldSensibleEnergy+pool.liquidLatentEnergy:0);
    const initialMass=sum(Object.values(authored),mass)+(pool?pool.liquidMass+pool.fieldIceMass:0);
    const mechanics=W.mechanics.create({continuous:true,ground,gravity,drag},env);
    const emptyPhysics=freeze(mechanics.initial({world}));
    const fixed=new Map(), frames=new WeakMap();
    // A shallow contact skin lets a lifted face separate from a coplanar cell seam.
    const contactHalf=half.map(value=>value-cell*1e-5);
    function fixedBody(key){
      const name='cell.'+key;
      if(!fixed.has(key))fixed.set(key,freeze({id:name,entity:name,origin:name,material:'material-cell',
        position:center(key),half:contactHalf,rotation,velocity:zero,angular:zero,mass:1,fixed:true}));
      return fixed.get(key);
    }

    function coherent(indices){
      if(!indices.length)return false;
      const remaining=new Set(indices), queue=[indices[0]];
      remaining.delete(indices[0]);
      for(const i of queue)for(const j of adjacent[i])if(remaining.delete(j))queue.push(j);
      return !remaining.size;
    }
    function shapeOf(cells){
      const rows=Object.entries(cells), total=sum(rows,([,row])=>mass(row)), weighted=[0,0,0];
      for(const [key,row] of rows){
        const p=center(Number(key)), weight=mass(row)/total;
        for(let i=0;i<3;i++)weighted[i]+=p[i]*weight;
      }
      const collider=freeze({kind:'compound',parts:rows.map(([key])=>({kind:'box',half,at:V.sub(center(Number(key)),weighted)}))});
      return {position:weighted,mass:total,collider,half:W.colliders.local(collider).half};
    }
    function parcelRows(state){
      return Object.values(state.cells).concat(Object.values(state.pieces).flatMap(piece=>Object.values(piece.cells)));
    }
    function balance(state){
      const rows=parcelRows(state), field=phases?.totals(state.phase), parcelEnergy=sum(rows,row=>row.energy);
      const energy=parcelEnergy+(field?field.fieldSensibleEnergy+field.liquidLatentEnergy:0);
      const materialMass=sum(rows,mass)+(field?field.liquidMass+field.fieldIceMass:0), phaseEnergy=state.phase?.exchange??0;
      return {mass:materialMass,initialMass,massError:materialMass-initialMass,energy,initialEnergy,appliedEnergy:state.appliedEnergy,
        ambientEnergy:state.ambientEnergy,energyError:energy-initialEnergy-state.appliedEnergy-state.ambientEnergy-phaseEnergy,
        ...(field&&{...field,phaseEnergy,parcelEnergy,solidMass:sum(rows.filter(row=>row.phase),mass)}),
        cells:Object.keys(state.cells).length,carried:rows.length-Object.keys(state.cells).length,pieces:Object.keys(state.pieces).length};
    }

    function checkAction(action,args){
      check(record(args),'Expected a material conversion command');
      if(action==='lift'){
        const {body,cells,velocity:linear=zero,angular=zero,breakSpeed,fracture}=args;
        check(keys(args,['body','cells','velocity','angular','breakSpeed','fracture'])&&bodyId(body)&&!body.startsWith('shard.')&&
          Array.isArray(cells)&&integer(cells.length,1,12)&&Array.from(cells).every(at=>index(at)>=0)&&
          new Set(cells.map(index)).size===cells.length&&coherent(cells.map(index))&&velocity(linear)&&velocity(angular)&&
          (breakSpeed===undefined||finite(breakSpeed,.01,1000)),'Lift needs a face-connected patch of 1–12 distinct cells and a valid body');
        if(fracture!==undefined)Bonds.prepare(fracture,cells.map(index),index,adjacent);
      } else if(action==='crumble'){
        check(keys(args,['body','spread'])&&bodyId(args.body)&&integer(args.spread??2,0,4),
          'Crumble needs a body and a spread radius of up to four cells');
      } else {
        const {at,body,energy}=args;
        check(keys(args,['at','body','energy'])&&(body===undefined?index(at)>=0:bodyId(body)&&(at===undefined||index(at)>=0))&&
          Number.isFinite(energy),'Heat needs a cell, piece or parcel in a piece and finite energy');
      }
    }

    function lift(state,args,ctx){
      const {body:id,cells:picked,velocity=zero,angular=zero,breakSpeed,fracture}=args;
      check(!own(state.pieces,id)&&Object.keys(state.pieces).length<32,'Material piece ID is occupied or its budget is exhausted');
      const cells={...state.cells}, cargo={};
      for(const at of picked){
        const key=index(at);
        check(own(cells,key),'Lift requires occupied material cells');
        cargo[key]=cells[key];
        delete cells[key];
      }
      const geometry=shapeOf(cargo), body={id,entity:id,origin:id,velocity,angular,rotation,fixed:false,
        material:Object.values(cargo)[0].material,...geometry};
      const piece={body,cells:cargo,...(breakSpeed!==undefined&&{breakSpeed}),
        ...(fracture!==undefined&&{fracture:Bonds.create(Bonds.prepare(fracture,picked.map(index),index,adjacent),cargo,adjacent,temperature)})};
      ctx.emit('material-lift',{body:id,at:body.position,parcels:Object.values(cargo).map(row=>row.id),mass:body.mass,
        energy:sum(Object.values(cargo),row=>row.energy)});
      return freeze({...state,cells,pieces:{...state.pieces,[id]:piece}});
    }

    function overlapsPiece(point,bodies){
      const probe={position:point,half,rotation};
      return bodies.some(body=>W.colliders.contact(probe,body)?.gap < -eps);
    }

    function placementsFor(state,piece,spread){
      const {body,cells}=piece, entries=Object.entries(cells), other=Object.values(state.pieces)
        .filter(row=>row!==piece).map(row=>row.body);
      const available=new Map();
      function vacant(key){
        if(!available.has(key)){
          const at=center(key);
          const occupied=own(state.cells,key)||at[1]-half[1]<ground-eps||overlapsPiece(at,other);
          available.set(key,!occupied);
        }
        return available.get(key);
      }
      const options=entries.map(([source,parcel],i)=>{
        const point=V.add(body.position,M.app(body.rotation,body.collider.parts[i].at)), near=location(point), candidates=[];
        for(let z=-spread;z<=spread;z++)for(let y=-spread;y<=spread;y++)for(let x=-spread;x<=spread;x++){
          const key=index(V.add(near,[x,y,z]));
          if(key>=0&&vacant(key))candidates.push({key,distance:V.dist(point,center(key))});
        }
        candidates.sort((a,b)=>a.distance-b.distance||a.key-b.key);
        return {source:Number(source),parcel,candidates};
      }).sort((a,b)=>a.candidates.length-b.candidates.length||a.source-b.source);

      // Augment until every parcel has a distinct place, or keep the whole rigid piece.
      const assigned=new Map();
      function assign(row,seen){
        const free=row.candidates.find(({key})=>!seen.has(key)&&!assigned.has(key));
        if(free){
          assigned.set(free.key,row);
          return true;
        }
        for(const {key} of row.candidates){
          if(seen.has(key))continue;
          seen.add(key);
          if(!assign(assigned.get(key),seen))continue;
          assigned.set(key,row);
          return true;
        }
        return false;
      }
      if(options.some(row=>!assign(row,new Set())))return null;
      return [...assigned].sort(([a],[b])=>a-b).map(([key,{parcel}])=>[key,parcel]);
    }

    function crumble(state,{body:id,spread=2},ctx,impact,detached=false){
      check(own(state.pieces,id),'Unknown material piece '+id);
      const piece=state.pieces[id], deposited=placementsFor(state,piece,spread);
      if(!deposited){
        if(detached)return state;
        if(impact===undefined)check(false,'Crumble has no free cell placement within its spread');
        ctx.emit('material-crumble-blocked',{body:id,at:piece.body.position,speed:impact});
        return state;
      }
      const pieces={...state.pieces};
      delete pieces[id];
      ctx.emit('material-crumble',{body:id,at:piece.body.position,mass:piece.body.mass,
        energy:sum(deposited,([,row])=>row.energy),cells:deposited.map(([key,row])=>({at:address(key),parcel:row.id})),
        ...(impact!==undefined&&{speed:impact}),...(detached&&{detached})});
      const cells={...state.cells};
      for(const [key,row] of deposited)cells[key]=settle?{...row,looseSince:ctx.tick}:row;
      return freeze({...state,cells,pieces});
    }

    function heat(state,{at,body,energy},ctx){
      const piece=own(state.pieces,body)?state.pieces[body]:null;
      check(body===undefined||piece,'Heat needs an existing material piece');
      const cells=piece?.cells??state.cells;
      const selected=at===undefined?(piece?Object.keys(cells):[]):[index(at)];
      check(selected.length>0&&selected.every(key=>own(cells,key)),'Heat needs occupied material');
      const total=sum(selected,key=>capacity(cells[key])), next={...cells};
      for(const key of selected){
        const row=cells[key];
        next[key]={...row,energy:row.energy+energy*(capacity(row)/total)};
        check(safeHeat(next[key]),'Material heat exceeds the temperature range');
      }
      ctx.emit('material-heat',{...(at!==undefined&&{cell:at}),...(body!==undefined&&{body}),energy});
      return freeze({...state,...(piece?{pieces:{...state.pieces,[body]:{...piece,cells:next}}}:{cells:next}),
        appliedEnergy:state.appliedEnergy+energy});
    }

    function settleLoose(state,tick){
      if(!settle)return state.cells;
      const pieces=Object.values(state.pieces).map(({body})=>body);
      const loose=Object.keys(state.cells).map(Number).filter(key=>state.cells[key].looseSince<tick)
        .sort((a,b)=>address(a)[1]-address(b)[1]||a-b);
      let cells=state.cells;
      for(const key of loose){
        const below=adjacent[key][3];
        if(below<0||own(cells,below))continue;
        const at=center(below);
        if(at[1]-half[1]<ground-eps||overlapsPiece(at,pieces))continue;
        if(cells===state.cells)cells={...cells};
        cells[below]=cells[key];
        delete cells[key];
      }
      return cells;
    }

    function thermal(cells,dt,faces={}){
      if(!cooling&&!conduction)return {cells,exchange:0};
      const input=Object.entries(cells), delta=new Map(), couple=-Math.expm1(-conduction*dt)/6, cool=-Math.expm1(-cooling*dt)/6;
      let exchange=0;
      for(const [text,row] of input){
        const key=Number(text), around=adjacent[key], temp=temperature(row), cap=capacity(row);
        let exposed=0, change=0;
        for(const [side,other] of around.entries()){
          const next=faces[key]&1<<side?null:cells[other];
          if(!next){exposed++;continue;}
          if(other<=key)continue;
          const second=capacity(next), energy=(temperature(next)-temp)*(cap*second/(cap+second))*couple;
          change+=energy;
          delta.set(other,(delta.get(other)??0)-energy);
        }
        // Both channels consume fractions of the same step-start heat budget.
        const ambientDelta=(ambient-temp)*cap*cool*exposed;
        exchange+=ambientDelta;
        delta.set(key,(delta.get(key)??0)+change+ambientDelta);
      }
      if(![...delta.values()].some(Boolean))return {cells,exchange};
      return {cells:Object.fromEntries(input.map(([key,row])=>[key,{...row,energy:row.energy+delta.get(Number(key))}])),exchange};
    }

    function splitPiece(piecesById,id,groups,ctx,fracture){
      const piece=piecesById[id], {body,cells}=piece;
      const origin=center(Number(Object.keys(cells)[0])), oldCenter=V.sub(origin,body.collider.parts[0].at);
      const pieces={...piecesById}, fragments=[];
      delete pieces[id];
      const ordered=groups.slice().sort((a,b)=>b.length-a.length||a[0]-b[0]);
      for(const [i,group] of ordered.entries()){
        const cargo=Object.fromEntries(group.map(key=>[key,cells[key]]));
        const geometry=shapeOf(cargo), offset=M.app(body.rotation,V.sub(geometry.position,oldCenter));
        const {mass,collider,half}=geometry, position=V.add(body.position,offset);
        const base='shard.'+ctx.tick+'.'+Math.min(...group.map(key=>cells[key].id));
        let name=i===0?id:base;
        if(i)for(let suffix=1;own(pieces,name);suffix++)name=base+'.'+suffix;
        const nextBody={...body,id:name,entity:name,origin:name,mass,collider,half,position,
          material:cells[group[0]].material,velocity:V.add(body.velocity,V.cross(body.angular,offset))};
        pieces[name]={...piece,body:nextBody,cells:cargo,...(fracture&&{fracture:Bonds.subset(fracture,group)})};
        fragments.push({body:name,parcels:group.map(key=>cells[key].id),mass});
      }
      return {pieces,fragments};
    }

    function crack(state,id,loads,ctx){
      const piece=state.pieces[id], {body,cells}=piece;
      const {fracture,failed}=Bonds.update(piece.fracture,cells,loads,ctx.dt,adjacent,temperature);
      if(!failed.length)
        return {...state,pieces:{...state.pieces,[id]:{...piece,fracture}}};

      const groups=Bonds.components(cells,fracture.bonds);
      if(Object.keys(state.pieces).length-1+groups.length>32){
        ctx.emit('material-fracture-blocked',{body:id,at:body.position,reason:'piece-budget'});
        // Keep the committed bond topology when the split exceeds capacity.
        return state;
      }
      const origin=center(Number(Object.keys(cells)[0])), oldCenter=V.sub(origin,body.collider.parts[0].at);
      const worldAt=key=>V.add(body.position,M.app(body.rotation,V.sub(center(key),oldCenter)));
      const seams=failed.map(({a,b,...load})=>({parcels:[cells[a].id,cells[b].id],cells:[address(a),address(b)],
        ...load,at:V.lerp(worldAt(a),worldAt(b),.5)}));
      const impact=seams.some(seam=>seam.impactDamage>0)&&loads.length>0;
      ctx.emit('material-crack',{body:id,at:seams[0].at,seams,...(impact&&{speed:Math.max(...loads.map(load=>load.speed))})});
      if(groups.length===1)return {...state,pieces:{...state.pieces,[id]:{...piece,fracture}}};
      const {pieces,fragments}=splitPiece(state.pieces,id,groups,ctx,fracture);
      ctx.emit('material-fracture',{body:id,at:body.position,fragments});
      return {...state,pieces};
    }

    function stepPhysical(state,ctx){
      const settled=settleLoose(state,ctx.tick), staticTemp=thermal(settled,ctx.dt), ids=Object.keys(state.pieces).sort(), moving={};
      let ambientEnergy=state.ambientEnergy+staticTemp.exchange;
      if(!ids.length)return staticTemp.cells===state.cells?state:freeze({...state,cells:staticTemp.cells,ambientEnergy});
      const bodies={};
      for(const key of Object.keys(settled)){
        const body=fixedBody(Number(key));
        bodies[body.id]=body;
      }
      for(const id of ids)bodies[id]=state.pieces[id].body;
      const physics=mechanics.step({...emptyPhysics,bodies},ctx);
      for(const id of ids){
        const piece=state.pieces[id], transfer=thermal(piece.cells,ctx.dt,piece.fracture?.faces);
        moving[id]={...piece,body:physics.bodies[id],cells:transfer.cells};
        ambientEnergy+=transfer.exchange;
      }
      let next={...state,cells:staticTemp.cells,pieces:moving,ambientEnergy};
      const speeds=new Map(), loads=new Map();
      for(const hit of physics.impacts){
        const a=own(moving,hit.a)?moving[hit.a]:null, b=hit.b!==null&&own(moving,hit.b)?moving[hit.b]:null;
        if(!a&&!b)continue;
        const effective=a&&b?(a.body.mass*b.body.mass)/(a.body.mass+b.body.mass):(a??b).body.mass;
        const energy=.5*effective*hit.speed**2/(a&&b?2:1);
        for(const [i,piece] of [a,b].entries()){
          if(!piece)continue;
          const id=piece.body.id;
          speeds.set(id,Math.max(speeds.get(id)??0,hit.speed));
          if(!piece.fracture||energy<=0)continue;
          const cell=Number(Object.keys(piece.cells)[hit.parts[i]]);
          if(!loads.has(id))loads.set(id,[]);
          loads.get(id).push({cell,energy,speed:hit.speed});
        }
      }
      for(const id of ids){
        const speed=speeds.get(id), piece=next.pieces[id];
        if(speed!==undefined&&speed>=piece.breakSpeed)next=crumble(next,{body:id},ctx,speed);
        if(own(next.pieces,id)&&piece.fracture)next=crack(next,id,loads.get(id)??[],ctx);
      }
      for(const [id,piece] of Object.entries(next.pieces))
        if(piece.fracture&&!piece.fracture.bonds.length)next=crumble(next,{body:id},ctx,undefined,true);
      return freeze(next);
    }

    function advancePhases(state,ctx){
      const field=phases.advance(state.phase,ctx), cells={...state.cells};
      let pieces={...state.pieces};
      function warm(row,point){
        if(!row.phase)return row;
        const added=phases.warm(point,temperature(row),ctx.dt);
        if(!added)return row;
        const energy=K.clamp(row.energy+added,0,heatLimit(row));
        field.exchange+=energy-row.energy;
        return {...row,energy};
      }
      function melt(row,point,body) {
        if(!row.phase||row.energy<phases.meltEnergy)return false;
        const destination=phases.deposit(field,point,row.energy);
        if(!destination)return false;
        ctx.emit('material-melt',{parcel:row.id,material:row.material,at:point,destination,mass:mass(row),energy:row.energy,
          ...(body!==undefined&&{body})});
        return true;
      }
      for(const [key,parcel] of Object.entries(cells)){
        const point=center(Number(key)), row=warm(parcel,point);
        if(melt(row,point))delete cells[key];
        else cells[key]=row;
      }
      for(const [id,piece] of Object.entries(state.pieces)){
        const {body,fracture}=piece, cargo={}, points=new Map();
        for(const [i,[key,parcel]] of Object.entries(piece.cells).entries()){
          const point=V.add(body.position,M.app(body.rotation,body.collider.parts[i].at));
          points.set(key,point);
          cargo[key]=warm(parcel,point);
        }
        pieces[id]={...piece,cells:cargo};
        const keys=Object.keys(cargo).map(Number);
        const bonds=fracture?.bonds??keys.flatMap(a=>adjacent[a].filter(b=>b>a&&own(cargo,b))
          .map(b=>({a,b,damage:0,strength:1})));
        const remaining={...cargo};
        let groups;
        for(const [key,row] of Object.entries(cargo)){
          if(!row.phase||row.energy<phases.meltEnergy)continue;
          delete remaining[key];
          const candidate=Bonds.components(remaining,bonds.filter(({a,b})=>own(remaining,a)&&own(remaining,b)));
          if(Object.keys(pieces).length-1+candidate.length<=32&&melt(row,points.get(key),id))groups=candidate;
          else remaining[key]=row;
        }
        if(groups){
          const split=splitPiece(pieces,id,groups,ctx,fracture);
          pieces=split.pieces;
          if(groups.length>1)ctx.emit('material-melt-split',{body:id,at:body.position,fragments:split.fragments});
        }
      }
      const bodies=Object.values(pieces).map(({body})=>body);
      let count=Object.keys(cells).length+sum(Object.values(pieces),piece=>Object.keys(piece.cells).length);
      for(const i of phases.sites){
        if(count>=512)break;
        if(field.ice[i]<1)continue;
        const at=phases.lattice(i), key=index(at), point=center(key);
        if(own(cells,key)||overlapsPiece(point,bodies))continue;
        const row=phases.extract(field,i);
        cells[key]=row;
        count++;
        ctx.emit('material-freeze',{parcel:row.id,material:row.material,cell:at,at:point,mass:mass(row),energy:row.energy});
      }
      return freeze({...state,cells,pieces,phase:field});
    }

    function step(state,ctx){
      const next=stepPhysical(state,ctx);
      return phases?advancePhases(next,ctx):next;
    }

    function validRotation(matrix){
      if(!vector(matrix,9)||Math.abs(M.det(matrix)-1)>1e-6)return false;
      const rows=[matrix.slice(0,3),matrix.slice(3,6),matrix.slice(6,9)];
      return rows.every((row,i)=>rows.every((other,j)=>Math.abs(V.dot(row,other)-Number(i===j))<1e-6));
    }
    function validateState(state){
      check(keys(state,['cells','pieces','ambientEnergy','appliedEnergy',...(phases?['phase']:[])])&&
        record(state.cells)&&record(state.pieces)&&Object.keys(state.pieces).length<=32&&
        [state.ambientEnergy,state.appliedEnergy].every(Number.isFinite),
      'Invalid saved material state');
      if(phases)phases.validate(state.phase);
      const seen=new Set();
      function validateCells(cells){
        check(record(cells)&&Object.keys(cells).length<=(phases?512:initialParcels.size),'Invalid saved material cells');
        for(const [key,row] of Object.entries(cells)){
          const i=Number(key), birth=initialParcels.get(row?.id);
          const isNew=phases&&row?.phase===true&&integer(row.id,phases.firstId,state.phase.nextId-1)&&
            row.material===phases.material&&row.wetness===0&&row.data===undefined;
          const authored=birth&&row.phase===undefined&&row.material===birth.material&&row.wetness===birth.wetness&&equal(row.data,birth.data);
          check(integer(i,0,count-1)&&String(i)===key&&center(i)[1]-half[1]>=ground-eps&&(isNew||authored)&&
            !seen.has(row.id)&&keys(row,['id','material','energy','wetness','data','looseSince',...(phases?['phase']:[])])&&
            (row.looseSince===undefined||settle&&integer(row.looseSince,1,Number.MAX_SAFE_INTEGER))&&safeHeat(row),
          'Invalid or duplicated saved material parcel');
          seen.add(row.id);
        }
      }
      validateCells(state.cells);
      for(const [id,piece] of Object.entries(state.pieces)){
        check(bodyId(id)&&keys(piece,['body','cells','breakSpeed','fracture'])&&
          (piece.breakSpeed===undefined||finite(piece.breakSpeed,.01,1000)), 'Invalid saved material piece');
        validateCells(piece.cells);
        const indices=Object.keys(piece.cells).map(Number);
        check(integer(indices.length,1,12)&&coherent(indices),'Invalid saved material compound');
        if(piece.fracture!==undefined)Bonds.validate(piece.fracture,piece.cells,adjacent);
        const {body}=piece, expected=shapeOf(piece.cells);
        check(keys(body,['id','entity','origin','velocity','angular','rotation','fixed','material','mass','collider','half','position'])&&
          body.id===id&&body.entity===id&&body.origin===id&&body.fixed===false&&
          body.material===Object.values(piece.cells)[0].material&&vector(body.position)&&vector(body.velocity)&&vector(body.angular)&&
          validRotation(body.rotation)&&equal(body.collider,expected.collider)&&equal(body.half,expected.half)&&body.mass===expected.mass,
        'Invalid saved material body');
      }
      const metrics=balance(state);
      check(seen.size<=512&&[...initialParcels.keys()].every(id=>seen.has(id))&&
        Math.abs(metrics.massError)<=1e-7*Math.max(1,initialMass)&&
        Math.abs(metrics.energyError)<=1e-7*Math.max(1,metrics.energy,initialEnergy),
        'Saved material does not balance');
    }

    const describe=(row,key,point)=>({...row,at:address(Number(key)),point,temperature:temperature(row),mass:mass(row)});
    function clearance(point,state,includePieces=true){
      let result=1e6;
      for(const key of Object.keys(state.cells))result=Math.min(result,solidBox(Number(key),point));
      if(includePieces)for(const {body} of Object.values(state.pieces))result=Math.min(result,W.mechanics.distance(body,point));
      return result;
    }
    function frame(state){
      if(frames.has(state))return frames.get(state);
      const B=makeBuilder(world.seed), splatIds=[], sun=V.norm([-.55,.75,.65]);
      function paint(cells,piece){
        for(const [i,[text,row]] of Object.entries(cells).entries()){
          const key=Number(text), {ramp,hotAt}=profiles.get(row.material), heat=K.clamp((temperature(row)-ambient)/(hotAt-ambient),0,1);
          const color=ramp[Math.round(heat*(ramp.length-1))], base=[color>>16,(color>>8)&255,color&255];
          const body=piece?.body, worldAt=p=>body?V.add(body.position,M.app(body.rotation,p)):p;
          const origin=body?body.collider.parts[i].at:center(key), cracks=piece?.fracture?.faces[key]??0;
          for(let side=0;side<normals.length;side++){
            if(own(cells,adjacent[key][side]))continue;
            const n=normals[side], u=V.perp(n), v=V.cross(n,u), normal=body?M.app(body.rotation,n):n;
            const shade=.59+.32*Math.max(0,V.dot(normal,sun))+.09*heat;
            const fresh=cracks&1<<side, rgb=base.map(c=>Math.round(c*Math.min(1,shade+(fresh ? .16*heat : 0))));
            const first=B.count(), face=V.mad(origin,n,cell*.502);
            for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
              const p=worldAt(V.mad(V.mad(face,u,x*cell/3),v,y*cell/3));
              B.disc(...p,normal,cell*.264,cell*.034,rgb,1);
              splatIds.push(system+'/'+row.id+'/'+side+'/'+(y+1)+'/'+(x+1));
            }
            for(const [edge,across] of normals.entries()){
              if(!(cracks&1<<edge)||V.dot(n,across)!==0)continue;
              const tangent=V.cross(n,across), run=V.mad(V.mad(face,across,cell*.47),n,cell*.014);
              for(let mark=-2;mark<=2;mark++){
                const p=worldAt(V.mad(run,tangent,mark*cell*.19));
                B.disc(...p,normal,cell*.105,cell*.018,rgb.map(c=>Math.round(c*.44)),1);
                splatIds.push(system+'/'+row.id+'/crack/'+side+'/'+edge+'/'+(mark+2));
              }
            }
            B.describeSplats(first,B.count(),{material:row.material,target:{surface:system,...(body&&{entity:body.entity})}});
          }
        }
      }
      paint(state.cells);
      for(const piece of Object.values(state.pieces))paint(piece.cells,piece);
      if(phases)for(const row of phases.rows(state.phase)){
        const depth=(row.liquid+row.ice)/phases.mass;
        if(depth<.005)continue;
        const point=V.add(row.point,[0,cell*.13*Math.min(2,depth),0]), c=phases.liquidColor;
        const frozen=row.ice/(row.liquid+row.ice), color=[c>>16,(c>>8)&255,c&255].map((n,i)=>
          Math.round(n+([187,223,231][i]-n)*frozen));
        const first=B.count();
        B.disc(...point,[0,1,0],cell*(.29+.31*Math.min(1,depth)),cell*.035,color,1);
        splatIds.push(system+'/phase/'+row.at.join('/'));
        B.describeSplats(first,B.count(),{material:phases.material+'-liquid',target:{surface:system}});
      }
      const {data,count,moving,back,renderMetadata}=B.finish();
      const part={data:data.slice(0,count*16),count,moving,back,renderMetadata,splatIds:freeze(splatIds)};
      const result=Object.freeze({bounds,parts:Object.freeze([Object.freeze(part)])});
      frames.set(state,result);
      return result;
    }

    const whenReady=read=>({state,target})=>state?read(state,target):Q.missing('Material cells are unavailable');
    const pieceBodies=state=>Object.fromEntries(Object.entries(state.pieces).map(([id,{body}])=>[id,body]));
    const readCells=cells=>Object.entries(cells).map(([key,row])=>describe(row,key,center(Number(key))));
    function readPieces(state){
      const pieces={};
      for(const [id,{body,cells,fracture}] of Object.entries(state.pieces)){
        const payload=Object.entries(cells).map(([key,row],i)=>{
          const point=V.add(body.position,M.app(body.rotation,body.collider.parts[i].at));
          return describe(row,key,point);
        });
        const bonds=fracture?.bonds.map(bond=>({...bond,cells:[address(bond.a),address(bond.b)],
          parcels:[cells[bond.a].id,cells[bond.b].id],broken:!Bonds.intact(bond)}));
        pieces[id]={body,cells:payload,...(bonds&&{bonds})};
      }
      return pieces;
    }
    return {
      initial:()=>freeze({cells:authored,pieces:{},ambientEnergy:0,appliedEnergy:0,...(phases&&{phase:phases.start})}),checkAction,
      validateState,step,actions:{lift,crumble,heat},volumeFrame:state=>state?frame(state):null,
      *poseEntities(state){yield* Object.keys(state?.pieces??{});},
      pose:(state,name)=>own(state?.pieces,name)?state.pieces[name].body:null,
      occupancyField:'solid-clearance',
      fields:{
        cells:{type:'records',read:whenReady(state=>Q.ok(readCells(state.cells)))},
        cell:{type:'record',read:whenReady((state,target)=>{
          if(!target.point)return Q.missing('XYZ point required');
          const key=index(location(target.point)), row=state.cells[key];
          return row?Q.ok(describe(row,key,center(key))):Q.missing('No material cell','empty');
        })},
        pieces:{type:'record',read:whenReady(state=>Q.ok(readPieces(state)))},
        ...(phases&&{phases:{type:'records',read:whenReady(state=>Q.ok(phases.rows(state.phase)))}}),
        bodies:{type:'record',read:whenReady(state=>Q.ok(pieceBodies(state)))},
        balance:{type:'record',read:whenReady(state=>Q.ok(balance(state)))},
        'solid-clearance':{type:'number',units:'world',read:whenReady((state,target)=>target.point?
          Q.ok(clearance(target.point,state,false)):Q.missing('XYZ point required'))},
        clearance:{type:'number',units:'world',read:whenReady((state,target)=>target.point?
          Q.ok(clearance(target.point,state)):Q.missing('XYZ point required'))}
      },
      occupancy:{
        ...mechanics.occupancy,key:state=>state.pieces,
        *rows(state){yield* mechanics.occupancy.rows({bodies:pieceBodies(state)});}
      }
    };
  }
  W.runtime.register('material-cells',materialCells);
})(KIT);
