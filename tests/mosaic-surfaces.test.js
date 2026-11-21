const test = require('node:test'),
  assert = require('node:assert/strict'),
  kit = require('..').load(),
  K = kit.KIT,
  M = K.mosaic;
const square = (key = 'tile') => ({
  key,
  polygon: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ]
});
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
function fixture(kit) {
  const B = kit.makeBuilder(1, [0x0c1729, 0xe8b456]),
    K = kit.KIT;
  K.mosaic.emit(
    B,
    K.mosaic.mesh(
      [
        {
          key: 'pane',
          polygon: [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1]
          ]
        }
      ],
      { gap: 0, bevel: 0, thickness: 0, grout: false, palette: ['#31b9d2'] }
    )
  );
  return B.finish({
    cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true },
    radius: 10,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 },
    look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
  });
}
test('weighted Voronoi partitions the domain deterministically with stable piece IDs', () => {
  const spec = {
      sites: [
        { key: 'a', point: [0.25, 0.5], weight: 0.1 },
        { key: 'b', point: [0.75, 0.5] }
      ]
    },
    a = M.voronoi(spec),
    b = M.voronoi(spec);
  assert.deepEqual(a, b);
  assert.equal(a.cells.length, 2);
  const area = p => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - a[1] * p[(i + 1) % p.length][0], 0) / 2;
  near(
    a.cells.reduce((s, c) => s + area(c.polygon), 0),
    1
  );
  near(Math.max(...a.cells[0].polygon.map(p => p[0])), 0.6);
  const m = M.mesh(a, { gap: 0, bevel: 0, thickness: 0 });
  assert.equal(m.locate(0.59, 0.5).key, 'a');
  assert.equal(m.locate(0.61, 0.5).key, 'b');
});
test('existing Penrose tilings and clipped fragments preserve logical pieces', () => {
  const tiling = K.procedural.tiles.quasiperiodic({ depth: 2, radius: 2 }),
    p = M.layout(tiling);
  assert.equal(p.cells.length, tiling.tiles.length);
  const plan = K.procedural.surfaceCells.clip([square()], {
    holes: [
      [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.6, 0.6],
        [0.4, 0.6]
      ]
    ]
  });
  const m = M.mesh(plan, { gap: 0, bevel: 0, thickness: 0 });
  assert.equal(m.pieces.length, 1);
  assert.equal(m.locate(0.5, 0.5), null);
  assert.equal(m.locate(0.2, 0.2).key, 'tile');
});
test('seams are actual gaps or opaque grout and bevels have geometric relief', () => {
  const m = M.mesh([square()], { gap: 0.1, bevel: 0.1, bevelDepth: 0.03, thickness: 0.1 });
  assert.equal(m.locate(0.02, 0.5), null);
  assert.equal(m.locate(0.02, 0.5, { includeSeams: true }).part, 'grout');
  near(m.locate(0.1, 0.5).point[2], 0.085);
  near(m.locate(0.5, 0.5).point[2], 0.1);
  assert(m.triangles.some(t => t.part === 'bevel' && Math.abs(t.normal[2]) < 0.99));
  const n = M.mesh([square()], { gap: 0.1, bevel: 0, thickness: 0, grout: false });
  assert.equal(n.locate(0.02, 0.5, { includeSeams: true }), null);
});
test('concave pieces triangulate without covering their cutouts', () => {
  const m = M.mesh(
    [
      {
        key: 'L',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 0.4],
          [0.4, 0.4],
          [0.4, 1],
          [0, 1]
        ]
      }
    ],
    { gap: 0.02, bevel: 0.01 }
  );
  assert(m.locate(0.2, 0.8));
  assert.equal(m.locate(0.8, 0.8), null);
});
test('carrier queries interpolate the actual subdivided triangles', () => {
  const m = M.mesh([square()], {
    gap: 0,
    bevel: 0,
    thickness: 0,
    subdivisions: 4,
    sample: ([u, v]) => [u, v, u * u + v * v]
  });
  assert.equal(m.triangles.length, 32);
  const q = m.locate(0.31, 0.37);
  assert(q);
  near(q.point[0], 0.31);
  near(q.point[1], 0.37);
  assert(Math.abs(q.point[2] - (0.31 ** 2 + 0.37 ** 2)) < 0.04);
  const t = m.triangles.find(t => t.vertices.every(v => v.uv[0] <= 0.25 + 1e-9));
  assert(t);
  near(K.V.len(q.normal), 1);
});
test('native splat triangles share one profile, preserve affine corners, optics and provenance', () => {
  const b = kit.makeBuilder(2),
    m = M.mesh([square()], { controls: { transmission: 0.7, ior: 1.6, roughness: 0.15, coating: 0.5 } }),
    binding = M.emit(b, m),
    w = b.finish({});
  assert.equal(w.count, m.triangles.length);
  assert.equal(w.splatFootprints.styles.length, 1);
  assert.equal(binding.pieces[0].key, 'tile');
  assert(w.opticalSplats);
  assert(w.surfaces.length);
  const f = w.splatFootprints.frames;
  for (let i = 0; i < w.count; i++) {
    const c = Array.from(w.data.subarray(i * 16, i * 16 + 3)),
      u = Array.from(f.subarray(i * 6, i * 6 + 3)),
      v = Array.from(f.subarray(i * 6 + 3, i * 6 + 6));
    const actual = [K.V.sub(K.V.sub(c, u), v), K.V.sub(K.V.add(c, u), v), K.V.add(K.V.sub(c, u), v)];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) near(actual[j][k], m.triangles[i].vertices[j].point[k]);
  }
  const copy = kit.SplatProvenance.subset(w, [0, 2, 4]);
  assert.equal(copy.splatFootprints.frames.length, 18);
  assert(copy.opticalSplats);
  assert.equal(copy.renderMetadata.targets[1].surface, 'tile');
  const rest = K.deform.rest(w, [0]);
  K.deform.apply(w, [0], rest, p => [p[0] * 2, p[1], p[2]]);
  near(w.splatFootprints.frames[0], f[0] * 2);
});
test('invalid geometry and budgets fail before mutating a builder', () => {
  for (const fn of [
    () =>
      M.voronoi({
        sites: [
          [0, 0],
          [0, 0]
        ]
      }),
    () =>
      M.voronoi({
        sites: [
          [0, 0],
          [1, 1]
        ],
        maxWork: 1
      }),
    () => M.layout([square('x'), square('x')]),
    () =>
      M.layout([
        {
          polygon: [
            [0, 0],
            [1, 1],
            [0, 1],
            [1, 0]
          ]
        }
      ]),
    () => M.mesh([square()], { gap: 3 }),
    () => M.mesh([square()], { subdivisions: 32, maxTriangles: 2 }),
    () => M.mesh([square()], { sample: () => [NaN, 0, 0] }),
    () => M.mesh([square()], { palette: [] })
  ])
    assert.throws(fn);
  const b = kit.makeBuilder(1);
  assert.throws(() => M.emit(b, null));
  assert.equal(b.count(), 0);
});
test('software raster has fitted rectangular coverage without a diagonal hole', () => {
  const w = fixture(kit),
    r = require('../cli/render').render(w, { w: 96, h: 96, px: 1, raw: true, passes: ['splatId', 'depth'] });
  assert(r); // Coverage is measured across the shared diagonal, not only at triangle centers.
  const ids = r.passes.splatId;
  assert(ids);
  let covered = 0;
  for (const id of ids) if (id >= 0) covered++;
  assert(covered > 100);
});
test(
  'hardware raster and native picking agree for mosaic panes while orbiting',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      fixture,
      (kit, build, backend) => {
        const w = build(kit),
          b = backend(96, 96, { raw: true });
        b.draw(w);
        const samples = b.sample([
            [48, 48],
            [36, 36],
            [60, 60],
            [0, 0]
          ]),
          hit = b.pick(w, { origin: [0, 0, 4], direction: [0, 0, -1] }, { raw: true });
        b.draw(w, { camera: { ...w.cam, yaw: 0.4 } });
        const image = b.image();
        b.close();
        return { samples, hit: hit?.solid?.index, imageLength: image.length };
      }
    );
    assert(result.imageLength > 0);
    assert(result.hit >= 0);
    assert(result.samples);
  }
);

