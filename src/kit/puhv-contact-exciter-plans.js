/* Author contact geometry, timing, coefficients and piecewise-linear controls. */
(function(K){
  const W=K.world, {V}=K, C=W.contactSamples, {check,record,id,vector,own}=W.data, {hash}=K.procedural.data;
  const format='ink-studio/contact-excitation', finite=Number.isFinite;
  const nonnegative=n=>finite(n)&&n>=0, positive=n=>finite(n)&&n>0;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const fields=(o,keys)=>record(o)&&Object.keys(o).every(key=>keys.includes(key));
  const zero=[0,0,0], axes=[0,1,0];
  const fieldsByKind={
    impact:['at','duration','impulse'],
    pluck:['at','duration','stiffness','deflection','tangent'],
    bow:['start','end','load','keys','stiffness','staticFriction','kineticFriction','slipScale'],
    scrape:['start','end','load','keys','friction','grain','roughness'],
    chatter:['start','end','load','keys','spacing','duty']
  };

  function compile(plan){
    const {sampleRate=48000,seed=1,revision=1}=plan??{};
    check(fields(plan,['format','version','id','revision','sampleRate','seed','tracks'])&&plan.format===format&&plan.version===1&&
      id(plan.id)&&integer(revision,1,Number.MAX_SAFE_INTEGER)&&integer(sampleRate,1000,192000)&&Number.isSafeInteger(seed)&&
      record(plan.tracks)&&integer(Object.keys(plan.tracks).length,1,64),'Expected a version 1 contact excitation plan');
    const tracks=Object.entries(plan.tracks).map(([name,row],index)=>{
      const {kind,point=zero,normal:raw=axes,slip=zero}=row??{}, length=vector(raw)?V.len(raw):0;
      check(id(name)&&own(fieldsByKind,kind)&&fields(row,['kind','point','normal','slip',...fieldsByKind[kind]])&&
        vector(point)&&vector(slip)&&positive(length),'Invalid contact track '+name);
      const normal=V.mul(raw,1/length), defaults={point:point.slice(),slip:C.tangent(slip,normal)};
      check(vector(defaults.slip),'Contact slip exceeded numeric range '+name);
      const transient=kind==='impact'||kind==='pluck';
      const at=transient?row.at:row.start,end=transient?at+(row.duration??(kind==='impact'?0:.012)):row.end;
      check(nonnegative(at)&&finite(end)&&end*sampleRate<=Number.MAX_SAFE_INTEGER&&
        (kind==='impact'?end>=at:end>at),'Invalid contact interval on '+name);
      const start=at*sampleRate, stop=end*sampleRate;
      const track={kind,name,index,normal,...defaults,start,stop,at,end,seed:hash(name,seed),keys:[]};

      if(transient){
        const {impulse,stiffness,deflection,tangent:axis}=row;
        if(kind==='impact'){
          check(vector(impulse),'Impact needs a finite impulse on '+name);
          track.total=impulse.slice();
        }else{
          const direction=vector(axis)?C.tangent(axis,normal):zero;
          const span=V.len(direction), amount=.5*stiffness*deflection*(end-at);
          check(positive(stiffness)&&finite(deflection)&&positive(span)&&finite(amount),'Invalid pluck on '+name);
          track.total=V.mul(direction,amount/span);
        }
        check(vector(track.total),'Contact impulse exceeded numeric range on '+name);
        return track;
      }

      const load=row.load??1, keys=row.keys??[];
      check(nonnegative(load)&&Array.isArray(keys)&&keys.length<=2048,'Invalid contact load or key table on '+name);
      let previous=-Infinity, last={...defaults,load};
      track.keys=Array.from(keys,key=>{
        check(fields(key,['time','point','slip','load'])&&finite(key.time)&&key.time>=at&&key.time<=end&&key.time>previous&&
          (key.point===undefined||vector(key.point))&&(key.slip===undefined||vector(key.slip))&&
          (key.load===undefined||nonnegative(key.load)),'Invalid contact key on '+name);
        previous=key.time;
        last={point:key.point?.slice()??last.point,slip:key.slip===undefined?last.slip:C.tangent(key.slip,normal),
          load:key.load??last.load};
        check(vector(last.slip),'Contact key slip exceeded numeric range on '+name);
        return {...last,at:previous*sampleRate};
      });
      if(track.keys[0]?.at!==start)track.keys.unshift({...defaults,load,at:start});
      if(kind==='bow'){
        const {stiffness=22000,staticFriction=.9,kineticFriction=.34,slipScale=.14}=row;
        check(positive(stiffness)&&positive(slipScale)&&nonnegative(kineticFriction)&&nonnegative(staticFriction)&&
          kineticFriction<=staticFriction,'Invalid bow coefficients on '+name);
        Object.assign(track,{stiffness,staticFriction,kineticFriction,slipScale});
      }else if(kind==='scrape'){
        const {friction=.44,grain=.0015,roughness=.65}=row;
        check(nonnegative(friction)&&positive(grain)&&nonnegative(roughness)&&roughness<=1,'Invalid scrape coefficients on '+name);
        Object.assign(track,{friction,grain,roughness});
      }else{
        const {spacing=.003,duty=.18}=row;
        check(positive(spacing)&&positive(duty)&&duty<=1,'Invalid chatter spacing or duty on '+name);
        Object.assign(track,{spacing,duty});
      }
      return track;
    });
    return {tracks,sampleRate,identity:{id:plan.id,revision,signature:hash(JSON.stringify(plan))}};
  }

  W.contactExciterPlans=Object.freeze({format,compile,integer});
})(KIT);
