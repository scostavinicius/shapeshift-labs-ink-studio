/* Usage: node clap-smoke.cjs manifest.json relay */
const assert=require('node:assert/strict');
const {KIT:K}=require('../..').load(), {load}=require('../../cli/clap-adapter');
const A=K.procedural.mediaGraph, host=load(process.argv[2]), alias=process.argv[3] ?? 'relay';
const rate=8000, n=300, pcm=values=>({sampleRate:rate,channels:1,
  samples:Float64Array.from({length:n},(_,i)=>values[i] ?? 0)});
const source=pcm({40:.3,90:.3,150:.3}), key=pcm({90:.7});
const saved=host.snapshot(alias,{sampleRate:rate,parameters:{6:.75}});
const processor={type:'external',adapter:'clap',...saved};
const setup={id:'clap-check',sampleRate:rate,output:'master',
  strips:{
    signal:{clips:[{id:'take',source:'take'}],sends:{wet:{tap:'post'}}},
    key:{clips:[{id:'kick',source:'key'}],output:null},
    wet:{inserts:[{processor:'fixture',sidechain:{strip:'key'}}],fader:.5},master:{}
  },
  processors:{fixture:processor},taps:{wet:{strip:'wet'}}};
const run=()=>A.mixer.render(setup,{take:source,key},host), restored=run();
const at=(take,i)=>take.samples[2*i];
const near=(value,expected)=>assert(Math.abs(value-expected)<1e-7,`${value} vs ${expected}`);
near(at(restored.taps.wet,40),.1125);
near(at(restored.taps.wet,90),.028125);
near(at(restored.taps.wet,69),.0140625);
assert.equal(restored.report.latencySamples,7);
assert.equal(restored.report.tailFrames,29);
assert.deepEqual(restored,run());
processor.parameters={6:{unit:'samples',curve:'hold',points:[{at:0,value:.5},{at:150,value:1}]}};
const animated=run();
near(at(animated.taps.wet,40),.075);
near(at(animated.taps.wet,150),.15);
assert.throws(()=>A.mixer.render(setup,{take:source,key}),/registered audio adapter/);
console.log(JSON.stringify({saved,latency:restored.report.latencySamples,tail:restored.report.tailFrames,
  recalledGain:at(restored.taps.wet,40)/.15,keyedGain:at(restored.taps.wet,90)/.05625,
  automation:[at(animated.taps.wet,40),at(animated.taps.wet,150)]}));
