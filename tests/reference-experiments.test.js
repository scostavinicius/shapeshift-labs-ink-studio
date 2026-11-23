const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..');
const {defaultSuite}=require('../cli/reference-experiments.js');

function near(actual,expected,tolerance){
  assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected} by more than ${tolerance}`);
}

test('shipped reference experiments satisfy independent physical checks',()=>{
  const {report,captures}=ink.runReferenceExperiments();
  assert.deepEqual(report.experiments.map(row=>row.id),
    ['open-tube','closed-tube','damped-oscillator','membrane','tank-drain','heat-slab','two-body-impact']);
  for(const row of report.experiments)assert.ok(row.passed,JSON.stringify(row.checks));
  assert.equal(report.passed,true);
  const results=Object.fromEntries(report.experiments.map(row=>[row.id,row]));
  const open=results['open-tube'].checks, closed=results['closed-tube'].checks;
  near(open.fundamental.value,125,.01);
  near(closed.fundamental.value,62.5,.01);
  assert.ok(open.reflectedPressure.value<-.3);
  assert.ok(closed.reflectedPressure.value>.3);
  assert.equal(open.boundary.value,0);
  near(closed.boundary.value,0,1e-12);
  assert.ok(results['damped-oscillator'].checks.displacement.value<1e-7);
  assert.ok(results['damped-oscillator'].checks.energy.value<1e-8);
  near(results.membrane.checks.pickupFrequency.value,270.48,.05);
  assert.equal(results.membrane.checks.pinnedPickup.value,0);
  const tank=captures['tank-drain'];
  assert.ok(tank.rows.at(-1).volume<tank.volume/10);
  near(tank.rows.at(-1).volume+tank.rows.at(-1).escaped,tank.volume,1e-12);
  assert.ok(results['heat-slab'].checks.continuousDiffusion.value<.01);
  assert.ok(results['heat-slab'].checks.heatBalance.value<1e-8);
  const impact=results['two-body-impact'];
  near(impact.evidence.contact.timing.time,.503333333333,1e-10);
  near(impact.checks.impulse.value,2.7,1e-10);
  near(impact.checks.stepAverageForce.value,54,1e-8);
  assert.equal(impact.evidence.contact.forceBasis,'step-average');
});

test('the CLI runs copied recipes and writes the failed comparison report for CI',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-reference-recipes-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.cpSync(path.dirname(defaultSuite),dir,{recursive:true});
  const suite=path.join(dir,'suite.json'), report=path.join(dir,'result.json');
  const run=id=>spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'sim','reference',id,'--suite',suite,'--out',report],{cwd:os.tmpdir(),encoding:'utf8'});
  const pass=run('membrane');
  assert.equal(pass.status,0,pass.stderr);
  const result=()=>JSON.parse(fs.readFileSync(report,'utf8'));
  assert.deepEqual(result(),ink.runReferenceExperiments({id:'membrane'}).report);

  const file=path.join(dir,'tank-drain.world.json'), world=JSON.parse(fs.readFileSync(file,'utf8'));
  world.systems.hydraulics.config.leaks.drain.maxFlow=.2;
  fs.writeFileSync(file,JSON.stringify(world));
  const fail=run('tank-drain');
  assert.equal(fail.status,2,fail.stderr);
  const {passed,experiments:[{id,checks}]}=result();
  assert.equal(id,'tank-drain');
  assert.equal(passed,false);
  assert.equal(checks.discreteDrain.passed,false);
  assert.equal(checks.continuousDrain.passed,false);
  assert.equal(checks.waterBalance.passed,true);
});
