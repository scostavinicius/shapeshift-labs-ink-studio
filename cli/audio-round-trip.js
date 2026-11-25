/* Compare the playable part of a compressed delivery against approved PCM. */
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const WAV = require('./wav.js');
const {decode,maxSamples} = require('./audio-round-trip-decode.js');
const {measureAttacks} = require('./audio-attacks.js');
const {graphOutputs} = require('./graph-outputs.js');

const format='ink-studio/audio-round-trip';
const usage='take approve-audio <plan.json> --out <report.json> [--ffmpeg executable] [--ffprobe executable]';
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(key=>keys.includes(key));
const text=value=>typeof value==='string'&&value.trim()&&value.length<=4096;
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
const check=(condition,message)=>{if (!condition) throw new RangeError(message);};
const stamp=file=>fs.statSync(file,{bigint:true});
const equalFile=(a,b)=>['ino','dev','size','mtimeNs'].every(key=>a[key]===b[key]);
const db=value=>value>0?20*Math.log10(value):null;
const linear=value=>10**(value/20);
const frames=pcm=>pcm.samples.length/pcm.channels;

async function fingerprint(file) {
  const hash=createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

function prepare(raw,source) {
  const frameCount=frames(source), {sampleRate,channels}=source;
  const {audioTrack=0,maxTruePeakDbTP=-1,additionalTrim={},transients=[],loops=[]}=raw;
  check(integer(audioTrack,0,63)&&finite(maxTruePeakDbTP,-30,0)&&
    fields(additionalTrim,['leading','trailing'])&&integer(additionalTrim.leading??0,0,sampleRate*2)&&
    integer(additionalTrim.trailing??0,0,sampleRate*2),'Invalid audio track, true-peak ceiling or additional trim');
  function list(rows,max,make) {
    check(Array.isArray(rows)&&rows.length<=max&&rows.every(row=>id(row?.id))&&
      new Set(rows.map(row=>row.id)).size===rows.length,'Audio approval checks need distinct IDs');
    return rows.map(make);
  }
  let work=0;
  const attacks=list(transients,64,row=>{
    const {id,window,channel='all',toleranceMs=2,minStrength=.035,minPeakDbFS=-42,minRiseDb=6}=row;
    check(fields(row,['id','window','channel','toleranceMs','minStrength','minPeakDbFS','minRiseDb'])&&
      fields(window,['from','to'])&&integer(window.from,0,frameCount-1)&&
      integer(window.to,window.from+1,Math.min(frameCount,window.from+sampleRate*4))&&
      (channel==='mix'||channel==='all'||integer(channel,0,channels-1))&&finite(toleranceMs,0,1000)&&
      finite(minStrength,.000001,100)&&finite(minPeakDbFS,-120,0)&&finite(minRiseDb,0,60),
    'Invalid transient window or thresholds for '+id);
    work+=(window.to-window.from+Math.round(sampleRate*.24))*(channel==='all'?channels:1);
    check(work<=4000000,'Transient windows exceed the approval analysis budget');
    return {id,...window,channel,toleranceMs,minStrength,minPeakDbFS,minRiseDb};
  });
  const seams=list(loops,32,row=>{
    const {id,from=0,to=frameCount,maxJumpErrorDbFS=-40,maxExcessRmsDbFS=-38}=row;
    check(fields(row,['id','from','to','windowSamples','maxJumpErrorDbFS','maxExcessRmsDbFS'])&&
      integer(from,0,frameCount-4)&&integer(to,from+4,frameCount)&&
      finite(maxJumpErrorDbFS,-120,0)&&finite(maxExcessRmsDbFS,-120,0),'Invalid loop region or levels for '+id);
    const maximum=Math.min(8192,Math.floor((to-from)/4));
    const windowSamples=row.windowSamples??Math.min(maximum,Math.round(sampleRate*.005));
    check(integer(windowSamples,1,maximum),'Loop window must fit the seam and adjacent reference windows for '+id);
    return {id,from,to,windowSamples,maxJumpErrorDbFS,maxExcessRmsDbFS};
  });
  return {audioTrack,maxTruePeakDbTP,trim:{leading:additionalTrim.leading??0,trailing:additionalTrim.trailing??0},attacks,seams};
}

function peak(pcm,api,ceiling) {
  const measured=api.peaks(pcm);
  return {...measured,maxTruePeakDbTP:ceiling,passed:measured.truePeakDbTP===null||measured.truePeakDbTP<=ceiling};
}

function transient(spec,source,delivery,api) {
  const reference=measureAttacks(api,source,spec), decoded=measureAttacks(api,delivery,spec);
  const delta=reference.hit&&decoded.hit?decoded.hit.sample-reference.hit.sample:null;
  const deltaMs=delta===null?null:delta*1000/source.sampleRate;
  const status=!reference.hit?'source-'+reference.status:!decoded.hit?'delivery-'+decoded.status:
    Math.abs(deltaMs)>spec.toleranceMs?'shifted':'passed';
  return {...spec,status,deltaSamples:delta,deltaMs,source:reference,delivery:decoded};
}

function seam(spec,source,delivery) {
  const {from,to,windowSamples:w}=spec, {channels}=source, playable=frames(delivery);
  if (to>playable) return {...spec,status:'outside-playable-audio'};
  if (from===0&&to===frames(source)&&to!==playable) return {...spec,status:'file-loop-length-mismatch'};
  function sample(pcm,frame,ch) { return pcm.samples[frame*channels+ch]; }
  const measurements=Array.from({length:channels},(_,channel)=>{
    const error=frame=>sample(delivery,frame,channel)-sample(source,frame,channel);
    let edge=0, interior=0;
    for (let i=0;i<w;i++) {
      edge+=error(from+i)**2+error(to-w+i)**2;
      interior+=error(from+w+i)**2+error(to-2*w+i)**2;
    }
    const boundary=Math.sqrt(edge/(2*w)), inner=Math.sqrt(interior/(2*w));
    const excess=Math.sqrt(Math.max(0,boundary**2-inner**2));
    const start=pcm=>sample(pcm,from,channel), end=pcm=>sample(pcm,to-1,channel);
    const sourceStep=start(source)-end(source), decodedStep=start(delivery)-end(delivery);
    return {channel,sourceStep,decodedStep,jumpError:Math.abs(decodedStep-sourceStep),boundary,inner,excess};
  });
  const maximum=field=>Math.max(...measurements.map(row=>row[field]));
  const jumpError=maximum('jumpError'), boundaryRms=maximum('boundary'), interiorRms=maximum('inner'),
    excessRms=maximum('excess');
  const endpointSteps=measurements.map(({boundary,inner,excess,...row})=>({...row,
    boundaryErrorRmsDbFS:db(boundary),interiorErrorRmsDbFS:db(inner),excessBoundaryRmsDbFS:db(excess)}));
  const problems=[];
  if (jumpError>linear(spec.maxJumpErrorDbFS)) problems.push('endpoint-step');
  if (excessRms>linear(spec.maxExcessRmsDbFS)) problems.push('boundary-distortion');
  return {...spec,status:problems.length?'damaged':'passed',problems,endpointSteps,jumpErrorDbFS:db(jumpError),
    boundaryErrorRmsDbFS:db(boundaryRms),interiorErrorRmsDbFS:db(interiorRms),excessBoundaryRmsDbFS:db(excessRms)};
}

async function analyze(file,{kit,ffmpeg,ffprobe}) {
  const plan=path.resolve(file), folder=path.dirname(plan);
  check(fs.statSync(plan).size<=1024*1024,'Audio approval plan exceeds its byte budget');
  const raw=JSON.parse(fs.readFileSync(plan,'utf8'));
  check(fields(raw,['format','version','source','delivery','audioTrack','additionalTrim','maxTruePeakDbTP','transients','loops'])&&
    raw.format===format&&raw.version===1&&text(raw.source)&&text(raw.delivery),'Expected a version 1 compressed audio approval plan');
  const sourceFile=path.resolve(folder,raw.source), deliveryFile=path.resolve(folder,raw.delivery), before=stamp(deliveryFile);
  check(before.isFile()&&before.size>0n&&before.size<=1024n**3n,'Delivery must be a bounded regular audio file');
  const sourceStat=fs.statSync(sourceFile);
  check(sourceStat.isFile()&&sourceStat.size<=maxSamples*8+65536,'Approved WAV must be a bounded regular file');
  const bytes=fs.readFileSync(sourceFile), source=WAV.decode(bytes,{metadata:true,preserveFloatRange:true});
  check(source.samples.length>0&&source.samples.length<=maxSamples&&integer(source.channels,1,8)&&
    integer(source.sampleRate,8000,192000),'Approved WAV needs 1–8 channels at 8000–192000 Hz within the sample budget');
  const settings=prepare(raw,source);
  const delivery=await decode(deliveryFile,settings.audioTrack,settings.trim,{ffmpeg,ffprobe});
  check(delivery.sampleRate===source.sampleRate&&delivery.channels===source.channels,
    'Delivery audio sample rate and channel count must match the approved WAV');
  const sha256=await fingerprint(deliveryFile);
  check(equalFile(before,stamp(deliveryFile)),'Delivery audio changed during approval');
  const P=kit.KIT.procedural;
  const sourcePeak=peak(source,P.mediaGraph.mixerMonitor,settings.maxTruePeakDbTP);
  const deliveryPeak=peak(delivery,P.mediaGraph.mixerMonitor,settings.maxTruePeakDbTP);
  const transientChecks=settings.attacks.map(row=>transient(row,source,delivery,P.mediaGraph));
  const loopChecks=settings.seams.map(row=>seam(row,source,delivery));
  const frameDelta=frames(delivery)-frames(source), flags=[], unchecked=[];
  if (frameDelta!==0) flags.push({kind:'playable-length',deltaSamples:frameDelta});
  if (!deliveryPeak.passed) flags.push({kind:'true-peak',truePeakDbTP:deliveryPeak.truePeakDbTP});
  for (const row of transientChecks) {
    if (row.status==='passed') continue;
    const list=row.status.startsWith('source-')?unchecked:flags;
    list.push({kind:'transient',id:row.id,status:row.status});
  }
  for (const row of loopChecks) if (row.status!=='passed') flags.push({kind:'loop-seam',id:row.id,status:row.status});
  const status=flags.length?'flagged':unchecked.length?'inconclusive':'approved';
  return {inputs:[plan,sourceFile,deliveryFile],report:{format:format+'-report',version:1,status,
    source:{file:raw.source,frames:frames(source),sha256:createHash('sha256').update(bytes).digest('hex'),
      ...(source.bwf&&{timeReference:source.bwf.timeReference}),peak:sourcePeak},
    delivery:{file:raw.delivery,sha256,...delivery.info,peak:deliveryPeak},
    sampleRate:source.sampleRate,channels:source.channels,frameDelta,
    transients:transientChecks,loops:loopChecks,flags,unchecked}};
}

async function command(file,opt,{kit}) {
  check(text(file)&&text(opt.out)&&Object.entries(opt).every(([key,value])=>
    ['out','ffmpeg','ffprobe'].includes(key)&&text(value)),'Use '+usage);
  const {inputs,report}=await analyze(file,{kit,ffmpeg:opt.ffmpeg,ffprobe:opt.ffprobe});
  const target=path.resolve(opt.out);
  graphOutputs(inputs).write(path.dirname(target),[{file:path.basename(target),document:report}]);
  process.stdout.write(JSON.stringify({status:report.status,report:target,flags:report.flags.length})+'\n');
  if (report.status!=='approved') process.exitCode=2;
}

module.exports={analyze,command,usage};
