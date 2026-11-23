/* Portable occurrence times and event boundaries within a receiver's step. */
(function (K) {
  const W = K.world, {check,record,copy} = W.data, {freeze} = K.procedural.data;
  const format = 'ink-studio/event-time', maxBoundaries = 256;
  const near = (a,b) => Math.abs(a-b)<=4*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b));
  const due = (time,end) => time===undefined || time<=end || near(time,end);
  function at(time,event,coordinates) {
    check(Number.isFinite(time) && time>=0 && record(event),'Timed event needs a nonnegative time and a record');
    const {sample,fraction} = coordinates??{};
    const row={...copy(event),timing:{format,time,...(sample!==undefined && {sample}),
      ...(fraction!==undefined && {fraction})}};
    timeOf(row);
    return freeze(row);
  }
  function timeOf(event) {
    const stamp = event?.timing;
    if (stamp?.format!==format) return undefined;
    check(record(stamp) && Number.isFinite(stamp.time) && stamp.time>=0 &&
      (stamp.deliveryTime===undefined || Number.isFinite(stamp.deliveryTime) && stamp.deliveryTime>=stamp.time) &&
      (stamp.sample===undefined || Number.isSafeInteger(stamp.sample) && stamp.sample>=0) &&
      (stamp.fraction===undefined || Number.isFinite(stamp.fraction) && stamp.fraction>=0 && stamp.fraction<=1),
    'Invalid timed event');
    return stamp.time;
  }
  function delivery(event) {
    const time = timeOf(event);
    return time===undefined ? undefined : event.timing.deliveryTime ?? time;
  }
  function withinTime(start,end,fraction) {
    check(Number.isFinite(fraction) && fraction>=0 && fraction<=1,'Event fraction must be between zero and one');
    return fraction===0 ? start : fraction===1 ? end : start+(end-start)*fraction;
  }
  function within(start,end,fraction,event,coordinates) {
    return at(withinTime(start,end,fraction),event,coordinates);
  }
  function select(entries,end,delay=0) {
    const ready=[], pending=[];
    for (const event of entries) {
      const time = delivery(event);
      if (time!==undefined && !due(time+delay,end)) pending.push(event);
      else ready.push(time!==undefined && delay ? freeze({...event,timing:{...event.timing,deliveryTime:time+delay}}) : event);
    }
    return {ready,pending};
  }
  function boundaries(keys,input,start,end) {
    const ordered=[];
    for (const key of keys) for (const event of input[key])
      ordered.push({key,event,time:Math.max(start,Math.min(end,delivery(event)??start))});
    ordered.sort((a,b)=>a.time-b.time);
    const groups=[];
    for (const {key,event,time} of ordered) {
      let group=groups.at(-1);
      if (!group || !near(group.time,time)) {
        check(groups.length<maxBoundaries,'Timed event boundary budget exceeded');
        group={time,ports:Object.create(null)};
        groups.push(group);
      }
      (group.ports[key]??=[]).push(event);
    }
    return groups;
  }
  W.timedEvents = Object.freeze({format,at,timeOf,delivery,within,withinTime,select,boundaries,maxBoundaries});
})(KIT);
