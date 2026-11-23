/* Produce one synchronized reference/candidate review directory. */
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const WAV=require('./wav.js'),{write,json}=require('./asset-files.js'),{plot}=require('./aligned-review-plots.js');
const {sourceResolver}=require('./simulation-measurements.js'),{readGraphProject}=require('./graph-project.js');
const format='ink-studio/aligned-simulation-review',sides=['reference','candidate'];
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;

function buildAudio(W,review,options,side){
  const {check,own}=W.data,{fields}=W.boundarySignals, {tracks,gain}=options;
  const {sampleRate,startSample,endSample}=review.report.clock;
  check(fields(options,['tracks','gain'])&&Array.isArray(tracks)&&tracks.length>=1&&tracks.length<=8&&
    new Set(tracks).size===tracks.length&&Array.from(tracks).every(name=>own(review[side].traces,name))&&
    Number.isFinite(gain)&&gain>0,'Review audio needs one to eight named traces and a shared positive gain');
  const channels=tracks.length, frames=endSample-startSample;
  check(sampleRate<=192000&&frames>0&&frames*channels<=8000000,'Review audio needs a bounded, nonempty take sample range');
  const samples=new Float64Array(frames*channels), missing={};
  for(const [channel,name] of tracks.entries()){
    const trace=review[side].traces[name];
    check(trace.sampleRate===sampleRate,'Review audio track '+name+' needs the take sample rate');
    const start=trace.startSample-startSample, values=trace.channels[name].samples;
    for(let i=0;i<values.length;i++){
      const value=values[i]*gain;
      check(Number.isFinite(value)&&Math.abs(value)<=1,'Review WAV clipping on '+name+'. Lower the shared audio gain');
      samples[(start+i)*channels+channel]=value;
    }
    missing[name]=frames-values.length;
  }
  const audio={sampleRate,channels,samples}, summary={tracks,gain,sampleRate,startSample,endSample,frames,channels,zeroPadded:missing};
  const bytes=WAV.encode(audio,{encoding:'pcm24',bwf:{description:review.report.id+' / '+side,timeReference:startSample}});
  return {audio,startSample,summary,bytes};
}

function renderPictures(kit,picture,settings,review,graph,pcm,append){
  const W=kit.KIT.world,{check,id,record,own}=W.data,{fields}=W.boundarySignals;
  check(fields(picture,['graph','output','format','warmup','bindings','controlsInput','inputs','seed','renderOptions'])&&
    id(picture.output)&&['frames','both'].includes(picture.format??'frames'),'Review picture needs a named graph output and PNG format');
  const {output,format='frames',warmup=0,bindings={},controlsInput='controls',inputs,seed,renderOptions}=picture;
  const {clock,from=0,to}=settings;
  check(integer(warmup,0,3600)&&to-Math.max(0,from-warmup)<=3600&&id(controlsInput)&&record(bindings)&&
    (inputs===undefined||record(inputs))&&Object.keys(bindings).length*(to-Math.max(0,from-warmup))<=200000&&
    Object.values(bindings).every(row=>['trace','audio'].includes(row?.source?.kind)),
  'Review cutaway needs bounded warm-up and trace or audio controls');
  const controlled=Object.keys(bindings).length>0;
  check(!controlled||graph.plan().inputs[controlsInput]?.type==='record'&&!own(inputs,controlsInput),
    'Declare an exclusive record-type review graph input named '+controlsInput);
  const views={};
  for(const side of sides){
    const controls=W.pictureSignals.prepare(bindings,{traces:review[side].pictureTraces,
      audio:pcm[side]?{mix:{audio:pcm[side].audio,startSample:pcm[side].startSample}}:{}});
    const measurements=new Map(), options={output,format,from,to,warmup,clock,inputs,seed,renderOptions};
    const clip=controlled?graph.clip(options,{frameInputs(frame){
      const sample=controls.sample(frame);
      if(frame.frame>=from)measurements.set(frame.frame,sample);
      return {[controlsInput]:sample.values};
    }}):graph.clip(options);
    for(const item of clip.artifacts)append(side+'/'+item.file,item.bytes);
    const {frames,animation,...summary}=clip.report;
    views[side]={...summary,frames:frames.map((row,i)=>({...row,file:side+'/'+row.file,
      endSample:review.frames[i].endSample,...(controlled&&{controls:measurements.get(row.frame).values,
        measurements:measurements.get(row.frame).report})})),
      ...(animation&&{animation:{...animation,file:side+'/'+animation.file}})};
  }
  const a=views.reference.frames,b=views.candidate.frames;
  check(a.length===b.length&&a.every((row,i)=>row.width===b[i].width&&row.height===b[i].height&&row.frame===b[i].frame&&
    row.firstSample===b[i].firstSample&&row.endSample===b[i].endSample),'Review cutaways need matching art dimensions and frame addresses');
  return views;
}

