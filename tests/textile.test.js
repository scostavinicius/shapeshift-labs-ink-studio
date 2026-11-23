const test = require('node:test');
const assert = require('node:assert/strict');
const kit = require('..').load();
const { KIT: K } = kit,
  T = K.textile;
const near = (x, y, epsilon = 1e-5) => assert(Math.abs(x - y) <= epsilon, `${x} != ${y}`);

test('directional embroidery follows a curved chart and respects the sampled mask', () => {
  const chart = (u, v) => [2 * u, v, 0.2 * Math.sin(Math.PI * u)];
  const plan = T.stitch({
    chart,
    columns: 6,
    rows: 4,
    radius: 0.02,
    arch: 1,
    samples: 4,
    direction: (u, v) => (v < 0.5 ? [1, 0] : [0, 1]),
    mask: (u, v) => 0.53 - u + (v > 0.9 ? 0.5 : 0)
  });
  assert(plan.threads.length > 0 && plan.threads.length < 24);
  assert(plan.threads.some(t => t.stations[0].uv[1] < 0.5));
  assert(plan.threads.some(t => t.stations[0].uv[1] > 0.5));
  for (const { stations, tapered } of plan.threads) {
    const a = stations[0],
      b = stations.at(-1);
    assert(tapered);
    assert(stations.every(({ uv: [u, v] }) => u >= 0.53 && v <= 0.9));
    if (a.uv[1] < 0.5) near(a.uv[1], b.uv[1]);
    else near(a.uv[0], b.uv[0]);
    for (const [i, s] of stations.entries())
      near(K.V.dot(K.V.sub(s.p, chart(...s.uv)), s.n), 0.02 * (0.26 + Math.sin((Math.PI * i) / 4)));
  }
});

test('adjacent knit courses interlace with alternating pass depth and continuous rows', () => {
  const radius = 0.04;
  const plan = T.knit({ columns: 3, rows: 2, radius, samples: 4 });
  assert.equal(plan.threads.length, 2);
  assert(plan.threads.every(t => t.family === 'course' && t.stations.length === 97));
  const [a, b] = plan.threads.map(t => t.stations.map(s => s.p));
  const crossXY = (a, b) => a[0] * b[1] - a[1] * b[0],
    hits = [];
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++) {
      const p = a[i - 1],
        q = b[j - 1],
        e = K.V.sub(a[i], p),
        f = K.V.sub(b[j], q),
        delta = K.V.sub(q, p);
      const d = crossXY(e, f);
      if (Math.abs(d) < 1e-8) continue;
      const s = crossXY(delta, f) / d,
        t = crossXY(delta, e) / d;
      if (s >= 0 && s < 1 && t >= 0 && t < 1) hits.push(p[2] + s * e[2] - (q[2] + t * f[2]));
    }
  assert.equal(hits.length, 12);
  assert.deepEqual(hits.map(Math.sign), [-1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1]);
  assert(hits.every(distance => Math.abs(distance) > radius * 2));
});

test('binary weave retains crossing order and measured relief on a curved chart', () => {
  const radius = 0.054,
    flatness = 0.35,
    clearance = 0.022;
  const chart = (u, v) => [4 * u, 3 * v, 0.22 * u * v];
  const p = T.weave({ size: [4, 3], columns: 8, rows: 5, radius, flatness, clearance, chart, pattern: ['10', '01'] });
  const byId = Object.fromEntries(p.threads.map(row => [row.id, row]));
  assert.equal(p.crossings.length, 40);
  for (const [i, { uv, over, under, depthGap }] of p.crossings.entries()) {
    const at = id => byId[id].stations.find(row => row.uv.every((x, j) => Math.abs(x - uv[j]) < 1e-8));
    const a = at(over),
      b = at(under);
    assert.equal(byId[over].family, (Math.floor(i / 8) + (i % 8)) % 2 ? 'weft' : 'warp');
    near(K.V.dot(K.V.sub(a.p, b.p), a.n), 2 * radius * flatness + depthGap);
    near(depthGap, clearance * flatness);
  }
});

