/* Keep a performed score pinned while planning and auditioning its surrounding sound. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,{fields,record,id,integer,finite,check}=P.musicInstruments;
  const kinds=['bed','call','gesture'], format='ink-studio/atmosphere-plan', maxFrames=4320000;

  function reference(score,performance) {
    const {sampleRate,channels,samples}=A.audio(score);
    check(record(performance),'Atmosphere reference needs a performed event table or report');
    return {sampleRate,frames:samples.length/channels,events:record(performance.events) ? performance.events : performance,
      ...(performance.arrangement?.score?.tempoMap && {map:performance.arrangement.score.tempoMap})};
  }

  function plan(source,assets,settings) {
    const time=S.atmosphereTimeline;
    check(fields(source,['sampleRate','frames','map','events']) && integer(source.sampleRate,8000,96000) &&
      integer(source.frames,1,Math.min(maxFrames,120*source.sampleRate)) && record(source.events) &&
      Object.keys(source.events).length<=32 && record(assets) &&
      fields(settings,['seed','layers']) && Number.isSafeInteger(settings.seed ?? 0) &&
      Array.isArray(settings.layers) && integer(settings.layers.length,1,16),'Invalid atmosphere score clock or layers');
    let count=0;
    for (const [name,notes] of Object.entries(source.events)) {
      check(id(name) && Array.isArray(notes) && (count+=notes.length)<=32768 && Array.from(notes).every(row=>
        record(row) && finite(row.time,0,3600) && finite(row.gate ?? row.duration ?? 0,0,3600)),
      'Atmosphere needs performed event times and gates');
    }
    const {sampleRate,frames,map}=source, seed=settings.seed ?? 0, clock=time.timeline(source);
    const seen=new Set(), described=new Map();
    function load(name) {
      check(id(name) && Object.hasOwn(assets,name),'Unknown atmosphere asset '+name);
      if (!described.has(name)) {
        const pcm=A.audio(assets[name]), sourceFrames=pcm.samples.length/pcm.channels;
        const step=pcm.sampleRate/sampleRate;
        check(pcm.channels<=2 && sourceFrames && finite(step,1/128,16),'Atmosphere assets need playable mono or stereo PCM');
        described.set(name,{id:name,sampleRate:pcm.sampleRate,sourceFrames,frames:Math.ceil(sourceFrames/step)});
      }
      return described.get(name);
    }
    const common=['id','kind','assets','range','perspective','trimDb'];
    const specific={bed:['crossfade'],call:time.levels,gesture:[...time.levels.filter(key=>key!=='spacing'),'every','offset','pattern']};
    const layers=Array.from(settings.layers,layer=>{
      check(kinds.includes(layer?.kind) && fields(layer,[...common,...specific[layer.kind]]) && id(layer.id) &&
        !seen.has(layer.id) && Array.isArray(layer.assets) && integer(layer.assets.length,1,16) &&
        new Set(layer.assets).size===layer.assets.length && finite(layer.density ?? 1,0,1) &&
        finite(layer.trimDb ?? 0,-72,12),'Invalid or duplicate atmosphere layer');
      seen.add(layer.id);
      const sounds=Array.from(layer.assets,load), range=clock.bounds(layer.range ?? {});
      const place={bed:time.bed,call:time.spots,gesture:time.gesture}[layer.kind];
      const {clips,windows,candidates}=place(layer,sounds,clock,range,seed,layer.density ?? 1);
      check(clips.length<=512,'Atmosphere layer exceeds the mixer clip budget');
      const perspective=time.perspective(layer.perspective ?? {},clock,range);
      const layerMixer={
        id:layer.id,sampleRate,end:{samples:range[1]},tail:'cut',output:'out',
        strips:{out:{clips:clips.map((clip,index)=>({id:'clip-'+index,source:clip.source,at:{samples:clip.at},
          ...(clip.toSample!==undefined && {toSample:clip.toSample}),
          ...(clip.gain!==undefined && {gainDb:clip.gain})})),
        inserts:['color'],fader:perspective.gain,pan:perspective.pan}},
        processors:{color:{type:'lowpass',hz:perspective.cutoff}}
      };
      return {id:layer.id,kind:layer.kind,trimDb:layer.trimDb ?? 0,range,clips,windows,
        ...(candidates!==undefined && {candidates}),quietWindows:perspective.windows,mixer:layerMixer};
    });
    return {format,version:1,sampleRate,frames,seed,...(map!==undefined && {map}),layers};
  }

  function dryScore(score,clock) {
    const pcm=A.audio(score);
    check(pcm.channels<=2 && pcm.sampleRate===clock.sampleRate && pcm.samples.length/pcm.channels===clock.frames,
      'Atmosphere plan needs the original score clock and length');
    return pcm;
  }

  function arrangement(value,assets,{stems=false}={}) {
    check(fields(value,['format','version','sampleRate','frames','seed','map','layers']) && value.format===format &&
      value.version===1 && integer(value.sampleRate,8000,96000) && integer(value.frames,1,maxFrames) &&
      Array.isArray(value.layers) && integer(value.layers.length,1,16) && record(assets),
    'Invalid atmosphere plan');
    const channels=2, {sampleRate,frames}=value, samples=new Float64Array(frames*channels);
    const grouped=stems ? Object.fromEntries(kinds.map(key=>[key,{sampleRate,channels,samples:new Float64Array(samples.length)}])) : {};
    const gains={};
    for (const layer of value.layers) {
      check(id(layer?.id) && !Object.hasOwn(gains,layer.id) && kinds.includes(layer.kind) && finite(layer.trimDb,-72,12) &&
        Array.isArray(layer.range) && layer.range.length===2 && integer(layer.range[0],0,frames-1) &&
        integer(layer.range[1],layer.range[0]+1,frames) && layer.mixer?.sampleRate===sampleRate &&
        layer.mixer.end?.samples===layer.range[1] && layer.mixer.tail==='cut',
      'Atmosphere layer mixer needs the same sample clock');
      if (!layer.mixer.strips?.out?.clips?.length) {gains[layer.id]=1;continue;}
      const {value:audio,report}=A.mixer.render(layer.mixer,assets), gain=10**(layer.trimDb/20);
      gains[layer.id]=report.headroom;
      const stem=grouped[layer.kind]?.samples;
      for (let i=layer.range[0]*channels;i<audio.samples.length;i++) {
        const x=audio.samples[i]*gain;
        samples[i]+=x;
        if (stem) stem[i]+=x;
      }
    }
    return {audio:{sampleRate,channels,samples},gains,stems:grouped};
  }

  function sum(dry,wet,first=0,end=wet.samples.length/2) {
    const {sampleRate}=wet, samples=new Float64Array(2*(end-first));
    for (let i=first,j=0;i<end;i++) for (let c=0;c<2;c++,j++) {
      const source=i*dry.channels+(dry.channels===1 ? 0 : c);
      samples[j]=dry.samples[source]+wet.samples[i*2+c];
    }
    return {sampleRate,channels:2,samples};
  }

  function peak(pcm) {
    let result=0;
    for (const x of pcm.samples) result=Math.max(result,Math.abs(x));
    return result;
  }

  function render(source,score,assets,options={}) {
    check(fields(options,['stems']) && (options.stems===undefined || typeof options.stems==='boolean'),'Invalid atmosphere render options');
    const dry=dryScore(score,source), {audio,gains,stems}=arrangement(source,assets,options);
    const value=sum(dry,audio);
    const gain=1/Math.max(1,...[value,audio,...Object.values(stems)].map(peak));
    if (gain<1) for (const pcm of [value,audio,...Object.values(stems)])
      for (let i=0;i<pcm.samples.length;i++) pcm.samples[i]*=gain;
    return {value,atmosphere:audio,stems,report:{sampleRate:source.sampleRate,frames:source.frames,headroom:gain,layerHeadroom:gains}};
  }

  function variant(settings,selection) {
    check(fields(selection,['id','layers','muted']) && id(selection.id) && record(selection.layers ?? {}) &&
      (selection.muted===undefined || typeof selection.muted==='boolean'),'Invalid atmosphere audition variant');
    const known=new Set(settings.layers.map(row=>row.id));
    check(Object.entries(selection.layers ?? {}).every(([name,change])=>known.has(name) &&
      fields(change,['density','trimDb'])),'Variant layers can change density or trim on known layers');
    return {...settings,layers:settings.layers.map(row=>({...row,...selection.layers?.[row.id]}))};
  }

  function audition(source,score,assets,settings,options) {
    check(fields(options,['variants','range','levels']) && Array.isArray(options.variants) &&
      integer(options.variants.length,1,8) && fields(options.range ?? {},['from','to']) &&
      fields(options.levels ?? {},['targetRmsDb','peakDb','gapSeconds','maxGainDb']),'Invalid atmosphere audition options');
    const original=plan(source,assets,settings), dry=dryScore(score,original);
    const range=S.atmosphereTimeline.timeline(source).bounds(options.range ?? {});
    const seconds=(range[1]-range[0])/original.sampleRate;
    check(seconds<=15 && seconds*options.variants.length<=90 && original.frames*options.variants.length<=16e6,
      'Atmosphere audition exceeds its budget. Choose a shorter passage or fewer variants');
    const ids=new Set(), reports=[];
    const clips=options.variants.map(choice=>{
      const spec=variant(settings,choice);
      check(!ids.has(choice.id),'Atmosphere audition variant IDs must be distinct');
      ids.add(choice.id);
      const planned=choice.layers && Object.keys(choice.layers).length ? plan(source,assets,spec) : original;
      const wet=choice.muted ? {sampleRate:original.sampleRate,samples:new Float64Array(original.frames*2)} :
        arrangement(planned,assets).audio;
      reports.push({id:choice.id,muted:choice.muted ?? false,layers:planned.layers.map(({id,kind,clips,quietWindows})=>
        ({id,kind,clips:choice.muted ? [] : clips.filter(row=>row.at<range[1] && row.end>range[0]),quietWindows}))});
      return {id:choice.id,value:sum(dry,wet,...range)};
    });
    const headroom=1/Math.max(1,...clips.map(row=>peak(row.value)));
    if (headroom<1) for (const {value:{samples}} of clips) for (let i=0;i<samples.length;i++) samples[i]*=headroom;
    const result=A.gestureBank.audition(clips,{...options.levels,sampleRate:source.sampleRate,levelMatch:'shared'});
    return {value:result.value,report:{...result.report,sourceRange:range,headroom,variants:reports}};
  }

  A.atmosphere=Object.freeze({reference,plan,render,audition});
})(KIT.procedural);
