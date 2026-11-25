const fs=require('node:fs');
const path=require('node:path');
const capture=require('../src/room-impulse-capture.js');
const WAV=require('./wav.js');
const {write,json}=require('./asset-files.js');

const usage=[
  'room-impulse sweep --out sweep.wav [--rate 48000 --seconds 3 --tail 2 --gain 0.2]',
  'room-impulse measure recording.wav (--loopback loopback.wav | --latency-ms MS) --out DIR',
  'room-impulse split room-impulse.json --out DIR'
];
const outputWav=(file,pcm)=>write(file,WAV.encode(pcm,{encoding:'float32'}));
const number=(value,name)=>{
  if(typeof value!=='string'||!value.trim()||!Number.isFinite(Number(value)))throw new TypeError('Expected a number for --'+name);
  return Number(value);
};
const settings=opt=>Object.fromEntries(Object.entries({rate:'sampleRate',seconds:'seconds',tail:'tail',lead:'lead',
  'start-hz':'startHz','end-hz':'endHz',gain:'gain'}).filter(([name])=>opt[name]!==undefined)
  .map(([name,key])=>[key,number(opt[name],name)]));
const readWav=file=>{
  if(fs.statSync(file).size>9*1024*1024)throw new RangeError('Room capture WAV exceeds its byte budget');
  return WAV.read(file);
};

function load(file,onFile=()=>{}){
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>16384)throw new RangeError('Invalid room impulse asset size');
  const document=JSON.parse(fs.readFileSync(file,'utf8'));
  if(document?.format!==capture.format||document.version!==1||
    typeof document.response!=='string'||!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,120}\.wav$/i.test(document.response))
    throw new TypeError('Invalid room impulse asset');
  const source=path.join(path.dirname(file),document.response);
  const response=readWav(source);
  const {measurement}=document;
  if(measurement?.sampleRate!==response.sampleRate||measurement.channels!==response.channels||
    measurement.frames!==response.samples.length/response.channels)
    throw new RangeError('Response WAV does not match the room impulse asset');
  const layers=capture.split(response,document.edit), levels=capture.mixSettings(document.probeMix);
  onFile(file);
  onFile(source);
  return {document,response,early:capture.level(layers.early,levels.earlyGain),tail:capture.level(layers.tail,levels.tailGain)};
}

function exportLayers(output,{early,tail}){
  outputWav(path.join(output,'early.wav'),early);
  outputWav(path.join(output,'tail.wav'),tail);
}
function save(output,result){
  const layers=capture.split(result.response,result.edit), document=capture.asset(result);
  outputWav(path.join(output,document.response),result.response);
  exportLayers(output,layers);
  json(path.join(output,'room-impulse.json'),document);
  return document;
}
function run([action,source,...extra],opt){
  const common=['out'], sweepFlags=['rate','seconds','tail','gain','lead','start-hz','end-hz'];
  const measureFlags=['loopback','latency-ms','max-latency-ms','room-start','loopback-start'];
  const flags=action==='sweep'?common.concat(sweepFlags):action==='measure'?common.concat(sweepFlags,measureFlags):common;
  if(typeof opt.out!=='string'||extra.length||!['sweep','measure','split'].includes(action)||
    (action==='sweep'?source!==undefined:typeof source!=='string')||Object.keys(opt).some(name=>!flags.includes(name)))
    throw new TypeError('Use '+usage.join('\n    '));
  if(action==='sweep'){
    const signal=capture.sweep(settings(opt));
    outputWav(opt.out,signal);
    return signal.settings;
  }
  if(action==='split'){
    const saved=load(source);
    exportLayers(opt.out,saved);
    return saved.document.edit;
  }
  if((opt.loopback===undefined)===(opt['latency-ms']===undefined)||
    opt.loopback!==undefined&&typeof opt.loopback!=='string'||opt['loopback-start']!==undefined&&opt.loopback===undefined)
    throw new TypeError('Measure with either --loopback FILE or --latency-ms MS');
  const room=readWav(source), sweep={sampleRate:room.sampleRate,...settings(opt)};
  const optional=(name,key,convert=n=>n)=>opt[name]===undefined?{}:{[key]:convert(number(opt[name],name))};
  const result=capture.measure(room,{sweep,
    ...(opt.loopback!==undefined&&{loopback:readWav(opt.loopback)}),
    ...optional('latency-ms','latencySamples',n=>Math.round(n*sweep.sampleRate/1000)),
    ...optional('max-latency-ms','maxLatencyMs'),
    ...optional('room-start','recordingStart'),...optional('loopback-start','loopbackStart')
  });
  return save(opt.out,result).measurement;
}

module.exports={usage,run,load,save};
