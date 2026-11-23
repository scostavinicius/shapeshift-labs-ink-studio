/* Sample-addressed breathing room and repeatable placements for atmosphere layers. */
(function (P) {
  const {fields,finite,integer,id,check}=P.musicInstruments;
  const S=P.mediaGraphSupport,T=P.takeTime;
  const levels=['density','spacing','avoid','padding','minGap'];
  function chance(seed,key,n) {
    const hash=P.data.hash(JSON.stringify([key,n]),seed);
    const mixed=Math.imul(hash^(hash>>>16),0x7feb352d);
    return ((mixed^(mixed>>>15))>>>0)/4294967296;
  }

  function timeline(reference) {
    const {sampleRate,frames,events,map}=reference;
    const clock=S.mixerTime(sampleRate,map);
    const position=value=>clock.frame(clock.position(typeof value==='number' ? {seconds:value} : value));
    const seconds=value=>Math.round(value*sampleRate);
    function bounds(raw) {
      check(fields(raw,['from','to']),'Invalid atmosphere range');
      const first=raw.from===undefined ? 0 : position(raw.from), end=raw.to===undefined ? frames : position(raw.to);
      check(integer(first,0,frames-1) && integer(end,first+1,frames),'Atmosphere range is outside the score');
      return [first,end];
    }
    function tracks(names=[]) {
      check(Array.isArray(names) && names.length<=32 && Array.from(names).every(name=>id(name) && Object.hasOwn(events,name)) &&
        new Set(names).size===names.length,'Atmosphere rules need distinct names of performed tracks');
      return names;
    }
    function gaps(names,from,to,pad=0,tail=pad,minimum=0) {
      const spans=names.flatMap(name=>events[name].map(({time,gate,duration})=>{
        const begin=Math.floor(time*sampleRate), end=Math.max(begin+1,Math.ceil((time+(gate ?? duration ?? 0))*sampleRate));
        return [Math.max(from,begin-pad),Math.min(to,end+tail)];
      })).filter(([a,b])=>a<b).sort((a,b)=>a[0]-b[0]);
      let cursor=from;
      const free=[];
      for (const [a,b] of spans) {
        if (a>cursor && a-cursor>=minimum) free.push([cursor,a]);
        cursor=Math.max(cursor,b);
      }
      if (to>cursor && to-cursor>=minimum) free.push([cursor,to]);
      return free;
    }
    const {beatAt}=clock.beatClock();
    function beatFrame(at) {
      return clock.frame(clock.position({beat:at}));
    }
    return {position,seconds,bounds,tracks,gaps,beatAt,beatFrame,rate:sampleRate};
  }

  const automation=points=>({unit:'samples',points:points.map(([at,value])=>({at,value}))});
  const tied=(knots,at,value)=>{
    if (knots.at(-1)?.[0]===at) knots[knots.length-1]=[at,value];
    else knots.push([at,value]);
  };
  function fade(length,incoming,outgoing) {
    const knots=[];
    const db=weight=>Math.max(-96,20*Math.log10(weight));
    if (incoming) {
      for (let i=0;i<=8;i++) tied(knots,Math.round(i*incoming/8),db(Math.sin(i*Math.PI/16)));
    } else tied(knots,0,0);
    if (outgoing) {
      for (let i=0;i<=8;i++) tied(knots,length-outgoing+Math.round(i*outgoing/8),db(Math.cos(i*Math.PI/16)));
    }
    return automation(knots);
  }
  function bed(layer,assets,world,[first,end],seed) {
    const {crossfade=.22}=layer;
    check(finite(crossfade,.005,4),'Bed crossfade must be between 5 ms and 4 seconds');
    const shortest=Math.min(...assets.map(row=>row.frames));
    const overlap=Math.min(Math.max(1,world.seconds(crossfade)),Math.floor(shortest/4));
    let at=first, previous=0;
    const clips=[];
    while (at<end) {
      check(clips.length<512,'Bed needs a longer source or a shorter window');
      const selected=assets[Math.floor(chance(seed,layer.id,clips.length)*assets.length)];
      const length=Math.min(selected.frames,end-at), next=at+length<end;
      const incoming=Math.min(clips.length ? previous : world.seconds(.025),length-1);
      const outgoing=next ? overlap : Math.min(world.seconds(.07),length-incoming);
      const sourceEnd=next ? selected.sourceFrames :
        Math.min(selected.sourceFrames,Math.ceil(length*selected.sampleRate/world.rate));
      clips.push({source:selected.id,at,end:at+length,toSample:sourceEnd,gain:fade(length,incoming,outgoing)});
      at+=length-(next ? overlap : 0);
      previous=overlap;
    }
    return {clips,windows:[[first,end]]};
  }

  function spots(layer,assets,world,range,seed,density) {
    const {spacing=1.8,padding=.085,minGap=.17}=layer;
    check(finite(spacing,.05,60) && finite(padding,0,4) && finite(minGap,0,30),'Invalid atmosphere spacing or gap protection');
    const windows=world.gaps(world.tracks(layer.avoid),...range,world.seconds(padding),world.seconds(padding),world.seconds(minGap));
    let next=range[0], candidates=0;
    const clips=[];
    for (const [first,end] of windows) {
      let base=Math.max(first,next);
      while (base<end) {
        const fit=assets.filter(row=>row.frames<=end-base);
        if (!fit.length) break;
        const sample=fit[Math.floor(chance(seed,layer.id+'-source',base)*fit.length)];
        const room=Math.min(end-base-sample.frames,world.seconds(.26),world.seconds(spacing*.2));
        const at=base+Math.floor(chance(seed,layer.id+'-time',base)*room);
        const index=candidates++;
        check(candidates<=4096,'Atmosphere calls exceed their candidate budget');
        if (chance(seed,layer.id+'-density',base)<density)
          clips.push({source:sample.id,at,end:at+sample.frames,slot:index});
        next=Math.max(at+sample.frames,at+world.seconds(spacing));
        base=next;
      }
    }
    return {clips,windows,candidates};
  }

  function gesture(layer,assets,world,range,seed,density) {
    const {every,offset=0,pattern,padding=.085,minGap=0}=layer;
    check(finite(every,.25,128) && finite(offset,0,512) && finite(padding,0,4) && finite(minGap,0,30) &&
      Array.isArray(pattern) && integer(pattern.length,1,16),'A gesture needs a beat period, offset and a pattern of up to 16 sounds');
    const byId=new Map(assets.map(row=>[row.id,row]));
    check(Array.from(pattern).every(row=>fields(row,['beat','source','gainDb']) && finite(row.beat,0,every) &&
      row.beat<every && byId.has(row.source) && finite(row.gainDb ?? 0,-60,12)),
    'Gesture steps need a beat inside the period and a layer asset');
    const windows=world.gaps(world.tracks(layer.avoid),...range,world.seconds(padding),world.seconds(padding),world.seconds(minGap));
    const clips=[];
    const start=Math.max(0,Math.floor((world.beatAt(range[0])-offset)/every));
    const stop=Math.max(start,Math.ceil((world.beatAt(range[1])-offset)/every)+1);
    check(stop-start<=1024,'Atmosphere gesture exceeds its recurrence budget');
    let candidates=0;
    for (let occurrence=start;occurrence<stop;occurrence++) {
      const atBeat=T.add(T.read(offset),T.mul(T.read(occurrence),T.read(every)));
      const steps=pattern.map((step,index)=>{
        const [numerator,denominator]=T.add(atBeat,T.read(step.beat));
        const at=world.beatFrame({numerator:T.index(numerator),denominator:T.index(denominator)});
        return {source:step.source,at,end:at+byId.get(step.source).frames,gain:step.gainDb ?? 0,occurrence,step:index};
      });
      if (!steps.every(step=>windows.some(([from,to])=>step.at>=from && step.end<=to))) continue;
      candidates++;
      if (chance(seed,layer.id+'-density',occurrence)<density) clips.push(...steps);
    }
    return {clips,windows,candidates};
  }

  function perspective(raw,world,range) {
    check(fields(raw,['far','near','whenQuiet','minQuiet','attack','release','tail']),'Invalid atmospheric perspective');
    const {far={},near={},minQuiet=.85,attack=.26,release=.19,tail=.16}=raw;
    const keys=['gainDb','cutoffHz','pan'];
    const maxHz=Math.min(24000,world.rate*.48);
    function state(value,fallback) {
      check(fields(value,keys) && finite(value.gainDb ?? fallback.gainDb,-72,0) &&
        finite(value.cutoffHz ?? fallback.cutoffHz,25,maxHz) && finite(value.pan ?? fallback.pan,-1,1),
      'Perspective needs a nonpositive gain, cutoff and stereo balance');
      return Object.fromEntries(keys.map(key=>[key,value[key] ?? fallback[key]]));
    }
    const distant=state(far,{gainDb:-17,cutoffHz:Math.min(3900,maxHz),pan:0});
    const close=state(near,distant);
    check(finite(minQuiet,0,30) && finite(attack,.005,8) && finite(release,.005,8) && finite(tail,0,5),
      'Invalid perspective envelope timing');
    const names=world.tracks(raw.whenQuiet);
    const windows=names.length ? world.gaps(names,...range,0,world.seconds(tail),world.seconds(minQuiet)) : [];
    const nearIn=Math.max(1,world.seconds(attack)), out=Math.max(1,world.seconds(release));
    const weights=[[0,0]];
    for (const [a,b] of windows) {
      const width=b-a, rise=Math.min(nearIn,Math.floor(width*nearIn/(nearIn+out)) || 1);
      const fall=Math.min(out,width-rise);
      if (width<2 || fall<1) continue;
      tied(weights,a,0);
      tied(weights,a+rise,Math.min(1,width/(nearIn+out)));
      tied(weights,b-fall,Math.min(1,width/(nearIn+out)));
      tied(weights,b,0);
    }
    check(weights.length<=2048,'Perspective exceeds its automation-point budget');
    function lane(key,transform=n=>n) {
      const a=transform(distant[key]), b=transform(close[key]);
      if (a===b || weights.length===1) return a;
      return automation(weights.map(([at,u])=>[at,(1-u)*a+u*b]));
    }
    return {windows,gain:lane('gainDb',n=>10**(n/20)),cutoff:lane('cutoffHz'),pan:lane('pan')};
  }

  S.atmosphereTimeline={timeline,bed,spots,gesture,perspective,levels};
})(KIT.procedural);
