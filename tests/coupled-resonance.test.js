const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const kit=require('..').load(),W=kit.KIT.world,R=W.resonantModes,WAV=require('../cli/wav.js');
const rate=24000,tau=2*Math.PI,hz=260,stiffness=((tau*335)**2-(tau*hz)**2)/2;
const site={point:[0,0,0],gains:[1]},near=(a,b,tol=1e-12)=>assert(Math.abs(a-b)<tol,a+' vs '+b);
const mode=(id,decay=0)=>R.bake({format:R.planFormat,version:1,id,source:{kind:'authored',modes:[{id:'ring',hz,decay}]},
  excitations:{strike:site,joint:site},pickups:{read:site}});
const spec=(contact={},decay=0)=>({bodies:{gate:{asset:mode('gate',decay),site:'joint'},rail:{asset:mode('rail',decay),site:'joint'}},
  contact:{stiffness,initial:1,slewMs:0,...contact}});
const prepare=(contact,decay)=>R.prepareCoupled(spec(contact,decay),{sampleRate:rate});
const strike=(body='gate',sample=0,value=.75,fraction=0)=>({body,excitation:'strike',sample,fraction,value});
const rms=rows=>Math.sqrt(rows.reduce((sum,x)=>sum+x*x,0)/rows.length);

test('a single strike transfers energy in both directions and held lossless contact conserves energy',()=>{
  const connected=prepare(),disconnected=prepare({initial:0});
  const impulse=strike(), a=connected.process(1600,{impulses:[impulse]}),b=disconnected.process(1600,{impulses:[impulse]});
  assert(rms(a.velocities.rail.read)>.20);
  assert(b.velocities.rail.read.every(value=>value===0));
  near(connected.view().energy.total,.5*impulse.value**2);
  for(let i=0;i<20;i++)connected.process(1211,{collect:false});
  near(connected.view().energy.total,.5*impulse.value**2,4e-12);
  const reverse=prepare().process(1600,{impulses:[strike('rail')]});
  assert(reverse.velocities.gate.read.every((value,i)=>Math.abs(value-a.velocities.rail.read[i])<1e-12));
  const boundary=connected.view();
  const open=connected.process(1500,{contact:0});
  assert(rms(open.velocities.rail.read)>.025);
  assert.equal(open.velocities.rail.read[0],boundary.velocities.rail.read);
  assert.equal(open.pickups.rail.read[0],boundary.pickups.rail.read);
  assert.equal(connected.view().contact.force,0);
});

function frequency(values,from,to){
  const zeroes=[];
  for(let i=from+1;i<to;i++)if(values[i-1]<=0&&values[i]>0)
    zeroes.push(i-1-values[i-1]/(values[i]-values[i-1]));
  return rate*(zeroes.length-1)/(zeroes.at(-1)-zeroes[0]);
}
test('contact shifts modal pitch and damping, then the independently ringing bodies retain their phase',()=>{
  const ring=prepare({damping:14},2);
  const held=ring.process(4800,{impulses:[strike(),strike('rail',0,-.75)]}), pre=ring.view();
  const free=ring.process(4800,{contact:0});
  const before=held.velocities.gate.read,after=free.velocities.gate.read;
  near(frequency(before,100,4500),335,.6);
  near(frequency(after,100,4500),260,.3);
  assert.equal(after[0],pre.velocities.gate.read);
  assert.equal(free.pickups.gate.read[0],pre.pickups.gate.read);
  assert(rms(before.slice(3400,4400))/rms(before.slice(400,1400))<.2);
  assert(rms(after.slice(3400,4400))/rms(after.slice(400,1400))>.72);
  assert(ring.view().energy.total<pre.energy.total);
});

