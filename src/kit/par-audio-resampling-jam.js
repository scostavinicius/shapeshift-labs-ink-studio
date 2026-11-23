/* Compare playback and rack changes on one editable pad performance. */
(function (P) {
  const A=P.mediaGraph,T=P.takeTime,{fields,record,id,integer,finite,check}=P.musicInstruments;
  const format='ink-studio/resampling-jam', version=1, origin='source';
  const name=value=>id(value) && value===value.toLowerCase();
  const duration=(frames,rate)=>({numerator:frames,denominator:rate});
  const maxBranches=64;
  const playbackSpeed=value=>finite(value,.25,4);
  const rangeFields=['firstSample','endSample'];
  const clockFields=['branch','range'];

  function project(source) {
    check(fields(source,['format','version','id','kit','performance','racks','branches']) &&
      source.format===format && source.version===version && name(source.id) && record(source.kit) &&
      record(source.racks ?? {}) && Object.keys(source.racks ?? {}).length<=16 &&
      Object.keys(source.racks ?? {}).every(name) &&
      Array.isArray(source.branches ?? []) && (source.branches ?? []).length<=maxBranches,'Invalid resampling jam project');
    const performance=A.padPattern.validate(source.performance);
    const rate=performance.options.sampleRate ?? 48000;
    check(performance.options.duration===undefined || T.seconds(T.read(performance.options.duration))<=90,
      'A jam performance can last up to 90 seconds');
    const racks=source.racks ?? {}, branches=source.branches ?? [], states=new Map();
    for (const rack of Object.values(racks)) A.audioRack.state(rack);
    states.set(origin,{id:origin,from:null,rack:null,speed:1,state:null});
    for (const row of branches) {
      check(fields(row,['id','from','rack','speed','macros','bypass','label']) && name(row.id) &&
        !states.has(row.id) && states.has(row.from ?? origin) &&
        (row.rack===undefined || row.rack===null || name(row.rack) && Object.hasOwn(racks,row.rack)) &&
        (row.speed===undefined || playbackSpeed(row.speed)) &&
        (row.bypass===undefined || typeof row.bypass==='boolean') &&
        (row.macros===undefined || record(row.macros)) &&
        (row.label===undefined || typeof row.label==='string' && row.label.trim() && row.label.length<=80),
      'A jam branch needs a unique ID, an earlier parent and valid playback or rack overrides');
      const from=row.from ?? origin, parent=states.get(from);
      const rack=row.rack===undefined ? parent.rack : row.rack;
      const previous=rack===parent.rack ? parent.state : null;
      check(rack!==null || row.macros===undefined && row.bypass===undefined,'Choose a rack before setting its macros or bypass');
      const state=rack===null ? null : A.audioRack.state(racks[rack],{
        bypass:row.bypass ?? previous?.bypass ?? false,macros:{...previous?.macros,...row.macros}
      });
      states.set(row.id,{id:row.id,from,rack,speed:row.speed ?? parent.speed,state,...(row.label && {label:row.label})});
    }
    const value=P.data.clone({...source,performance,racks,branches});
    check(JSON.stringify(value).length<=4e6,'Jam project exceeds its JSON budget');
    return {value,states,rate};
  }

  function branch(source,request) {
    const {value}=project(source);
    check(fields(request,['branches','sweep']) &&
      (request.branches===undefined || Array.isArray(request.branches) && request.branches.length<=maxBranches),
    'Supply named jam branches or a macro sweep');
    const additions=[...(request.branches ?? [])];
    if (request.sweep!==undefined) {
      const sweep=request.sweep;
      const {states}=project({...value,branches:[...value.branches,...additions]});
      check(fields(sweep,['from','prefix','axes']) && states.has(sweep.from ?? origin) && name(sweep.prefix) &&
        Array.isArray(sweep.axes) && integer(sweep.axes.length,1,3),'A jam sweep needs a parent, prefix and one to three axes');
      const from=sweep.from ?? origin, parent=states.get(from);
      const seen=new Set();
      let count=1;
      for (const axis of sweep.axes) {
        const control=axis?.control, macro=typeof control==='string' && control.startsWith('macros.') && control.slice(7);
        const isSpeed=control==='speed';
        check(fields(axis,['control','values']) && !seen.has(control) &&
          (isSpeed || macro && parent.state && Object.hasOwn(parent.state.macros,macro)) &&
          Array.isArray(axis.values) && integer(axis.values.length,2,8) &&
          Array.from(axis.values).every(isSpeed ? playbackSpeed : value=>finite(value,0,1)) &&
          new Set(axis.values).size===axis.values.length,'Invalid, repeated or unavailable jam sweep control');
        seen.add(control);
        count*=axis.values.length;
      }
      check(count<=32 && value.branches.length+additions.length+count<=maxBranches,'Jam sweep exceeds its branch budget');
      let combinations=[{}];
      for (const {control,values} of sweep.axes)
        combinations=combinations.flatMap(row=>values.map(value=>({...row,[control]:value})));
      combinations.forEach((combination,index)=>{
        const {speed,...knobs}=combination;
        const macros=Object.fromEntries(Object.entries(knobs).map(([key,value])=>[key.slice(7),value]));
        additions.push({id:sweep.prefix+'-'+String(index+1).padStart(2,'0'),from,...(speed!==undefined && {speed}),
          ...(Object.keys(macros).length && {macros})});
      });
    }
    check(additions.length>0,'Add at least one jam branch');
    const result=project({...value,branches:[...value.branches,...additions]});
    return {value:result.value,added:additions.map(row=>result.states.get(row.id))};
  }

  function window(range={},frames) {
    check(fields(range,rangeFields),'Invalid jam sample range');
    const {firstSample=0,endSample=frames}=range;
    check(integer(firstSample,0,frames-1) && integer(endSample,firstSample+1,frames),'Jam range is outside its phrase clock');
    return {firstSample,endSample};
  }

  function portion(pcm,{firstSample,endSample}) {
    return {...pcm,samples:pcm.samples.subarray(firstSample*pcm.channels,endSample*pcm.channels)};
  }

  function player({value,states,rate},assets) {
    const {performance,kit,racks}=value, {events,options}=performance;
    check(record(assets),'A jam needs named PCM assets');
    const baseline=A.sampleKit.render(kit,assets,events,{...options,stems:false});
    const frames=baseline.value.samples.length/baseline.value.channels;
    check(frames<=rate*90,'A jam performance can last up to 90 seconds');
    const cache=new Map([[1,baseline.value]]);
    const clock=baseline.report.events.map(({id,pad,at,noteOff})=>({id,pad,at,...(noteOff!==undefined && {noteOff})}));
    function dry(speed) {
      if (!cache.has(speed)) {
        const cents=1200*Math.log2(speed);
        const pitched=events.map(row=>{
          const tune=(row.play?.tune ?? 0)+cents;
          check(finite(tune,-4800,4800),'Jam speed and authored tuning exceed the playable cents range on '+row.id);
          return {...row,play:{...row.play,tune}};
        });
        const take=A.sampleKit.render(kit,assets,pitched,{...options,stems:false,duration:duration(frames,rate)});
        cache.set(speed,take.value);
      }
      return cache.get(speed);
    }
    function play(id) {
      const branch=states.get(id);
      check(branch,'Unknown jam branch '+id);
      const before=dry(branch.speed);
      if (branch.rack===null || branch.state.bypass) return {dry:before,value:before,branch};
      const wet=A.audioRack.render(racks[branch.rack],{...assets,main:before},branch.state,{
        sampleRate:rate,map:options.map,end:{samples:frames},tail:'cut',meter:false
      });
      return {dry:before,value:wet.value,branch,rack:wet.report};
    }
    return {play,clock,frames};
  }

  function render(source,assets,options={}) {
    check(fields(options,clockFields),'Invalid jam render options');
    const model=project(source),{frames,clock,play}=player(model,assets);
    const range=window(options.range,frames), {value,dry,branch,rack}=play(options.branch ?? origin);
    return {value:portion(value,range),dry:portion(dry,range),report:{frames,sampleRate:model.rate,
      ...range,branch,events:clock,...(rack!==undefined && {rack})}};
  }

  function audition(source,assets,options={}) {
    check(fields(options,['branches','range','levels']) && Array.isArray(options.branches) &&
      integer(options.branches.length,1,32) && new Set(options.branches).size===options.branches.length &&
      fields(options.levels ?? {},['targetRmsDb','peakDb','gapSeconds','maxGainDb']),'Invalid jam audition options');
    const model=project(source);
    check(options.branches.every(name=>model.states.has(name)),'A jam audition needs existing branch IDs');
    const {frames,clock,play}=player(model,assets), range=window(options.range,frames);
    const seconds=(range.endSample-range.firstSample)/model.rate;
    check(seconds<=15 && seconds*options.branches.length<=90 && frames*options.branches.length<=12e6,
      'Jam audition exceeds its render budget. Shorten the phrase or audition fewer branches');
    const branches=[], clips=options.branches.map(id=>{
      const take=play(id);
      branches.push(take.branch);
      const cropped=portion(take.value,range);
      return {id,value:{...cropped,samples:cropped.samples.slice()}};
    });
    const {value,report}=A.gestureBank.audition(clips,{...options.levels,sampleRate:model.rate});
    return {value,report:{...report,frames,...range,branches,events:clock}};
  }

  A.resamplingJam=Object.freeze({validate:source=>project(source).value,
    inspect:source=>[...project(source).states.values()],branch,render,audition});
})(KIT.procedural);
