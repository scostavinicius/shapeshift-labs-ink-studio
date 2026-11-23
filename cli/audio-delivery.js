/* Render role stems, variants, loop decays and a sample-aligned handoff. */
const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'),{write,json}=require('./asset-files.js');
const {editorialTimeline,cueCSV}=require('./delivery-interchange.js');

const scale=2**23, margin=1-8/scale;
const ebu={id:'ebu-r128',sampleRate:48000,targetLufs:-23,toleranceLu:.5,maxTruePeakDbTP:-1};
const label=(value,max)=>typeof value==='string' && value.trim() && value.length<=max;

function deliveryClock(P,sampleRate,map,pictureRate) {
  const T=P.takeTime, score=P.musicTiming.compile(map), rate=T.read(sampleRate);
  const {fields,integer,finite,check}=P.musicInstruments;
  check(integer(sampleRate,8000,96000),'Delivery sample rate must be 8000 to 96000 Hz');
  const fps=pictureRate===undefined ? null : T.read(pictureRate);
  check(!fps || finite(T.seconds(fps),1,1000),'Invalid delivery picture rate');
  const sample=point=>T.index(T.roundDown(T.mul(point,rate)));
  function at(raw) {
    let point;
    if (fields(raw,['frame']) && integer(raw.frame,0,3600000) && fps) point=T.div(T.read(raw.frame),fps);
    else if (P.musicTiming.isPosition(raw)) point=score.resolve(raw);
    else if (fields(raw,['samples']) && integer(raw.samples,0,sampleRate*3600)) return raw.samples;
    else if (fields(raw,['seconds']) && raw.seconds!==undefined) point=T.read(raw.seconds);
    else throw new TypeError('Use a sample, second, beat or picture-frame address with fps');
    const resolved=sample(point);
    check(integer(resolved,0,sampleRate*3600),'Delivery address is outside its timeline budget');
    return resolved;
  }
  const picture=n=>fps ? T.index(T.roundDown(T.mul(T.div(T.read(n),rate),fps))) : undefined;
  return {at,picture};
}

function profileFor(P,raw) {
  const {fields,finite,integer,check,id}=P.musicInstruments;
  if (raw===undefined) return null;
  if (raw==='ebu-r128') return {...ebu};
  check(fields(raw,['id','sampleRate','targetLufs','toleranceLu','maxTruePeakDbTP']) &&
    id(raw.id ?? 'custom') && (raw.sampleRate===undefined || integer(raw.sampleRate,8000,96000)) &&
    finite(raw.targetLufs,-65,0) && finite(raw.toleranceLu ?? .5,0,12) &&
    finite(raw.maxTruePeakDbTP,-30,0),'Choose ebu-r128 or supply a loudness target and true-peak ceiling');
  return {id:'custom',toleranceLu:.5,...raw};
}

function slice(pcm,start,end) {
  const {channels}=pcm, result=new Float64Array((end-start)*channels);
  result.set(pcm.samples.subarray(start*channels,end*channels));
  return {...pcm,samples:result};
}

function balancePrint(value,applied,limit) {
  const gain=Math.min(applied,limit);
  if (gain<applied) for (let i=0;i<value.samples.length;i++) value.samples[i]*=gain/applied;
  return gain;
}

function headroom(arrays) {
  let peak=0;
  for (const row of arrays) for (const x of row) {
    if (!Number.isFinite(x)) throw new RangeError('Delivery contains nonfinite premaster samples');
    peak=Math.max(peak,Math.abs(x));
  }
  return peak>margin ? margin/peak : 1;
}

function quantize(stems,premaster) {
  const values=Object.values(stems), shared=headroom([premaster.samples,...values]);
  // Distribute 24-bit rounding to a contributing stem so the integer sum nulls exactly.
  for (let i=0;i<premaster.samples.length;i++) {
    let total=0, max=0, strongest=values[0];
    for (const samples of values) {
      const quantized=Math.round(samples[i]*shared*scale), level=Math.abs(quantized);
      if (level>max) {max=level;strongest=samples;}
      total+=quantized;
      samples[i]=quantized/scale;
    }
    const goal=Math.round(premaster.samples[i]*shared*scale);
    strongest[i]+=(goal-total)/scale;
    premaster.samples[i]=goal/scale;
  }
  return shared;
}

