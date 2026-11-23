const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {KIT:{world:W}} = require('..').load();
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance=1e-12) =>
  assert.ok(Math.abs(actual-expected)<tolerance,actual+' differs from '+expected);

const ramp = ({live = false}) => ({
  combinational:live, initial:()=>0, step:(_,ctx)=>ctx.time,
  outputs:{signal:'number',vector:'vec3'},
  output:signal=>({signal,vector:[signal,signal*2,signal===0?0:-signal]})
});
const sink = () => ({
  inputs:{value:'number',vector:'vec3'}, initial:()=>[],
  step:(state,{input})=>state.concat(input)
});
const options = {implementations:{ramp,sink}};

test('linear interpolation uses exact phase coordinates and serializes shared vector and scalar history', () => {
  const world = {dt:1,causality:true,systems:{
    slow:{kind:'ramp'},fast:{kind:'ramp',schedule:{substeps:4}}, sink:{kind:'sink',schedule:{substeps:4}}
  },connections:[
    {from:'slow/signal',to:'sink/value',sample:'interpolate'},
    {from:'fast/vector',to:'sink/vector',sample:'fractional-delay',delay:0.375}
  ]};
  const run = W.runtime.create(world,options);
  run.advance(2);
  const readings = run.view().states.sink.slice(-4);
  assert.deepEqual(readings.map(row=>row.value),[0.25,0.5,0.75,1]);
  assert.deepEqual(readings.map(row=>row.vector[0]),[0.875,1.125,1.375,1.625]);
  assert.deepEqual(readings.map(row=>row.vector[1]),readings.map(row=>row.vector[0]*2));
  const trace = run.query().trace('world/cause',{}, {port:'sink/vector'}).value;
  assert.equal(trace.nodes[0].parents.length,2);
  assert.equal(trace.nodes[0].data.latencyTicks,0.375);
  const plan = run.composition().execution;
  assert.equal(plan.signals.find(row=>row.to==='sink/vector').crossing.latencyTicks,0.375);
  assert.equal(plan.signals.find(row=>row.to==='sink/value').crossing.latencyTicks,1);
  const saved = plain(run.checkpoint());
  assert.deepEqual(saved.delays,{});
  const resumed = W.runtime.create(saved.world,{...options,checkpoint:saved});
  run.advance(5);
  resumed.advance(5);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(plain(run.recording()),options).checkpoint(),run.checkpoint());
  saved.sampling.$crossings['fast/vector'].values.pop();
  assert.throws(()=>W.runtime.create(saved.world,{...options,checkpoint:saved}),/Invalid saved rate-crossing history/);
});

test('a sub-sample delay with an aligned combinational source preserves dependencies and initialization', () => {
  const world = {dt:1,systems:{a:{kind:'sink'},z:{kind:'ramp',config:{live:true}}},
    connections:[{from:'z/signal',to:'a/value',sample:'fractional-delay',delay:0.5}]};
  const run = W.runtime.create(world,options);
  assert.deepEqual(run.composition().order,['z','a']);
  run.advance(3);
  assert.deepEqual(run.view().states.a.map(row=>row.value),[0.5,1.5,2.5]);
  assert.equal(run.composition().execution.signals[0].publication,'same-phase-if-due');
  const stateful = plain(world);
  delete stateful.systems.z.config;
  assert.throws(()=>W.runtime.validate(stateful,options),/available bracketing samples/);
  const self = {...world,systems:{z:{kind:'pass'}},connections:[{...world.connections[0],to:'z/value',from:'z/value'}]};
  const pass = () => ({combinational:true,initial:()=>0,inputs:{value:'number'},outputs:{value:'number'},
    step:(_,ctx)=>ctx.input.value,output:value=>({value})});
  assert.throws(()=>W.runtime.validate(self,{implementations:{pass}}),/Instantaneous signal cycle/);
});

