/* Generate a standalone browser audition and the native mixer project. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib');
const ink=require('../..'),A=ink.load().KIT.procedural.mediaGraph;
const WAV=require('../../cli/wav.js'),{json,write}=require('../../cli/asset-files.js');
const {make}=require('./fixture.cjs');

const out=process.argv[2];
if (!out) throw Error('Use node examples/spectral-sidechain/demo.cjs <output-directory>');
const {lead,rival,duration}=make(),rate=lead.sampleRate;
const paths={lead:'lead.wav',rival:'keys.wav'};
const assets=Object.fromEntries(Object.entries({lead,rival}).map(([id,pcm])=>{
  const bytes=WAV.encode(pcm,{encoding:'float32'});
  write(path.join(out,paths[id]),bytes);
  return [id,WAV.decode(bytes)];
}));
const mixer={id:'signal-through-the-keys',sampleRate:rate,output:'master',peakPolicy:'error',
  strips:{lead:{clips:[{id:'phrase',source:'lead'}]},rival:{
    clips:[{id:'chords',source:'rival'}],inserts:[{processor:'space',sidechain:{strip:'lead',tap:'post'}}]
  },master:{}},
  processors:{space:{type:'spectral-sidechain',maxCutDb:8,thresholdDb:-48,lowHz:300,highHz:6000,attackMs:9,releaseMs:68}},
  taps:{lead:{strip:'lead'},keys:{strip:'rival',tap:'pre'}}};
const render=maxCutDb=>A.mixer.render({...mixer,processors:{space:{...mixer.processors.space,maxCutDb}}},assets);
const dry=render(0),wet=render(8);
const mask=wet.report.strips.rival.inserts[0].details;
assert(mask.peakCutDb>7 && mask.peakCutDb<=8);
assert(wet.value.samples.some((sample,i)=>sample!==dry.value.samples[i]));
assert(wet.taps.lead.samples.every((sample,i)=>sample===dry.taps.lead.samples[i]));
json(path.join(out,'project.json'),{assets:paths,mixer});
json(path.join(out,'report.json'),wet.report);
for (const [name,pcm] of Object.entries({bypass:dry.value,processed:wet.value,'processed-keys':wet.taps.keys})) {
  write(path.join(out,name+'.wav'),WAV.encode(pcm,{encoding:'pcm24'}));
}
const packed=pcm=>gzipSync(Buffer.from(Float32Array.from(pcm.samples).buffer),{level:6}).toString('base64');
const demo={mixer,duration,mask,
  assets:Object.fromEntries(Object.entries(assets).map(([id,pcm])=>[id,packed(pcm)])),
  mixes:{bypass:packed(dry.value),processed:packed(wet.value),keys:packed(wet.taps.keys)}};
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const html=read('review.html').replace('/*INK_SIDECHAIN_DATA*/',()=>JSON.stringify(demo))
  .replace('/*INK_SIDECHAIN_ENGINE*/',()=>JSON.stringify(gzipSync(ink.bundle(),{level:9}).toString('base64')))
  .replace('/*INK_SIDECHAIN_SCRIPT*/',()=>read('review.js'));
write(path.join(out,'index.html'),html);
console.log(JSON.stringify({duration,peakCutDb:mask.peakCutDb,overlapFrames:mask.overlapFrames,latency:wet.report.latencySamples}));
