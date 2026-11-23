const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), {KIT:K}=ink.load(), W=K.world,G=W.gestureScores;
const score=(channels,gestures,rate=120)=>({format:G.format,version:1,id:'shutter-score',revision:2,rate,channels,gestures});
const gesture=(id,patch={})=>({id,channel:'level',start:.5,end:1.5,leadIn:.5,release:.5,target:1,curve:'linear',...patch});
const base={type:'number',base:0};
const limited={type:'number',base:0,quantity:{unit:'m',kind:'position'},
  limits:{min:0,max:1,maxSpeed:2,maxAcceleration:5}};
const near=(a,b,tol=1e-12)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const make=asset=>G.prepare(asset);
const copy=value=>JSON.parse(JSON.stringify(value));

test('lead-in, hold and release have explicit phases and keyframed targets',()=>{
  const keys=[{at:0,value:.5},{at:1,value:1.5}];
  const compiled=make(score({level:base},[gesture('open',{target:{keys}})]));
  assert.equal(compiled.requested(0).level.requested,0);
  const lead=compiled.requested(.25).level;
  assert.equal(lead.requested,.25);
  assert.deepEqual(lead.contributors,[{id:'open',priority:0,blend:'replace',weight:.5,phase:'lead-in',target:.5}]);
  assert.equal(compiled.requested(.75).level.requested,.75);
  assert.equal(compiled.requested(1.5).level.contributors[0].phase,'release');
  assert.equal(compiled.requested(1.75).level.requested,.75);
  assert.equal(compiled.requested(2).level.requested,0);
  const hold=gesture('hold',{leadIn:0,release:0,target:{keys,interpolation:'step'}});
  const other=make(score({level:base},[hold]));
  assert.equal(other.requested(.5).level.requested,.5);
  assert.equal(other.requested(1.1).level.requested,.5);
  assert.equal(other.requested(1.5).level.requested,0);
});

test('peer blending, additive offsets, and priority use stable order',()=>{
  const gestures=[gesture('a',{weight:.25,target:4}),gesture('b',{weight:.5,target:2}),
    gesture('trim',{blend:'add',target:.5}),gesture('override',{priority:10,weight:.5,target:0})];
  const asset=score({level:{...base,base:1}},gestures);
  const expected=1.375;
  near(make(asset).requested(1).level.requested,expected);
  assert.deepEqual(make({...asset,gestures:gestures.reverse()}).requested(1),
    make(asset).requested(1));
  const protectedScore=make(score({level:base},[...gestures,gesture('stop',{priority:20,target:.2})]));
  near(protectedScore.requested(1).level.requested,.2);
});

test('one gesture can set several channels with a shared phase and priority',()=>{
  const compiled=make(score({level:base,aim:{type:'vec3',base:[0,0,0]}},[
    {id:'touch',start:.5,end:1.5,leadIn:.5,release:.5,priority:4,curve:'linear',targets:{level:.8,aim:[0,1,2]}}
  ]));
  const at=compiled.requested(.25);
  assert.equal(at.level.requested,.4);
  assert.deepEqual(at.aim.requested,[0,.5,1]);
  for(const lane of Object.values(at))
    assert.deepEqual(lane.contributors.map(({id,phase,weight})=>[id,phase,weight]),[['touch','lead-in',.5]]);
  assert.throws(()=>make(score({level:base},[gesture('conflict',{targets:{level:.8}})])),/named targets/);
});

test('range, speed and acceleration stay bounded through target changes and a release',()=>{
  const asset=score({level:limited},[gesture('open',{start:.1,end:.8,leadIn:0,release:0,target:4}),
    gesture('reverse',{start:.55,end:1.3,leadIn:.05,release:.1,target:-1,priority:3})]);
  const compiled=make(asset), direct=compiled.open(), resumed=compiled.open();
  let previous=0, priorSpeed=0, peak=0, flags=new Set();
  for(let tick=1;tick<=900;tick++){
    direct.advance(tick);
    const row=direct.view().channels.level;
    assert.ok(row.value>=0&&row.value<=1);
    near(row.velocity,(row.value-previous)*asset.rate);
    assert.ok(Math.abs(row.velocity)<=2+1e-12);
    assert.ok(Math.abs(row.velocity-priorSpeed)*asset.rate<=5+1e-10);
    peak=Math.max(peak,row.value);
    for(const flag of row.limits)flags.add(flag);
    previous=row.value;priorSpeed=row.velocity;
  }
  assert.deepEqual([...flags].sort(),['acceleration','range','speed']);
  assert.ok(peak>.1&&previous<.001);
  resumed.advance(102);
  const saved=copy(resumed.snapshot()), opened=compiled.open(saved);
  opened.advance(900);
  assert.deepEqual(opened.snapshot(),direct.snapshot());
  const invalid=copy(saved);
  invalid.waypoint[0]=.5;
  assert.throws(()=>opened.restore(invalid),/Invalid gesture motion checkpoint/);
  assert.deepEqual(opened.snapshot(),direct.snapshot());
  assert.throws(()=>make({...asset,revision:3}).open(saved),/Incompatible/);
});

