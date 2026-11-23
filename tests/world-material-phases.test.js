const test = require('node:test');
const assert = require('node:assert/strict');
const kit = require('..').load(), { world: W } = kit.KIT;
const rim = [[2,1,1], [3,1,1], [4,1,1]];
const water = rim.map(([x,,z]) => ({ at:[x,z], liquid:1.2, temperature:4 }));
const cold = { min:[1,.5], max:[2.5,1], temperature:-24, rate:2.8 };
const warm = { min:[3,0], max:[8,1.5], temperature:32, rate:2.5 };
const action = (tick, verb, args) => ({ tick, action:'spill/' + verb, args });
const lift = (tick, velocity) => action(tick,'lift',{ body:'slab', cells:rim, velocity });
const read = (run, name) => run.query().probe('spill/' + name).value;
const clone = value => JSON.parse(JSON.stringify(value));
const close = (a,b) => assert(Math.abs(a-b) < 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), a + ' differs from ' + b);

function definition(phase, commands = []) {
  return { id:'test-spillway', dt:.08, visual:{ volume:'spill' }, commands,
    systems:{ spill:{ kind:'material-cells', config:{
      size:[16,5,3], cell:.5, gravity:[0,0,0], drag:0, materials:{ frost:{ density:8, specificHeat:2 } },
      phase:{ material:'frost', layer:1, latentHeat:20, leveling:0, ...phase }
    } } } };
}

test('a liquid patch freezes, drifts as one body, and melts by parcel into the downstream field', () => {
  const source = definition({ initial:water, climate:[cold,warm] }, [lift(9,[1.9,0,0])]);
  const run = W.runtime.create(source);
  const baseline = read(run,'balance');
  let saved, passes;
  for (let tick=1; tick<=28; tick++) {
    run.step();
    const ledger = read(run,'balance');
    close(ledger.mass,baseline.mass);
    close(ledger.massError,0);
    close(ledger.energy,baseline.energy+ledger.phaseEnergy);
    close(ledger.energyError,0);
    if(tick===10) {
      const body=read(run,'pieces').slab;
      assert.equal(body.cells.length,3);
      assert.equal(body.body.collider.parts.length,3);
      assert(body.cells.every(row=>row.temperature<0));
      saved=clone(run.checkpoint());
      const visible=W.visual(kit,run.view(),run.query());
      passes=W.query.fromScene(visible);
    }
    if(tick===19)assert.equal(read(run,'pieces').slab.cells.length,2);
  }
  assert(passes.select({entity:'slab',material:'frost'}).length);
  assert(passes.select({material:'frost-liquid'}).length);
  const births=run.history.filter(row=>row.kind==='material-freeze');
  const melts=run.history.filter(row=>row.kind==='material-melt');
  assert.equal(births.length,3);
  assert.deepEqual(melts.map(e=>e.parcel).sort(),births.map(e=>e.parcel).sort());
  assert(melts.every(e=>e.body==='slab'&&e.destination[0]>=6&&e.energy>=566.3-1e-8));
  assert(melts[0].tick<melts[1].tick&&melts[1].tick<melts[2].tick);
  close(read(run,'balance').liquidMass,3);
  close(read(run,'balance').fieldIceMass,.6);
  assert.equal(read(run,'balance').solidMass,0);
  const reopened=W.runtime.create(source,{checkpoint:saved});
  reopened.advance(28);
  assert.deepEqual(reopened.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(clone(run.recording())).checkpoint(),run.checkpoint());
  const tampered=clone(saved);
  tampered.states.spill.phase.liquid[0]=.25;
  assert.throws(()=>W.runtime.create(source,{checkpoint:tampered}),/does not balance/);
});

test('transport pools liquid on the upstream side of a closed column and carries its heat', () => {
  const closed=Array.from({length:3},(_,z)=>[5,z]);
  const run=W.runtime.create(definition({ closed, current:[2,0], initial:[{at:[0,1],liquid:1.5,temperature:14}] }));
  run.advance(24);
  const rows=read(run,'phases'), pooled=rows.find(row=>row.at[0]===4);
  assert(pooled.liquid>1.45);
  assert(rows.every(row=>row.at[0]<5));
  for(const row of rows)close(row.temperature,14);
  const ledger=read(run,'balance');
  close(ledger.liquidMass,1.5);
  close(ledger.phaseEnergy,0);
  close(ledger.energyError,0);
});

test('melting a connecting parcel preserves the position and motion of both rigid remnants', () => {
  const start=rim.map(([x,,z])=>({at:[x,z],ice:1,temperature:-5}));
  const run=W.runtime.create(definition({initial:start},[
    lift(2,[.25,0,0]),action(3,'heat',{body:'slab',at:rim[1],energy:40})
  ]));
  run.advance(2);
  const before=read(run,'pieces').slab.cells.map(row=>row.point);
  run.step();
  assert(run.events.some(event=>event.kind==='material-melt-split'));
  const pieces=Object.values(read(run,'pieces'));
  assert.equal(pieces.length,2);
  assert(pieces.every(piece=>piece.body.collider.parts.length===1&&piece.body.velocity[0]===.25));
  const after=pieces.map(piece=>piece.body.position).sort((a,b)=>a[0]-b[0]);
  close(after[0][0]-before[0][0],.25*.08);
  close(after[1][0]-before[2][0],.25*.08);
  close(read(run,'balance').liquidMass,1);
  close(read(run,'balance').energyError,0);
  assert.deepEqual(W.runtime.replay(clone(run.recording())).checkpoint(),run.checkpoint());
});

test('a hot piece outside the receiving grid retains its inventory and stays within its thermal bounds', () => {
  const start=rim.map(([x,,z])=>({at:[x,z],ice:1,temperature:-5}));
  const source=definition({initial:start,depositSpread:0,
    climate:[{min:[8.1,0],max:[150,1.5],temperature:10000,rate:4}]},[lift(2,[14,0,0])]);
  const run=W.runtime.create(source);
  run.advance(65);
  const piece=read(run,'pieces').slab;
  assert.equal(piece.cells.length,3);
  assert(piece.cells.every(row=>row.temperature<=10000&&row.temperature>9900));
  assert.equal(run.history.filter(e=>e.kind==='material-melt').length,0);
  close(read(run,'balance').massError,0);
  close(read(run,'balance').energyError,0);
  assert.deepEqual(W.runtime.create(source,{checkpoint:clone(run.checkpoint())}).checkpoint(),run.checkpoint());
});
