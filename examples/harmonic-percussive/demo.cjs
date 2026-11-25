const fs=require('node:fs'), path=require('node:path');
const assert=require('node:assert/strict'), {gzipSync}=require('node:zlib');
const ink=require('../..'), A=ink.load().KIT.procedural.mediaGraph;
const WAV=require('../../cli/wav.js'), {json,write}=require('../../cli/asset-files.js');
const {make}=require('./fixture.cjs');

const out=process.argv[2];
if(!out)throw Error('Use node examples/harmonic-percussive/demo.cjs <output-directory>');
const {source}=make(), rate=source.sampleRate, serialize=pcm=>WAV.encode(pcm,{encoding:'float32'});
const settings={id:'relay-break',tail:.15,separation:{timeMedian:25,frequencyMedian:9,balance:.75}};
const input=WAV.decode(serialize(source));
const split=A.harmonicPercussive.session(input,settings);
const names={harmonic:'harmonic.wav',percussive:'percussive.wav'};
const assets=Object.fromEntries(Object.entries(split.assets).map(([name,pcm])=>{
  const bytes=serialize(pcm);
  write(path.join(out,names[name]),bytes);
  return [name,WAV.decode(bytes)];
}));
const project={session:split.value,assets:names};
const base=A.audioEditorial.render(project.session,assets,{stems:true});
const closest=time=>split.report.hits.reduce((best,hit)=>
  Math.abs(hit.sample-time*rate)<Math.abs(best.sample-time*rate)?hit:best);
const hits=[closest(.62),closest(2.41)];
assert(hits.every((hit,i)=>Math.abs(hit.sample/rate-[.62,2.41][i])<.012));
const preset={pitch:5,shifts:[105,-72]};
const changes=[{op:'transpose',clip:'harmonic',semitones:preset.pitch},...hits.map(({id},i)=>({
  op:'nudge',clip:id,offsetSamples:Math.round(rate*preset.shifts[i]/1000)
}))];
const edited=A.audioEditorial.revise(project.session,assets,changes);
const mix=A.audioEditorial.render(edited.value,assets,{stems:true});
let delta=0;
for(let i=0;i<input.samples.length;i++)delta=Math.max(delta,Math.abs(base.value.samples[i]-input.samples[i]));
assert(delta<8e-8);
assert.equal(base.report.headroom,1);
assert.equal(mix.report.headroom,1);
assert.equal(edited.report.clips[0].source.transpose,preset.pitch);
json(path.join(out,'project.json'),project);
json(path.join(out,'edited.json'),{session:edited.value,assets:names});
json(path.join(out,'changes.json'),changes);
json(path.join(out,'settings.json'),settings);
json(path.join(out,'report.json'),{...split.report,recombinationPeakError:delta,edited:edited.report});
write(path.join(out,'source.wav'),serialize(input));
write(path.join(out,'recombined.wav'),WAV.encode(base.value,{encoding:'pcm24'}));
write(path.join(out,'remix.wav'),WAV.encode(mix.value,{encoding:'pcm24'}));

const clips={original:input,harmonic:base.stems.harmonic,percussive:base.stems.percussive,
  recombined:base.value,remix:mix.value};
const pcm64=pcm=>Buffer.from(Float32Array.from(pcm.samples).buffer).toString('base64');
const audition={project,rate,channels:2,report:split.report,hits,preset,edited:edited.value,
  layers:Object.fromEntries(Object.entries(assets).map(([id,pcm])=>[id,pcm64(pcm)])),
  clips:Object.fromEntries(Object.entries(clips).map(([id,pcm])=>[id,WAV.encode(pcm,{encoding:'pcm16'}).toString('base64')]))};
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const html=read('review.html').replace('/*INK_SPLIT_DATA*/',()=>JSON.stringify(audition))
  .replace('/*INK_SPLIT_ENGINE*/',()=>JSON.stringify(gzipSync(ink.bundle(),{level:9}).toString('base64')))
  .replace('/*INK_SPLIT_SCRIPT*/',()=>read('review.js'));
write(path.join(out,'index.html'),html);
console.log(JSON.stringify({frames:split.report.frames,hits:split.report.hits.length,changes,delta},null,2));
