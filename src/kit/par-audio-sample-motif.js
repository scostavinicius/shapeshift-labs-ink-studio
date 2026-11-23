/* Put one source into four editable musical roles over a pinned score window. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,T=P.takeTime,H=P.musicHarmony;
  const {fields,record,finite,integer,check}=P.musicInstruments;
  const order=['raw','lead','accent','texture'], format='ink-studio/sample-motif';
  const ratio=(numerator,denominator)=>({numerator,denominator});
  const length=audio=>audio.samples.length/audio.channels;
  const shapeOf=audio=>({sampleRate:audio.sampleRate,channels:audio.channels,frames:length(audio)});
  const defaultFilter={type:'highpass',hz:150};
  const levels=['targetRmsDb','peakDb','gapSeconds','maxGainDb'];
  const position=(time,value)=>time.position(typeof value==='number' ? {seconds:value} : value);
  function scoreInput(input) {
    const score=A.audio(input);
    check(score.channels<=2 && integer(score.sampleRate,8000,96000) && length(score)>0,
      'A motif comparison needs mono or stereo score audio at 8–96 kHz');
    return score;
  }

  function plan(input,backing,settings={}) {
    check(fields(settings,['map','range','seed','tonic','derive',...order]) &&
      fields(settings.range ?? {},['from','to']) && Number.isSafeInteger(settings.seed ?? 0),'Invalid sample-to-motif settings');
    const source=S.instrumentAudio(input), score=scoreInput(backing), {sampleRate}=score;
    const time=S.mixerTime(sampleRate,settings.map), {from,to}=settings.range ?? {};
    const first=from===undefined ? 0 : time.frame(position(time,from));
    const end=to===undefined ? length(score) : time.frame(position(time,to));
    const frames=end-first;
    check(integer(first,0,length(score)-1) && integer(end,first+1,length(score)) &&
      integer(frames,32,sampleRate*15),'Choose a score range of up to 15 seconds and at least 32 samples');
    const {beatAt}=time.beatClock(), origin=from===undefined ? T.read(0) : position(time,from);
    const clock=P.musicTiming.compile(settings.map);
    const span=beatAt(end)-beatAt(first);
    let gesture, projection, relative=0;
    if (settings.derive!==undefined) {
      const derive=settings.derive;
      check(fields(derive,['analysis','projection','at']) && finite(derive.at ?? 0,0,span-.125) &&
        !(settings.lead?.shape && settings.lead?.notes===undefined),
      'Derived notes need a valid placement and the original audio coordinates');
      relative=derive.at ?? 0;
      gesture=S.timbreGesture.extract(source,derive.analysis);
      projection=S.timbreGesture.project(gesture,{beats:Math.min(2,(span-relative)*.54),
        tailBeats:Math.min(1,(span-relative)*.28),...(settings.tonic!==undefined && {tonic:settings.tonic}),...derive.projection});
      check(relative+projection.beats<=span+.000001,'The derived gesture exceeds the score window');
    }
    const {takes:{source:analysis}}=A.sampleInstrument.analyze({source});
    const rawRoot=settings.lead?.root, detected=analysis.root?.confidence>=.4 ? analysis.root : null;
    const anchor=settings.tonic===undefined ? detected?.suggestedNote ?? 60 : H.midi(settings.tonic);
    const measured=projection?.origin;
    const root=rawRoot===undefined ? measured!==null && measured!==undefined ? Math.min(127,measured) :
      detected?.midi ?? anchor : H.midi(rawRoot);
    const originOfRoot=rawRoot!==undefined ? 'authored' : detected || measured!==null && measured!==undefined ? 'detected' : 'reference';
    const defaults={raw:{gainDb:-10,pan:-.23,at:span*.16},lead:{gainDb:-9,pan:.07},
      accent:{gainDb:-10,pan:.23},texture:{gainDb:-14,pan:-.12,at:0}};
    function boundary(point,last=frames-1) {
      const at=time.frame(point)-first;
      check(integer(at,0,last),'Motif placement exceeds the score window');
      return at;
    }
    function offset(value,last) {
      check(finite(T.seconds(T.read(value)),0,512),'Motif beat offsets must be from 0 to 512');
      return boundary(clock.offsetBeats(origin,value),last);
    }
    function hit(id,row,gated) {
      check(fields(row,['beat','duration','note','velocity','play']) &&
        row.beat!==undefined && finite(row.velocity ?? .82,0,1) &&
        record(row.play ?? {}) && (row.duration===undefined || finite(T.seconds(T.read(row.duration)),.0001,128)),
      'Invalid editable motif hit');
      const at=offset(row.beat);
      let until;
      if (gated) {
        const start=clock.offsetBeats(origin,row.beat);
        until=boundary(clock.offsetBeats(start,row.duration ?? .17),frames);
        check(until>at,'Motif gate must span at least one sample');
      }
      return {id,pad:'voice',time:ratio(at,sampleRate),velocity:row.velocity ?? .82,
        ...(row.note!==undefined && {note:H.midi(row.note)}),
        ...(until!==undefined && {until:ratio(until,sampleRate)}),
        ...(row.play && {play:row.play})};
    }
    function pitched(index) {
      const intervals=[0,3,7,2,5], midi=anchor+intervals[index];
      return midi>127 ? midi-12 : midi;
    }
    const defaultLead=[.08,.22,.41,.55,.71].map((part,i)=>({beat:span*part,duration:Math.min(.62,span*.10),
      note:pitched(i),velocity:[.77,.62,.89,.76,.73][i]}));
    const defaultHits=[.15,.34,.48,.54,.76,.89].map((part,i)=>({beat:span*part,duration:Math.min(.13,span*.05),
      velocity:[.83,.48,.78,.44,.80,.57][i],play:{tune:[0,350,-200,550,-350,100][i],filter:defaultFilter}}));
    const allowed={raw:['at'],lead:['notes','root','shape'],accent:['hits'],texture:['at','until','grains']};
    const roles=order.map(id=>{
      const options=settings[id] ?? {};
      check(fields(options,['gainDb','pan',...allowed[id]]) &&
        finite(options.gainDb ?? defaults[id].gainDb,-60,6) && finite(options.pan ?? defaults[id].pan,-1,1),
      'Invalid '+id+' motif settings');
      const projectedAt=id==='texture' && projection ? relative+projection.motifs.tail.events[0].beat : defaults[id].at;
      const {gainDb,pan,at}={...defaults[id],at:projectedAt,...options};
      const pitched=id==='lead', gated=pitched || id==='accent';
      const derivedHits=projection && (pitched || id==='accent') ?
        (projection.motifs[pitched ? 'contour' : 'attacks']?.events ?? []).map(row=>{
          const point=pitched ? gesture.pitchTrack.find(point=>'pitch-'+point.sample===row.id) :
            gesture.attacks.find(point=>point.id===row.id);
          const tune=pitched && rawRoot===undefined ? Math.max(-1200,Math.min(1200,(root-point.midi)*100)) : 0;
          return {beat:relative+row.beat,duration:row.duration,velocity:row.velocity,
            ...(pitched && {note:row.midi}),play:{startSample:point.sample,tune}};
        }) : null;
      const hits=options.notes ?? options.hits ?? derivedHits ??
        (pitched ? defaultLead : id==='accent' ? defaultHits : [{beat:at,velocity:1}]);
      check(Array.isArray(hits) && integer(hits.length,derivedHits && pitched && options.notes===undefined ? 0 : 1,128) &&
        (!pitched || Array.from(hits).every(row=>row?.note!==undefined)),'Supply editable lead notes or accent hits');
      const events=Array.from(hits,(row,i)=>hit(id+'-'+(i+1),row,gated));
      let transform=null, kitRoot=root;
      if (pitched && options.shape!==undefined) {
        check(fields(options.shape,['pitchCents','duration','formantCents','attackFrames','joinFrames','mode','fundamentalHz']) &&
          finite(options.shape.pitchCents ?? 0,-2400,2400),'Invalid lead sample shaping');
        const {pitchCents=0}=options.shape;
        transform={kind:'shape',settings:{fundamentalHz:detected?.hz ?? 180,...options.shape}};
        kitRoot=root+pitchCents/100;
        check(finite(kitRoot,0,127),'Shaped lead root is outside MIDI range');
      }
      if (id==='texture') {
        const begin=offset(at), stop=options.until===undefined ? frames : offset(options.until,frames);
        check(stop-begin>=32,'Texture needs a positive range within the score window');
        const {grainMs=145,density=28,semitones=0,sprayMs=21,spread=.65,reverse=.10,jitterCents=22}=options.grains ?? {};
        check(fields(options.grains ?? {},['grainMs','density','semitones','sprayMs','spread','reverse','jitterCents']),
          'Invalid texture controls');
        transform={kind:'granular',frames:stop-begin,grains:{grainMs,density,semitones,sprayMs,spread,reverse,jitterCents,
          seed:(settings.seed ?? 0)|0},...(projection && {range:projection.tail})};
      }
      const noteRoot=Math.round(kitRoot), take={asset:'material',
        ...(pitched && {root:noteRoot,tune:100*(noteRoot-kitRoot)})};
      const kit={id,pads:{voice:{gain:gainDb,pan,gated,attack:id==='texture' ? .07 : id==='raw' ? 0 : .004,
        release:pitched ? .115 : .038,articulations:{default:[{id:'slice',takes:[take]}]}}}};
      return {id,kit,performance:{events,options:{sampleRate,duration:ratio(frames,sampleRate),stems:false}},transform};
    });
    return {format,version:1,source:shapeOf(source),score:shapeOf(score),firstSample:first,endSample:end,
      ...(settings.map!==undefined && {map:settings.map}),root:{midi:root,kind:originOfRoot,analysis:analysis.root},
      ...(projection && {gesture:projection}),roles};
  }

  function ready(plan,input,backing) {
    const source=S.instrumentAudio(input), score=scoreInput(backing), rate=score.sampleRate;
    check(fields(plan,['format','version','source','score','firstSample','endSample','map','root','roles','gesture']) &&
      plan.format===format && plan.version===1 && ['source','score'].every(key=>{
        const actual=key==='source' ? shapeOf(source) : shapeOf(score);
        return fields(plan[key],Object.keys(actual)) && Object.keys(actual).every(name=>plan[key][name]===actual[name]);
      }) && integer(plan.firstSample,0,length(score)-1) &&
      integer(plan.endSample,plan.firstSample+32,Math.min(length(score),plan.firstSample+15*rate)) &&
      Array.isArray(plan.roles) && plan.roles.length===4 && order.every((id,i)=>plan.roles[i]?.id===id),
    'Sample-to-motif plan does not match the source and score');
    return {source,score,rate,frames:plan.endSample-plan.firstSample};
  }

  function grains(source,rate,{frames,grains}) {
    const seconds=frames/rate, sourceSeconds=length(source)/source.sampleRate;
    const scanRate=Math.min(4,sourceSeconds/seconds);
    const end=Math.max(frames,Math.ceil(sourceSeconds*rate));
    const mixer={id:'texture',sampleRate:rate,end:{samples:end},tail:'cut',output:'out',strips:{
      out:{clips:[{id:'recording',source:'source'}],inserts:['grains']}
    },processors:{grains:{type:'granular',...grains,scanRate,extendSeconds:Math.max(0,seconds-sourceSeconds),wrap:true,wet:1}}};
    const {value}=A.mixer.render(mixer,{source});
    return {...value,samples:value.samples.subarray(0,frames*value.channels)};
  }
  function texture(source,rate,settings) {
    const {range}=settings;
    if (!range) return grains(source,rate,settings);
    const {fromSample,toSample}=range;
    check(fields(range,['fromSample','toSample']) && integer(fromSample,0,length(source)-1) &&
      integer(toSample,fromSample+1,length(source)),'Invalid gesture tail coordinates');
    return grains({...source,samples:source.samples.slice(fromSample*source.channels,toSample*source.channels)},rate,settings);
  }

  function take(plan,context,id) {
    check(order.includes(id),'Choose a raw, lead, accent or texture role');
    const role=plan.roles.find(row=>row.id===id), {source,rate,frames}=context;
    check(fields(role,['id','kit','performance','transform']) && record(role.performance) &&
      role.performance.options?.sampleRate===rate &&
      T.compare(T.read(role.performance.options.duration),T.read(ratio(frames,rate)))===0 &&
      (role.transform===null || id==='lead' && fields(role.transform,['kind','settings']) && role.transform.kind==='shape' ||
        id==='texture' && fields(role.transform,['kind','frames','grains','range']) && role.transform.kind==='granular' &&
        integer(role.transform.frames,32,frames) &&
        fields(role.transform.grains,['grainMs','density','semitones','sprayMs','spread','reverse','jitterCents','seed'])),
    'Sample motif role uses an invalid performance or transform');
    const material=role.transform===null ? source : role.transform.kind==='shape' ?
      A.shapeInstrumentSample(source,role.transform.settings).value : texture(source,rate,role.transform);
    const {value,report}=A.sampleKit.render(role.kit,{material},role.performance.events,{...role.performance.options,stems:false});
    return {stem:value,material,role,events:report.events,kitHeadroom:report.gain};
  }
  function passage(plan,{score,frames,rate},stem) {
    const samples=new Float64Array(frames*2);
    let peak=0;
    for (let i=0;i<frames;i++) for (let ch=0;ch<2;ch++) {
      const at=i*2+ch, source=(plan.firstSample+i)*score.channels+(score.channels===1 ? 0 : ch);
      samples[at]=score.samples[source]+(stem?.samples[at] ?? 0);
      peak=Math.max(peak,Math.abs(samples[at]));
    }
    return {value:{sampleRate:rate,channels:2,samples},peak};
  }

  function render(plan,input,backing,id) {
    const context=ready(plan,input,backing), {stem,material,role,events,kitHeadroom}=take(plan,context,id);
    const {value,peak}=passage(plan,context,stem), headroom=1/Math.max(1,peak);
    if (headroom<1) for (let i=0;i<value.samples.length;i++) value.samples[i]*=headroom;
    return {value,stem,material,role,report:{role:id,events,headroom,kitHeadroom,
      sampleRate:context.rate,firstSample:plan.firstSample,endSample:plan.endSample,root:plan.root}};
  }

  function audition(plan,input,backing,settings={}) {
    const {roles=order,levels:options={}}=settings, context=ready(plan,input,backing);
    check(fields(settings,['roles','levels']) && fields(options,levels) && Array.isArray(roles) &&
      integer(roles.length,1,5) && new Set(roles).size===roles.length && Array.from(roles).every(id=>id==='score' || order.includes(id)),
    'Audition distinct sample motif roles');
    const rows=roles.map(id=>{
      const role=id==='score' ? null : take(plan,context,id);
      return {id,...passage(plan,context,role?.stem),events:role?.events ?? []};
    });
    const headroom=1/Math.max(1,...rows.map(row=>row.peak));
    const clips=rows.map(({id,value})=>{
      if (headroom<1) for (let i=0;i<value.samples.length;i++) value.samples[i]*=headroom;
      return {id,value};
    });
    const {value,report}=A.gestureBank.audition(clips,{...options,sampleRate:context.rate,levelMatch:'shared'});
    return {value,report:{...report,headroom,firstSample:plan.firstSample,endSample:plan.endSample,root:plan.root,
      ...(plan.gesture && {gesture:plan.gesture}),roles:Object.fromEntries(rows.map(({id,events})=>[id,events]))}};
  }

  A.sampleMotif=Object.freeze({plan,render,audition});
  S.stretchMotifTexture=texture;
})(KIT.procedural);
