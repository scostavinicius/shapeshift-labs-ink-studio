const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const kit = ink.load();
const courier = require('../examples/motion-review.js')(kit);
const courierPlan = require('../examples/signal-courier-approval.json');
const entry = path.resolve(__dirname, '../cli/ink-studio.js');

test('one export range checks the native palette, contour, motion, transitions and budgets', () => {
  const { report, evidence } = ink.approveShot(courier.build(courier.seed), { plan: courierPlan });
  assert.deepEqual(Object.fromEntries(Object.entries(report.checks).map(([key, check]) => [key, check.status])),
    { palette: 'passed', silhouette: 'passed', motion: 'failed', transition: 'failed', performance: 'passed' });
  assert.equal(report.timing.warmupRendered, 3);
  assert.equal(report.samples.length, 12);
  assert.equal(report.firstFailure.frame, 5);
  assert.equal(report.firstFailure.category, 'motion');
  assert.equal(report.firstFailure.subject, 'Right glove');
  assert.equal(report.firstFailure.check, 'spacing-spike');
  assert.equal(report.firstFailure.evidence.sceneTime, .625);
  assert(report.firstFailure.evidence.focus.points.length > 2);
  const pop = report.findings.find(row => row.category === 'transition');
  assert.equal(pop.frame, 5);
  assert.equal(pop.evidence.previousFrame, 4);
  assert.equal(evidence.frame, 5);
  assert(evidence.image && evidence.previous && evidence.marked);
});

test('failed swatch, silhouette and count budgets expose their subject and measured values', () => {
  const plan = { ...courierPlan, from: 0, frames: 2, fps: { numerator: 30000, denominator: 1001 },
    palette: [{ ...courierPlan.palette[0], swatch: '#ffffff' }],
    silhouette: [{ ...courierPlan.silhouette[0], minPixels: 4096 }], performance: { fragments: 0 } };
  const { report } = ink.approveShot(courier.build(courier.seed), { plan });
  assert.equal(report.samples[1].time, 1001 / 30000);
  assert.equal(report.firstFailure.frame, 0);
  assert.equal(report.firstFailure.category, 'palette');
  assert.equal(report.firstFailure.subject, 'Right glove');
  const contour = report.findings.find(row => row.category === 'silhouette');
  assert.equal(contour.evidence.failures[0].limit, 4096);
  const budget = report.findings.find(row => row.category === 'performance');
  assert.equal(budget.check, 'fragments');
  assert(budget.evidence.value > budget.evidence.max);
});

test('CLI reproduction preserves a trimmed temporal graph, planned cuts and exact evidence pixels', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ink shot's "));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, "shot's scene.js"), `module.exports = ({makeBuilder}) => ({
    id: 'staging', name: 'Staging', seed: 1,
    build() {
      const world = makeBuilder(1,[0x101822]).finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0}});
      world.look = {renderGraph:{passes:[
        {id:'feed',type:'composite',isolated:true,layer:{source({time}) {
          const w=24,h=16,rgba=new Uint8Array(w*h*4),red=time>=1 && time<1.5 ? 220 : 20;
          for(let p=0;p<w*h;p++) rgba.set([red,30,40,224],p*4);
          return {w,h,rgba};
        }}},
        {id:'age',type:'frameAge',fps:4,cameraMotion:'keep',regions:[{mode:'delay',frames:1}]}
      ]}};
      return world;
    }
  });`);
  const plan = { from: 1, fps: 4, frames: 4, warmup: 2, width: 24, height: 16,
    cuts: [{ frame: 0, id: 'Before' }, { frame: 2, id: 'After' }],
    transition: { thresholds: { popFraction: .1 } } };
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(plan));
  const reportFile = path.join(folder, 'report.json');
  const run = spawnSync(process.execPath, [entry, 'shot', 'approve', "shot's scene.js",
    '--plan', 'plan.json', '--out', reportFile, '--transparent'], { encoding: 'utf8', cwd: folder });
  assert.equal(run.status, 2, run.stderr);
  const report = JSON.parse(fs.readFileSync(reportFile));
  assert.equal(report.firstFailure.frame, 1);
  assert.equal(report.firstFailure.category, 'transition');
  assert.equal(report.firstFailure.subject, 'Before');
  assert.equal(report.checks.motion.status, 'not-configured');
  assert.equal(report.checks.performance.status, 'measured');
  assert.equal(report.samples[2].cut, true);
  assert.equal(report.samples[2].transition, undefined);
  const original = report.firstFailure.reproduce;
  assert(run.stdout.includes(original.command));
  fs.writeFileSync(path.join(folder, 'plan.json'), '{}');
  const replay = spawnSync('sh', ['-c', original.command], { encoding: 'utf8' });
  assert.equal(replay.status, 2, replay.stderr);
  const focused = JSON.parse(fs.readFileSync(path.join(folder, 'report-repro-1.json')));
  assert.equal(focused.timing.reviewedFrames, 2);
  assert.deepEqual(focused.plan, plan);
  for (const key of ['image', 'previous']) {
    const read = row => fs.readFileSync(path.join(folder, row.evidence[key]));
    assert.deepEqual(read(focused), read(report));
  }
});