function delivery({P,settings,mixer,assets,premix,cues:sceneCues,clock},directory) {
  const A=P.mediaGraph,M=A.mixer,{fields,record,integer,check,id}=P.musicInstruments;
  const roles=M.deliveryRoles;
  check(fields(settings,['id','title','from','to','fps','bwf','profile','roles','dialogueSources','cues','loops']) &&
    id(settings.id) && label(settings.title ?? settings.id,200) &&
    fields(settings.bwf ?? {},['timeReference','originator','originatorReference','date','time']) &&
    record(settings.roles ?? {}) && Object.values(settings.roles ?? {}).every(role=>roles.includes(role)) &&
    Array.isArray(settings.cues ?? []) && (settings.cues ?? []).length<=4096 &&
    Array.isArray(settings.loops ?? []) && (settings.loops ?? []).length<=12,'Invalid audio delivery settings');
  const plan=settings.roles ?? {}, profile=profileFor(P,settings.profile), title=settings.title ?? settings.id;
  check(!Object.hasOwn(plan,mixer.output),'Direct master clips belong to the returns stem');
  const dialogue=settings.dialogueSources ?? Object.keys(mixer.strips).filter(name=>
    (Object.hasOwn(plan,name) ? plan[name] : name)==='dialogue');
  check(Array.isArray(dialogue) && dialogue.length<=48 && new Set(dialogue).size===dialogue.length &&
    dialogue.every(name=>name!==mixer.output && Object.hasOwn(mixer.strips,name)),
  'Name distinct dialogue source strips to remove from the M&E');
  const rate=mixer.sampleRate ?? 48000, first=settings.from===undefined ? 0 : clock.at(settings.from);
  const explicit=settings.to===undefined ? undefined : clock.at(settings.to);
  const programme=explicit===undefined ? mixer : {...mixer,end:{samples:explicit},tail:'cut'};
  const full=M.renderForDelivery(programme,assets,plan,premix);
  const end=full.report.frames, frames=end-first;
  check(frames>0,'Delivery must include some programme audio');
  const b=settings.bwf ?? {}, base=b.timeReference ?? 0;
  check(integer(base,0,Number.MAX_SAFE_INTEGER) || typeof base==='string' && /^\d{1,20}$/.test(base),
    'Use a nonnegative Broadcast Wave time reference in samples');
  const origin=BigInt(base), timeReference=(origin+BigInt(first)).toString();
  const stamp=name=>Object.hasOwn(plan,name) ? plan[name] : roles.includes(name) ? name : 'returns';
  const assigned=sceneCues ?? Object.entries(full.report.strips).flatMap(([strip,{clips}])=>clips.map(clip=>({
    id:strip+'/'+clip.id,label:clip.id,role:stamp(strip),source:clip.source,fromSample:clip.start,toSample:clip.end
  })));
  const authorIds=new Set(), loopIds=new Set();
  const authored=Array.from(settings.cues ?? [],raw=>{
    check(fields(raw,['id','label','at','until','role']) && id(raw.id) && !authorIds.has(raw.id) &&
      label(raw.label,256) && (raw.role===undefined || roles.includes(raw.role)),'Invalid authored delivery cue');
    authorIds.add(raw.id);
    const start=clock.at(raw.at), stop=raw.until===undefined ? start : clock.at(raw.until);
    check(stop>=start,'Delivery cue ends before it starts');
    return {id:raw.id,label:raw.label,role:raw.role,fromSample:start,toSample:stop,kind:'authored',pictureFrame:raw.at.frame};
  });
  const loops=Array.from(settings.loops ?? [],raw=>{
    check(fields(raw,['id','label','from','to']) && id(raw.id) && !loopIds.has(raw.id.toLowerCase()) &&
      label(raw.label ?? raw.id,200),'Invalid delivery loop region');
    loopIds.add(raw.id.toLowerCase());
    const start=clock.at(raw.from), stop=clock.at(raw.to);
    check(start>=first && stop>start && stop<=full.report.sourceEnd,'Delivery loop must fit within the source programme');
    return {id:raw.id,label:raw.label ?? raw.id,start,stop,pictureFrame:raw.from.frame};
  });
  const cueRows=[...assigned.map((row,i)=>({...row,id:row.id ?? 'voice-'+(i+1),kind:'source'})),...authored];
  for (const {id,label,start,stop,pictureFrame} of loops)
    cueRows.push({id:'loop/'+id,label,fromSample:start,toSample:stop,kind:'loop',pictureFrame});
  const cues=[];
  for (const row of cueRows) {
    const marker=row.fromSample===row.toSample;
    if (row.fromSample>=end || row.toSample<first || !marker && row.toSample===first) continue;
    const fromSample=Math.max(first,row.fromSample), toSample=Math.min(end,row.toSample);
    cues.push({...row,fromSample,toSample,offsetSample:fromSample-first,durationSamples:toSample-fromSample,
      pictureFrame:fromSample===row.fromSample && row.pictureFrame!==undefined ? row.pictureFrame : clock.picture(fromSample),timeReference:(origin+BigInt(fromSample)).toString()});
  }
  cues.sort((a,b)=>a.fromSample-b.fromSample || a.toSample-b.toSample);
  const outputs={}, checks={};
  const print=(file,pcm,description,at,measure)=>{
    const metadata={...b,description:description.replace(/[^ -~]/gu,'?').slice(0,256),
      timeReference:(origin+BigInt(at)).toString(),originatorReference:b.originatorReference ?? settings.id.slice(0,32)};
    const bytes=WAV.encode(pcm,{encoding:'pcm24',bwf:metadata});
    outputs[file]={frames:pcm.samples.length/pcm.channels,timeReference:metadata.timeReference};
    if (measure) {
      const metered=A.mixerMonitor.meter(WAV.decode(bytes));
      const integratedLufs=metered.frames>=rate*.4 ? metered.integratedLufs : null;
      const truePeak=profile===null || metered.truePeakDbTP===null || metered.truePeakDbTP<=profile.maxTruePeakDbTP;
      const rateMatch=profile?.sampleRate===undefined || profile.sampleRate===rate;
      const loudness=measure!=='programme' || profile===null ? null : integratedLufs!==null &&
        Math.abs(integratedLufs-profile.targetLufs)<=profile.toleranceLu;
      checks[file]={integratedLufs,truePeakDbTP:metered.truePeakDbTP,samplePeakDbFS:metered.samplePeakDbFS,
        passed:rateMatch && truePeak && loudness!==false,rateMatch,loudness,truePeak};
    }
    write(path.join(directory,file),bytes);
    return file;
  };
  const master=print('audio/master.wav',slice(full.value,first,end),title+' master',first,'programme');
  const pre=slice(full.premaster,first,end);
  const stems=Object.fromEntries(Object.entries(full.stems).map(([role,pcm])=>[role,pcm.slice(first*2,end*2)]));
  const gain=quantize(stems,pre);
  const premaster=print('audio/premaster.wav',pre,title+' premaster',first);
  const stemFiles=Object.fromEntries(Object.entries(stems).map(([role,samples])=>[role,
    print('stems/'+role+'.wav',{...pre,samples},title+' '+role,first)]));
  const meStrips=Object.fromEntries(Object.entries(programme.strips).map(([name,strip])=>
    [name,dialogue.includes(name) ? {...strip,clips:[]} : strip]));
  const me=M.renderForDelivery({...programme,strips:meStrips,
    ...(full.report.sourceEnd>0 && {end:{samples:full.report.sourceEnd}})},assets,plan,premix);
  const meSound=slice(me.value,first,end);
  const meMasterGain=balancePrint(meSound,me.report.headroom,full.report.headroom);
  const meMaster=print('audio/music-and-effects.wav',meSound,title+' music and effects',first,'alternate');
  const mePre=slice(me.premaster,first,end), meGain=headroom([mePre.samples]);
  for (let i=0;i<mePre.samples.length;i++) mePre.samples[i]*=meGain;
  const mePremaster=print('audio/music-and-effects-premaster.wav',mePre,title+' music and effects premaster',first);

  const exports=loops.map(({id,label,start,stop})=>{
    const region={...programme,end:{samples:stop},tail:'keep'};
    const result=premix ? M.renderPremix(region,assets,premix) : M.render(region,assets);
    const sound=result.value, tailEnd=result.report.frames;
    const masterGain=balancePrint(sound,result.report.headroom,full.report.headroom);
    const stem='loops/'+id+'/';
    const body=print(stem+'body.wav',slice(sound,start,stop),title+' '+label+' loop body',start);
    const tail=tailEnd>stop ? print(stem+'tail.wav',slice(sound,stop,tailEnd),title+' '+label+' loop tail',stop) : null;
    const withTail=print(stem+'with-tail.wav',slice(sound,start,tailEnd),title+' '+label+' with tail',start,'alternate');
    return {id,label,fromSample:start,toSample:stop,body,tail,withTail,bodyFrames:stop-start,tailFrames:tailEnd-stop,masterGain};
  });
  const qc={profile,passed:Object.values(checks).every(row=>row.passed),files:checks};
  const interchange='premaster.otio', cueSheet={json:'cue-sheet.json',csv:'cue-sheet.csv'};
  json(path.join(directory,interchange),editorialTimeline({title,sampleRate:rate,frames,timeReference,stems:stemFiles,cues}));
  json(path.join(directory,cueSheet.json),{sampleRate:rate,firstSample:first,timeReference,cues});
  write(path.join(directory,cueSheet.csv),cueCSV(cues));
  json(path.join(directory,'quality.json'),qc);
  const manifest={format:'ink-studio/audio-delivery',version:1,id:settings.id,title,sampleRate:rate,channels:2,
    firstSample:first,endSample:end,frames,timeReference,encoding:'pcm24-bwf-v1',
    ...(settings.fps!==undefined && {fps:settings.fps}),
    master,premaster,stems:stemFiles,recombination:{gain,pcmNull:0},
    musicAndEffects:{master:meMaster,premaster:mePremaster,masterGain:meMasterGain,premasterGain:meGain,dialogueSources:dialogue},
    loops:exports,cueSheet,interchange,quality:'quality.json',qualityPassed:qc.passed,files:outputs};
  json(path.join(directory,'delivery.json'),manifest);
  return manifest;
}

module.exports={delivery,deliveryClock};
