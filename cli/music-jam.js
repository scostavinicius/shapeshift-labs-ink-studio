/* Editable source archives and ordinary audio prints from pinned jams. */
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const WAV=require('./wav.js'),{write,json,publishJson}=require('./asset-files.js');
const {openSampleLibrary}=require('./sample-library.js');
const {publishAudioPrint}=require('./audio-print.js');
const {resolveSampleAssets}=require('./music-sample-assets.js');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const manifestBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const variants=['dry','wet'];
const fingerprint=/^[a-f0-9]{64}$/;
const assetFile=hash=>'assets/'+hash+'.wav';
const output=value=>{process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;};

function unpackProject(document,{record,id,check}) {
  const {assets,...source}=document ?? {};
  check(record(assets) && Object.keys(assets).length<=512 && Object.keys(assets).every(id),
    'A jam project needs a table of audio asset references');
  return {source,refs:assets};
}

function rebasePaths(refs,file,out) {
  const relative=name=>path.relative(path.dirname(path.resolve(out)),path.resolve(path.dirname(file),name));
  return Object.fromEntries(Object.entries(refs).map(([key,ref])=>{
    if (typeof ref==='string') return [key,relative(ref)];
    const field=['wav','edit','print'].find(name=>typeof ref?.[name]==='string');
    return [key,field ? {...ref,[field]:relative(ref[field])} : ref];
  }));
}

function archive(source,assets) {
  const blobs=new Map(), encoded=new Map();
  const references=Object.fromEntries(Object.entries(assets).sort(([a],[b])=>a<b ? -1 : 1).map(([name,pcm])=>{
    if (!encoded.has(pcm)) {
      const bytes=WAV.encode(pcm,{encoding:'float64'}), hash=sha(bytes);
      blobs.set(assetFile(hash),bytes);
      encoded.set(pcm,hash);
    }
    const sha256=encoded.get(pcm);
    return [name,{wav:assetFile(sha256),sha256}];
  }));
  const snapshot={...source,assets:references};
  return {snapshot,blobs,digest:sha(manifestBytes(snapshot))};
}

function writeArchive(folder,{snapshot,blobs}) {
  for (const [name,bytes] of blobs) {
    const target=path.join(folder,name);
    if (!fs.existsSync(target)) write(target,bytes);
    else if (fs.statSync(target).size!==bytes.length || sha(fs.readFileSync(target))!==sha(bytes))
      throw new RangeError('Archived jam asset has changed');
  }
  const manifest=path.join(folder,'jam.json');
  publishJson(manifest,snapshot,'An archived jam project already exists with different content');
  return manifest;
}

function recover(directory,entry,folder,P) {
  const {check,fields}=P.musicInstruments, {resamplingJam}=P.mediaGraph;
  const digest=entry.print?.projectHash, reference=entry.source.reference;
  const selection=entry.print?.inputs?.selection;
  check(typeof digest==='string' && fingerprint.test(digest) && reference==='jams/'+digest+'/jam.json' &&
    entry.print?.target?.output==='jam-'+entry.print?.take && selection,'This sample does not reference an editable jam print');
  const original=path.resolve(directory,reference);
  check(fs.statSync(original).size<=5e6,'Archived jam manifest exceeds its byte budget');
  const bytes=fs.readFileSync(original);
  check(sha(bytes)===digest,'Archived jam project hash does not match its print');
  const {source,refs}=unpackProject(JSON.parse(bytes),P.musicInstruments);
  resamplingJam.validate(source);
  const blobs=new Map();
  let bytesRead=0;
  for (const ref of Object.values(refs)) {
    check(fields(ref,['wav','sha256']) && typeof ref.sha256==='string' && fingerprint.test(ref.sha256) &&
      ref.wav===assetFile(ref.sha256),'Invalid archived jam asset reference');
    if (blobs.has(ref.wav)) continue;
    const input=path.resolve(path.dirname(original),ref.wav), size=fs.statSync(input).size;
    bytesRead+=size;
    check(size<=WAV.maxBytes && bytesRead<=WAV.maxBytes+512*128,'Archived jam audio exceeds its byte budget');
    const pcm=fs.readFileSync(input);
    check(sha(pcm)===ref.sha256,'Archived jam audio hash does not match its print');
    blobs.set(ref.wav,pcm);
  }
  const file=writeArchive(folder,{snapshot:{...source,assets:refs},blobs});
  const edit=path.join(folder,'selection.json');
  publishJson(edit,selection,'This workspace already has a different jam selection');
  return {project:file,selection:edit,original};
}

