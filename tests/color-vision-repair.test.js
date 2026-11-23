const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { repairColorVisionPalette } = require('..');
const { modes, simulateColor } = require('../cli/color-vision.js');
const { prepareOutputGrade } = require('../cli/output-grade.js');

const red = '#cd5357', green = '#788c49', olive = '#8c8348', aqua = '#9eece1';
const unpack = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16));

function raster(colors, objectId, width) {
  const w = width, h = colors.length / width, ids = Uint32Array.from(objectId);
  return { w, h, rgb: Uint8Array.from(colors.flatMap(unpack)), passes: { w, h, objectId: ids,
    objects: [null, 'signal', 'moss', 'olive', 'protected'], materialId: ids,
    materials: [null, 'signal-red', 'green-paint', 'olive-paint', 'lamp'] } };
}
const relationships = [
  { id: 'west', subject: { object: 'signal' }, background: { object: 'moss' } },
  { id: 'east', subject: { material: 'signal-red' }, background: { material: 'olive-paint' } }
];

test('the simulation transforms encoded sRGB in linear light and distinguishes all three deficiencies', () => {
  assert.equal(simulateColor(0xcd5357, 'normal'), 0xcd5357);
  assert.equal(simulateColor(0xff0000, 'protanopia'), 0x6d5f00);
  assert.equal(simulateColor(0xff0000, 'deuteranopia'), 0xa39000);
  assert.equal(simulateColor(0xff0000, 'tritanopia'), 0xff000f);
  for (const mode of modes) {
    assert.equal(simulateColor(0, mode), 0);
    assert.equal(simulateColor(0xffffff, mode), 0xffffff);
  }
});

test('the minimum repair uses one shared signal swatch and leaves locked and unrelated art unchanged', () => {
  const source = raster([red, green, red, olive, aqua, red, green, red, olive, aqua], [1, 2, 1, 3, 4, 1, 2, 1, 3, 4], 5);
  const result = repairColorVisionPalette(source, { pairs: relationships, locked: [aqua], minDistance: .105, maxChanges: 2 });
  assert.equal(result.report.status, 'repaired');
  assert.equal(result.report.work.minimumChanges, 1);
  assert.equal(result.report.changes[0].from, red);
  assert.equal(result.report.changes[0].pixels, 4);
  assert.equal(result.report.weakBefore, 2);
  assert.equal(result.report.weakAfter, 0);
  for (const p of [1, 3, 4, 6, 8, 9]) assert.deepEqual(result.repaired.rgb.slice(p * 3, p * 3 + 3), source.rgb.slice(p * 3, p * 3 + 3));
  assert.deepEqual(result.repaired.rgb, prepareOutputGrade(result.stack).apply(source).rgb);
  assert.deepEqual(result, repairColorVisionPalette(source, { pairs: relationships, locked: [aqua], minDistance: .105, maxChanges: 2 }));
});

test('the search can require edits on both ends, respects locks, and reports unmeasured or bounded searches', () => {
  const a = '#787878', b = '#7e7e7e', source = raster([a, b, a, b], [1, 2, 1, 2], 2);
  const options = { pairs: relationships.slice(0, 1), modes: ['normal', 'deuteranopia'], minDistance: .16,
    candidates: { [a]: ['#595959'], [b]: ['#9a9a9a'] } };
  const solved = repairColorVisionPalette(source, { ...options, maxChanges: 2 });
  assert.equal(solved.report.work.minimumChanges, 2);
  assert.equal(solved.report.weakAfter, 0);
  const unresolved = repairColorVisionPalette(source, { ...options, maxChanges: 1 });
  assert.equal(unresolved.report.status, 'unresolved');
  assert.equal(unresolved.report.work.minimumChanges, null);
  assert.deepEqual(unresolved.repaired.rgb, source.rgb);
  assert.equal(repairColorVisionPalette(source, { ...options, locked: [a] }).report.status, 'unresolved');
  assert.equal(repairColorVisionPalette(source, { ...options, maxEvaluations: 1 }).report.status, 'search-limit');
  const transparent = { ...source, alpha: Uint8Array.of(255, 0, 255, 128) };
  assert.equal(repairColorVisionPalette(transparent, options).report.status, 'unsampled');
  const shared = raster([a, a], [1, 2], 2);
  assert.equal(repairColorVisionPalette(shared, options).report.status, 'unresolved');
});

test('the crossing repair is a normal export grade and reproduces the reported native frame', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-cvd-repair-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js'), scene = path.resolve(__dirname, '../examples/color-vision-palette-repair/crossing.js');
  const plan = scene.replace(/\.js$/, '.json');
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' });
  const read = file => fs.readFileSync(path.join(directory, file));
  run('palette', 'cvd-repair', scene, plan, '--out', 'review');
  const report = JSON.parse(read('review/report.json'));
  assert.equal(report.status, 'repaired');
  assert.equal(report.work.minimumChanges, 2);
  assert.equal(report.weakAfter, 0);
  assert(report.changes.every(edit => edit.from !== aqua && edit.to !== aqua));
  const preview = JSON.parse(read('review/index.html').toString().match(/^const data = (.*);$/m)[1]);
  assert.deepEqual(Object.keys(preview.images), modes);
  run('render', scene, '--w', '168', '--h', '108', '--px', '1', '--output-grade', 'review/repair.json', '--out', 'render.png');
  assert.deepEqual(read('render.png'), read('review/repaired.png'));
});
