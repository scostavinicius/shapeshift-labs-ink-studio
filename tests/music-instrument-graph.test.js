const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), P=KIT.procedural, A=KIT.music.production, rate=16000;
const controls=(play={})=>({midi:69,frequency:440,velocity:1,time:0,gate:.3,salt:29,roundRobin:0,play});
const render=(patch,play={},frames=4096,channels=1,assets={})=>{
  const body=P.musicInstruments.compile(patch,assets).prepare(controls(play),rate,.30);
  return Float64Array.from({length:frames*channels},(_,i)=>
    body.signal(Math.floor(i/channels)/rate,Math.floor(i/channels),i%channels));
};
const rms=(data,first=0,last=data.length)=>{
  let sum=0;
  for (let i=first;i<last;i++) sum+=data[i]**2;
  return Math.sqrt(sum/(last-first));
};
const cycle={type:'graph',tail:.3,output:{left:'sum',right:'echo'},nodes:{
  osc:{type:'oscillator',wave:'sine',phase:.25},
  body:{type:'gain',input:'osc',amount:.08},
  sum:{type:'mix',inputs:['body','echo']},
  echo:{type:'delay',input:'sum',samples:3,gain:.65}
}};
const impulse={sampleRate:rate,channels:1,samples:Float64Array.from({length:96},(_,i)=>i>=24 && i<72 ?
  .62*Math.sin(i*1.76)*Math.exp(-(i-24)/7) : 0)};
const bodyPatch={type:'graph',tail:.8,controls:{contact:.25},output:'body',nodes:{
  tap:{type:'sample',zones:[{samples:['click']}]},
  body:{type:'resonator',input:'tap',decay:{base:.73,by:{damping:-.65}},modes:[{ratio:1,shape:2}]},
}};
const recipe=patch=>({arrangement:{score:{key:{root:'A4'},tempoMap:{tempo:120},endFade:0,
  harmonies:{i:{root:'A3',quality:'unison'}}},parts:{bells:{role:'lead'}},motifs:{},
  sections:[{id:'pass',bars:1,harmony:'i'}]},patches:{bells:patch},
  tracks:{bells:{patch:'bells',clips:[{id:'line',beat:0,length:4,voices:[
    {id:'front',notes:[{id:'one',beat:.05,duration:.43,midi:69,velocity:.87,play:{contact:.25,damping:.10}},
      {id:'two',beat:2,duration:.51,midi:69,velocity:.87,play:{contact:.25,damping:.10}}]},
    {id:'back',notes:[{id:'under',beat:.10,duration:.29,midi:57,velocity:.51,play:{contact:.25,damping:.73}}]}
  ]}]}}});

test('feedback routes are causal and stereo channel reads process the note once',()=>{
  const pcm=render(cycle,{},2048,2);
  const plain=structuredClone(cycle);
  plain.nodes.echo.gain=0;
  const dry=render(plain,{},2048,2);
  assert.deepEqual(pcm.slice(0,6),dry.slice(0,6));
  assert(pcm[7]>.001);
  assert(pcm[6]-dry[6]>.001);
  const expected=Float32Array.of(Math.tanh(.08*.65))[0]*3/rate*1000;
  assert(Math.abs(pcm[7]-expected)<1e-12);
  assert.deepEqual(pcm,render(cycle,{},2048,2));
  const report=A.inspectInstrumentGraph(cycle);
  assert.deepEqual(report.output,['sum','echo']);
  assert(report.order.indexOf('echo')<report.order.indexOf('sum'));
  assert.equal(report.nodes.find(row=>row.name==='echo').writesAfterFrame,true);
  plain.nodes.echo={type:'gain',input:'sum'};
  assert.throws(()=>A.inspectInstrumentGraph(plain),/cycle needs an explicit delay/);
  plain.nodes.echo={type:'gain',input:'osc',amount:{from:{sum:.5}}};
  assert.throws(()=>A.inspectInstrumentGraph(plain),/cycle needs an explicit delay/);
  plain.nodes.echo.input='missing';
  assert.throws(()=>A.inspectInstrumentGraph(plain),/Unknown graph input missing/);
});

