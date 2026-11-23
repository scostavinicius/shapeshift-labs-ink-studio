const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), W=K.world, E=W.contactExciters, C=W.contactSamples;
const WAV=require('../cli/wav.js');
const close=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
const plan=(tracks,sampleRate=1000,seed=17)=>({format:E.format,version:1,id:'contacts',sampleRate,seed,tracks});
const axis=(row,key,index)=>Array.from(row[key]).filter((_,i)=>i%3===index);
const sum=values=>values.reduce((a,b)=>a+b,0);

test('canonical samples normalize contact geometry and preserve average force and exact timing',()=>{
  const row=C.sample({kind:'impact',point:[1,2,3],normal:[0,-2,0],slip:[3,5,0],
    impulse:[0,-6,0],interval:.01},{time:.021,sample:21,fraction:0});
  assert.deepEqual(row.point,[1,2,3]);
  close(row.normal[1],-1);
  assert.deepEqual(row.slip,[3,0,0]);
  close(row.force[1],-600);
  assert.equal(W.timedEvents.timeOf(row),.021);
  assert.throws(()=>C.sample({...row,force:[0,0,0]}),/disagree/);
});

test('fractional impacts and pluck releases conserve their authored impulse at several rates',()=>{
  for(const rate of [1000,48000]){
    const run=E.prepare(plan({
      strike:{kind:'impact',at:.007314,point:[1,0,2],impulse:[0,.08,.015],duration:.00347},
      pluck:{kind:'pluck',at:.01091,tangent:[1,0,0],stiffness:12,deflection:-.032,duration:.00415}
    },rate));
    const block=run.process(Math.ceil(rate*.024));
    assert.equal(block.events.length,2);
    close(block.events[0].timing.time,.007314);
    close(block.events[0].timing.sample+block.events[0].timing.fraction,.007314*rate);
    close(sum(axis(block.tracks.strike,'impulse',1)),.08);
    close(sum(axis(block.tracks.strike,'force',2))/rate,.015);
    close(sum(axis(block.tracks.pluck,'impulse',0)),.5*12*(-.032)*.00415);
  }
});

test('bow builds static shear and drops into slip, with sample-aligned moving geometry',()=>{
  const run=E.prepare(plan({bow:{kind:'bow',start:0,end:.15,load:2,slip:[.3,3,0],stiffness:100,
    staticFriction:.5,kineticFriction:.18,keys:[{time:.15,point:[.05,0,0]}]}}));
  const data=run.process(130).tracks.bow, shear=axis(data,'force',0), max=Math.max(...shear);
  assert.ok(shear[1]>shear[0]&&max>.96&&max<1.01);
  assert.ok(shear[34]<.5);
  assert.ok(axis(data,'force',1).every(value=>Math.abs(value-2)<1e-12));
  assert.ok(axis(data,'slip',1).every(value=>value===0));
  close(data.point[0],.05*.0005/.15);
});

test('held live controls update contact geometry without resetting the bow bristles',()=>{
  const p=plan({bow:{kind:'bow',start:0,end:.1,stiffness:100,load:4,slip:[0,0,0]}});
  const run=E.prepare(p);
  run.process(10,{controls:{bow:{slip:[1,4,0],point:[2,1,0],load:3}}});
  const at=run.view().tracks.bow;
  close(at.force[0],1);
  close(at.force[1],3);
  assert.deepEqual(at.point,[2,1,0]);
  assert.deepEqual(at.slip,[1,0,0]);
  const block=run.process(1,{controls:{bow:{slip:[0,0,0],load:3}}});
  close(block.tracks.bow.force[0],1);
  assert.throws(()=>run.process(1,{controls:{bow:{load:-1}}}),/Invalid contact control/);
});

test('scrape texture follows accumulated slip distance and its seed',()=>{
  const track={kind:'scrape',start:0,end:.2,slip:[.8,0,0],load:2,roughness:.8,grain:.002};
  const a=E.prepare(plan({scrape:track})).process(120).tracks.scrape;
  const same=E.prepare(plan({scrape:track})).process(120).tracks.scrape;
  assert.deepEqual(a,same);
  assert.notDeepEqual(a.force,E.prepare(plan({scrape:track},1000,19)).process(120).tracks.scrape.force);
  const stationary=E.prepare(plan({scrape:{...track,slip:[0,0,0]}})).process(10).tracks.scrape;
  assert.ok(axis(stationary,'force',0).every(value=>value===0));
});

