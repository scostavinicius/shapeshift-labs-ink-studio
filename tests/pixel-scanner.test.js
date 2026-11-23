const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K, makeBuilder, SpriteSurface } = ink.load();

function passes(hits) {
  return {
    w: hits.length, h: 1,
    depth: Float32Array.from(hits, hit => hit.miss ? Infinity : 1),
    position: Float32Array.from(hits.flatMap(hit => hit.at)),
    normal: Float32Array.from(hits.flatMap(hit => hit.normal ?? [0, 0, 1])),
    objectId: Uint32Array.from(hits, hit => hit.object ?? 0),
    objects: ['', 'railing', 'wall']
  };
}

test('returns merge across spatial cell boundaries, preserve positions and refresh in stepped colors', () => {
  const scanner = K.pixelScanner.create({ spacing: .11, freshFor: .25, settleAfter: .75, range: [0, 10] });
  const at = [0, 0, 1], hit = { at: [.104, 0, 0], object: 1 };
  const first = scanner.ingest(passes([hit, { ...hit, at: [.117, 0, 0] }, { ...hit, miss: true },
    { ...hit, at: [0, 0, -11] }]), { at, time: 1 });
  assert.deepEqual(first, { count: 1, added: 1, refreshed: 0, evicted: 0, rewound: false });
  const [saved] = scanner.points(1);
  assert.equal(saved.age, 'fresh');
  assert.equal(scanner.points(1.25)[0].age, 'settled');
  assert.equal(scanner.points(1.75)[0].age, 'old');
  assert.notDeepEqual(scanner.points(1.75)[0].rgb, saved.rgb);
  assert.equal(scanner.points(.25).length, 0);
  const later = scanner.ingest(passes([{ ...hit, at: [.129, 0, 0] }, { ...hit, at: [.130, 0, 0] }]),
    { at: [0, 0, 2], time: 2 });
  assert.deepEqual(later, { count: 1, added: 0, refreshed: 1, evicted: 0, rewound: false });
  const [recent] = scanner.points(2);
  assert.equal(recent.firstSeen, 1);
  assert.equal(recent.lastSeen, 2);
  assert.equal(recent.object, 'railing');
  assert.ok(recent.range > 2);
  assert.deepEqual(recent.at, saved.at);
  recent.at[0] = 99;
  assert.deepEqual(scanner.points()[0].at, saved.at);
});

test('capacity evicts the least recent return and expiry and rewind clear stale history', () => {
  const scanner = K.pixelScanner.create({ capacity: 2, spacing: .5, retention: 2 });
  const at = [0, 0, 2];
  const rail = { at: [0, 0, .02], object: 1 }, wall = { at: [0, 0, 0], object: 2 };
  const side = { at: [0, 0, .01], normal: [1, 0, 0], object: 1 };
  scanner.ingest(passes([rail, wall]), { at, time: 1 });
  scanner.ingest(passes([rail]), { at, time: 1.25 });
  const next = scanner.ingest(passes([side]), { at, time: 2 });
  assert.deepEqual(next, { count: 2, added: 1, refreshed: 0, evicted: 1, rewound: false });
  assert.deepEqual(scanner.points(2).map(point => point.normal), [[0, 0, 1], [1, 0, 0]]);
  assert.equal(scanner.points(3.3).length, 1);
  assert.equal(scanner.points(4).length, 0);
  assert.equal(scanner.ingest(passes([wall]), { at, time: .1 }).rewound, true);
  assert.deepEqual(scanner.points().map(point => point.object), ['wall']);
  scanner.clear();
  assert.deepEqual(scanner.points(), []);
  assert.throws(() => scanner.ingest({ w: 1, h: 1 }, { at }), /aligned/);
  assert.throws(() => K.pixelScanner.create({ capacity: 0 }), /budget/);
});

test('a perspective scanner captures only the first visible surface and writes depth-tested native points', () => {
  const builder = makeBuilder(9, [0x081018, 0x287577, 0x5f4c50]);
  const atlas = SpriteSurface.make(8);
  atlas.face([-2, -2, 0], [2, 0, 0], [0, 4, 0], 1, 1, () => 0x287577, { id: 'front' });
  atlas.face([-3, -2, -1], [6, 0, 0], [0, 4, 0], 1, 1, () => 0x5f4c50, { id: 'rear' });
  const scanner = K.pixelScanner.create({ capacity: 256, spacing: .12, surfaceBias: .018, width: .04 });
  const marks = K.frameSplats(builder, scanner.capacity, (draw, dt, t) => scanner.draw(draw, t));
  const world = builder.finish({ spriteSurfaces: atlas.finish(),
    cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 4, fov: .8 }, radius: 5 });
  const scan = { at: [0, 0, 3], target: [0, 0, 0], w: 20, h: 18, fov: .65 };
  const a = ink.capturePixelScan(world, scan);
  assert.equal(a.position[(9 * 20 + 4) * 3 + 2], 0);
  assert.equal(a.position[(9 * 20 + 15) * 3 + 2], -1);
  assert.ok(a.depth[9 * 20 + 4] < a.depth[9 * 20 + 15]);
  assert.throws(() => ink.capturePixelScan(world, { ...scan, target: scan.at }), /different/);
  scanner.ingest(a, scan);
  const old = scanner.points();
  assert.ok(old.length > 80 && old.every(p => p.at[2] === 0 || p.at[2] === -1));
  assert.ok(old.every(p => p.at[2] === 0 || p.at[0] > 0));
  const stage = K.stage(world);
  stage.add(marks);
  const viewer = { w: 60, h: 42, px: 1, raw: true, yaw: .08 };
  const before = ink.render(world, viewer);
  stage.update(1 / 60, 0);
  assert.ok(Math.abs(world.data[marks.first * 16 + 2] - (old[0].at[2] + .018)) < 1e-6);
  const after = ink.render(world, viewer);
  assert.notDeepEqual(after.rgb, before.rgb);
  const b = ink.capturePixelScan(world, scan);
  assert.deepEqual(b.depth, a.depth);
  assert.deepEqual(b.position, a.position);
});