function keep(directory,library,source,assets,origins,settings,folder,P) {
  const A=P.mediaGraph,{fields,check}=P.musicInstruments;
  check(fields(settings,['branch','range','sample','takes','markers','note']) &&
    fields(settings.sample,['id','label','material','articulation','pitch','license','tags']) &&
    (settings.note===undefined || typeof settings.note==='string' && settings.note.length<=512),
  'A jam print needs catalog sample metadata and an optional branch, range, markers and note');
  const {branch='source',takes=['wet'],note,markers=[],sample}=settings;
  check(Array.isArray(takes) && takes.length>=1 && takes.length<=2 && Array.from(takes).every(name=>variants.includes(name)) &&
    new Set(takes).size===takes.length,'A jam print takes dry, wet or both');
  const playback=A.resamplingJam.render(source,assets,{branch}), {report}=playback;
  const saved=archive(source,assets), reference='jams/'+saved.digest+'/jam.json';
  const sources=Object.fromEntries(takes.map(take=>[take,take==='dry' ? playback.dry : playback.value]));
  const range=settings.range ?? {};
  const selection={branch,takes,sample,range,markers,...(note!==undefined && {note})};
  const traceAssets=Object.fromEntries(Object.entries(saved.snapshot.assets).map(([name,ref])=>
    [name,{...ref,original:origins[name]}]));
  const traces=Object.fromEntries(takes.map(take=>[take,{
    target:{output:'jam-'+take}, chain:[{op:'music.renderResamplingJam',branch}],
    inputs:{selection,state:report.branch}, assets:traceAssets
  }]));
  const prepared=A.audioPrint.prepare(sources,{sample,range,markers,projectHash:saved.digest,source:{reference},traces});
  const retained=writeArchive(path.dirname(path.resolve(directory,reference)),saved);
  const project=writeArchive(path.join(folder,'source'),saved);
  const selectionFile=path.join(folder,'source','selection.json');
  publishJson(selectionFile,selection,'This workspace already has a different jam selection');
  const print=publishAudioPrint(prepared,folder,library,A);
  const passage=report.events.filter(row=>row.at>=print.firstSample && row.at<print.endSample);
  const reportFile=path.join(folder,'jam-print.json');
  json(reportFile,{...print,branch:report.branch,events:passage,project:'source/jam.json',selection:'source/selection.json'});
  return {...print,project,selection:selectionFile,retained,report:reportFile};
}

module.exports=function command(args,opt,kit) {
  const [mode,directory,file,settingsFile]=args, P=kit.KIT.procedural, A=P.mediaGraph, J=A.resamplingJam;
  const project=target=>unpackProject(read(target),P.musicInstruments);
  if (mode==='inspect' && directory) return output(J.inspect(project(directory).source));
  if (mode==='branch' && directory && file && typeof opt.out==='string') {
    P.musicInstruments.check(path.resolve(opt.out)!==path.resolve(file),'Choose a separate output for the branched jam');
    const {source,refs}=project(directory), result=J.branch(source,read(file));
    json(opt.out,{...result.value,assets:rebasePaths(refs,directory,opt.out)});
    return output({project:path.resolve(opt.out),added:result.added});
  }
  if (!directory || !file || typeof opt.out!=='string' ||
      !['render','audition','keep','recover'].includes(mode) || mode!=='recover' && !settingsFile)
    throw new TypeError('Use music jam branch, inspect, render, audition, keep or recover with the required files and --out');
  const folder=path.resolve(opt.out), library=openSampleLibrary(directory,{kit});
  if (mode==='recover') return output(recover(directory,library.get(file).entry,folder,P));
  const {source:raw,refs}=project(file), source=J.validate(raw), settings=read(settingsFile);
  const {assets,sources}=resolveSampleAssets(refs,file,library,kit,{allowWav:true});
  if (mode==='keep') return output(keep(directory,library,source,assets,sources,settings,folder,P));
  const result=J[mode](source,assets,settings);
  const audio=path.join(folder,mode==='render' ? 'wet.wav' : 'audition.wav');
  const report=path.join(folder,'report.json');
  write(audio,WAV.encode(result.value,{encoding:'pcm24'}));
  const extra={};
  if (result.dry) {
    extra.dry=path.join(folder,'dry.wav');
    write(extra.dry,WAV.encode(result.dry,{encoding:'pcm24'}));
  }
  json(report,result.report);
  return output({audio,report,...extra});
};