test('a sample excites a position-dependent mode and damping changes its tail',()=>{
  const assets={click:impulse};
  const onset=render(bodyPatch,{damping:0,contact:.25},12000,1,assets);
  const muted=render(bodyPatch,{damping:0,contact:.5},12000,1,assets);
  const damped=render(bodyPatch,{damping:.91,contact:.25},12000,1,assets);
  assert(rms(onset,500,1500)>1e-4);
  assert(rms(onset,3500,5200)>rms(damped,3500,5200)*15);
  assert(rms(muted)<1e-12);
  assert.deepEqual(A.inspectInstrumentGraph(bodyPatch,assets).assets,['click']);
  assert.throws(()=>A.inspectInstrumentGraph(bodyPatch,{}),/Unknown sampler zone asset/);
});

test('pressure and breath are independent continuous controls on the performed voice',()=>{
  const patch={type:'graph',output:'drive',tail:.2,nodes:{
    tone:{type:'oscillator',wave:'saw'},
    flow:{type:'filter',input:'tone',cutoff:{base:180,by:{breath:6200}}},
    drive:{type:'gain',input:'flow',amount:{base:.12,by:{pressure:.7}}}
  }};
  const lift={curves:{pressure:[[0,0],[.35,0],[.65,1],[1,1]]}};
  const a=render(patch,lift,4800), quiet=render(patch,{pressure:0},4800);
  assert.deepEqual(a.slice(0,1400),quiet.slice(0,1400));
  assert(rms(a,3200,4400)>rms(quiet,3200,4400)*6);
  const breathed=render(patch,{pressure:0,curves:{breath:[[0,0],[.35,0],[.64,1],[1,1]]}},4800);
  assert.deepEqual(breathed.slice(0,1400),quiet.slice(0,1400));
  assert(rms(breathed,3200,4400)>rms(quiet,3200,4400)*3);
  const score=recipe(patch);
  score.tracks.bells.clips[0].voices[0].notes[0].play={curves:{pressure:[[0,1.1]]}};
  assert.throws(()=>A.inspect(score),/Invalid note curve point on pressure/);
  patch.nodes.drive.amount={by:{meaningless:1}};
  assert.throws(()=>A.inspectInstrumentGraph(patch),/Invalid instrument graph parameter/);
});

test('ordinary score and live edit session render a sample graph, including an articulated asset override',t=>{
  const p=structuredClone(bodyPatch), assets={click:impulse,soft:{...impulse,samples:impulse.samples.map(x=>x*.34)}};
  p.articulations={soft:{nodes:{tap:{zones:[{samples:['soft']}]}}}};
  const source=recipe(p);
  const original=A.render(source,assets,{sampleRate:rate,stems:true});
  const notes=source.tracks.bells.clips[0].voices[0].notes;
  notes[1].play.articulation='soft';
  const performed=A.render(source,assets,{sampleRate:rate,stems:true});
  assert.deepEqual(performed.stems.bells.samples.slice(0,2*rate),original.stems.bells.samples.slice(0,2*rate));
  assert(rms(original.stems.bells.samples,2*rate,2*rate+1300)>2*rms(performed.stems.bells.samples,2*rate,2*rate+1300));
  assert.deepEqual(A.render(source,assets,{sampleRate:rate,stems:true,start:1.1,end:1.5}).stems.bells.samples,
    performed.stems.bells.samples.slice(Math.round(2.2*rate),3*rate));
  const session={format:'ink-studio/music-edit-session',version:1,id:'test-voice',sampleRate:rate,production:source};
  const T=P.mediaGraph.musicSession.create(assets).open(session);
  assert(rms(T.pull(12000).value.samples)>1e-4);
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-modular-voice-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const WAV=require('../cli/wav.js');
  for (const [name,pcm] of Object.entries(assets)) fs.writeFileSync(path.join(cwd,name+'.wav'),WAV.encode(pcm));
  fs.writeFileSync(path.join(cwd,'patch.json'),JSON.stringify({patch:p,assets:{click:'click.wav',soft:'soft.wav'}}));
  const report=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','production','inspect-instrument','patch.json'],{cwd,encoding:'utf8'}));
  assert.deepEqual(report.assets,['click','soft']);
});