test('chatter runs by traveled distance and block partitioning preserves tooth times and impulses',()=>{
  const p=plan({teeth:{kind:'chatter',start:0,end:.03125,load:2,slip:[32,0,0],spacing:.125,duty:.5}},1024);
  const full=E.prepare(p).process(32);
  const direct=E.prepare(p), first=direct.process(8), checkpoint=JSON.parse(JSON.stringify(direct.snapshot()));
  const resumed=E.prepare(p);
  resumed.restore(checkpoint);
  const second=resumed.process(24);
  assert.deepEqual([...first.events,...second.events],full.events);
  assert.deepEqual([...first.tracks.teeth.force,...second.tracks.teeth.force],Array.from(full.tracks.teeth.force));
  assert.deepEqual(full.events.filter(row=>row.phase==='tooth').map(row=>row.timing.sample),[4,8,12,16,20,24,28]);
  close(sum(axis(full.tracks.teeth,'impulse',1)),2*.03125);
  const excessive=E.prepare(plan({too:{kind:'chatter',start:0,end:1,slip:[200,0,0],spacing:.00001}}));
  const before=excessive.snapshot();
  assert.throws(()=>excessive.process(1),/tooth rate/);
  assert.deepEqual(excessive.snapshot(),before);
});

test('mechanics publishes measured swept impulse and tangential slip without changing legacy impact events',()=>{
  const world={dt:.1,systems:{body:{kind:'mechanics',config:{gravity:[0,0,0],drag:0,impactEvents:'timed',contactSamples:true,
    bodies:{mass:{position:[0,.9,0],velocity:[2,-10,0],half:[.2,.2,.2],mass:3}}}}}};
  const run=W.runtime.create(world);
  run.step();
  const names=run.view().signals, [hit]=names['body/contact-samples'], [legacy]=names['body/impacts'];
  close(hit.timing.time,.07);
  close(hit.point[0],.14);
  close(hit.point[1],0);
  close(hit.impulse[1],-30);
  close(hit.force[1],-300);
  assert.deepEqual(hit.slip,[2,0,0]);
  assert.equal(hit.forceBasis,'step-average');
  assert.equal(legacy.point,undefined);
  assert.equal(hit.timing.time,legacy.timing.time);
  const imported=E.prepare(plan({received:C.impactTrack(hit,{duration:.003})})).process(90);
  close(sum(axis(imported.tracks.received,'impulse',1)),-30);
  const replay=W.runtime.create(world,{checkpoint:JSON.parse(JSON.stringify(run.checkpoint()))});
  assert.deepEqual(replay.view().signals,run.view().signals);
});

test('the contact block kernel retains vector pins and stamps an onset at a fractional sample',()=>{
  const excitation=plan({hit:{kind:'impact',at:.0044,impulse:[0,.02,0],point:[1,2,3]}});
  const kernel=W.kernels.prepare('contact-exciter',1,{excitation,track:'hit'},{dt:.001});
  const result=kernel.advanceBlock({start:0,end:5});
  assert.deepEqual(result.point,[1,2,3]);
  close(result.force[1],20);
  close(result.contacts[0].timing.fraction,.4);
  assert.equal(result.contacts[0].timing.sample,4);
});

test('sim excite writes an auditable force WAV and contact trace',t=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'ink-contact-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const excitation=plan({hit:{kind:'impact',at:.0044,impulse:[0,.02,0]}});
  fs.writeFileSync(path.join(out,'excitation.json'),JSON.stringify(excitation));
  fs.writeFileSync(path.join(out,'run.json'),JSON.stringify({format:E.runFormat,version:1,excitation:'excitation.json',
    samples:12,audio:{axis:[0,1,0],gain:.025}}));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'sim','excite','run.json','--out','trace.json','--wav','force.wav'],{cwd:out});
  const trace=JSON.parse(fs.readFileSync(path.join(out,'trace.json')));
  assert.equal(trace.format,E.traceFormat);
  close(trace.tracks.hit.force[4*3+1],20);
  close(WAV.read(path.join(out,'force.wav')).samples[4],.5,1/32768);
});
