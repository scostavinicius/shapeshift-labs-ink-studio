/* Capture simulation and native render measurements for the same sound plan. */
const fs=require('node:fs'),path=require('node:path');
const {createSceneSampler}=require('./graph-render.js');
const {embedModels}=require('./simulation-model-files.js');

const runFormat='ink-studio/motion-sound-run';
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;

function captureRender(kit,world,source,onFrame){
  const K=kit.KIT,W=K.world,T=K.procedural.takeTime,S=W.soundMeasurements,{check,id,record}=W.data;
  const {fields}=W.boundarySignals;
  check(fields(source,['clock','firstFrame','frames','options','camera','measures'])&&
    record(source.measures)&&integer(Object.keys(source.measures).length,1,32)&&Object.keys(source.measures).every(id),
  'Render sound capture needs named measurements');
  const {clock={},firstFrame=0,frames,options={},camera}=source;
  check(record(options)&&['time','motionFrom','partMotionHistory','surfaceMotionFrom'].every(key=>options[key]===undefined),
    'Render sound capture owns picture timing and motion history');
  const {width=128,height=128}=options;
  const measures=Object.entries(source.measures).map(([name,options])=>({
    name,model:W.renderSoundMeasurements.prepare(options),points:[]
  }));
  check(integer(firstFrame,0,1000000000)&&
    integer(frames,1,2048)&&firstFrame+frames<=1000000000&&integer(width,1,2048)&&integer(height,1,2048)&&
    width*height<=1048576&&width*height*frames*measures.length<=240000000,
  'Render sound capture exceeds its frame or pixel budget');
  const takeClock=T.create(clock), sample=createSceneSampler(kit);
  check(takeClock.at(firstFrame+frames-1).start<=3600,'Render sound capture exceeds its time range');
  const channels=[...new Set(measures.flatMap(({model})=>model.channels))];
  let sequence={}, previous;
  for(let i=0;i<frames;i++){
    const take=takeClock.at(firstFrame+i), {start}=T.requireFrame(take);
    if(take.cut)sequence={};
    const cut=take.cut, interval=previous===undefined||cut?undefined:T.seconds(T.sub(start,previous)), at=S.pack(start);
    const result=sample(world,{sequence,take,channels,options,camera});
    for(const {model,points} of measures)points.push(model.measure(result.frame,{at,cut,interval}));
    onFrame?.(result,take);
    previous=start;
  }
  return Object.fromEntries(measures.map(({name,model,points})=>[name,S.series(model.unit,points)]));
}

function run(kit,request,file,{build,dependency=()=>{}}={}){
  const K=kit.KIT,W=K.world,S=W.soundMeasurements,{check,id,record}=W.data,{fields}=W.boundarySignals;
  check(fields(request,['format','version','plan','sources'])&&request.format===runFormat&&request.version===1&&
    record(request.sources)&&integer(Object.keys(request.sources).length,1,32)&&Object.keys(request.sources).every(id),
  'Expected a version 1 motion sound run');
  const owner=path.resolve(file), files=new Map(), measurements=Object.create(null);
  function resolve(reference){
    check(typeof reference==='string'&&reference.length&&!path.isAbsolute(reference)&&!path.win32.isAbsolute(reference),
      'Motion sound asset paths must be relative to the run file');
    const filename=path.resolve(path.dirname(owner),reference);
    dependency(filename);
    return filename;
  }
  function read(value){
    if(typeof value!=='string')return {value,file:owner};
    const filename=resolve(value);
    if(!files.has(filename))files.set(filename,{value:JSON.parse(fs.readFileSync(filename,'utf8')),file:filename});
    return files.get(filename);
  }
  const contact=require('./contact-exciter.js'), sensors=require('./virtual-sensors.js');
  const rendered=new Map();
  function trace(file,format,runner){
    const entry=read(file);
    if(entry.value?.format!==format)return entry.value;
    if(!rendered.has(entry))rendered.set(entry,runner.run(kit,entry.value,entry.file,dependency));
    return rendered.get(entry);
  }
  const keys={
    render:['scene','clock','firstFrame','frames','options','camera'],
    world:['file','steps','every','checkpoint'],contacts:['file'],sensors:['file'],rows:['file'],tracks:['file']
  };
  for(const [group,source] of Object.entries(request.sources)){
    const {kind,measures}=source??{};
    check(Object.hasOwn(keys,kind)&&fields(source,['kind','measures',...keys[kind]])&&record(measures)&&
      integer(Object.keys(measures).length,1,32)&&Object.keys(measures).every(id),'Invalid motion sound source '+group);
    for(const name of Object.keys(measures))
      check(!Object.hasOwn(measurements,name),'Duplicate sound measurement '+name);
    let tracks;
    if(kind==='render'){
      const {scene,...settings}=source;
      delete settings.kind;
      check(typeof build==='function','Render sound capture needs a scene loader');
      tracks=captureRender(kit,build(resolve(scene)),settings);
    }else if(kind==='world'){
      const raw=read(source.file), checkpoint=read(source.checkpoint).value;
      const document=embedModels(raw.value??checkpoint?.world,raw.file,dependency);
      const world=document?.format===W.models.format?W.models.compile(document):document;
      tracks=S.world(W.runtime.create(world,{checkpoint}),measures,{steps:source.steps,every:source.every});
    }else if(kind==='contacts'){
      const native=trace(source.file,W.contactExciters.runFormat,contact);
      tracks=Object.fromEntries(Object.entries(measures).map(([name,options])=>[name,S.contacts(native,options)]));
    }else if(kind==='sensors'){
      const native=trace(source.file,W.virtualSensors.runFormat,sensors);
      tracks=Object.fromEntries(Object.entries(measures).map(([name,sensor])=>[name,S.sensor(native,sensor)]));
    }else{
      const raw=read(source.file).value;
      tracks=Object.fromEntries(Object.entries(measures).map(([name,options])=>{
        if(kind==='rows')return [name,S.rows(raw,options)];
        check(typeof options==='string'&&raw&&Object.hasOwn(raw,options),'Unknown saved sound measurement '+options);
        return [name,raw[options]];
      }));
    }
    Object.assign(measurements,tracks);
    check(Object.keys(measurements).length<=128,'Motion sound run exceeds its measurement budget');
  }
  return W.motionSound.compile(read(request.plan).value,measurements);
}

module.exports={runFormat,run,captureRender};
