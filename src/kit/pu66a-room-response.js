/* Listener-space impulse response probes and doorway blends. */
(function(K){
  const W=K.world,{check,copy,id,record,vector}=W.data,{freeze}=K.procedural.data;
  const axes=['x','y','z'];
  const fields=(value,names)=>record(value)&&Object.keys(value).every(name=>names.includes(name));
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const point=value=>vector(value)&&value.every(n=>Math.abs(n)<=1e6);
  const box=({min,max})=>point(min)&&point(max)&&min.every((n,i)=>n<max[i]);
  const contains=({min,max},p)=>min.every((n,i)=>n<=p[i]&&p[i]<=max[i]);
  const overlaps=(a,b)=>a.min.every((n,i)=>n<b.max[i]&&a.max[i]>b.min[i]);
  const table=(value,min,max)=>record(value)&&Object.keys(value).every(id)&&
    finite(Object.keys(value).length,min,max);
  const assetName=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,127}$/.test(value);

  function compile(raw){
    const config=copy(raw);
    check(fields(config,['rooms','doorways','wet','smoothing']),'Invalid room response settings');
    const {rooms,doorways={},wet=.35,smoothing=.035}=config;
    check(table(rooms,1,8)&&table(doorways,0,16)&&finite(wet,0,1)&&finite(smoothing,0,1),
      'Invalid room response rooms, doorways, wet gain or smoothing');
    const assets=new Set(), regions=new Map();
    for(const name of Object.keys(rooms).sort()){
      const room=rooms[name];
      check(fields(room,['min','max','probes'])&&box(room)&&Array.isArray(room.probes)&&
        room.probes.length>=1&&room.probes.length<=8&&![...regions.values()].some(other=>overlaps(room,other)),
      'Invalid or overlapping room response room '+name);
      const positions=new Set();
      for(const probe of room.probes){
        check(fields(probe,['at','impulse'])&&point(probe.at)&&contains(room,probe.at)&&assetName(probe.impulse),
          'Invalid room response probe in '+name);
        const key=probe.at.join(',');
        check(!positions.has(key),'Coincident room response probes in '+name);
        positions.add(key);
        assets.add(probe.impulse);
      }
      regions.set(name,room);
    }
    check(assets.size<=8,'Room response supports up to eight impulse assets');
    const portals=new Map();
    for(const name of Object.keys(doorways).sort()){
      const door=doorways[name];
      check(fields(door,['from','to','axis','min','max'])&&box(door)&&axes.includes(door.axis)&&
        door.from!==door.to&&regions.has(door.from)&&regions.has(door.to)&&
        ![...portals.values()].some(other=>overlaps(door,other)),
      'Invalid or overlapping room response doorway '+name);
      const axis=axes.indexOf(door.axis), from=regions.get(door.from), to=regions.get(door.to);
      // Each end face must lie inside the named room. The two rooms may have a gap.
      const endIn=(room,value)=>[door.min,door.max].every(corner=>
        contains(room,corner.map((n,i)=>i===axis?value:n)));
      check(endIn(from,door.min[axis])&&endIn(to,door.max[axis])&&
        [...regions].every(([key,room])=>key===door.from||key===door.to||!overlaps(room,door)),
      'Room response doorway must run from the lower room to the upper room on its axis: '+name);
      portals.set(name,{...door,axis});
    }
    const definition=freeze({assets:[...assets].sort(),smoothing});
    function sample(position){
      const weights=new Map();
      const add=(asset,gain)=>weights.set(asset,(weights.get(asset)??0)+gain);
      function feed(room,level){
        if(!level)return;
        const distances=room.probes.map(({at})=>at.reduce((sum,n,i)=>sum+(n-position[i])**2,0));
        const nearest=Math.min(...distances);
        if(nearest===0){
          add(room.probes[distances.indexOf(0)].impulse,level);
          return;
        }
        const inverse=distances.map(d=>nearest/d), sum=inverse.reduce((a,b)=>a+b,0);
        room.probes.forEach(({impulse},i)=>add(impulse,level*inverse[i]/sum));
      }
      let room=null, doorway=null;
      if(position){
        check(point(position),'Invalid room response listener position');
        const crossing=[...portals].find(([,door])=>contains(door,position));
        if(crossing){
          const [name,{axis,min,max,from,to}]=crossing;
          doorway=name;
          const t=(position[axis]-min[axis])/(max[axis]-min[axis]), u=t*t*(3-2*t);
          feed(regions.get(from),wet*(1-u));
          feed(regions.get(to),wet*u);
        }else{
          const inside=[...regions].find(([,region])=>contains(region,position));
          if(inside){
            room=inside[0];
            feed(inside[1],wet);
          }
        }
      }
      return freeze({room,doorway,sends:[...weights].map(([asset,gain])=>({asset,gain:Math.min(gain,wet)}))});
    }
    return Object.freeze({definition,sample});
  }
  W.roomResponse=Object.freeze({compile});
})(KIT);
