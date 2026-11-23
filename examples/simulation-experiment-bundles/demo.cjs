/* Build and replay an experiment in a fresh directory, then render its review. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('../..'), kit = studio.load(), K = kit.KIT, W = K.world;
const PNG = require('../../cli/png.js'), WAV = require('../../cli/wav.js');
const { write, json } = require('../../cli/asset-files.js');
const modal = require('../../cli/modal-resonator.js');
const { runFormat: measurementFormat } = require('../../cli/simulation-measurements.js');
const { openCheckpointStore } = require('../../src/simulation-checkpoint-store.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/experiment-bundles');
const fixtures = path.resolve(__dirname, '..'), cli = path.resolve(__dirname, '../../cli/ink-studio.js');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const sampleRate = 24000, fromSample = 4800, framesPerCase = 28, fps = 10;

function experiment(work) {
  const source = path.join(work, 'authored');
  const file = name => path.join(source, name);
  const command = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: work, encoding: 'utf8' });
  const model = read(path.join(fixtures, 'simulation-models/sluice.json'));
  const gateCommands = [{ tick: 8, input: 'gateOpening', value: .42 }];
  const run = W.models.session(model, { commands: gateCommands });
  const water = Array.from({ length: 13 }, (_, tick) => {
    run.seek(tick);
    return W.models.sample(run).outputs;
  });
  const checkpointRun = W.models.session(model);
  checkpointRun.seek(4);
  const checkpoint = checkpointRun.checkpoint();
  const store = openCheckpointStore(file('state/store'));
  const { reference } = store.save(checkpoint);
  json(file('state/sluice.ref.json'), { ...reference, store: 'store' });
  json(file('models/sluice.json'), model);
  json(file('inputs/gate.json'), gateCommands);
  json(file('expected/sluice.json'), water.at(-1));

  const mesh = path.join(fixtures, 'reference-experiments/recipes');
  const bake = read(path.join(mesh, 'membrane.bake.json'));
  bake.source.file = '../geometry/membrane.obj';
  write(file('geometry/membrane.obj'), fs.readFileSync(path.join(mesh, 'membrane.obj')));
  json(file('models/membrane.bake.json'), bake);
  const asset = modal.bake(kit, bake, file('models/membrane.bake.json'));
  json(file('models/membrane.modes.json'), asset);
  const playback = { format: W.resonantModes.runFormat, version: 1, asset: 'membrane.modes.json',
    settings: { sampleRate } };
  const strike = { excitation: 'strike', sample: 0, value: .006 };
  const secondStrike = { ...strike, sample: 18000, value: .0045 };
  const full = modal.run(kit, { ...playback, samples: 28800, impulses: [strike, secondStrike] }, file('models/full.json'));
  const warm = modal.run(kit, { ...playback, samples: fromSample, impulses: [strike] }, file('models/warm.json'));
  const resume = { ...playback, samples: full.end - fromSample, checkpoint: '../state/membrane.json', impulses: [secondStrike] };
  const expected = full.pickups.center.slice(fromSample);
  json(file('state/membrane.json'), warm.checkpoint);
  json(file('models/membrane.resume.json'), resume);
  json(file('expected/resumed-pickup.json'), expected);
  const continuation = modal.run(kit, resume, file('models/membrane.resume.json')).pickups.center;
  assert.deepEqual(continuation, expected);

  // A separate closed-form reference for the fundamental of the fixed rectangular membrane.
  const analyticHz = bake.source.speed * Math.hypot(1 / .9, 1 / .7) / 2;
  const referenceTone = Float64Array.from({ length: sampleRate }, (_, i) =>
    .6 * Math.sin(2 * Math.PI * analyticHz * i / sampleRate));
  write(file('reference/analytic-tone.wav'), WAV.encode({ channels: 1, sampleRate, samples: referenceTone }));
  json(file('models/reference.measure.json'), { format: measurementFormat, version: 1,
    plan: { format: W.simulationMeasurements.format, version: 1, id: 'membrane-frequency',
      measurements: { peak: { kind: 'frequency', source: 'reference', band: [230, 310] } } },
    sources: { reference: { file: '../reference/analytic-tone.wav', mode: 'saved' } } });
  json(file('expected/frequency.json'), analyticHz);

  const recipe = {
    format: 'ink-studio/simulation-experiment', version: 1, id: 'sluice-and-membrane', revision: 1,
    assets: {
      geometry: { membrane: '../geometry/membrane.obj' },
      inputs: { gate: '../inputs/gate.json' },
      references: { analyticalMembrane: '../reference/analytic-tone.wav' }
    },
    runs: {
      'sluice-resume': { kind: 'model', source: '../models/sluice.json', checkpoint: '../state/sluice.ref.json',
        commands: '../inputs/gate.json', tick: 12, select: '/outputs', expected: '../expected/sluice.json' },
      'mesh-frequency': { kind: 'modes', source: '../models/membrane.bake.json', select: '/modes/0/hz',
        expected: '../expected/frequency.json', tolerance: { absolute: 1.5 } },
      'membrane-resume': { kind: 'native', source: '../models/membrane.resume.json',
        select: '/pickups/center', expected: '../expected/resumed-pickup.json' },
      'reference-wav': { kind: 'measure', source: '../models/reference.measure.json',
        select: '/measurements/peak/value', expected: '../expected/frequency.json', tolerance: { absolute: .05 } }
    }
  };
  const entry = file('recipes/combined.json'), packageFile = path.join(work, 'experiment.json');
  json(entry, recipe);
  command('project', 'pack', entry, '--root', source, '--out', packageFile);
  fs.renameSync(source, path.join(work, 'original-source-moved'));
  const relocated = path.join(work, 'relocated');
  fs.mkdirSync(relocated);
  const archive = path.join(relocated, 'sluice-and-membrane.project.json');
  fs.renameSync(packageFile, archive);
  const runFromArchive = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: relocated, encoding: 'utf8' });
  const report = JSON.parse(runFromArchive('project', 'verify', path.basename(archive)));
  const inventory = JSON.parse(runFromArchive('project', 'inspect', path.basename(archive)));
  assert.ok(report.engine.matched && report.passed);
  const packed = path.join(out, path.basename(archive));
  write(packed, fs.readFileSync(archive));
  json(path.join(out, 'verification.json'), report);
  json(path.join(out, 'inventory.json'), inventory);
  return { report, inventory, water, model, asset, analyticHz, full: full.pickups.center, continuation,
    archiveSize: fs.statSync(archive).size };
}

const colors = {
  bg: '#111d29', panel: '#1c2f40', well: '#142534', line: '#3b5063', ink: '#f1f0e4',
  dim: '#a8bbca', aqua: '#84d9c0', blue: '#96c9ea', gold: '#edbe77', lilac: '#d8b5ef'
};
const { bg, panel, well, line, ink, dim, aqua, blue, gold, lilac } = colors;
const width = 960, height = 540;
function canvas(title, caption, color) {
  const commands = [];
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (label, x, y, scale, color = ink) => commands.push({
    type: 'text', text: String(label), at: [Math.round(x), Math.round(y)], scale, color
  });
  const stroke = (points, color, width = 1) => commands.push({ type: 'path', points, stroke: color, width });
  const polygon = (points, fill) => commands.push({ type: 'polygon', points, fill });
  rect(0, 0, width, height, bg);
  rect(30, 27, 22, 4, color);
  text('INK STUDIO / SIMULATION EXPERIMENTS', 65, 22, 2, color);
  text(title, 30, 63, 5);
  text(caption, 31, 116, 2, dim);
  return { rect, text, stroke, polygon,
    finish: () => PNG.packRGBA(K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' })) };
}
function metric(d, label, value, y, color, scale = 3) {
  d.text(label, 663, y, 2, dim);
  d.text(value, 662, y + 23, scale, color);
}
function axes(d, x, y, w, h) {
  d.rect(x, y, w, h, well);
  for (let i = 1; i < 4; i++) d.stroke([[x, y + h * i / 4], [x + w, y + h * i / 4]], line);
}
function inventoryFrame(data, t) {
  const d = canvas('One portable experiment', 'A SLUICE MODEL AND A MESH MEMBRANE IN ONE ARCHIVE', aqua);
  const entries = [
    ['Model, seed and operator revision', 'SLUICE / SEED ' + data.model.seed + ' / WATER R' + data.model.operators.basin.revision],
    ['Geometry and timed input', 'MEMBRANE.OBJ / GATE.JSON'],
    ['Reference and expected results', 'ANALYTIC WAV / JSON BASELINES'],
    ['Two checkpoints', 'WORLD TICK 4 / AUDIO SAMPLE ' + fromSample],
    ['Engine and file fingerprints', data.report.engine.expected.sourceHash.slice(0, 12).toUpperCase() + ' / SHA-256']
  ];
  const n = Math.min(entries.length, 1 + Math.floor(t * 9));
  for (const [i, [label, value]] of entries.entries()) {
    const y = 157 + 67 * i;
    d.rect(30, y, 586, 57, panel);
    d.rect(30, y, 4, 57, i < n ? aqua : line);
    d.text(label, 49, y + 8, 2);
    d.text(i < n ? value : ' ', 50, y + 35, 1, dim);
  }
  d.rect(641, 157, 289, 325, panel);
  metric(d, 'PACKAGE SIZE', Math.round(data.archiveSize / 1024) + ' KIB', 182, blue, 4);
  metric(d, 'PACKAGED FILES', data.inventory.files.length, 274, ink, 4);
  metric(d, 'AFTER RELOCATION', t > .45 ? '4 / 4 PASSED' : 'VERIFYING', 366, aqua, 3);
  d.text('PROJECT PACK   /   PROJECT VERIFY', 31, 511, 2, aqua);
  return d.finish();
}
function sluiceFrame(data, t) {
  const d = canvas('Resume the sluice', 'GATE INPUT AND OUTLET DEPTH SHARE THE WORLD CLOCK', blue);
  const { water, report } = data, cursor = report.runs['sluice-resume'].cursor;
  const tick = Math.min(12, Math.round(12 * t)), state = water[tick];
  d.rect(30, 157, 586, 325, panel);
  const x = 52, y = 201, w = 540, h = 224, plotX = i => x + w * i / 12;
  axes(d, x, y, w, h);
  const marker = (i, color) => d.stroke([[plotX(i), y], [plotX(i), y + h]], color);
  marker(4, lilac);
  marker(8, gold);
  d.stroke(water.flatMap(({ gateOpening }, i) => [
    ...(i ? [[plotX(i), y + h - water[i - 1].gateOpening * h]] : []),
    [plotX(i), y + h - gateOpening * h]
  ]), gold, 2);
  d.stroke(water.map(({ outletDepth }, i) => [plotX(i), y + h - outletDepth / .08 * h]), blue, 3);
  marker(tick, ink);
  d.text('GATE OPENING', x, 174, 1, gold);
  d.text('OUTLET DEPTH', x + 124, 174, 1, blue);
  d.text('TICK 0', x, 445, 1, dim);
  d.text('CHECKPOINT 4', plotX(4) - 35, 445, 1, lilac);
  d.text('INPUT 8', plotX(8) - 20, 445, 1, gold);
  d.text('12', plotX(12) - 12, 445, 1, dim);
  d.rect(641, 157, 289, 325, panel);
  metric(d, 'SAVED TICK / TARGET', cursor.from + ' / ' + cursor.to, 182, lilac);
  metric(d, 'OUTLET AT TICK ' + tick, (state.outletDepth * 100).toFixed(2) + ' CM', 274, blue);
  metric(d, 'WATER VOLUME', state.waterVolume.toFixed(3) + ' M3', 366, aqua);
  d.text('RESUMED RESULT MATCHES THE CONTINUOUS RUN', 31, 511, 2, aqua);
  return d.finish();
}
function membraneFrame(data, t) {
  const d = canvas('Rebuild the membrane', 'FIXED-EDGE MESH / SAMPLE-EXACT PROBE REPLAY', lilac);
  const { asset, full, continuation, analyticHz, report } = data;
  d.rect(30, 157, 586, 325, panel);
  const { geometry, modes } = asset, shape = modes[0].shape, max = peak(shape);
  const shades = ['#344157', '#45546f', '#666383', '#8b7f9f', '#b99dc7', '#d8b5ef', '#efd2f8'];
  const phase = Math.sin(t * Math.PI * 6) * .85;
  function project(i, amplitude) {
    const [x, y] = geometry.vertices[i];
    return [137 + 285 * x + 133 * y, 290 + 32 * x - 87 * y - 51 * amplitude];
  }
  for (const tri of geometry.elements) {
    const shapeAt = tri.map(i => phase * shape[i] / max);
    d.polygon(tri.map((i, j) => project(i, shapeAt[j])),
      shades[Math.round(3 + shapeAt.reduce((sum, value) => sum + value, 0))]);
    d.stroke([...tri, tri[0]].map(i => project(i, phase * shape[i] / max)), '#283b50');
  }
  for (const i of asset.evidence.fixedVertices) {
    const [x, y] = project(i, 0);
    d.rect(x - 1, y - 1, 3, 3, gold);
  }
  d.text('FIRST MODE / SLOWED', 51, 174, 1, dim);
  d.text('CONTINUOUS RUN', 51, 338, 1, dim);
  d.text('RESUMED RUN', 163, 338, 1, lilac);
  const x = 52, y = 363, w = 540, h = 66, magnitude = peak(full);
  axes(d, x, y, w, h);
  const p = i => x + w * i / (full.length - 1);
  function envelope(values, start, color) {
    const step = 120, positions = Array.from({ length: Math.ceil(values.length / step) }, (_, i) => i * step);
    const points = positions.map(i => [p(start + i), peak(values.slice(i, i + step)) * h / (2 * magnitude)]);
    for (const sign of [-1, 1]) d.stroke(points.map(([x, height]) => [x, y + h / 2 + sign * height]), color, 2);
  }
  envelope(full, 0, dim);
  envelope(continuation, fromSample, lilac);
  d.stroke([[p(fromSample), y], [p(fromSample), y + h]], gold);
  const at = x + t * w;
  d.stroke([[at, y], [at, y + h]], ink);
  d.text('CHECKPOINT ' + fromSample + ' SAMPLES', p(fromSample) - 36, 445, 1, gold);
  d.rect(641, 157, 289, 325, panel);
  metric(d, 'MESH FUNDAMENTAL', modes[0].hz.toFixed(2) + ' HZ', 182, lilac);
  metric(d, 'ANALYTIC REFERENCE', analyticHz.toFixed(2) + ' HZ', 274, blue);
  metric(d, 'SAMPLES MATCHED', report.runs['membrane-resume'].checked, 366, aqua);
  d.text('MESH, CHECKPOINT AND REFERENCE WAV ALL CAME FROM THE ARCHIVE', 31, 511, 1, aqua);
  return d.finish();
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-experiment-demo-'));
try {
  const data = experiment(work);
  const cases = { inventory: inventoryFrame, sluice: sluiceFrame, membrane: membraneFrame }, gallery = [];
  for (const [i, [name, render]] of Object.entries(cases).entries()) {
    for (let f = 0; f < framesPerCase; f++) {
      const frame = render(data, f / (framesPerCase - 1));
      const number = String(i * framesPerCase + f).padStart(3, '0');
      write(path.join(out, 'frames', 'frame-' + number + '.png'), PNG.encodeFrame(frame));
      if (f % 2 === 0) gallery.push(frame);
      if (f === framesPerCase - 1) write(path.join(out, name + '.png'), PNG.encodeFrame(frame));
    }
  }
  write(path.join(out, 'experiment-gallery.png'), PNG.encodeAnimation(gallery, fps / 2));
  const level = .75 / peak(data.full);
  const sound = Float64Array.from(data.full, value => value * level);
  write(path.join(out, 'membrane.wav'), WAV.encode({ sampleRate, channels: 1, samples: sound }));
  const track = new Float64Array(sampleRate * framesPerCase * 3 / fps);
  track.set(sound, Math.round(sampleRate * framesPerCase * 2 / fps));
  write(path.join(out, 'gallery.wav'), WAV.encode({ sampleRate, channels: 1, samples: track }));
  console.log('Verified four checks after moving the archive. Review files: ' + out);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
