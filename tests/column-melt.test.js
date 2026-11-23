const { test } = require('node:test');
const assert = require('node:assert/strict');
const entry = import('../webgl.mjs');

function image(width, height, pixel) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

test('red seeds reach strips from either side and green delays propagation', async () => {
  const { createColumnMeltMap } = await entry;
  const paint = (barrier) => image(18, 3, (x, y) => {
    if (y === 2 && (x === 2 || x === 17)) return [255, 0, 0, 255];
    if (x === 5 && y === 0) return [0, barrier, 192, 128];
    if (x === 12) return [255, 0, 255, 0];
    return [0, 0, 0, 255];
  });
  const clear = createColumnMeltMap(paint(0), { strips: 9, spread: 0.4 });
  const blocked = createColumnMeltMap(paint(255), { strips: 9, spread: 0.4 });
  const at = (map, strip, channel = 0) => map.data[strip * 4 + channel];
  assert.equal(at(clear, 1), 0);
  assert.equal(at(clear, 8), 0);
  assert(at(clear, 0) > 0);
  assert(at(clear, 7) < at(clear, 6));
  assert(at(blocked, 3) > at(clear, 3));
  assert.equal(at(blocked, 2, 1), 128);
  assert.equal(at(blocked, 2, 2), 96);
  assert.equal(at(blocked, 6, 2), 0);
  assert.equal(at(blocked, 6, 3), 255);
  const noSeeds = createColumnMeltMap(image(5, 1, () => [0, 0, 0, 0]));
  assert.equal(at(noSeeds, 2), 0);
  assert.equal(at(noSeeds, 0), at(noSeeds, 4));
});

test('painted strips move whole source rows, sag and hold, then finish on the incoming frame', async () => {
  const { createColumnMeltMap, renderColumnMelt, createTransition } = await entry;
  const map = createColumnMeltMap(image(2, 1, (x) => [255, 0, x * 255, 255]));
  const from = image(4, 60, (x, y) => [x, y, 0, 123]);
  const to = image(4, 60, (x, y) => [x, y, 255, 255]);
  const plan = createTransition('column-melt', { duration: 1 });
  assert.equal(plan.sample(0.5).mask, 'melt');
  const frame = (time) => renderColumnMelt(from, to, { map, progress: plan.sample(time).value });
  const pixel = ({ data }, x, y) => [...data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
  assert.deepEqual(frame(0), from);
  assert.deepEqual(frame(1), to);
  for (const time of [0.22, 0.55]) {
    assert.deepEqual(pixel(frame(time), 2, 5), [2, 5, 255, 255]);
    assert.deepEqual(pixel(frame(time), 3, 6), [3, 0, 0, 123]);
  }
  assert.deepEqual(pixel(frame(0.55), 1, 18), [1, 0, 0, 123]);
  assert.deepEqual(pixel(frame(0.9), 3, 6), [3, 6, 255, 255]);
  assert.deepEqual(frame(0.55), frame(0.55));
});

test('unpainted melt uses repeatable seeded strips and nearest-neighbor source scaling', async () => {
  const { renderColumnMelt } = await entry;
  const from = image(2, 2, (x, y) => [x + y * 2, 0, 0, 255]);
  const to = image(1, 1, () => [9, 0, 0, 255]);
  const render = (progress, seed) => renderColumnMelt(from, to, {
    progress, seed, cellSize: 2, width: 20, height: 20
  });
  assert.deepEqual(render(0.51, 90), render(0.51, 90));
  assert.notDeepEqual(render(0.51, 90), render(0.51, 17));
  assert.deepEqual([...render(0).data.slice(36, 44)], [0, 0, 0, 255, 1, 0, 0, 255]);
  assert(render(1).data.every((value, i) => value === [9, 0, 0, 255][i % 4]));
});
