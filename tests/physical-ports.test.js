const assert = require('node:assert/strict');
const {test} = require('node:test');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const {KIT: K} = ink.load(), W = K.world, U = K.quantities;
const {clone} = K.procedural.data;
const pump = require('../examples/physical-ports/pump.world.json');
const graphDemo = require('../examples/physical-ports/pressure.graph.json');
const sluice = require('../examples/simulation-models/sluice.json');

test('physical units classify dimensions, distinguish scale, and convert explicit values', () => {
  assert.deepEqual(U.unit('Pa').dimension,{mass:1,length:-1,time:-2});
  assert.deepEqual(U.unit('N/m^2'),U.unit('Pa'));
  assert.deepEqual(U.unit('m³/s').dimension,{length:3,time:-1});
  assert.doesNotThrow(() => U.assertLink({unit:'mL'},{unit:'cm^3'},'a','b'));
  assert.throws(() => U.unit('degC/s'), /invalid physical unit/);
  assert.throws(() => U.unit('sprockets'), /invalid physical unit/);
  assert.throws(() => U.assertLink({unit:'world'},{unit:'m'},'a','b'), /cannot supply/);
  assert.equal(U.converter({unit:'kPa'},{unit:'Pa'})(12.5),12500);
  assert.deepEqual(U.converter({unit:'cm/s'},{unit:'m/s'})([100,0,-50]),[1,0,-0.5]);
  assert.equal(U.converter({unit:'°C'},{unit:'K'})(0),273.15);
  assert.throws(() => U.converter({unit:'Pa',positive:'in'},{unit:'Pa',positive:'out'}), /positive direction/);
});

test('world plans diagnose incompatible units, frames, directions and sampling before solving', () => {
  const plan = W.runtime.create(pump).composition();
  assert.equal(plan.systems.pump.writes.outputs['flow.branch'].quantity.sampleRate,20);
  assert.equal(plan.systems.meter.reads.inputs.value.quantity.sampleRate,10);
  const bad = clone(pump);
  bad.connections[1].from = 'pump/pressure.supply';
  assert.throws(() => W.runtime.validate(bad), /pump\/pressure\.supply -> meter\/value: Pa \(mass length\^-1 time\^-2\) cannot supply m\^3\/s/);
  const incompatible = (change, message) => {
    const world = clone(pump);
    change(world,world.systems.meter.portQuantities.inputs.value);
    assert.throws(() => W.runtime.validate(world),message);
  };
  incompatible((_, quantity) => quantity.unit = 'L/s', /different scales or offsets/);
  incompatible((_, quantity) => quantity.frame = 'tank', /coordinate frame pump-branch cannot supply tank/);
  incompatible((_, quantity) => quantity.positive = 'return-to-supply', /positive direction/);
  incompatible(world => delete world.connections[1].sample, /sample rate 20 Hz cannot supply 10 Hz/);
  incompatible((_, quantity) => quantity.sampleRate = 48, /does not match its schedule/);
  incompatible(world => delete world.systems.pump.portQuantities, /source has no physical quantity/);
  incompatible(world => world.systems.meter.portQuantities.inputs.misspelled = {unit:'Pa'}, /Unknown port/);
  const run = W.runtime.create(pump);
  run.advance(8);
  assert.ok(run.view().signals['meter/value'] > 0);
});

test('world plans require a policy for physical links from a variable-rate system', () => {
  const world = clone(pump);
  world.simulationChunks = {
    grid:{dimensions:2,size:8},
    levels:[{id:'full',within:2,every:1},{id:'coarse',within:14,every:2},{id:'sleep',sleep:true}],
    chunks:{bench:{index:[0,0],systems:['pump']}}
  };
  assert.throws(()=>W.runtime.validate(world),/variable sample rates need an explicit world sampling policy/);
  world.connections[0].sample = 'hold';
  const plan = W.runtime.create(world).composition();
  const port = plan.systems.pump.writes.outputs['pressure.supply'];
  assert.deepEqual(port.sampleRates,[20,10]);
  assert.equal(port.quantity.sampleRate,undefined);
});