function build(kit,request,file){
  const W=kit.KIT.world,{check}=W.data,{fields}=W.boundarySignals;
  check(fields(request,['format','version','id','clock','from','to','reference','candidate','traces','events','audio','picture'])&&
    request.format===format&&request.version===1,'Expected a version 1 aligned simulation review recipe');
  const owner=path.resolve(file), paths=new Set([owner]), dependency=file=>paths.add(file);
  const {format:ignored,version,reference,candidate,audio,picture,...settings}=request;
  const io=sourceResolver(kit,owner,dependency);
  const review=W.alignedReview.compare(settings,{reference:io.sources(reference),candidate:io.sources(candidate)});
  const artifacts=[], used=new Set(), pcm={};
  let byteCount=0;
  function append(file,bytes){
    const key=file.toLowerCase();
    check(!used.has(key),'Duplicate review artifact '+file);
    used.add(key);
    byteCount+=bytes.length;
    check(byteCount<=256*1024*1024,'Review exceeds its encoded artifact byte budget');
    const meta={file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    artifacts.push({file,bytes});
    return meta;
  }
  const jsonBytes=value=>Buffer.from(JSON.stringify(value)+'\n');
  const {report}=review;
  for(const kind of ['traces','events'])for(const [name,meta] of Object.entries(report[kind])){
    for(const side of sides){
      let data=review[side][kind][name];
      if(kind==='traces'){
        const {unit,samples}=data.channels[name];
        data={...data,channels:{[name]:{unit,samples:Array.from(samples)}}};
      }
      Object.assign(meta[side],append(side+'/'+kind+'/'+name+'.json',jsonBytes(data)));
    }
    meta.plot=append('plots/'+kind+'/'+name+'.png',plot(kit,review,kind,name));
  }
  if(audio!==undefined){
    check(audio!==null&&typeof audio==='object'&&!Array.isArray(audio),'Invalid review audio options');
    report.audio={};
    for(const side of sides){
      const result=buildAudio(W,review,audio,side);
      pcm[side]=result;
      report.audio[side]={...result.summary,...append(side+'/audio.wav',result.bytes)};
    }
  }
  if(picture!==undefined){
    check(typeof picture?.graph==='string'&&picture.graph.length>0,'Review cutaway needs a shared graph file');
    const source=io.load(picture.graph);
    const graph=readGraphProject(source.file,{kit});
    try{
      for(const asset of graph.sourceFiles())dependency(asset);
      report.picture=renderPictures(kit,picture,settings,review,graph,pcm,append);
      report.passed=report.passed&&sides.every(side=>report.picture[side].passed);
    }finally{graph.clear();}
  }
  function focus(finding,file){
    const {kind,track,frame}=finding;
    return {frame,plot:append(file,plot(kit,review,kind==='sample'?'traces':'events',track,true)),
      ...(report.picture&&Object.fromEntries(sides.map(side=>[side,report.picture[side].frames[frame-report.clock.from].file])))};
  }
  if(report.first){
    report.focus=focus(report.first,'plots/focus.png');
    const alternate=report.first.kind==='sample'?report.firstEvent:report.firstSample;
    if(alternate)report.focus[alternate.kind]=focus(alternate,'plots/first-'+alternate.kind+'.png');
  }
  return {report,artifacts,paths:[...paths]};
}

function actual(filename){
  if(fs.existsSync(filename))return fs.realpathSync(filename);
  const parent=path.dirname(filename);
  return parent===filename?filename:path.join(actual(parent),path.basename(filename));
}

function command(kit,file,opt){
  if(typeof file!=='string'||typeof opt.out!=='string'||!opt.out.trim()||
    Object.keys(opt).some(key=>key!=='out'&&key!=='require-match')||
    opt['require-match']!==undefined&&opt['require-match']!==true)
    throw TypeError('Use sim review <recipe.json> --out directory [--require-match]');
  const request=JSON.parse(fs.readFileSync(file,'utf8')), {report,artifacts,paths}=build(kit,request,file);
  const directory=path.resolve(opt.out), manifest=path.join(directory,'review.json');
  const normalized=filename=>actual(filename).toLowerCase(), dependencies=new Set(paths.map(normalized));
  const targets=[manifest,...artifacts.map(item=>path.join(directory,item.file))].map(normalized);
  if(new Set(targets).size!==targets.length||targets.some(target=>dependencies.has(target)))
    throw RangeError('Review artifacts must be separate from their source assets and each other');
  for(const item of artifacts)write(path.join(directory,item.file),item.bytes);
  json(manifest,report);
  if(opt['require-match']&&!report.passed)process.exitCode=2;
}

module.exports={format,build,command};