test('JSON plans produce identical native caps and sidewalls with stable material targets', () => {
  const plan = T.stitch({ columns: 2, rows: 3 });
  const { world, batch } = bake(plan),
    clone = bake(JSON.parse(JSON.stringify(plan)));
  function bake(input) {
    const B = kit.makeBuilder(1);
    const batch = T.draw(B, input, {
      object: 'curtain',
      material: 'silk',
      sides: 6,
      color: ({ uv: [u, v], id, family, point, distance }) => {
        assert(id.startsWith('stitch:') && family === 'stitch' && point.length === 3 && distance > 0);
        return [120 + 80 * u, 150 + 60 * v, 255];
      }
    });
    return { world: B.finish(), batch };
  }
  assert.deepEqual(batch, clone.batch);
  assert.deepEqual(world.data, clone.world.data);
  assert.equal(world.count, plan.stats.points * 12);
  assert.equal(world.splatFootprints.styles[0].depth, 'plane');
  assert(world.renderMetadata.objects.includes('curtain'));
  assert(world.renderMetadata.materials.includes('silk'));
  assert.equal(
    batch.threads.every((range, index) => range.id === plan.threads[index].id && range.end - range.first === 60),
    true
  );
});

test('bad callbacks, duplicate IDs and undersized budgets fail without adding builder rows', () => {
  const p = T.stitch({ columns: 4, rows: 2 }),
    B = kit.makeBuilder(1);
  assert.throws(() => T.draw(B, p, { maxMarks: 1 }), /mark budget/);
  assert.throws(() => T.draw(B, p, { color: ({ index }) => (index ? '#ffffff' : [0, NaN, 0]) }), /yarn color/);
  const bad = JSON.parse(JSON.stringify(p));
  bad.threads[1].id = bad.threads[0].id;
  assert.throws(() => T.draw(B, bad), /invalid thread/);
  assert.equal(B.count(), 0);
  assert.throws(() => T.knit({ maxPoints: 8 }), /point budget/);
  assert.throws(() => T.stitch({ direction: [0, 0] }), /nonzero/);
  assert.throws(() => T.stitch({ chart: () => [0, 0, 0] }), /degenerate/);
  assert.throws(() => T.weave({ pattern: ['12'] }), /binary/);
  const empty = T.stitch({ mask: () => 1 });
  assert.equal(T.draw(B, empty).end, 0);
});

test('graph nodes expose the same textile plan and world operations', () => {
  const ops = K.procedural.sceneGraph.operations;
  const p = ops['textile.pattern'].run({ kind: 'weave', options: { columns: 4, rows: 3 } }).value;
  const w = ops['textile.world'].run({ source: p, options: { appearance: { sides: 6 } } }).value;
  assert.equal(p.crossings.length, 12);
  assert(w.count > 0 && w.splatFootprints);
});

test(
  'WebGL shows the correct strand at the crossing and geometry changes under orbit',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      (kit, pattern) => {
        const T = kit.KIT.textile,
          plan = T.weave({ size: [2, 2], columns: 1, rows: 1, radius: 0.2, flatness: 0.55, pattern });
        return T.world(plan, {
          camera: { dist: 4, yaw: 0, pitch: 0, target: [0, 0, 0], sway: 0 },
          appearance: {
            sides: 8,
            ambient: 1,
            sheen: 0,
            twist: 0,
            color: ({ family }) => (family === 'warp' ? '#f22e26' : '#274cf3')
          }
        });
      },
      (kit, build, backend) => {
        const b = backend(123, 123, { raw: true, damp: false });
        const warp = build(kit, ['1']),
          weft = build(kit, ['0']),
          center = Object.fromEntries([59, 61, 63].flatMap(y => [59, 61, 63].map(x => [x + '/' + y, [x, y]])));
        const centerColor = () =>
          Object.values(b.sample(center)).reduce(
            (sum, pixel) => sum.map((value, channel) => value + pixel[channel]),
            [0, 0, 0]
          );
        b.draw(warp);
        const red = centerColor(),
          before = b.image();
        b.draw(warp, { camera: { ...warp.cam, yaw: 0.65, pitch: 0.26 } });
        const after = b.image();
        b.draw(weft);
        const blue = centerColor();
        b.close();
        return { red, blue, moved: before !== after };
      }
    );
    assert(result.red[0] > result.red[2] * 2, JSON.stringify(result.red));
    assert(result.blue[2] > result.blue[0] * 2, JSON.stringify(result.blue));
    assert(result.moved);
  }
);