test('vectors sample keyframed waypoints and enforce independent per-axis limits',()=>{
  const asset=score({level:{type:'vec3',base:[0,0,0],quantity:{unit:'m',frame:'rig'},
    limits:{min:[-1,0,-1],max:[1,2,1],maxSpeed:[1,2,3]}}},
  [gesture('aim',{start:0,end:1,leadIn:0,release:1,target:{keys:[{at:0,value:[-2,1,2]},{at:1,value:[2,3,0]}]}})]);
  const prepared=make(asset);
  assert.deepEqual(prepared.requested(.5).level.target,[0,2,1]);
  const run=prepared.open();
  run.advance(1);
  const row=run.view().channels.level;
  assert.deepEqual(row.value,[-1/120,2/120,3/120]);
  assert.deepEqual(row.limits,[['range','speed'],['speed'],['range','speed']]);
  assert.equal(prepared.info.channels.level.quantity.frame,'rig');
  assert.throws(()=>make(score({level:{...limited,limits:{maxAcceleration:2}}},[])),/motion limits/);
  assert.throws(()=>make(score({level:base},[gesture('same'),gesture('same')])),/repeated gesture/);
  assert.throws(()=>make(score({level:{...limited,quantity:{unit:'m',sampleRate:60}}},[])),/match the score clock/);
});

test('world ports, exact take frames, graph seeks, and shell traces share the same clock',t=>{
  const asset=score({level:{...limited,quantity:{...limited.quantity,sampleRate:120}}},[gesture('open')]);
  const scorePlan=make(asset), player=scorePlan.open();
  const world={dt:1/60,systems:{driver:{kind:'gesture-score',config:{score:asset}},
    sink:{kind:'control',config:{op:'pass'},portQuantities:{inputs:{value:{unit:'m',kind:'position'}}}}},
  connections:[{from:'driver/level',to:'sink/value'}]};
  const run=W.runtime.create(world);
  run.advance(24);
  player.advance(48);
  const checkpoint=copy(run.checkpoint());
  assert.equal(run.view().signals['driver/level'],player.values().level);
  assert.deepEqual(run.query().probe('driver/score').value,player.view());
  run.advance(60);
  const replay=W.runtime.create(checkpoint.world,{checkpoint});
  replay.advance(60);
  assert.deepEqual(replay.checkpoint(),run.checkpoint());

  const definition={format:'ink-studio/graph-project',version:1,nodes:{driver:{op:'sim.gesture-score',inputs:{score:asset}}},
    outputs:{frame:{node:'driver',port:'value'}}};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-gesture-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  write('driver.graph.json',definition);
  write('score.json',asset);
  const graph=ink.readGraphProject(path.join(dir,'driver.graph.json'));
  assert.deepEqual(graph.run({time:.4}).outputs.frame,player.view());
  assert.equal(graph.run({time:.2}).outputs.frame.tick,24);
  const take=ink.createTake({clock:{fps:{numerator:30000,denominator:1001}},graph});
  const shot=take.seek(30);
  assert.equal(shot.graph.outputs.frame.tick,120);
  player.advance(120);
  assert.deepEqual(shot.graph.outputs.frame,player.view());
  assert.deepEqual(graph.run({time:1}).outputs.frame,player.view());
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const call=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'sim','gesture-score','score.json',...args],
    {cwd:dir,encoding:'utf8'}));
  const trace=call('--from-tick','30','--to-tick','49','--every','8','--checkpoint','gesture.checkpoint.json');
  assert.deepEqual(trace.frames.map(row=>row.tick),[30,38,46,49]);
  assert.deepEqual(call('--resume','gesture.checkpoint.json','--t','1').frames,[player.view()]);
});
