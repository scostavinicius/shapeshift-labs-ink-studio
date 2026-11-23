const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { fitSharedObjectGrade } = require('..');
const Color = require('../src/color-space.js');
const ColorStack = require('../src/color-stack.js');
const { prepareOutputGrade } = require('../cli/output-grade.js');
const PNG = require('../cli/png.js');

const names = [null, 'cloak', 'stone', 'lamp'];
const cast = { name: 'Cool dailies', steps: [{ type: 'oklabChroma', correction: [[-.034, 0, 0], [-.057, 0, 0]] }] };
const anchors = names.slice(1).map(id => ({ id, select: { object: id } }));

function bands(reference) {
  const w = 6, h = 3, rgb = new Uint8Array(w * h * 3), ids = new Uint32Array(w * h);
  const hues = [[.14, .025], [-.047, -.035], [.072, .16]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, L = reference ? .47 + x * .037 : .27 + x * .067;
    const [u, v] = hues[y];
    rgb.set(Color.fromOKLab([L, L * u, L * v]).map(value => Math.round(255 * value)), p * 3);
    ids[p] = y + 1;
  }
  return { w, h, rgb, passes: { w, h, objectId: ids, objects: names, materialId: ids, materials: names } };
}

test('the OKLab chroma step preserves floating-point lightness at the gamut boundary', () => {
  const definition = { name: 'Chroma', steps: [{ type: 'oklabChroma', correction: [[.15, .2, 0], [-.27, 0, .3]], maxShift: .3 }] };
  const stack = ColorStack.prepare(definition);
  const samples = [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, .04], [.41, .43, .48]];
  for (const color of samples) {
    const changed = stack.sample(color);
    assert(changed.every(value => value >= 0 && value <= 1));
    assert(Math.abs(Color.toOKLab(color)[0] - Color.toOKLab(changed)[0]) < 1e-6);
  }
  assert.throws(() => ColorStack.prepare({ ...definition, steps: [{ type: 'oklabChroma', correction: [[1]] }] }), /two finite/);
});

test('shared anchors remove a cast while source shadow and highlight separation remains distinct from the reference', () => {
  const reference = bands(true), source = prepareOutputGrade(cast).apply(bands(false));
  const result = fitSharedObjectGrade(source, reference, { anchors });
  assert(result.report.afterError < result.report.beforeError / 8);
  assert(result.report.maxLightnessDrift < .004);
  for (const row of result.report.anchors) {
    assert(row.afterError < row.beforeError);
    assert(Math.abs(row.lighting.before.range - row.lighting.after.range) < .005);
    assert(row.lighting.after.range - row.lighting.reference.range > .1);
  }
  assert.deepEqual(prepareOutputGrade(JSON.parse(JSON.stringify(result.stack))).apply(source).rgb, result.matched.rgb);
  assert.equal(result.masks[0].source.reduce((a, b) => a + b), 6);
  assert.throws(() => fitSharedObjectGrade(source, reference, { anchors: [{ id: 'missing', select: { object: 'occluded' } }] }), /four visible/);
  assert.throws(() => fitSharedObjectGrade(source, reference, { anchors: [{ ...anchors[0], source: { region: [4, 0, 3, 1] } }] }), /inside/);
});

test('an approved color and per-shot region can train a match without merging lightness or alpha', () => {
  const original = bands(false), reference = bands(true);
  const alpha = new Uint8Array(original.w * original.h).fill(255);
  alpha[5] = 0;
  alpha[11] = 200;
  const source = { ...original, rgb: Buffer.from(original.rgb), alpha };
  const untouched = Buffer.from(source.rgb);
  const result = fitSharedObjectGrade(source, reference, { anchors: [{ id: 'stone', select: { material: 'stone' },
    source: { region: [1, 1, 5, 1] }, reference: { region: [0, 1, 5, 1] }, approved: '#8f857e' }] });
  assert.equal(result.report.anchors[0].sourcePixels, 5);
  assert.equal(result.report.anchors[0].approved, '#8f857e');
  assert.deepEqual(result.matched.alpha, alpha);
  assert.deepEqual(source.rgb, untouched);
  assert.deepEqual(result.matched.rgb.slice(5 * 3, 6 * 3), Uint8Array.from(source.rgb.slice(5 * 3, 6 * 3)));
  assert(result.report.anchors[0].afterError < result.report.anchors[0].beforeError);
});

test('a CLI match exports an identical still through render and replay, with grade before final palette', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-shared-grade-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' });
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  const read = name => fs.readFileSync(path.join(directory, name));
  write('scene.json', { id: 'tile', style: 'slate', camera: { target: [0, .35, 0], yaw: 0, pitch: .16, dist: 4 },
    solids: [{ id: 'wall', kind: 'box', at: [0, .35, 0], half: [1, .45, .15], mat: 'stone' }] });
  write('cast.json', cast);
  write('plan.json', { format: 'ink-studio/shared-object-grade', version: 1, width: 60, height: 38,
    source: { scene: 'scene.json', colorStack: 'cast.json' }, reference: { scene: 'scene.json', camera: { yaw: .34 } },
    anchors: [{ id: 'wall', select: { object: 'wall' } }] });
  run('shot', 'grade-match', 'plan.json', '--out', 'fit');
  const report = JSON.parse(read('fit/report.json'));
  assert(report.afterError < report.beforeError);
  assert.equal(JSON.parse(read('fit/index.html').toString().match(/^const data = (.*);$/m)[1]).masks.length, 1);
  const view = ['--w', '60', '--h', '38', '--px', '1', '--color-stack', 'cast.json', '--output-grade', 'fit/grade.json'];
  run('render', 'scene.json', ...view, '--recipe', 'still.json', '--out', 'still.png');
  assert.deepEqual(read('still.png'), read('fit/matched.png'));
  run('shot', 'replay', 'still.json', '--out', 'replay.png');
  assert.deepEqual(read('still.png'), read('replay.png'));
  write('policy.json', { palette: ['#000000', '#ffffff'], match: 'perceptual' });
  run('clip', 'scene.json', ...view, '--output-palette', 'policy.json', '--fps', '8', '--to', '.25', '--out', 'clip.png');
  const { rgb } = PNG.read(path.join(directory, 'clip.png'));
  const allowed = new Set([0, 0xffffff]);
  for (let i = 0; i < rgb.length; i += 3) assert(allowed.has(rgb[i] * 65536 + rgb[i + 1] * 256 + rgb[i + 2]));
});
