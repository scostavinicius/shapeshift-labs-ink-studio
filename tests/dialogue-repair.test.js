const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),A=kit.KIT.procedural.mediaGraph,WAV=require('../cli/wav');
const rate=16000, phase=(i,hz)=>2*Math.PI*hz*i/rate, tone=(i,hz)=>Math.sin(phase(i,hz));
function signal(frames,fn,channels=1) {
  return {sampleRate:rate,channels,samples:Float64Array.from({length:frames*channels},
    (_,i)=>fn(Math.floor(i/channels),i%channels))};
}
function band({channels,samples},hz,from,to) {
  let re=0,im=0;
  for (let i=from;i<to;i++) {
    re+=samples[i*channels]*Math.cos(phase(i,hz));
    im+=samples[i*channels]*tone(i,hz);
  }
  return 2*Math.hypot(re,im)/(to-from);
}
const near=(x,y,tol=1e-10)=>assert(Math.abs(x-y)<=tol,x+' != '+y);
function nullTest({value,before,removed}) {
  for (let i=0;i<before.samples.length;i++) near(value.samples[i]+removed.samples[i],before.samples[i]);
}

test('rides use the source sample clock and click repair leaves true signal neighbors in place',()=>{
  const base=[.04,.05,.06,.07,.08,.09,.10,.11,.12,.13,.14,.15];
  const source={sampleRate:rate,channels:1,samples:[...base]};
  source.samples[5]=.95;
  const settings={
    gainDb:{unit:'samples',curve:'hold',points:[{at:0,value:0},{at:8,value:6}]},
    declick:{ranges:[{fromSample:5,toSample:6}]}
  };
  const result=A.repairDialogue(source,settings);
  assert.equal(source.samples[5],.95);
  near(result.value.samples[5],.09);
  near(result.removed.samples[5],.86);
  near(result.before.samples[8],.12*10**.3);
  assert.equal(result.report.steps.declick.repairedFrames,1);
  nullTest(result);
  const clipped=A.repairDialogue(source,{...settings,gainDb:20,preview:{fromSample:4,toSample:8}});
  assert.deepEqual(clipped.value.samples,A.repairDialogue(source,{...settings,gainDb:20}).value.samples.slice(4,8));
  nullTest(clipped);

  const click=signal(2400,i=>i===1120 ? .7 : .12*tone(i,380));
  const auto=A.repairDialogue(click,{declick:{}});
  assert.deepEqual(auto.report.steps.declick.regions,[{fromSample:1120,toSample:1121}]);
  near(auto.value.samples[1120],.12*tone(1120,380),.002);
  near(auto.value.samples[1119],click.samples[1119]);
});

test('auto dehum matches a quiet reference across channels and preserves speech-band energy',()=>{
  const source=signal(rate,(i,ch)=>.089*Math.sin(phase(i,60)+ch*.7)+.052*Math.cos(phase(i,120)-ch)+
    (i<rate/2 ? 0 : .20*tone(i,560)),2);
  const result=A.repairDialogue(source,{hum:{harmonics:2,reference:{fromSample:0,toSample:8000}}});
  assert.equal(result.report.steps.hum.frequency,60);
  assert(band(result.value,60,8000,16000)<.0001);
  assert(band(result.value,120,8000,16000)<.0001);
  near(band(result.value,560,8000,16000),.2,.0001);
  near(band(result.removed,60,8000,16000),.089,.0001);
  nullTest(result);
  const ridden=A.repairDialogue(source,{hum:{harmonics:2,reference:{fromSample:0,toSample:8000}},
    gainDb:{unit:'samples',curve:'hold',points:[{at:0,value:0},{at:8000,value:6}]}});
  assert(band(ridden.value,60,8000,16000)<.0002);
  near(band(ridden.value,560,8000,16000),.20*10**.3,.001);
});

