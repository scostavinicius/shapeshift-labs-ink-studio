/* Finite specular image-source paths for positional cues. */
(function(K){
  const W=K.world,{V}=K,{check,record}=W.data;
  const eps=1e-5;
  const faces=['west','east','floor','ceiling','north','south'];
  const xyz=v=>Array.isArray(v)&&v.length===3&&Array.from(v).every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6);
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const keys=(v,allowed)=>record(v)&&Object.keys(v).every(key=>allowed.includes(key));
  const name=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(id);
  const defaultStyle={gain:.65,cutoff:6500};

  function compile(config){
    check(keys(config,['panels','room','materials','order','maxTaps','maxDelay','minGain','gain','metersPerWorld','speedOfSound']),
      'Invalid early reflection settings');
    const {panels={},room,materials={},order=2,maxTaps=6,maxDelay=.09,minGain=.012,gain=.8,
      metersPerWorld=1,speedOfSound=343}=config;
    check([1,2].includes(order)&&Number.isInteger(maxTaps)&&finite(maxTaps,1,8)&&finite(maxDelay,.001,.25)&&
      finite(minGain,0,1)&&finite(gain,0,1)&&finite(metersPerWorld,.0001,100)&&finite(speedOfSound,100,2000)&&
      record(materials)&&Object.keys(materials).length<=24&&record(panels)&&Object.keys(panels).length<=16,
      'Invalid early reflection limits or surface tables');
    const styles=new Map(Object.entries(materials).map(([id,style])=>{
      check(name(id)&&keys(style,['gain','cutoff'])&&finite(style.gain??defaultStyle.gain,0,1)&&
        finite(style.cutoff??defaultStyle.cutoff,20,22000),'Invalid reflection material '+id);
      return [id,{...defaultStyle,...style}];
    }));
    const surfaces=[];
    function add(id,{center,u,v,material}){
      check(name(id)&&!surfaces.some(surface=>surface.id===id)&&xyz(center)&&xyz(u)&&xyz(v)&&
        (material===undefined||styles.has(material)),'Invalid reflection panel '+id);
      const width=V.len(u),height=V.len(v);
      check(width>eps&&height>eps&&Math.abs(V.dot(u,v))<=width*height*1e-6,
        'Reflection panel axes must be perpendicular and nonzero');
      const right=V.mul(u,1/width),up=V.mul(v,1/height);
      surfaces.push({id,center:center.slice(),right,up,width,height,normal:V.norm(V.cross(right,up)),
        material:material??null,...(styles.get(material)??defaultStyle)});
    }
    if(room!==undefined){
      check(keys(room,['min','max','faces'])&&xyz(room.min)&&xyz(room.max)&&
        room.min.every((n,i)=>room.max[i]>n+2*eps)&&keys(room.faces??{},faces),'Invalid reflection room bounds');
      const half=V.mul(V.sub(room.max,room.min),.5),mid=V.lerp(room.min,room.max,.5);
      faces.forEach((id,i)=>{
        const material=room.faces?.[id];
        if(material===false) return;
        const axis=Math.floor(i/2), center=mid.slice(), u=[0,0,0],v=[0,0,0];
        center[axis]=i%2?room.max[axis]:room.min[axis];
        u[(axis+1)%3]=half[(axis+1)%3];
        v[(axis+2)%3]=half[(axis+2)%3];
        add(id,{center,u,v,material});
      });
    }
    for(const [id,panel] of Object.entries(panels).sort(([a],[b])=>a<b?-1:a===b?0:1)){
      check(keys(panel,['center','u','v','material']),'Invalid reflection panel '+id);
      add(id,panel);
    }
    const signed=(surface,p)=>V.dot(V.sub(p,surface.center),surface.normal);
    function crossing(surface,a,b){
      const from=signed(surface,a), to=signed(surface,b);
      // Endpoints are excluded so a bounce does not block its own segments.
      if(Math.abs(from)<eps||Math.abs(to)<eps||Math.sign(from)===Math.sign(to))return;
      const point=V.lerp(a,b,from/(from-to)), at=V.sub(point,surface.center);
      if(Math.abs(V.dot(at,surface.right))<=surface.width+eps&&Math.abs(V.dot(at,surface.up))<=surface.height+eps)
        return point;
    }
    const mirror=(at,surface)=>V.mad(at,surface.normal,-2*signed(surface,at));
    const seconds=metersPerWorld/speedOfSound;
    function trace(source,listener,{visible,distanceGain=()=>1}={}){
      check(xyz(source)&&xyz(listener),'Early reflections need two finite XYZ positions');
      const direct=V.dist(source,listener), candidates=[];
      if(!gain)return candidates;
      const limit=direct+maxDelay/seconds;
      const reflectors=surfaces.filter(surface=>surface.gain>0&&!([source,listener].some(p=>Math.abs(signed(surface,p))<eps)));
      function candidate(chain,images){
        let end=listener;
        const points=[];
        for(let i=chain.length-1;i>=0;i--){
          const bounce=crossing(chain[i],end,images[i]);
          if(!bounce)return;
          points.unshift(bounce);
          end=bounce;
        }
        const route=[source,...points,listener];
        let distance=0, pressure=gain, cutoff=22000;
        for(let i=0;i<chain.length;i++){
          const surface=chain[i], a=signed(surface,route[i]), b=signed(surface,route[i+2]);
          if(a*b<=eps*eps)return;
          pressure*=surface.gain;
          cutoff=Math.min(cutoff,surface.cutoff);
        }
        for(let i=1;i<route.length;i++){
          const a=route[i-1],b=route[i], length=V.dist(a,b);
          if(length<=eps||surfaces.some(surface=>crossing(surface,a,b)))return;
          distance+=length;
        }
        const delay=(distance-direct)*seconds, level=pressure*distanceGain(distance);
        if(delay<.0001||delay>maxDelay||level<=0||level<minGain)return;
        candidates.push({delay,distance,gain:level,cutoff,apparentSource:points.at(-1),points,
          surfaces:chain.map(surface=>surface.id),materials:chain.map(surface=>surface.material),route});
      }
      for(const a of reflectors){
        const image=mirror(source,a);
        if(V.dist(image,listener)<=limit)candidate([a],[image]);
        if(order===2)for(const b of reflectors)if(a!==b){
          const last=mirror(image,b);
          if(V.dist(last,listener)<=limit)candidate([a,b],[image,last]);
        }
      }
      candidates.sort((a,b)=>a.delay-b.delay||b.gain-a.gain);
      const taps=[];
      for(const {route,...tap} of candidates){
        if(visible&&route.some((b,i)=>i>0&&!visible(route[i-1],b)))continue;
        taps.push(tap);
        if(taps.length===maxTaps)break;
      }
      return taps;
    }
    return Object.freeze({trace});
  }
  W.earlyReflections=Object.freeze({compile});
})(KIT);
