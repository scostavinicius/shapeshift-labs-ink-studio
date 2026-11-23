const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process'), { createHash } = require('node:crypto');
const ink = require('..'), kit = ink.load(), W = kit.KIT.world;
const { openCheckpointStore } = require('../src/simulation-checkpoint-store.js');
const Measurements = require('../cli/simulation-measurements.js');
const WAV = require('../cli/wav.js');

const fixtures = path.resolve(__dirname, '../examples');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
function recipe(runs, assets) {
  return { format: 'ink-studio/simulation-experiment', version: 1, id: 'lab-check', revision: 2, assets, runs };
}
function workspace(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-experiment-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test('an experiment packages its model, paged state, mesh, authored actions and WAV and replays after relocation', t => {
  const folder = workspace(t), source = path.join(folder, 'source'), moved = path.join(folder, 'moved');
  const at = file => path.join(source, file);
  const model = read(path.join(fixtures, 'simulation-models/sluice.json'));
  save(at('models/sluice.json'), model);
  const session = W.models.session(model);
  session.seek(4);
  const checkpoint = session.checkpoint();
  const { reference } = openCheckpointStore(at('state/store')).save(checkpoint);
  save(at('state/sluice.ref.json'), { ...reference, store: 'store' });
  save(at('state/store/unreferenced.txt'), 'unneeded');
  const commands = [{ tick: 8, input: 'gateOpening', value: .42 }];
  save(at('inputs/gate.json'), commands);
  const baseline = W.models.session(model, { commands });
  baseline.seek(12);
  const outputs = W.models.sample(baseline).outputs;
  assert.equal(outputs.gateOpening, .42);
  save(at('expected/sluice.json'), outputs);

  const mesh = path.join(fixtures, 'reference-experiments/recipes');
  save(at('geometry/membrane.obj'), fs.readFileSync(path.join(mesh, 'membrane.obj')));
  const modes = read(path.join(mesh, 'membrane.bake.json'));
  modes.source.file = '../geometry/membrane.obj';
  save(at('models/modes.json'), modes);
  save(at('expected/mode.json'), 150 * Math.hypot(1 / .9, 1 / .7));

  const sampleRate = 8000, hz = 200;
  const samples = Float64Array.from({ length: 4000 }, (_, i) => .5 * Math.sin(2 * Math.PI * hz * i / sampleRate));
  save(at('reference/tone.wav'), WAV.encode({ sampleRate, channels: 1, samples }));
  save(at('models/measure.json'), {
    format: Measurements.runFormat, version: 1, sources: { ref: { file: '../reference/tone.wav', mode: 'saved' } },
    plan: { format: W.simulationMeasurements.format, version: 1, id: 'tone',
      measurements: { hz: { kind: 'frequency', source: 'ref', band: [180, 220] } } }
  });
  save(at('expected/tone.json'), hz);
  save(at('recipes/lab.json'), recipe({
    resume: { kind: 'model', source: '../models/sluice.json', checkpoint: '../state/sluice.ref.json',
      commands: '../inputs/gate.json', tick: 12, expected: '../expected/sluice.json', select: '/outputs' },
    geometry: { kind: 'modes', source: '../models/modes.json', expected: '../expected/mode.json', select: '/modes/0/hz',
      tolerance: { absolute: 1.5 } },
    reference: { kind: 'measure', source: '../models/measure.json', expected: '../expected/tone.json',
      select: '/measurements/hz/value', tolerance: { absolute: .1 } }
  }));

  const packed = run(source, 'project', 'pack', 'recipes/lab.json', '--root', '.', '--out', '../lab.json');
  assert.equal(packed.status, 0, packed.stderr);
  fs.mkdirSync(moved);
  fs.renameSync(path.join(folder, 'lab.json'), path.join(moved, 'lab.json'));
  fs.renameSync(source, path.join(folder, 'original'));
  const filename = path.join(moved, 'lab.json'), project = ink.readProjectBundle(filename), snapshot = project.snapshot();
  assert.equal(snapshot.version, 3);
  assert.equal(project.experimentDocument().revision, 2);
  assert.ok(project.files().includes('state/store/' + reference.root.slice(0, 2) + '/' + reference.root.slice(2)));
  assert.ok(!project.files().includes('state/store/unreferenced.txt'));
  for (const name of ['geometry/membrane.obj', 'reference/tone.wav', 'inputs/gate.json', 'expected/sluice.json'])
    assert.match(snapshot.files[name]?.sha256, /^[0-9a-f]{64}$/);
  const inspect = run(moved, 'project', 'inspect', 'lab.json');
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).experiment.id, 'lab-check');

  const replay = run(moved, 'project', 'verify', 'lab.json', '--out', 'verification.json');
  assert.equal(replay.status, 0, replay.stderr || fs.readFileSync(path.join(moved, 'verification.json'), 'utf8'));
  const report = read(path.join(moved, 'verification.json'));
  assert.equal(report.engine.matched, true);
  assert.equal(report.status, 'matched');
  assert.deepEqual(report.runs.resume.cursor, { from: 4, to: 12, seed: 27, modelRevision: 1 });
  assert.deepEqual(Object.values(report.runs).map(row => row.passed), [true, true, true]);
  const unpacked = run(moved, 'project', 'unpack', 'lab.json', '--out', 'unpacked');
  assert.equal(unpacked.status, 0, unpacked.stderr);
  assert.equal(read(path.join(moved, 'unpacked/recipes/lab.json')).id, 'lab-check');

  const altered = path.join(moved, 'altered.json'), expected = snapshot.files['expected/mode.json'];
  expected.data = '420';
  save(altered, snapshot);
  assert.throws(() => ink.verifyProjectExperiment(altered), /Corrupt experiment asset: expected\/mode.json/);
  expected.sha256 = createHash('sha256').update(expected.data).digest('hex');
  save(altered, snapshot);
  const divergence = run(moved, 'project', 'verify', 'altered.json');
  assert.equal(divergence.status, 2, divergence.stderr);
  const difference = JSON.parse(divergence.stdout).runs.geometry.difference;
  assert.equal(difference.reason, 'numeric');
  assert.equal(difference.expected, 420);

  const otherEngine = project.snapshot();
  otherEngine.toolkit.runnerHash = '0'.repeat(64);
  save(altered, otherEngine);
  const mismatch = run(moved, 'project', 'verify', 'altered.json');
  assert.equal(mismatch.status, 2, mismatch.stderr);
  assert.equal(JSON.parse(mismatch.stdout).status, 'engine-mismatch');
  assert.deepEqual(JSON.parse(mismatch.stdout).runs, {});
  const comparison = ink.verifyProjectExperiment(altered, { compareEngine: true });
  assert.equal(comparison.passed, true);
  assert.equal(comparison.engine.matched, false);
});

test('portable replay refuses executable solver definitions even under measurement runs', t => {
  const folder = workspace(t), at = name => path.join(folder, name);
  save(at('experiment.json'), recipe({ solver: {
    kind: 'measure', source: 'measurement.json', expected: 'answer.json'
  } }));
  save(at('answer.json'), { passed: true });
  save(at('measurement.json'), {
    format: Measurements.runFormat, version: 1,
    plan: { format: W.simulationMeasurements.format, version: 1, id: 'measure' },
    sources: { solver: { value: { format: 'ink-studio/solve-plan', version: 1,
      method: 'root', bracket: [0, 1], equation: { module: 'equation.cjs' } } } }
  });
  save(at('equation.cjs'), 'throw new Error("executed module")');
  const result = run(folder, 'project', 'pack', 'experiment.json', '--out', 'bundle.json');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /replay needs a declarative equation/);
  assert.ok(!fs.existsSync(at('bundle.json')));
});