test('decimation rejects a high-frequency alias and resumes with its filter history intact', () => {
  const kit = require('../examples/simulation-rate-crossings/ink-studio.config.js').load();
  const R = kit.KIT.world.runtime;
  const world = require('../examples/simulation-rate-crossings/bench.world.json');
  const run = R.create(world);
  const filtered = [];
  function onTick(view) {
    if (view.tick % 3 === 0) filtered.push(view.states.meter.at(-1));
  }
  run.advance(61,{onTick});
  const saved = plain(run.checkpoint());
  const resumed = R.create(saved.world,{checkpoint:saved});
  resumed.advance(120);
  run.advance(120,{onTick});
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  const lane = run.composition().execution.signals.find(row=>row.sample==='decimate').crossing;
  assert.equal(lane.taps,193);
  near(lane.latencySeconds,97/240);
  const steady = filtered.filter(row=>row.time>0.95);
  for (const row of steady)
    near(row.filtered,Math.sin(2*Math.PI*3*(row.time-lane.latencySeconds)),0.002);
  assert.ok(steady.some(row=>Math.abs(row.plain-Math.sin(2*Math.PI*3*(row.time-1/240)))>0.5));
  assert.equal(run.composition().execution.resources.memory.crossingHistorySlots,196);
  assert.equal(Object.keys(run.checkpoint().sampling.$crossings).length,2);
});

test('link semantics select conservative totals and ordered events and reject incompatible policies', () => {
  const source = () => ({initial:()=>0,step:n=>n+1,outputs:{pulse:'event',metal:'number'},
    output:n=>({pulse:n?[n]:[],metal:2})});
  const meter = () => ({initial:()=>[],inputs:{pulse:'event',metal:'number'},
    step:(state,{input})=>state.concat(input)});
  const opts = {implementations:{source,meter}};
  const world = {systems:{source:{kind:'source',schedule:{substeps:2}},meter:{kind:'meter',schedule:{every:2}}},
    connections:[
      {from:'source/metal',to:'meter/metal',signal:'accumulated'},
      {from:'source/pulse',to:'meter/pulse',signal:'event'}
    ]};
  const run = W.runtime.create(world,opts);
  run.advance(4);
  assert.deepEqual(run.view().states.meter,[{metal:6,pulse:[1,2,3]},{metal:8,pulse:[4,5,6,7]}]);
  for (const [signal,sample] of [['instantaneous','sum'],['accumulated','interpolate'],['event','hold']]) {
    const invalid = plain(world);
    Object.assign(invalid.connections[0],{signal,sample});
    assert.throws(()=>W.runtime.validate(invalid,opts),/Invalid sampling or signal semantics/);
  }
  const invalid = {systems:{a:{kind:'ramp'},b:{kind:'sink'}},
    connections:[{from:'a/signal',to:'b/value',sample:'decimate'}]};
  assert.throws(()=>W.runtime.validate(invalid,options),/slower consumer/);
  invalid.systems.b.schedule = {every:2};
  invalid.connections[0].filter = {taps:8};
  assert.throws(()=>W.runtime.validate(invalid,options),/odd taps/);
  delete invalid.connections[0].filter;
  invalid.simulationChunks = {levels:[{id:'near',within:5},{id:'sleep',sleep:true}],
    chunks:{observer:{index:[0,0],systems:['b']}}};
  assert.throws(()=>W.runtime.validate(invalid,options),/needs fixed schedules/);
});

test('prefab upgrades preserve retained samples when a fixed-rate source is renamed', () => {
  const kit = require('..').load(), runtime = kit.KIT.world;
  const scene = plain(require('../examples/world-prefab-upgrade.js')(kit));
  delete scene.simulationChunks;
  Object.assign(scene.connections[1],{sample:'interpolate',signal:'instantaneous'});
  const run = runtime.runtime.create(scene);
  run.advance(6);
  const before = run.checkpoint();
  const result = runtime.upgradePrefab(before.world,'lock','sluice.v2',{
    checkpoint:before,migration:require('../examples/world-prefab-upgrade.migration.json')
  });
  assert.ok(result.report.ok,JSON.stringify(result.report.issues));
  const saved = plain(result.checkpoint);
  assert.deepEqual(saved.sampling.$crossings['lock.counter/value'],before.sampling.$crossings['lock.clock/value']);
  const resumed = runtime.runtime.create(saved.world,{checkpoint:saved});
  resumed.step();
  assert.equal(resumed.view().tick,7);
});

test('CLI plans report the explicit signal semantics, filter and fractional latency', () => {
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const cwd = path.resolve(__dirname,'../examples/simulation-rate-crossings');
  const result = JSON.parse(execFileSync(process.execPath,[cli,'sim','plan','bench.world.json'],{cwd,encoding:'utf8'}));
  const lanes = Object.fromEntries(result.execution.signals.map(row=>[row.sample,row]));
  assert.equal(lanes.decimate.signal,'instantaneous');
  assert.equal(lanes.decimate.crossing.taps,193);
  assert.equal(lanes['fractional-delay'].delay,0.375);
  assert.equal(lanes.interpolate.crossing.latencyTicks,1);
});
