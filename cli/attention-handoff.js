/* Audition native editorial nudges on one picture and sample grid. */
const fs=require('node:fs'), path=require('node:path');
const {createHash}=require('node:crypto');
const PNG=require('./png.js'),WAV=require('./wav.js'),{write,json}=require('./asset-files.js');
const {readTakePicture}=require('./take-picture.js');
const {readEditorialProject}=require('./music-editorial.js');

const format='ink-studio/attention-handoff',reportFormat='ink-studio/attention-handoff-report';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function build(file,kit){
  const P=kit.KIT.procedural,T=P.takeTime,E=P.mediaGraph.audioEditorial;
  const {fields,id,finite,integer,check}=P.musicInstruments;
  const owner=path.resolve(file), recipe=read(owner), inputs=new Set([owner]);
  const text=value=>typeof value==='string' && value.trim() && value.length<=96;
  check(fields(recipe,['format','version','id','editorial','picture','window','reveal','clip','variants']) &&
    recipe.format===format && recipe.version===1 && id(recipe.id) && id(recipe.clip) &&
    typeof recipe.editorial==='string' && recipe.editorial.trim() &&
    Array.isArray(recipe.variants) && integer(recipe.variants.length,2,8),
  'Expected a version 1 attention handoff with two to eight timing variants');
  const {fps,rate,firstFrame,frames}=readTakePicture(recipe.picture,owner,kit,file=>inputs.add(file));
  const endFrame=firstFrame+frames.length, window=recipe.window ?? {from:firstFrame,to:endFrame};
  check(fields(window,['from','to']) && integer(window.from,firstFrame,endFrame-1) &&
    integer(window.to,window.from+1,Math.min(endFrame,window.from+360)) &&
    (window.to-window.from)/T.seconds(rate)<=15,
  'Choose a picture excerpt up to 360 frames and 15 seconds');
  const {from,to}=window, reveal=recipe.reveal;
  check(fields(reveal,['frame','label']) && integer(reveal.frame,from,to-1) &&
    (reveal.label===undefined || text(reveal.label)),'Mark a reveal frame inside the audition window');

  const project=path.resolve(path.dirname(owner),recipe.editorial);
  inputs.add(project);
  const {session,assets,paths}=readEditorialProject(project,P);
  for(const name of Object.values(paths))inputs.add(path.resolve(path.dirname(project),name));
  const baseline=E.prepare(session,assets), clip=baseline.clips.find(row=>row.id===recipe.clip);
  check(clip?.range && !baseline.unresolved.length,'Choose a resolved editorial clip in a fully spotted project');
  const {sampleRate}=session, startFrame=session.picture.startFrame??0;
  const end=startFrame+session.picture.shots.reduce((sum,shot)=>sum+shot.frames,0);
  check(T.compare(T.read(session.picture.fps),rate)===0 && from>=startFrame && to<=end,
    'The audition window must fit both picture and editorial on the same frame grid');
  const clock=kit.KIT.timeDomains.take({fps,sampleRate});
  const origin=clock.at(startFrame).firstSample, start=clock.at(from).firstSample;
  const length=clock.at(to).firstSample-start, visualSample=clock.at(reveal.frame).firstSample;
  check(recipe.variants.length*length*2<=16e6,'Audio variants exceed the audition sample budget');

  const offsetOrigin=start-origin, available=new Set(), unique=new Set();
  const sampleDelta=ms=>T.index(T.roundDown(T.add(T.div(T.mul(T.read(ms),T.read(sampleRate)),T.read(1000)),T.read(.5))));
  const specs=Array.from(recipe.variants,row=>{
    check(fields(row,['id','offsetMs','label']) && id(row.id) && !available.has(row.id) &&
      finite(row.offsetMs,-15000,15000) && (row.label===undefined || text(row.label)),'Invalid handoff timing variant');
    const delta=sampleDelta(row.offsetMs), syncSample=visualSample+delta;
    check(syncSample>=start && syncSample<start+length,'Move the audition window to include '+row.id+' sound cue');
    check(!unique.has(syncSample),'Two handoff variants land on the same audio sample');
    unique.add(syncSample);
    available.add(row.id);
    const original=clip.spot.anchorSample??clip.spot.sample;
    const offsetSamples=syncSample-origin-original;
    check(integer(offsetSamples,-1e9,1e9),'Handoff nudge exceeds the editorial sample range');
    return {...row,delta,syncSample,offsetSamples};
  });

  // Print the stationary tracks once. Each variant uses the same source sync,
  // head and tail, and gains as the original editorial clip.
  const stationary=E.prepare({...session,clips:session.clips.filter(row=>row.id!==recipe.clip)},assets);
  const bed=new Float64Array(length*2);
  stationary.write(bed,offsetOrigin,offsetOrigin+length);
  const source=session.clips.find(row=>row.id===recipe.clip);
  let peak=0;
  const variants=specs.map(row=>{
    const {id,delta,syncSample,offsetSamples,offsetMs,label}=row;
    const nudge={op:'nudge',clip:recipe.clip,offsetSamples};
    const shifted=E.prepare({...session,clips:[{...source,offsetSamples}]},assets);
    const [moved]=shifted.clips;
    check(moved?.spot.sample===syncSample-origin,'Handoff variant does not resolve on the editorial sample grid');
    const samples=bed.slice();
    shifted.write(samples,offsetOrigin,offsetOrigin+length);
    for(const value of samples){
      check(Number.isFinite(value),'Handoff mix contains nonfinite audio');
      peak=Math.max(peak,Math.abs(value));
    }
    const record={id,label:label??id,requestedMs:offsetMs,offsetMs:delta/sampleRate*1000,
      syncSample,localSample:syncSample-start,
      clipped:{head:Math.max(0,offsetOrigin-moved.spot.sample-moved.source.first),
        tail:Math.max(0,moved.spot.sample+moved.source.last-offsetOrigin-length)},
      edit:nudge,wav:id+'.wav',edits:id+'.edit.json'};
    return {report:record,samples};
  });

  const headroom=1/Math.max(1,peak), audio=[];
  for(const {report,samples} of variants){
    if(headroom<1)for(let i=0;i<samples.length;i++)samples[i]*=headroom;
    const bytes=WAV.encode({sampleRate,channels:2,samples},{encoding:'pcm24',bwf:{
      description:recipe.id+' / '+report.id,timeReference:start}});
    report.sha256=hash(bytes);
    audio.push(bytes);
  }
  let pixels=0, bytes=audio.reduce((sum,item)=>sum+item.length,0), size;
  const picture=frames.slice(from-firstFrame,to-firstFrame).map(file=>{
    bytes+=fs.statSync(file).size;
    check(bytes<=32*1024*1024,'Embedded review media exceeds 32 MiB. Use a shorter or smaller preview.');
    const data=fs.readFileSync(file), {w,h}=PNG.layout(data);
    pixels+=w*h;
    check(pixels<=68e6,'Review exceeds its decoded picture budget. Use a shorter or smaller preview.');
    size??=[w,h];
    check(w===size[0] && h===size[1],'Audition picture frames must have constant dimensions');
    return data;
  });
  const report={format:reportFormat,version:1,id:recipe.id,fps:T.pack(rate),sampleRate,
    window:{from,to,firstSample:start,endSample:start+length,frames:to-from},picture:{size,
      sha256:hash(picture.map(hash).join(''))},
    reveal:{frame:reveal.frame,label:reveal.label??'Picture reveal',sample:visualSample,localFrame:reveal.frame-from,
      localSample:visualSample-start},clip:recipe.clip,headroom,variants:variants.map(row=>row.report)};
  return {report,picture,audio,inputs};
}