test('a native world can adapt scale explicitly without changing physical semantics', () => {
  const world = clone(pump);
  const pressure = {unit:'kPa',kind:'gauge-pressure'};
  world.systems.kilo = {kind:'quantity-convert',config:{from:{unit:'Pa',kind:'gauge-pressure'},to:pressure}};
  world.systems.gauge.portQuantities.inputs.value = pressure;
  world.connections[0].from = 'kilo/value';
  world.connections.push({from:'pump/pressure.supply',to:'kilo/value'});
  const run = W.runtime.create(world);
  run.step();
  const priorPressure = run.view().signals['pump/pressure.supply'];
  run.step();
  assert.equal(run.view().signals['gauge/value'],priorPressure/1000);
});

test('simulation model ports retain their physical metadata at the enclosing world rate', () => {
  const model = clone(sluice);
  model.operators.basin.portQuantities = {outputs:{'depth.outlet':{unit:'world',kind:'depth',sampleRate:40}}};
  assert.equal(W.runtime.create(model).composition().systems.basin.writes.outputs['depth.outlet'].quantity.sampleRate,40);
  const parent = W.runtime.create({dt:0.1,systems:{sluice:W.models.system(model)}});
  assert.deepEqual(parent.composition().systems.sluice.writes.outputs.outletDepth.quantity,
    {unit:'world',kind:'depth',sampleRate:10});
  parent.advance(6);
  assert.ok(parent.view().signals['sluice/outletDepth'] > 0.05);
});

test('graph plans preserve quantities through group outputs and require exact linked metadata', () => {
  const pressure = {unit:'Pa',kind:'gauge-pressure',frame:'tank',positive:'into-tank',
    sampleRate:{numerator:60000,denominator:2002}};
  const accept = {inputs:{value:{type:'number',quantity:pressure}},outputs:{value:'number'},
    run:({value})=>({value})};
  const group = {inputs:{pressure:{type:'number',quantity:pressure}},nodes:{},outputs:{value:{input:'pressure'}}};
  const project = {format:'ink-studio/graph-project',version:1,groups:{Pressure:group},
    nodes:{source:{op:'Pressure',inputs:{pressure:58}},sink:{op:'accept',inputs:{value:{node:'source'}}}},
    outputs:{value:{node:'sink'}}};
  const graph = ink.createGraphProject(project,{operations:{accept}});
  const planned = graph.plan().nodes[1].inputs.value;
  assert.deepEqual(planned.quantity.sampleRate,{numerator:30000,denominator:1001});
  assert.deepEqual(planned.source.quantity,planned.quantity);
  assert.equal(graph.run().outputs.value,58);
  const mismatch = (quantity, message) => {
    const input = {value:{type:'number',quantity:{...pressure,...quantity}}};
    assert.throws(()=>ink.createGraphProject(project,{operations:{accept:{...accept,inputs:input}}}),message);
  };
  mismatch({unit:'m^3/s'},/source\.value -> sink\.value.*cannot supply m\^3\/s/);
  mismatch({unit:'kPa'},/explicit unit conversion/);
  mismatch({kind:'absolute-pressure'},/quantity kind/);
  mismatch({frame:'world'},/coordinate frame/);
  mismatch({positive:'out-of-tank'},/positive direction/);
  mismatch({sampleRate:60},/sample rate 30000\/1001 Hz cannot supply 60 Hz/);
  assert.equal(ink.createGraphProject(graphDemo).run().outputs.pressure,12500);
});

test('the normal CLI plan rejects the miswired pump and reports the graph conversion', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-physical-ports-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const cli = (...args) => spawnSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),...args],
    {cwd:root,encoding:'utf8'});
  const bad = clone(pump);
  bad.connections[1].from = 'pump/pressure.supply';
  fs.writeFileSync(path.join(root,'bad.json'),JSON.stringify(bad));
  const rejected = cli('sim','plan','bad.json');
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/Pa .*cannot supply m\^3\/s/);
  const valid = cli('graph','plan',path.join(__dirname,'../examples/physical-ports/pressure.graph.json'));
  assert.equal(valid.status,0,valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout).outputs.pressure.quantity,{unit:'Pa',kind:'gauge-pressure',sampleRate:20});
});
