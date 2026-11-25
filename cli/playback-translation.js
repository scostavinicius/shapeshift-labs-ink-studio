/* Audition a single approved mix through measured playback chains. */
const fs=require('node:fs'), path=require('node:path');
const {createHash}=require('node:crypto');
const WAV=require('./wav.js');
const {load:loadCapture}=require('./room-impulse-capture.js');
const {stageAt}=require('./recorded-presentation.js');
const Metrics=require('./playback-translation-metrics.js');

const format='ink-studio/playback-translation';
const usage='music mix translate <plan.json> --out <new-directory>';
const text=(value,max=4096)=>typeof value==='string'&&value.trim()&&value.length<=max;
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const number=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const check=(condition,message)=>{if (!condition) throw new RangeError(message);};
const count=pcm=>pcm.samples.length/pcm.channels;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const minCueMs=25;

function prepare(raw,mix) {
  const {title='Playback translation',targets,cues=[],thresholds={}}=raw, {sampleRate}=mix;
  const frames=count(mix);
  check(text(title,160)&&fields(thresholds,['bassHz','referenceHz','minBassShare','minBassLossDb','minCueLossDb','minCueRmsDbFS']),
    'Invalid translation title or thresholds');
  const settings={bassHz:[25,180],referenceHz:[500,2000],minBassShare:.76,minBassLossDb:10,
    minCueLossDb:4,minCueRmsDbFS:-54,...thresholds};
  const band=(value,min,max)=>Array.isArray(value)&&value.length===2&&number(value[0],min,max-1)&&
    number(value[1],value[0]+10,max);
  check(band(settings.bassHz,20,500)&&band(settings.referenceHz,250,sampleRate*.45)&&
    settings.referenceHz[0]>=settings.bassHz[1]&&number(settings.minBassShare,.5,1)&&
    number(settings.minBassLossDb,1,60)&&number(settings.minCueLossDb,0,50)&&number(settings.minCueRmsDbFS,-100,0),
  'Invalid bass, reference band or loss thresholds');
  function rows(list,min,max) {
    return Array.isArray(list)&&integer(list.length,min,max)&&list.every(row=>id(row?.id))&&
      new Set(list.map(row=>row.id)).size===list.length;
  }
  check(rows(targets,1,8)&&rows(cues,0,32),'Use distinct IDs for up to eight devices and 32 cues');
  const devices=targets.map(row=>{
    const {id,label=id,device,input='mono',response,directSample,window}=row;
    check(fields(row,['id','label','device','input','response','directSample','window'])&&id!=='reference'&&text(label,100)&&
      ['phone','laptop','small-speaker','other'].includes(device)&&['mono','stereo'].includes(input)&&text(response)&&
      (directSample===undefined||integer(directSample,0,192000))&&
      (window===undefined||fields(window,['fromSample','toSample'])&&Number.isSafeInteger(window.fromSample)&&
        Number.isSafeInteger(window.toSample)),'Invalid playback target '+id);
    return {id,label,device,input,response,directSample,window};
  });
  const windows=cues.map(row=>{
    const {id,label=id,stem,fromSample,toSample}=row, minimum=Math.ceil(sampleRate*minCueMs/1000);
    check(fields(row,['id','label','stem','fromSample','toSample'])&&text(label,100)&&(stem===undefined||text(stem))&&
      integer(fromSample,0,frames-minimum)&&integer(toSample,fromSample+minimum,Math.min(frames,fromSample+sampleRate*8)),
    'Cue '+id+' needs a window from 25 ms to 8 seconds on the mix sample grid');
    return {id,label,stem,fromSample,toSample};
  });
  return {title,settings,devices,windows};
}

function readWav(file,maxBytes) {
  const stat=fs.statSync(file);
  check(stat.isFile()&&stat.size<=maxBytes,'Audio input exceeds its file budget: '+file);
  const bytes=fs.readFileSync(file), pcm=WAV.decode(bytes,{preserveFloatRange:true});
  check(integer(pcm.sampleRate,8000,96000)&&[1,2].includes(pcm.channels)&&count(pcm)>0&&
    pcm.samples.every(value=>Math.abs(value)<=16),'Translation needs bounded mono or stereo PCM from 8 to 96 kHz');
  return {...pcm,sha256:digest(bytes)};
}