test('spectral patches attenuate or interpolate a selected band and leave outside samples exact',()=>{
  const start=4800, end=10400, hz=2500;
  const source=signal(rate,i=>.20*tone(i,500)+.025*tone(i,hz)+(i>=start && i<end ? .158*tone(i,hz) : 0));
  const patch={fromSample:start,toSample:end,lowHz:2240,highHz:2820,fadeSamples:128,amountDb:36};
  const cut=A.repairDialogue(source,{spectral:[patch]});
  const interpolated=A.repairDialogue(source,{spectral:[{...patch,mode:'interpolate'}]});
  assert.deepEqual(cut.value.samples.slice(0,start),source.samples.slice(0,start));
  assert.deepEqual(cut.value.samples.slice(end),source.samples.slice(end));
  assert(band(cut.value,hz,6000,9200)<.005);
  near(band(interpolated.value,hz,6000,9200),.025,.004);
  near(band(cut.value,500,6000,9200),.20,.001);
  nullTest(interpolated);
});

test('de-essing tames a burst while retaining the low band and releases on quieter sound',()=>{
  const source=signal(rate,i=>.12*tone(i,300)+(i>4000 && i<8000 ? .30 : .0015)*tone(i,5000));
  const result=A.repairDialogue(source,{deess:{hz:5000,q:1.8,thresholdDb:-28,rangeDb:11}});
  near(band(result.value,300,5000,7600),.12,.005);
  assert(band(result.value,5000,5000,7600)<.104);
  assert(band(result.removed,5000,5000,7600)>.19);
  near(band(result.value,5000,12500,15700),.0015,.0004);
  nullTest(result);
});

test('an external dialogue key ducks only the score band and range automation can scope it to one line',()=>{
  const key=signal(rate,i=>i>3200 && i<9600 ? .28*Math.cos(phase(i,550)) : 0);
  const bed=signal(rate,i=>.17*tone(i,240)+.18*tone(i,2240)+.12*tone(i,6800));
  const recipe={id:'cue',sampleRate:rate,tail:'cut',output:'master',
    strips:{master:{},dialogue:{clips:[{id:'line',source:'key'}],output:null},
      music:{clips:[{id:'score',source:'bed'}],inserts:[{processor:'space',sidechain:{strip:'dialogue',tap:'pre'}}]}},
    processors:{space:{type:'band-duck',hz:2240,q:1.9,thresholdDb:-31,release:.021,
      rangeDb:{unit:'samples',points:[{at:0,value:8},{at:6700,value:8},{at:7000,value:0}]}}},
    taps:{dry:{strip:'music',tap:'input'}}};
  const {value,taps,report}=A.mixer.render(recipe,{key,bed});
  assert.equal(report.strips.music.inserts[0].sidechain.strip,'dialogue');
  near(band(value,2240,4000,6400)/band(taps.dry,2240,4000,6400),10**(-8/20),.007);
  near(band(value,240,4000,6400)/band(taps.dry,240,4000,6400),1,.008);
  near(band(value,6800,4000,6400)/band(taps.dry,6800,4000,6400),1,.03);
  assert.deepEqual(value.samples.slice(14000),taps.dry.samples.slice(14000));
  assert.deepEqual(value.samples.slice(0,6400),taps.dry.samples.slice(0,6400));
});

test('repair CLI writes aligned audio, residual and machine-readable findings',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-dialogue-')),at=name=>path.join(dir,name);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(at('input.wav'),WAV.encode(signal(rate,i=>i===3200 ? .75 : .05*tone(i,350))));
  fs.writeFileSync(at('recipe.json'),JSON.stringify({declick:{},preview:{fromSample:3100,toSample:3360}}));
  const result=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','repair',at('input.wav'),at('recipe.json'),'--out',at('output')]));
  const diff=ink.readWav(result.removed);
  assert.equal(diff.samples.length,260);
  assert(diff.samples[100]>.74);
  const report=JSON.parse(fs.readFileSync(result.report,'utf8'));
  assert.equal(report.fromSample,3100);
  assert.deepEqual(report.steps.declick.regions,[{fromSample:3200,toSample:3201}]);
});
