const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { allocateSequencePalette } = require('..');
const PNG = require('../cli/png.js');

const hex = value => value.toString(16).padStart(2, '0');
const visible = ({ rgb, alpha }) => {
  const colors = new Set();
  for (let i = 0; i < rgb.length; i += 3) {
    if (alpha?.[i / 3] === 0) continue;
    colors.add('#' + Array.from(rgb.subarray(i, i + 3), hex).join(''));
  }
  return colors;
};

function frame(base, extras = []) {
  const pixels = [...Array.from({ length: 95 }, () => [base, 1]), ...extras];
  return { w: pixels.length, h: 1, rgb: Uint8Array.from(pixels.flatMap(([color]) => color)),
    materialId: Uint32Array.from(pixels, ([, material]) => material), materials: [null, 'ground', 'trim', 'signal'] };
}

test('a visibility-weighted sequence shares its slots, preserves exact pins, and does not spread an exact-only accent', () => {
  const accent = [255, 0, 214];
  const a = frame([22, 49, 196], [[[247, 222, 32], 2], [accent, 3], [[248, 2, 210], 2]]);
  const b = frame([22, 147, 46], [[[243, 225, 31], 2], [[242, 225, 29], 2]]);
  const shots = [{ id: 'walk', frames: [a] }, { id: 'gate', frames: [b] }];
  const options = { budget: 3, pins: [{ color: '#ff00d6', label: 'Signal' }] };
  const allocation = allocateSequencePalette(shots, options);
  assert.equal(allocation.palette.length, 3);
  assert.deepEqual(allocation.policy.reserved, [{ color: '#ff00d6', match: false }]);
  assert.deepEqual(allocation, allocateSequencePalette(shots, options));
  assert.deepEqual(allocation.palette, allocateSequencePalette([shots[0], { ...shots[1], frames: [b, b, b] }], options).palette);
  const output = allocation.shots.flatMap(shot => shot.frames.map(frame => frame.image));
  for (const image of output) for (const swatch of visible(image)) assert(allocation.palette.includes(swatch));
  const pixels = output[0].rgb;
  assert.deepEqual(Array.from(pixels.slice(96 * 3, 97 * 3)), accent);
  assert.notDeepEqual(Array.from(pixels.slice(97 * 3, 98 * 3)), accent);
  assert.equal(allocation.materials.find(row => row.name === 'trim').sourceExclusiveSwatches, 4);
  assert.equal(allocation.materials.find(row => row.name === 'trim').exclusiveSwatches, 0);
  assert.equal(allocation.materials.find(row => row.name === 'signal').exclusiveSwatches, 1);
  const emphasized = allocateSequencePalette(shots, { ...options, materialWeights: { trim: 100 } });
  assert(emphasized.materials.find(row => row.name === 'trim').rmsError < allocation.materials.find(row => row.name === 'trim').rmsError);
});

test('transparent pixels do not train the shared palette and partial alpha survives', () => {
  const source = { w: 3, h: 1, rgb: Uint8Array.of(255, 0, 0, 0, 0, 255, 0, 0, 255), alpha: Uint8Array.of(0, 128, 255) };
  const shots = [{ id: 'wave', frames: [source] }];
  const result = allocateSequencePalette(shots, { budget: 2, pins: ['#010101'] });
  assert.deepEqual(result.palette, ['#0000ff', '#010101']);
  assert.deepEqual(Array.from(result.shots[0].frames[0].image.alpha), [0, 128, 255]);
  assert.equal(result.summary.pixels, 2);
  assert.throws(() => allocateSequencePalette(shots, { budget: 1, pins: ['#0000ff'] }), /Leave a slot free/);
  assert.throws(() => allocateSequencePalette(shots, { budget: 3, pins: ['#abcdef', '#ABCDEF'] }), /own slot/);
  assert.throws(() => allocateSequencePalette([{ id: 'wave', frames: [{ ...source, alpha: Uint8Array.of(0, 0, 0) }] }],
    { budget: 3 }), /visible pixels/);
});

test('the sequence CLI publishes a reusable policy for native stills and clips', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-sequence-palette-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' });
  const save = (file, value) => fs.writeFileSync(path.join(directory, file), JSON.stringify(value));
  save('scene.json', { id: 'tile', style: 'slate', camera: { target: [0, .35, 0], yaw: 0, pitch: .16, dist: 4 },
    solids: [{ id: 'wall', kind: 'box', at: [0, .35, 0], half: [1, .45, .15], mat: 'stone' }] });
  save('plan.json', { format: 'ink-studio/palette-sequence', version: 1, width: 60, height: 38, budget: 3,
    pins: ['#eeddbb'], previewBudgets: [5], shots: [
      { id: 'wide', scene: 'scene.json', times: [0, .08] },
      { id: 'reverse', scene: 'scene.json', camera: { yaw: .4 } }
    ] });
  run('palette', 'sequence', 'plan.json', '--out', 'fit');
  const get = file => fs.readFileSync(path.join(directory, file));
  const report = JSON.parse(get('fit/report.json'));
  assert.equal(report.shots.length, 2);
  assert.equal(report.shots[0].frames.length, 2);
  const page = JSON.parse(get('fit/index.html').toString().match(/^const data = (.*);$/m)[1]);
  assert.deepEqual(page.variants.map(row => row.budget), [3, 5]);
  const file = report.shots[0].frames[0].allocated;
  run('render', 'scene.json', '--w', '60', '--h', '38', '--px', '1', '--output-palette', 'fit/palette-policy.json',
    '--recipe', 'still.json', '--out', 'still.png');
  assert.deepEqual(get('still.png'), get('fit/' + file));
  run('shot', 'replay', 'still.json', '--out', 'replay.png');
  assert.deepEqual(get('still.png'), get('replay.png'));
  run('clip', 'scene.json', '--w', '60', '--h', '38', '--px', '1', '--fps', '8', '--to', '.25',
    '--output-palette', 'fit/palette-policy.json', '--out', 'clip.png');
  const clip = PNG.read(path.join(directory, 'clip.png'));
  assert(visible(clip).size > 1);
  for (const swatch of visible(clip)) assert(report.palette.includes(swatch));
});