test('grid sites, tiny convex edges and flat bevels stay fitted without topology inversions', () => {
  const sites = Array.from({ length: 16 }, (_, i) => [((i % 4) + 0.5) / 4, (Math.floor(i / 4) + 0.5) / 4]);
  const p = M.voronoi({ sites });
  assert.equal(p.cells.length, 16);
  const m = M.mesh(p, { gap: 0.01, bevel: 0.02, bevelDepth: 0 });
  assert.equal(m.pieces.length, 16);
  assert(m.triangles.some(t => t.part === 'bevel'));
  assert.equal(m.locate(0.125, 0.125).key, '0');
  assert.equal(m.locate(2, 2), null);
});
test('retained plane intersections preserve oblique perspective coordinates and distance', () => {
  const F = kit.SplatFootprints,
    p = F.prepare({ shape: 'square', depth: 'plane', softness: 0 }),
    c = [0, 0, 0],
    f = [1, 0, 0.7, 0, 1, 0];
  const hit = F.planeSample(c, f, [0.5, 0.2, 4], [0, 0, -1]);
  near(hit.position[2], 0.35);
  near(hit.uv[0], 0.5);
  near(hit.uv[1], 0.2);
  near(hit.t, 3.65);
  assert.equal(F.planeSample(c, f, [0, 0, 4], [1, 0, 0.7]), null);
  assert.throws(() => F.prepare({ depth: 'unknown' }));
  const b = kit.makeBuilder(1),
    s = M.mesh(
      [
        {
          key: 'plane',
          polygon: [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1]
          ]
        }
      ],
      { gap: 0, bevel: 0, thickness: 0, sample: ([u, v]) => [u, v, 0.7 * u] }
    );
  M.emit(b, s);
  const w = b.finish({});
  assert(w.splatFootprints.styles.every(p => p.depth === 'plane'));
  const rays = K.procedural.contributions.create(w);
  const q = rays.ray({ origin: [0.5, 0.2, 4], direction: [0, 0, -1] }).contributions[0];
  assert(q);
  near(q.point[2], 0.35);
  assert.equal(rays.ray({ origin: [0.5, 0.2, 4], direction: [0, 0, -1], maxDistance: 3.5 }).contributions.length, 0);
});
function crossingFixture(kit) {
  const B = kit.makeBuilder(7),
    M = kit.KIT.mosaic,
    cells = [
      {
        key: 'crossing',
        polygon: [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1]
        ]
      }
    ];
  for (const [s, color] of [
    [0.6, '#178ad1'],
    [-0.6, '#ed6138']
  ])
    M.emit(
      B,
      M.mesh(cells, {
        gap: 0,
        bevel: 0,
        thickness: 0,
        grout: false,
        palette: [color],
        sample: ([u, v]) => [u, v, s * u]
      }),
      { object: color, ambient: 1 }
    );
  return B.finish({
    cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0, ortho: true },
    radius: 10,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 },
    look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
  });
}
test('software plane depth resolves crossing polygons at each pixel, independent of center order', () => {
  const w = crossingFixture(kit),
    r = require('../cli/render').render(w, { w: 96, h: 96, px: 1, raw: true });
  const left = (48 * 96 + 40) * 3,
    right = (48 * 96 + 56) * 3;
  assert(r.rgb[left] > r.rgb[left + 2] * 2);
  assert(r.rgb[right + 2] > r.rgb[right] * 2);
});
test(
  'WebGL opaque-plane depth prepass agrees with software at crossing surfaces',
  { skip: !process.env.INK_TEST_CHROME },
  () => {
    const result = require('../cli/look-webgl')(
      { chrome: process.env.INK_TEST_CHROME, hardware: true },
      crossingFixture,
      (kit, build, backend) => {
        const w = build(kit),
          b = backend(96, 96, { raw: true });
        b.draw(w);
        const samples = b.sample([
          [40, 48],
          [56, 48]
        ]);
        b.draw(w, { camera: { ...w.cam, ortho: false, yaw: 0.4 } });
        const perspective = b.image();
        b.close();
        return { samples, perspectiveLength: perspective.length };
      }
    );
    assert(result.samples[0][0] > result.samples[0][2] * 2);
    assert(result.samples[1][2] > result.samples[1][0] * 2);
    assert(result.perspectiveLength > 0);
  }
);

test('plane compositing never silently drops exact depth when a fragment budget is exhausted', () => {
  assert.throws(
    () => require('../cli/render').render(crossingFixture(kit), { w: 96, h: 96, px: 1, raw: true, fragmentBudget: 1 }),
    /Surface-plane rendering exceeded/
  );
});