function impulse(target,owner,rate,api,inputs) {
  const filename=path.resolve(path.dirname(owner),target.response);
  inputs.add(filename);
  let raw, direct, sha256, capture;
  if (path.extname(filename).toLowerCase()==='.json') {
    const {document,response}=loadCapture(filename,file=>inputs.add(file));
    raw=response;
    direct=target.directSample??document.edit.directSample;
    capture=document.measurement.calibration;
    sha256=digest(fs.readFileSync(path.join(path.dirname(filename),document.response)));
  } else {
    raw=readWav(filename,8*1024*1024);
    direct=target.directSample??0;
    sha256=raw.sha256;
  }
  const rawFrames=count(raw), {fromSample=0,toSample=rawFrames}=target.window??{};
  check(integer(fromSample,0,rawFrames-1)&&integer(toSample,fromSample+1,rawFrames)&&
    toSample-fromSample<=raw.sampleRate*.5&&integer(direct,fromSample,toSample-1),
  'Choose a measured response window up to 500 ms containing the direct arrival for '+target.id);
  const step=raw.sampleRate/rate, frames=Math.ceil((toSample-fromSample)/step);
  let pcm={...raw,samples:raw.samples.subarray(fromSample*raw.channels,toSample*raw.channels)};
  if (step!==1) {
    const reader=api.pcmReader(pcm,0,count(pcm),step), pair=[0,0], samples=new Float64Array(frames*raw.channels);
    for (let i=0;i<frames;i++) {
      reader.read(i*step,pair);
      for (let ch=0;ch<raw.channels;ch++) samples[i*raw.channels+ch]=pair[ch];
    }
    pcm={channels:raw.channels,sampleRate:rate,samples};
  }
  const offset=Math.min(frames-1,Math.round((direct-fromSample)/step));
  return {...target,pcm,frames,offset,
    measurement:{file:target.response,sha256,sampleRate:raw.sampleRate,channels:raw.channels,
      frames:rawFrames,window:{fromSample,toSample},directSample:direct,alignedAtSample:offset,...(capture&&{capture})}};
}

function stereo(pcm,fold=false) {
  const samples=new Float64Array(count(pcm)*2);
  for (let i=0;i<count(pcm);i++) {
    const left=pcm.samples[i*pcm.channels], right=pcm.channels===1?left:pcm.samples[i*2+1];
    if (fold) samples[i*2]=samples[i*2+1]=(left+right)*.5;
    else {samples[i*2]=left;samples[i*2+1]=right;}
  }
  return samples;
}