function command(file,opt,{kit}){
  if(typeof opt.out!=='string' || !opt.out.trim() || Object.keys(opt).some(key=>key!=='out'))
    throw new TypeError('Use take audition-handoff <recipe.json> --out directory');
  const {report,picture,audio,inputs}=build(file,kit), folder=path.resolve(opt.out);
  const targets=['review.html','report.json',...report.variants.flatMap(row=>[row.wav,row.edits])].map(file=>path.join(folder,file));
  for(const file of targets){
    const stat=fs.statSync(file,{throwIfNoEntry:false});
    if(inputs.has(file) || stat && [...inputs].some(source=>{
      const other=fs.statSync(source,{throwIfNoEntry:false});
      return other?.dev===stat.dev && other?.ino===stat.ino;
    }))throw new RangeError('Handoff outputs must be separate from the source take and editorial project');
  }
  const media=list=>list.map(bytes=>bytes.toString('base64'));
  const serial=value=>JSON.stringify(value).replace(/</g,'\\u003c');
  const html=fs.readFileSync(path.join(__dirname,'attention-handoff-review.html'),'utf8')
    .replace('/* REPORT */ {}',()=>serial(report))
    .replace('/* PICTURE */ []',()=>serial(media(picture)))
    .replace('/* AUDIO */ []',()=>serial(media(audio)));
  for(const [index,variant] of report.variants.entries()){
    write(path.join(folder,variant.wav),audio[index]);
    json(path.join(folder,variant.edits),[variant.edit]);
  }
  json(targets[1],report);
  write(targets[0],html);
  process.stdout.write(JSON.stringify({review:targets[0],report:targets[1],variants:report.variants.length})+'\n');
}

module.exports={build,command};
