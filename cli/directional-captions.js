const fs = require('node:fs');
const path = require('node:path');
const Captions = require('../src/directional-captions.js');
const {format:receiptFormat} = require('./scene-audio-receipts.js');
const {graphOutputs} = require('./graph-outputs.js');
const {captions:webvtt} = require('./story-performance.js');

const usage = 'story audio-captions <playback.json> <plan.json> --out directory';
const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const token = value=>typeof value==='string'&&value.trim()&&value.length<=512;
const check = (condition,message)=>{if (!condition) throw new TypeError(message);};
function read(file,bytes) {
  if (fs.statSync(file).size>bytes) throw new RangeError('Caption input exceeds its size budget: '+file);
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function build(playback,plan) {
  check(playback?.format===receiptFormat&&playback.version===1&&token(playback.world)&&
    integer(playback.sampleRate,8000,192000)&&integer(playback.firstSample,0,Number.MAX_SAFE_INTEGER-1)&&
    integer(playback.endSample,playback.firstSample+1,Number.MAX_SAFE_INTEGER)&&
    Array.isArray(playback.receipts)&&playback.receipts.length<=16384,'Expected a version 1 audio playback receipt ledger');
  const {sampleRate,firstSample,endSample,receipts} = playback, compiled = Captions.compile(plan,sampleRate);
  const counts = {played:0,late:0,muted:0,dropped:0,'outside-window':0,matched:0,captioned:0};
  const events = [];
  for (const [receipt,row] of receipts.entries()) {
    check(row&&token(row.beatId)&&token(row.cue)&&['played','late','muted','dropped','outside-window'].includes(row.outcome),
      'Invalid audio playback receipt at index '+receipt);
    counts[row.outcome]++;
    const {cue,beatId,outcome,actualSample,caption} = row, family = row.variant?.family;
    if (!compiled.rule({cue,family})) continue;
    counts.matched++;
    if (outcome!=='played'&&outcome!=='late') continue;
    check(integer(actualSample,0,endSample-1),'Played caption receipt needs its actual sample');
    if (caption!==undefined) {
      check(caption&&integer(caption.sample,Math.max(firstSample,actualSample),endSample-1)&&
        (caption.direction===null||Captions.validDirection(caption.direction))&&
        (caption.opening===null||token(caption.opening)),
      'Invalid caption arrival evidence at receipt '+receipt);
    }
    const sample = caption?.sample??actualSample;
    if (sample<firstSample) continue;
    events.push({cue,family,beatId,receipt,sample,direction:caption?.direction,opening:caption?.opening});
  }
  const captions = Captions.group(compiled,events,{from:firstSample,to:endSample}).map((row,index)=>({
    ...row,rule:row.id,id:'sound-'+String(index+1).padStart(4,'0'),
    fileSample:row.startSample-firstSample,endFileSample:row.endSample-firstSample
  }));
  counts.captioned=events.length;
  return {format:Captions.format+'-track',version:1,world:playback.world,sampleRate,firstSample,endSample,counts,captions};
}

function command(file,planFile,rest,opt,library) {
  check(file&&planFile&&!rest.length&&token(opt.out)&&Object.keys(opt).every(key=>key==='out'),'Use '+usage);
  const result = build(read(file,32*1024*1024),read(planFile,512*1024));
  const T = library().KIT.procedural.takeTime;
  const at = sample=>({numerator:sample,denominator:result.sampleRate});
  const lines = result.captions.map(row=>({id:row.id,text:'['+row.text+']',
    timecode:at(row.fileSample),endTimecode:at(row.endFileSample)}));
  graphOutputs([file,planFile]).write(path.resolve(opt.out),[
    {file:'captions.vtt',bytes:webvtt(lines,T)},
    {file:'captions.json',document:result}
  ]);
  process.stdout.write(JSON.stringify({captions:result.captions.length,track:'captions.vtt',report:'captions.json'})+'\n');
}

module.exports = {usage,command,build};