function build(file,kit) {
  const owner=path.resolve(file), inputs=new Set([owner]), dir=path.dirname(owner), api=kit.KIT.procedural.mediaGraph;
  check(fs.statSync(owner).size<=1024*1024,'Translation plan exceeds its byte budget');
  const raw=JSON.parse(fs.readFileSync(owner,'utf8'));
  check(fields(raw,['format','version','title','mix','targets','cues','thresholds'])&&raw.format===format&&
    raw.version===1&&text(raw.mix),'Expected a version 1 playback translation plan');
  const mixFile=path.resolve(dir,raw.mix), mix=readWav(mixFile,96*1024*1024);
  inputs.add(mixFile);
  const {title,settings,devices,windows}=prepare(raw,mix), {sampleRate}=mix;
  const profiles=devices.map(row=>impulse(row,owner,sampleRate,api,inputs));
  const fft=Metrics.analysis(sampleRate,Math.max(...profiles.map(row=>row.frames)));
  let fftWork=0;
  for (const row of windows) {
    const span=row.toSample-row.fromSample;
    fftWork+=(1+Math.ceil(Math.max(0,span-fft.frames)/(fft.frames/2)))*2*fft.size*Math.log2(fft.size);
  }
  check(fftWork<=160e6,'Cue windows exceed the translation spectrum budget');

  const frameCount=count(mix), outputFrames=frameCount+Math.max(0,...profiles.map(row=>row.frames-1-row.offset));
  check((profiles.length+1)*outputFrames*2<=16000000,'Playback previews exceed their combined sample budget');
  const dry=stereo(mix), folded=profiles.some(row=>row.input==='mono')?stereo(mix,true):null;
  const reference=new Float64Array(outputFrames*2);
  reference.set(dry);
  const previews=new Map([['reference',reference]]);
  let work=0;
  for (const profile of profiles) {
    Object.assign(profile,fft.response(profile.pcm,settings.referenceHz));
    const effect=api.prepareImpulseResponse(profile.id,profile.pcm,sampleRate);
    work+=(frameCount+effect.tail)*effect.cost;
    check(work<=300e6,'Measured-device convolution exceeds its processing budget');
    const output=new Float64Array((frameCount+effect.tail)*2);
    effect.block(profile.input==='mono'?folded:dry,output);
    const samples=new Float64Array(outputFrames*2);
    for (let i=profile.offset*2;i<output.length;i++) samples[i-profile.offset*2]=output[i]*profile.gain;
    previews.set(profile.id,samples);
  }

  const stems=new Map([[mixFile,mix]]);
  let stemSamples=mix.samples.length;
  const cues=windows.map(row=>{
    const filename=row.stem?path.resolve(dir,row.stem):mixFile;
    if (!stems.has(filename)) {
      const stem=readWav(filename,96*1024*1024);
      stemSamples+=stem.samples.length;
      check(stem.sampleRate===sampleRate&&count(stem)===frameCount&&stemSamples<=24000000,
        'Cue stem must match the mix grid and fit the stem budget: '+row.stem);
      stems.set(filename,stem); inputs.add(filename);
    }
    const pcm=stems.get(filename), basis=pcm.sha256===mix.sha256?'mix-window':'isolated-stem';
    const probe=fft.spectrum(pcm,row.fromSample,row.toSample);
    return {...row,basis,rmsDbFS:probe.rmsDbFS,measurements:profiles.map(profile=>fft.measure(probe,profile,settings,basis))};
  });
  const flags=cues.flatMap(cue=>cue.measurements.filter(row=>['bass-risk','needs-isolation'].includes(row.status))
    .map(({target,status})=>({cue:cue.id,target,status})));

  const peakById=new Map([...previews].map(([id,samples])=>[id,api.mixerMonitor.peaks({sampleRate,channels:2,samples})]));
  const highest=Math.max(-1,...[...peakById.values()].map(row=>row.truePeakDbTP??-Infinity));
  const sharedGain=10**((-1-highest)/20);
  const preview=id=>({file:'audio/'+id+'.wav',peakBeforeSharedGain:peakById.get(id)});
  const report={format:format+'-report',version:1,title,sampleRate,sourceFrames:frameCount,frames:outputFrames,
    mix:{file:raw.mix,sha256:mix.sha256},settings,sharedPreviewGainDb:20*Math.log10(sharedGain),
    reference:preview('reference'),
    targets:profiles.map(({id,label,device,input,measurement,calibrationGainDb})=>({
      id,label,device,input,measurement,calibrationGainDb,...preview(id)
    })), cues,flags};
  return {report,previews,inputs:[...inputs],sharedGain};
}

function command(file,opt,kit) {
  check(text(file)&&text(opt.out)&&Object.keys(opt).every(key=>key==='out'),'Use '+usage);
  const directory=path.resolve(opt.out);
  check(!fs.lstatSync(directory,{throwIfNoEntry:false}),'Choose a new directory for playback translation output');
  const {report,previews,inputs,sharedGain}=build(file,kit), stage=stageAt(directory);
  try {
    for (const [id,samples] of previews) {
      if (sharedGain!==1) for (let i=0;i<samples.length;i++) samples[i]*=sharedGain;
      stage.save('audio/'+id+'.wav',WAV.encode({sampleRate:report.sampleRate,channels:2,samples},{encoding:'pcm24'}));
    }
    stage.json('report.json',report);
    const html=fs.readFileSync(path.join(__dirname,'playback-translation.html'),'utf8')
      .replace('/* REPORT */ {}',()=>JSON.stringify(report).replace(/</g,'\\u003c'));
    stage.save('index.html',html);
    check(!fs.lstatSync(directory,{throwIfNoEntry:false}),'Playback translation output was created by another process');
    stage.publish(inputs);
  } finally { stage.close(); }
  process.stdout.write(JSON.stringify({review:'index.html',report:'report.json',targets:report.targets.length,
    bassRisks:report.flags.filter(row=>row.status==='bass-risk').length})+'\n');
}

module.exports={usage,command,build};
