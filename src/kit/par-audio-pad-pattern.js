/* Turn a repeatable beat pattern or recorded pad pulses into editable kit events. */
(function (P) {
  const A=P.mediaGraph,T=P.takeTime,E=P.mediaGraphSupport.padEvent;
  const {fields,record,finite,integer,id,check,clamp,hash}=P.musicInstruments;
  const ZERO=T.read(0);
  const compare=(a,b)=>T.compare(a,b);
  function rational(raw,lo,hi,label) {
    const exact=T.read(raw);
    check(finite(T.seconds(exact),lo,hi),'Invalid '+label);
    return exact;
  }
  function encode([numerator,denominator]) {
    return denominator===1n ? T.index(numerator) : {numerator:T.index(numerator),denominator:T.index(denominator)};
  }
  function list(raw,max,label) {
    check(Array.isArray(raw) && raw.length<=max,'Invalid '+label+' list');
    return raw;
  }
  function unique(rows) {
    check(new Set(rows.map(row=>row.id)).size===rows.length,'Pad IDs must be unique');
  }
  function renderSettings(options={}) {
    check(fields(options,['sampleRate','duration','stems','map']) &&
      (options.sampleRate===undefined || integer(options.sampleRate,8000,96000)) &&
      (options.stems===undefined || typeof options.stems==='boolean'),'Invalid pad render options');
    if (options.duration!==undefined) {
      const span=rational(options.duration,0,3600,'performance duration');
      check(compare(span,ZERO)>0,'Performance duration must be positive');
    }
    return P.musicTiming.compile(options.map);
  }
  function event(row,clock) {
    check(fields(row,E.eventFields) && id(row.id) && (row.duration===undefined || row.until===undefined),
      'Editable pad events need a unique ID, a time and at most one gate endpoint');
    const play=E.trigger(row);
    const point=time=>P.musicTiming.isPosition(time) ? clock.resolve(time) : T.read(time);
    const start=point(row.time);
    check(finite(T.seconds(start),0,3600),'Pad event is outside the time range');
    const end=row.until!==undefined ? point(row.until) :
      row.duration!==undefined ? T.add(start,T.read(row.duration)) : null;
    if (end) {
      check(compare(end,start)>0 && finite(T.seconds(T.sub(end,start)),0,120),'Invalid pad event gate');
    } else check(!play.gate,'A per-hit gate needs a duration or until');
    return {row,start};
  }
  function performance(rows,options={}) {
    const clock=renderSettings(options);
    const events=Array.from(list(rows,E.maxEvents,'pad event'),row=>event(row,clock));
    unique(events.map(item=>item.row));
    events.sort((a,b)=>compare(a.start,b.start));
    return P.data.freeze(P.data.clone({events:events.map(item=>item.row),options}));
  }

  function condition(raw={}) {
    check(fields(raw,['every','phase','chance','fill']),'Invalid pad condition');
    const {every=1,phase=0,chance=1,fill}=raw;
    check(integer(every,1,512) && integer(phase,0,every-1) && finite(chance,0,1) &&
      (fill===undefined || typeof fill==='boolean'),'Invalid pad cycle, chance or fill condition');
    return {every,phase,chance,fill};
  }

  function roll(raw={}) {
    check(fields(raw,['count','spacing','velocity','tune']),'Invalid pad roll');
    const {count=1,spacing=.125,velocity=[1,1],tune=[0,0]}=raw;
    const pair=(row,lo,hi)=>Array.isArray(row) && row.length===2 && Array.from(row).every(n=>finite(n,lo,hi));
    check(integer(count,1,32) && pair(velocity,0,2) && pair(tune,-4800,4800),'Invalid pad roll subdivision or ramp');
    const step=rational(spacing,0,16,'roll spacing');
    check(compare(step,ZERO)>0,'Roll spacing must be positive');
    return {count,step,velocity,tune};
  }

  function steps(rows,from,to) {
    return Array.from(list(rows,1024,'pad step'),raw=>{
      check(fields(raw,['id','beat','gate','offset','when','roll',...E.triggerFields]) &&
        id(raw.id) && raw.id.length<=32,'A pattern step needs a short ID and a beat');
      const {id:stepId,beat,gate,offset=0,when,roll:repeat,...trigger}=raw;
      const play=E.trigger(trigger);
      const at=rational(beat,0,64,'step beat'), lag=rational(offset,-.25,.25,'step offset');
      const gateBeats=gate===undefined ? null : rational(gate,0,64,'gate in beats');
      check(gateBeats ? compare(gateBeats,ZERO)>0 : !play.gate,'A pattern gate must cover a positive beat range');
      const repeats=roll(repeat);
      const last=T.add(at,T.mul(repeats.step,T.read(repeats.count-1)));
      check(compare(at,from)>=0 && compare(last,to)<0,'Pad step or roll exceeds its pattern or fill window');
      return {id:stepId,at,lag,gate:gateBeats,when:condition(when),repeat:repeats,trigger};
    });
  }

  function perform(source,settings={}) {
    check(fields(source,['id','length','seed','steps','fills']) && id(source.id) &&
      fields(settings,['cycles','startBeat','seed','fills','render']),'Invalid pad pattern or run settings');
    const {cycles=1,startBeat=0,seed=source.seed ?? 0,fills:placements=[],render={}}=settings;
    check(integer(cycles,1,512) && integer(seed,-2147483648,2147483647),'Invalid pad cycle count or seed');
    const length=rational(source.length,0,64,'pattern length');
    const origin=rational(startBeat,0,32768,'pattern start beat');
    check(compare(length,ZERO)>0,'Pattern length must be positive');
    const main=steps(source.steps,ZERO,length);
    const fills=Array.from(list(source.fills ?? [],64,'pad fill'),fill=>{
      check(fields(fill,['id','from','to','mode','steps']) && id(fill.id) &&
        ['replace','add'].includes(fill.mode ?? 'replace'),'Invalid pad fill');
      const from=rational(fill.from,0,64,'fill start'), to=rational(fill.to,0,64,'fill end');
      check(compare(from,to)<0 && compare(to,length)<=0,'Fill window must be inside the pattern');
      return {id:fill.id,from,to,mode:fill.mode ?? 'replace',steps:steps(fill.steps,from,to)};
    });
    unique(fills);
    unique([...main,...fills.flatMap(fill=>fill.steps)]);
    const byCycle=new Map(), byId=new Map(fills.map(fill=>[fill.id,fill]));
    for (const placement of list(placements,cycles,'fill placement')) {
      check(fields(placement,['cycle','id']) && integer(placement.cycle,0,cycles-1) &&
        byId.has(placement.id) && !byCycle.has(placement.cycle),'Choose one known fill per pattern cycle');
      byCycle.set(placement.cycle,byId.get(placement.id));
    }
    const events=[], trace=[];
    let work=0;
    for (let cycle=0;cycle<cycles;cycle++) {
      const base=T.add(origin,T.mul(length,T.read(cycle)));
      const fill=byCycle.get(cycle);
      function emit(rows,fillId) {
        for (const step of rows) {
          const {id,at,lag,gate,when,repeat,trigger}=step;
          check(++work<=262144,'Pad program exceeds its decision budget');
          const draw=(hash([seed,source.id,cycle,id])>>>0)/4294967296;
          if (cycle%when.every!==when.phase || draw>=when.chance ||
              when.fill!==undefined && when.fill!==Boolean(fill)) continue;
          for (let sub=0;sub<repeat.count;sub++) {
            const local=T.add(at,T.mul(repeat.step,T.read(sub)));
            if (!fillId && fill?.mode==='replace' && compare(local,fill.from)>=0 && compare(local,fill.to)<0) continue;
            const beat=T.add(base,local), uid='p'+cycle+'-'+id+'-'+sub;
            const time={beat:encode(beat),...(compare(lag,ZERO)!==0 && {offset:encode(lag)})};
            const u=sub/Math.max(1,repeat.count-1), ramp=([a,b])=>a+(b-a)*u;
            const tune=ramp(repeat.tune), play={...trigger.play,
              ...(tune!==0 && {tune:(trigger.play?.tune ?? 0)+tune}),...(gate && {gate:true})};
            events.push({id:uid,...trigger,time,
              ...(repeat.count>1 && {velocity:clamp((trigger.velocity ?? .8)*ramp(repeat.velocity))}),
              ...(Object.keys(play).length && {play}),
              ...(gate && {until:{...time,beat:encode(T.add(beat,gate))}})});
            trace.push({id:uid,cycle,step:id,sub,...(fillId && {fill:fillId})});
            check(events.length<=E.maxEvents,'Pad program exceeds its event budget');
          }
        }
      }
      emit(main);
      if (fill) emit(fill.steps,fill.id);
    }
    const value=performance(events,render), byEvent=new Map(trace.map(row=>[row.id,row]));
    return {value,events:value.events,report:{id:source.id,seed,cycles,events:value.events.map(row=>byEvent.get(row.id))}};
  }

  function capture(recording,routes,options={}) {
    check(record(routes) && Object.keys(routes).length<=64 &&
      Object.entries(routes).every(([name,route])=>id(name) && fields(route,['duration',...E.triggerFields]) && E.trigger(route)),
    'Pad capture needs named input channel routes');
    const source=A.recording(recording), rows=[];
    for (const [index,pulse] of source.events.entries()) {
      if (pulse.kind!=='pulse' || !Object.hasOwn(routes,pulse.channel)) continue;
      const route=routes[pulse.channel], value=pulse.value;
      if (value===false) continue;
      const controls=value===true ? {} : typeof value==='number' ? {velocity:value} : value;
      check(fields(controls,['duration',...E.triggerFields]) && controls.pad===undefined,
        'A pad pulse needs velocity, true or a record of hit controls');
      rows.push({id:'pulse-'+index,...route,...controls,time:pulse.timecode ?? pulse.time,
        ...(route.play || controls.play ? {play:{...route.play,...controls.play}} : {})});
    }
    return performance(rows,options);
  }

  function edit(source,edits) {
    check(fields(source,['events','options']),'Expected an editable pad performance');
    const baseline=performance(source.events,source.options);
    const rows=new Map(baseline.events.map(row=>[row.id,row]));
    for (const op of list(edits,8192,'pad edit')) {
      if (op?.op==='add') {
        check(fields(op,['op','event']) && id(op.event?.id) && !rows.has(op.event.id),'Invalid pad event to add');
        rows.set(op.event.id,op.event);
      } else {
        check(id(op?.id) && rows.has(op.id),'Unknown pad event to edit');
        if (op.op==='delete' && fields(op,['op','id'])) rows.delete(op.id);
        else {
          check(op.op==='set' && fields(op,['op','id','changes']) && fields(op.changes,E.eventFields.filter(key=>key!=='id')),
            'Invalid pad edit');
          const row={...rows.get(op.id)};
          for (const [key,value] of Object.entries(op.changes)) {
            if (value===null) delete row[key];
            else if (key==='play') {
              check(record(value),'Per-hit changes need a record');
              row.play={...row.play,...value};
              for (const [name,field] of Object.entries(value)) if (field===null) delete row.play[name];
            } else row[key]=value;
          }
          rows.set(op.id,row);
        }
      }
    }
    return performance([...rows.values()],baseline.options);
  }
  A.padPattern=Object.freeze({perform,capture,edit,validate(source) {
    check(fields(source,['events','options']),'Expected an editable pad performance');
    return performance(source.events,source.options);
  }});
})(KIT.procedural);
