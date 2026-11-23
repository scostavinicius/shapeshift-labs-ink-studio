/* Shared, timestamped contact measurements for mechanics and physical exciters. */
(function(K){
  const W=K.world, {check,record,vector}=W.data, {V}=K;
  const format='ink-studio/contact-sample', kinds=Object.freeze(['impact','pluck','bow','scrape','chatter']);
  const finite=Number.isFinite, zero=[0,0,0];

  function tangent(value,normal){
    return V.mad(value,normal,-V.dot(value,normal));
  }

  function sample(row,{time=W.timedEvents.timeOf(row),sample,fraction}={}){
    const {kind,point,normal:axis,slip=zero,impulse,force,interval,source,target,track,phase='contact',
      pointBasis='authored',forceBasis='interval-average'}=row??{};
    const length=vector(axis)?V.len(axis):0;
    const label=value=>value===undefined||typeof value==='string'&&value.length>0&&value.length<=256;
    check(record(row)&&(row.format===undefined||row.format===format&&row.version===1)&&kinds.includes(kind)&&
      vector(point)&&finite(length)&&length>0&&vector(slip)&&(vector(impulse)||vector(force))&&
      (impulse===undefined||vector(impulse))&&(force===undefined||vector(force))&&
      finite(interval)&&interval>0&&finite(time)&&time>=0&&[source,target,track].every(label)&&
      ['contact','onset','tooth'].includes(phase)&&['authored','ground','surface','overlap'].includes(pointBasis)&&
      ['interval-average','step-average'].includes(forceBasis),'Invalid contact sample');
    const normal=V.mul(axis,1/length), velocity=tangent(slip,normal);
    const measured=impulse??V.mul(force,interval), load=force??V.mul(impulse,1/interval);
    check(vector(measured)&&vector(load)&&vector(velocity)&&measured.every((value,i)=>{
      const product=load[i]*interval;
      return finite(product)&&Math.abs(value-product)<=1e-10*Math.max(1e-100,Math.abs(value),Math.abs(product));
    }),'Contact impulse and average force disagree');
    return W.timedEvents.at(time,{format,version:1,kind,phase,point,normal,slip:velocity,impulse:measured,force:load,
      interval,pointBasis,forceBasis,...(source!==undefined&&{source}),...(target!==undefined&&{target}),
      ...(track!==undefined&&{track})},{sample,fraction});
  }

  function impactTrack(row,{duration=0}={}){
    const hit=sample(row);
    check(hit.kind==='impact'&&finite(duration)&&duration>=0,'Impact track needs an impact and nonnegative duration');
    return {kind:'impact',at:hit.timing.time,point:hit.point,normal:hit.normal,slip:hit.slip,impulse:hit.impulse,duration};
  }

  W.contactSamples=Object.freeze({format,kinds,sample,impactTrack,tangent});
})(KIT);
