const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { KIT:{world:W} } = require('..').load();
const Staging = require('../cli/staging-search.js');

const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const example = path.resolve(__dirname,'../examples/staging-route-search');
const fixture = () => [read(path.join(example,'world.json')),read(path.join(example,'plan.json'))];
const discover = (world,plan,origin=W.runtime.create(world)) => Staging.search(W,Staging.prepare(W,plan,origin),origin);
const scene = commands => ({id:'staging-fixture',dt:.5,history:{enabled:false},commands});
const event = (tick,kind,detail={}) => ({tick,action:'world/event',args:{kind,...detail}});
const patch = (entity,value) => ({action:'world/patch',args:{edits:[{op:'set',path:'/entities/'+entity+'/position',value}]}});
const action = (id,fromTick,...commands) => ({id,fromTick,toTick:fromTick,commands});
const planFor = (until,checks,actions=[]) => ({format:'ink-studio/staging-search',version:1,until,actions,checks});
const dialogue = {id:'reveal',kind:'reveal-during-dialogue',
  start:{kind:'speak'},end:{kind:'finish'},reveal:{kind:'reveal'}};
const cli = (...args) => spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),...args],
  {encoding:'utf8',timeout:20000});

test('breadth-first staging search finds the first reachable failing tick and saves full native routes', () => {
  const [world,plan] = fixture();
  const {report,recordings} = discover(world,plan);
  assert.deepEqual(report.checks.map(({status,tick})=>[status,tick]),[['found',3],['found',3],['found',5]]);
  const [reveal,contact,cue] = report.checks;
  assert.equal(reveal.evidence.dialogue.tick,2);
  assert.equal(contact.evidence.blocker.id,'divider');
  assert.deepEqual(contact.steps.map(step=>step.action),['enter-deck','round-divider','press-latch']);
  assert.equal(cue.evidence.cue.tick,2);
  assert.equal(cue.evidence.due,5);
  assert(cue.evidence.distanceAtQueue<cue.evidence.maxDistance);
  assert(cue.evidence.distanceAtArrival>cue.evidence.maxDistance);
  assert(report.equivalentStates>0);
  for (const check of report.checks) {
    const record = JSON.parse(JSON.stringify(recordings.get(check.id)));
    assert.equal(record.origin.tick,0);
    assert.equal(record.end.tick,check.tick);
    assert.equal(W.runtime.verify(record).status,'verified');
  }
  assert.deepEqual(discover(world,plan).report,report);
});

test('a budget cutoff preserves earlier witnesses and distinguishes unresolved checks', () => {
  const [world,plan] = fixture();
  const cutoff = discover(world,{...plan,maxStates:1}).report;
  assert.equal(cutoff.stop,'budget-exhausted');
  assert.equal(cutoff.completeThrough,0);
  assert.equal(cutoff.visited,1);
  assert(cutoff.checks.every(check=>check.status==='budget-exhausted'));
  const short = discover(world,{...plan,until:4}).report;
  assert.equal(short.completeThrough,4);
  assert.deepEqual(short.checks.map(check=>check.status),['found','found','not-found']);
  const partial = discover(world,{...plan,maxStates:short.visited}).report;
  assert.deepEqual(partial.checks.map(check=>check.status),['found','found','budget-exhausted']);
});

test('same-tick dialogue order and active dialogue survive independent choices with history disabled', () => {
  const world = scene([event(2,'reveal'),event(3,'finish'),event(3,'reveal')]);
  const speak = action('speak',1,{action:'world/event',args:{kind:'speak'}});
  const result = discover(world,planFor(4,[dialogue],[speak])).report.checks[0];
  assert.deepEqual(result.steps,[{tick:1,action:'speak'}]);
  assert.equal(result.tick,2);
  const closed = scene([event(1,'speak'),event(2,'finish'),event(2,'reveal')]);
  assert.equal(discover(closed,planFor(3,[dialogue])).report.checks[0].status,'not-found');
});

