/* Subsonic travel time and Doppler for opted-in spatial voices. */
(function(K){
  const W=K.world,{V}=K,{record,check}=W.data;
  const zero=[0,0,0], finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const fields=(row,names)=>record(row)&&Object.keys(row).every(name=>names.includes(name));
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function medium(raw={}){
    check(fields(raw,['metersPerWorld','speedOfSound']),'Invalid sound propagation medium');
    const {metersPerWorld=1,speedOfSound=343}=raw;
    check(finite(metersPerWorld,.00001,10000)&&finite(speedOfSound,1,20000),'Invalid sound propagation scale or speed');
    return speedOfSound/metersPerWorld;
  }
  function settings(raw){
    if(raw===undefined||raw===false)return raw;
    check(fields(raw,['delayScale','dopplerScale','maxDelay','maxShiftCents']),'Invalid cue propagation settings');
    const {delayScale=1,dopplerScale=1,maxDelay=8,maxShiftCents=1200}=raw;
    check(finite(delayScale,0,4)&&finite(dopplerScale,0,4)&&finite(maxDelay,0,30)&&finite(maxShiftCents,0,2400),
      'Invalid propagation delay, Doppler strength or limit');
    return {delayScale,dopplerScale,maxDelay,maxShiftCents};
  }
  function bounded(velocity,speed){
    const length=V.len(velocity), max=speed*.9;
    return length>max?V.mul(velocity,max/length):velocity;
  }
  // Positive root of |separation + velocity * t| = speed * t.
  function travel(separation,velocity,speed){
    const d2=V.dot(separation,separation), dot=V.dot(separation,velocity), a=speed*speed-V.dot(velocity,velocity);
    return (Math.sqrt(dot*dot+a*d2)+dot)/a;
  }
  function compile(speed,config,source,ear,{sourceVelocity=zero,listenerVelocity=zero,route,emissionLag=0,receiving=false}={}){
    const vs=bounded(sourceVelocity,speed), vl=bounded(listenerVelocity,speed);
    const origin=V.mad(source,vs,-emissionLag), observer=V.mad(ear,vl,-emissionLag);
    const delta=V.sub(observer,origin);
    const onset=travel(delta,vl,speed), retarded=travel(delta,vs,speed);
    const elapsed=route?.seconds??(receiving?retarded:onset);
    const direction=receiving?V.mad(delta,vs,retarded):V.mad(delta,vl,onset);
    const departure=V.norm(route?.first?V.sub(route.first,source):direction,zero);
    const arrival=V.norm(route?.last?V.sub(ear,route.last):direction,zero);
    const raw=(speed-V.dot(vl,arrival))/(speed-V.dot(vs,departure));
    const cents=clamp(1200*Math.log2(raw)*config.dopplerScale,-config.maxShiftCents,config.maxShiftCents);
    const delay=seconds=>Math.min(config.maxDelay,seconds*config.delayScale);
    return {delaySeconds:delay(elapsed),travelSeconds:elapsed,rateScale:2**(cents/1200),cents,
      delayAt(seconds){
        const earlier=V.mad(delta,V.sub(vs,vl),seconds);
        return delay(route?.seconds??travel(earlier,vl,speed));
      },
      apparent:receiving&&!route?V.mad(source,vs,-delay(elapsed)):null};
  }
  function session(speed){
    const poses=new Map(), clocks=new Map();
    let now=-Infinity;
    return {
      observe(time){
        if(time<now){poses.clear();clocks.clear();}
        now=time;
      },
      velocity(key,point,native){
        if(native)return native;
        const prior=poses.get(key);
        if(prior?.time===now)return prior.velocity;
        const dt=now-(prior?.time??-Infinity), offset=prior&&V.sub(point,prior.point);
        const velocity=dt>0&&dt<=1&&V.len(offset)<=speed*.9*dt?V.mul(offset,1/dt):zero;
        if(poses.size>=1024&&!poses.has(key))poses.delete(poses.keys().next().value);
        poses.set(key,{point:point.slice(),time:now,velocity});
        return velocity;
      },
      clock(id,offset,baseRate,rate,reading,config){
        let clock=clocks.get(id);
        if(!clock){
          if(clocks.size>=128)clocks.delete(clocks.keys().next().value);
          const first=reading.delayAt(now), physical=config.delayScale===1&&config.dopplerScale===1&&
            Math.abs(reading.cents)<config.maxShiftCents&&reading.travelSeconds<=config.maxDelay;
          const phase=physical?Math.max(0,now-reading.travelSeconds)*baseRate:Math.max(0,now-first)*rate;
          clock={first,offset:offset+phase,time:now,rate};
          clocks.set(id,clock);
        }else{
          clock.offset+=clock.rate*Math.max(0,now-Math.max(clock.time,clock.first));
          clock.time=now;
          clock.rate=rate;
        }
        return {first:clock.first,offset:clock.offset,remaining:Math.max(0,clock.first-now)};
      }
    };
  }
  W.audioPropagation=Object.freeze({medium,settings,compile,session});
})(KIT);
