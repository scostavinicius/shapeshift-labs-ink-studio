const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { planSubjectReframe, sampleReframe, reframeRaster } = require('..');

const width = 112, height = 72;
const subjects = [
  { id: 'face', select: { object: 'actor', material: 'skin' }, weight: 2 },
  { id: 'hand', select: { object: 'glove' } },
  { id: 'prop', select: { material: 'enamel' } }
];
const formats = [
  { id: 'wide', width: 64, height: 36, scale: .65 },
  { id: 'portrait', width: 36, height: 64, safeArea: [.1, .12, .9, .82] },
  { id: 'handheld', width: 48, height: 36, scale: .65 }
];

function plate(x, { hidden = false, prop = x + 14 } = {}) {
  const rgb = new Uint8Array(width * height * 3);
  const objectId = new Uint32Array(width * height), materialId = new Uint32Array(width * height);
  function fill(x, y, w, h, object, material) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      const p = row * width + col;
      objectId[p] = object;
      materialId[p] = material;
      rgb.set([col, row, object], p * 3);
    }
  }
  fill(x, 20, 6, 9, 1, 1);
  fill(x + 3, 25, 7, 18, 1, 2);
  if (!hidden) fill(x + 11, 29, 4, 4, 2, 2);
  fill(prop, 28, 6, 7, 3, 3);
  return { w: width, h: height, rgb, passes: { w: width, h: height, objectId, materialId,
    objects: [null, 'actor', 'glove', 'lantern'], materials: [null, 'skin', 'cloth', 'enamel'] } };
}

test('whole-sequence reframing solves an aspect-exact pan with all three visible subjects inside every delivery safe area', () => {
  const source = [9, 14, 23, 41, 58, 71, 80].map(x => plate(x));
  const { formats: results, samples } = planSubjectReframe(source, { width, height, subjects, formats, from: 2, fps: 10 });
  assert.deepEqual(samples[0].targets[0].box, [9, 20, 15, 29]);
  for (const delivery of results) {
    const [l, t, r, b] = delivery.safeArea;
    const first = delivery.keyframes[0].crop;
    const last = delivery.keyframes.at(-1).crop;
    assert(last[0] > first[0]);
    assert.deepEqual(last.slice(2), first.slice(2));
    assert.equal(delivery.safeFrames, source.length);
    assert(delivery.centerSafeFrames < delivery.safeFrames);
    delivery.keyframes.forEach(({ time, crop: [x, y, w, h] }, i) => {
      assert.equal(time, 2 + i / 10);
      assert.equal(w * delivery.height, h * delivery.width);
      assert([x, y, w, h].every(Number.isInteger));
      assert(x >= 0 && y >= 0 && x + w <= width && y + h <= height);
      for (const { box: [left, top, right, bottom] } of samples[i].targets) {
        assert(x + l * w <= left + 1e-8 && y + t * h <= top + 1e-8);
        assert(x + r * w >= right - 1e-8 && y + b * h >= bottom - 1e-8);
      }
    });
    const second = delivery.keyframes[1].crop;
    assert(sampleReframe(delivery, 2.05).every((value, i) => Math.abs(value - (first[i] + second[i]) / 2) < 1e-8));
    assert.deepEqual(sampleReframe(delivery, 0), first);
    assert.deepEqual(sampleReframe(delivery, 12), last);
  }
});

test('temporary occlusion, frame-edge cropping and impossible safe areas remain visible in the report', () => {
  const source = [plate(10), plate(18, { hidden: true }), plate(29, { prop: 100 }), plate(0)];
  const { formats: [delivery] } = planSubjectReframe(source, { width, height, subjects, formats: [formats[1]] });
  assert.deepEqual(delivery.keyframes[1].missing, ['hand']);
  assert(delivery.keyframes[2].outside.length);
  assert(delivery.keyframes[2].minimumClearance < 0);
  assert.deepEqual(delivery.keyframes[3].sourceEdge, ['face']);
  assert.equal(delivery.safeFrames, 1);
  assert.throws(() => planSubjectReframe(source, { width, height, subjects, formats: [{ ...formats[1], safeArea: [0, .8, 1, .5] }] }),
    /valid normalized safe area/);
  assert.throws(() => planSubjectReframe([{ ...source[0], passes: { w: width, h: height } }, source[1]],
    { width, height, subjects, formats }), /aligned native/);
});

test('preferring a smaller crop near the source edge can meet safe padding without changing the native aspect ratio', () => {
  const { formats: [delivery] } = planSubjectReframe([plate(7), plate(10)], {
    width, height, subjects, formats: [{ id: 'wide', width: 16, height: 9, safeArea: [.15, 0, .93, 1] }]
  });
  assert.equal(delivery.safeFrames, 2);
  assert(delivery.keyframes[0].crop[2] <= 46);
});

test('crop raster replay uses exact native coordinates, nearest samples and preserves transparency', () => {
  const input = { w: 4, h: 3, rgb: Uint8Array.from({ length: 36 }, (_, i) => i),
    alpha: Uint8Array.from({ length: 12 }, (_, i) => i * 20) };
  const delivery = { width: 4, height: 4, keyframes: [{ time: 0, crop: [0, 0, 2, 2] }, { time: 1, crop: [2, 1, 2, 2] }] };
  const replay = JSON.parse(JSON.stringify(delivery));
  const result = reframeRaster(input, replay, .5);
  assert.deepEqual([result.w, result.h], [4, 4]);
  assert.deepEqual([...result.alpha], [100, 100, 120, 120, 100, 100, 120, 120, 180, 180, 200, 200, 180, 180, 200, 200]);
  assert.deepEqual([...result.rgb.slice(0, 9)], [15, 16, 17, 15, 16, 17, 18, 19, 20]);
});

test('shot reframe captures a scene, exports three correctly timed APNGs and embeds the same paths in the review', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-reframe-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const fixture = require('../examples/subject-reframe/lantern-crossing.json');
  const plan = { ...fixture, scene: path.resolve(__dirname, '../examples/courier-shot-lighting.js'),
    title: 'Lantern crossing </script>', from: .25, fps: 2, frames: 6 };
  const input = path.join(directory, 'plan.json');
  fs.writeFileSync(input, JSON.stringify(plan));
  const stdout = execFileSync(process.execPath, [cli, 'shot', 'reframe', input, '--out', directory], { encoding: 'utf8' });
  const solution = JSON.parse(fs.readFileSync(path.join(directory, 'paths.json')));
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const data = JSON.parse(html.match(/id="reframe-data">(.*)<\/script>/)[1]);
  assert.deepEqual(data.solution, solution);
  assert.equal(data.pictures.length, plan.frames);
  for (const delivery of solution.formats) {
    assert.equal(delivery.safeFrames, plan.frames);
    assert.match(stdout, new RegExp(delivery.label + ': 6/6 safe frames'));
    const bytes = fs.readFileSync(path.join(directory, delivery.id + '.png'));
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [delivery.width, delivery.height]);
    assert.equal(bytes.readUInt32BE(bytes.indexOf('acTL') + 4), plan.frames);
    const firstFrame = bytes.indexOf('fcTL') + 4;
    assert.equal(bytes.readUInt16BE(firstFrame + 20), 1);
    assert.equal(bytes.readUInt16BE(firstFrame + 22), plan.fps);
  }
});