test('a mechanical blocker must be between the camera and contact and can be excluded', () => {
  const world = {...scene([event(1,'contact',{at:{entity:'prop',socket:'grip'}})]),
    entities:{lens:{position:[0,1,0]},prop:{position:[1,1,0],sockets:{grip:[1,0,0]}}},
    systems:{solid:{kind:'mechanics',config:{bodies:{
      wall:{position:[1,1,0],fixed:true,half:[.1,1,1]},
      beyond:{position:[3,1,0],fixed:true,half:[.2,1,1]}}}}}};
  const check = {id:'contact',kind:'occluded-contact',event:{kind:'contact'},trace:'solid/ray',
    camera:{entity:'lens'},point:{eventPath:'/at'}};
  const [hit,clear,missing] = discover(world,planFor(2,[check,
    {...check,id:'excluded',exclude:['wall']},{...check,id:'undefined',point:{eventPath:'/missing'}}])).report.checks;
  assert.equal(hit.evidence.blocker.id,'wall');
  assert.deepEqual(hit.evidence.point,[2,1,0]);
  assert.equal(clear.status,'not-found');
  assert.equal(missing.status,'inconclusive');
  assert.equal(missing.unavailable,1);
});

test('cue range is sampled on arrival and ignores cues already out of range when queued', () => {
  const world = {...scene([event(1,'cue',{source:[0,1,0]}),event(2,'cue',{source:[12,1,0],other:true})]),
    entities:{listener:{position:[1,1,0]}}};
  const cue = {id:'cue',kind:'cue-out-of-range',event:{kind:'cue'},emitter:{eventPath:'/source'},
    listener:{entity:'listener'},maxDistance:2,delayTicks:2};
  const leave = action('leave',2,patch('listener',[5,1,0]));
  const returnAtArrival = {...world,commands:[...world.commands,{tick:3,...patch('listener',[2,1,0])}]};
  assert.equal(discover(returnAtArrival,planFor(4,[cue],[leave])).report.checks[0].status,'not-found');
  const result = discover(world,planFor(4,[cue],[leave])).report.checks[0];
  assert.equal(result.tick,3);
  assert.equal(result.evidence.distanceAtArrival,5);
  const other = {...cue,event:{kind:'cue',where:{path:'/other',value:true}}};
  assert.equal(discover(world,planFor(4,[other],[leave])).report.checks[0].status,'not-found');
});

test('search starts from a native checkpoint, preserves pending commands and observes only its new commits', () => {
  const world = scene([event(1,'speak'),event(2,'reveal'),event(3,'speak'),event(4,'reveal')]);
  const run = W.runtime.create(world);
  run.advance(1);
  const checkpoint = JSON.parse(JSON.stringify(run.checkpoint()));
  const origin = W.runtime.create(checkpoint.world,{checkpoint});
  const {report,recordings} = discover(world,planFor(5,[dialogue]),origin);
  assert.equal(report.from,1);
  assert.equal(report.checks[0].tick,4);
  const recording = recordings.get('reveal');
  assert.equal(recording.origin.tick,1);
  assert.equal(W.runtime.verify(JSON.parse(JSON.stringify(recording))).status,'verified');
});

test('CLI writes native witness recordings, verifies them and guards inputs from output collisions', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(),'ink-staging-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const world = path.join(example,'world.json'), plan = path.join(example,'plan.json');
  const capture = cli('sim','search-staging',world,plan,'--out',out,'--json');
  assert.equal(capture.status,0,capture.stderr);
  const report = read(path.join(out,'report.json'));
  assert.deepEqual(JSON.parse(capture.stdout),report);
  const replay = path.join(out,report.checks[0].replay);
  const verify = cli('sim','verify',replay,'--json');
  assert.equal(verify.status,0,verify.stderr);
  assert.equal(JSON.parse(verify.stdout).status,'verified');

  const resumedPlan = path.join(out,'resume.json');
  const revised = {...read(plan),until:6,actions:[],checks:[read(plan).checks[0]]};
  fs.writeFileSync(resumedPlan,JSON.stringify(revised));
  const resumed = cli('sim','search-staging',replay,resumedPlan,'--out',path.join(out,'resumed'),'--json');
  assert.equal(resumed.status,0,resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).from,3);

  fs.copyFileSync(plan,path.join(out,'report.json'));
  const collidingPlan = path.join(out,'report.json');
  const collision = cli('sim','search-staging',world,collidingPlan,'--out',out);
  assert.notEqual(collision.status,0);
  assert.match(collision.stderr,/separate from the staging search inputs/);
  assert.deepEqual(read(collidingPlan),read(plan));
});
