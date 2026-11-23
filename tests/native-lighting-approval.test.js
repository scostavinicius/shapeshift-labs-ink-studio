const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');

const fixture = require('../examples/native-lighting-approval/signal-box.json');
const rig = require('../examples/native-lighting-approval/starting-rig.json');
const { prepare } = require('../cli/native-lighting-approval.js');
const { prepareLightSearch } = require('../cli/shot-light-search.js');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');

test('the multi-grid plan validates named scopes, checks, and native sizes', () => {
  assert.deepEqual(prepare(fixture).grids.map(grid => grid.width), [96, 144, 192]);
  assert.throws(() => prepare({ ...fixture, grids: [fixture.grids[0]] }), /two to six/);
  assert.throws(() => prepare({ ...fixture, grids: [fixture.grids[0], { ...fixture.grids[0], id: 'two' }] }),
    /sizes must be distinct/);
  assert.throws(() => prepare({ ...fixture, checks: [{ ...fixture.checks[0], grids: ['misspelled'] }] }), /known grids/);
  assert.throws(() => prepare(fixture, { raw: true }), /palette-enabled/);
});

test('exclusive exact swatch demands on the same selected pixels are defensibly incompatible', () => {
  const kit = ink.load(), scene = require('../examples/native-lighting-approval/signal-box.js')(kit);
  const world = scene.build(scene.seed);
  const swatch = (id, subject, color, minShare) => ({ id, subject, type: 'swatch', swatch: color, minShare, grids: ['first'] });
  const plan = { ...fixture, evaluations: 1,
    grids: [{ id: 'first', width: 48, height: 32 }, { id: 'second', width: 72, height: 48 }],
    subjects: [fixture.subjects[1], { id: 'alias', select: { object: 'lever-accent' } },
      { id: 'hidden', select: { object: 'absent' } }],
    checks: [swatch('copper', 'lever', '#c77f5d', .66), swatch('amber', 'alias', '#e6a26e', .56),
      { id: 'missing', subject: 'hidden', type: 'readability', grids: ['second'], minLightnessP10: .05 }] };
  const { report } = ink.fitNativeLighting(world, { plan, rig, kit });
  assert.equal(report.passed, false);
  assert.deepEqual(report.conflicts[0].checks, ['copper', 'amber']);
  assert(report.conflicts[0].minimumShare > 1);
  assert.equal(report.rows.find(row => row.id === 'amber').diagnostic, 'incompatible-swatch-shares');
  assert.equal(report.rows.find(row => row.id === 'missing').diagnostic, 'subject-not-visible');
  assert.equal(report.work.nativeRenders, 2);
});

test('shared search keeps scaled emitter dimensions inside native limits', () => {
  const starter = { ...rig, key: { ...rig.key, size: [.001, 1000] } };
  const { parameters, candidate } = prepareLightSearch({}, { rig: starter });
  assert.equal(parameters.size, undefined);
  const values = Object.fromEntries(Object.entries(parameters).map(([name, row]) => [name, row.initial]));
  assert.deepEqual(candidate(values).key.size, starter.key.size);
});

test('the fitted rig replays at each native size and reports a tested grid trade-off', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-native-approval-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'plan.json'), out = path.join(directory, 'out');
  const example = name => path.resolve(__dirname, '../examples/native-lighting-approval', name);
  fs.writeFileSync(input, JSON.stringify({ ...fixture, title: 'Signal box </script>', scene: example(fixture.scene),
    rig: example(fixture.rig), evaluations: 7 }));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.match(run('shot', 'light-approve', input, '--out', out), /Approved 3\/4 grid checks/);
  const load = file => JSON.parse(fs.readFileSync(path.join(out,file), 'utf8'));
  const report = load('approval.json');
  assert.deepEqual(report.summary, { before: 2, after: 3, total: 4 });
  assert.equal(report.work.nativeRenders, report.work.evaluations * 3);
  const visor = report.rows.find(row => row.id === 'visor-readability');
  assert(visor.before.metrics.lightnessP10 < .055 && visor.after.metrics.lightnessP10 >= .055);
  const missed = report.rows.find(row => row.id === 'muted-closeup');
  assert.equal(missed.diagnostic, 'trade-off-observed');
  assert(missed.bestObserved.metrics.share >= .92);
  assert(missed.witness.regressed.some(row => row.id === 'copper-accent'));
  assert.doesNotThrow(() => ink.load().KIT.shotLighting.prepare(missed.witness.rig));
  const html = fs.readFileSync(path.join(out,'index.html'), 'utf8');
  const data = JSON.parse(html.match(/id="approval-data">(.*)<\/script>/)[1]);
  assert.deepEqual(data.report, report);
  assert.deepEqual(data.rig, load('rig.json'));
  for (const { id, width, height } of report.grids) {
    const replay = path.join(directory, id + '.png');
    run('render', example(fixture.scene), '--w', String(width), '--h', String(height), '--px', '1',
      '--shot-lighting', path.join(out, 'rig.json'), '--out', replay);
    const native = fs.readFileSync(path.join(out,id+'-fitted.png'));
    assert.deepEqual([native.readUInt32BE(16), native.readUInt32BE(20)], [width, height]);
    assert(native.equals(fs.readFileSync(replay)));
  }
});