test('sample-rate contact and fractional impulses are block invariant and checkpoints restore both bodies',()=>{
  const settings={sampleRate:rate}, pair=spec({slewMs:2},3), length=2400, split=941;
  const contact=Float64Array.from({length},(_,i)=>i<800 ? 1 : i<1177 ? .35 : (1+Math.sin(i*.018))*.5);
  const force=Float64Array.from({length},(_,i)=>2*Math.sin(i*.031));
  const impulses=[strike('rail',0,.47,.37),strike('gate',270,.11,.943),strike('rail',950,.18,.66)];
  const full=R.prepareCoupled(pair,settings),first=R.prepareCoupled(pair,settings);
  const work=(run,from,to)=>run.process(to-from,{contact:contact.subarray(from,to),
    forces:{gate:{strike:force.subarray(from,to)}},impulses:impulses.filter(event=>event.sample>=from&&event.sample<to)});
  const a=work(full,0,length), b=work(first,0,split), resumed=R.prepareCoupled(pair,settings);
  resumed.restore(JSON.parse(JSON.stringify(first.snapshot())));
  const c=work(resumed,split,length);
  assert.deepEqual(resumed.snapshot(),full.snapshot());
  for(const kind of ['pickups','velocities'])for(const body of ['gate','rail'])
    assert.deepEqual([...b[kind][body].read,...c[kind][body].read],[...a[kind][body].read]);
  assert.deepEqual([...b.contact,...c.contact],[...a.contact]);
  assert(b.contact[800]>contact[800]);
  assert(b.contact[840]===contact[840]);
  const before=resumed.snapshot();
  assert.throws(()=>resumed.process(4,{contact:[1,0,2,1]}),/contact level/);
  assert.throws(()=>resumed.process(4,{impulses:[strike('gate',length,1e308)]}),/numerical range/);
  assert.deepEqual(resumed.snapshot(),before);
  assert.throws(()=>prepare({stiffness:stiffness+1},3).restore(before),/Incompatible/);
  assert.throws(()=>prepare({stiffness:1e11}),/bandwidth/);
});

test('the resonator CLI prints both bodies and routes their native clock through physical audio',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-coupled-')),file=name=>path.join(folder,name);
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const set=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const {bodies,contact}=spec(),audio={channels:[{body:'gate',pickup:'read'},{body:'rail',pickup:'read'}],gain:.6};
  for(const [name,body] of Object.entries(bodies))set(name+'.json',body.asset);
  const selection=body=>({body,name:'read',channel:'velocity',metersPerUnit:1});
  set('run.json',{format:R.coupledRunFormat,version:1,samples:1900,bodies:{
    gate:{asset:'gate.json',site:'joint'},rail:{asset:'rail.json',site:'joint'}},
    contact,settings:{sampleRate:rate},levels:[{sample:1300,level:0}],impulses:[strike()],audio});
  const run=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'sim',...args],
    {cwd:folder});
  run('resonator','render','run.json','--out','trace.json','--wav','pair.wav');
  const read=name=>JSON.parse(fs.readFileSync(file(name))),trace=read('trace.json'), heard=WAV.read(file('pair.wav'));
  assert.equal(trace.format,R.coupledTraceFormat);
  assert.equal(trace.contact[1299],1);
  assert.equal(trace.contact[1300],0);
  assert.equal(heard.channels,2);
  near(heard.samples[350*2+1],trace.velocities.rail.read[350]*audio.gain,1e-7);
  const rail=W.physicalSignals.fromTrace(trace,selection('rail'));
  assert.equal(rail.kind,'velocity');
  assert.deepEqual(rail.samples,trace.velocities.rail.read);
  const analysis=W.outputTiming.trace(trace,{track:'rail',measure:'velocity'});
  assert.equal(analysis.startSample,0);
  assert.equal(analysis.channels.read.unit,'model-unit/s');
  assert.deepEqual(Array.from(analysis.channels.read.samples),trace.velocities.rail.read);
  set('listening.json',{format:'ink-studio/physical-audio-run',version:1,inputs:{
    gate:{trace:'run.json',selection:selection('gate')},rail:{trace:'trace.json',selection:selection('rail')}},
    plan:{format:W.physicalAudio.format,version:1,id:'pair',sampleRate:rate,startSample:500,frames:100,channels:2,
      sources:{gate:{signal:'gate',pan:-1,pcmPerUnit:.3},rail:{signal:'rail',pan:1,pcmPerUnit:.3}}}});
  run('physical-audio','listening.json','--out','mix.json','--stems','prints');
  assert.equal(read('mix.json').startSample,500);
  const mixed=WAV.read(file('prints/mix.wav'));
  assert(mixed.samples.some((sample,i)=>i%2===1&&Math.abs(sample)>.02));
});
