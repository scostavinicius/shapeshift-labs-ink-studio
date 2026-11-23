/* Map picture positions to deterministic local simulation positions. */
(function (K) {
  const W=K.world,{check,own,record}=W.data,{freeze}=K.procedural.data;
  const fields=(value,names)=>record(value)&&Object.keys(value).every(key=>names.includes(key));
  const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;

  function compile(policy,clock,cuts=[]) {
    check(fields(policy,['warmup','cuts','loop']),'Invalid take simulation policy');
    const {warmup=0,cuts:rules={},loop}=policy, max=W.runtime.maxTick;
    const ids=new Set(cuts.map(row=>row.id));
    check(integer(warmup,max)&&record(rules)&&Object.entries(rules).every(([id,rule])=>
      ids.has(id)&&fields(rule,['state','warmup'])&&['carry','reset'].includes(rule.state)&&
      (rule.warmup===undefined||rule.state==='reset'&&integer(rule.warmup,max))),
    'Invalid simulation cut policy or warm-up');
    const origins=[{frame:0,tick:0,cut:null,warmup}];
    for(const cut of cuts.slice().sort((a,b)=>a.frame-b.frame)) {
      const rule=own(rules,cut.id)?rules[cut.id]:undefined;
      if(rule?.state==='reset') origins.push({frame:cut.frame,tick:clock.at(cut.frame).tick,cut:cut.id,warmup:rule.warmup??0});
    }
    let firstTick,lastTick,interior=[],cycleTicks;
    if(loop!==undefined) {
      check(fields(loop,['from','to','state'])&&integer(loop.from,1000000000)&&integer(loop.to,1000000000)&&
        loop.from<loop.to&&['restore','carry'].includes(loop.state),'Invalid simulation loop');
      firstTick=clock.at(loop.from).tick;
      lastTick=clock.at(loop.to).tick;
      cycleTicks=lastTick-firstTick;
      interior=origins.filter(row=>row.frame>loop.from&&row.frame<loop.to);
    }

    function locate(frame,iteration=0) {
      check(integer(iteration,1000000000)&&(!iteration||loop&&frame.frame>=loop.from&&frame.frame<loop.to),
        'A loop iteration needs a frame inside the authored loop');
      let origin=origins.findLast(row=>row.frame<=frame.frame);
      let local=origin.warmup+frame.tick-origin.tick;
      if(iteration&&loop.state==='carry') {
        if(!interior.length) local+=iteration*cycleTicks;
        else if(frame.frame<interior[0].frame) {
          origin=interior.at(-1);
          local=origin.warmup+lastTick-origin.tick+frame.tick-firstTick;
        }
      }
      check(integer(local,max),'Take simulation position exceeds the tick budget');
      return freeze({iteration,originFrame:origin.frame,originCut:origin.cut,warmup:origin.warmup,tick:local,
        preRoll:local===origin.warmup});
    }

    function next(frame,iteration) {
      if(loop&&frame===loop.to-1) return {frame:loop.from,iteration:iteration+1};
      return {frame:frame+1,iteration};
    }

    return Object.freeze({locate,next});
  }
  W.simulationTransport=Object.freeze({compile});
})(KIT);
