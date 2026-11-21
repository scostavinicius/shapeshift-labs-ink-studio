/* Two native-splat studies of fields made visible. */
function contourRibbonDemo({ KIT: K, makeBuilder, makeSculpt }) {
  const colors = [0x071b27, 0x0e3440, 0x155459, 0x28756d, 0x69aaa0, 0xa9d6ba, 0xe2b266, 0xffdba0];
  const state = { view: 'atlas', paused: false, time: 0 },
    worlds = {},
    stages = {},
    effects = {},
    cameras = {};
  const settings = cam => ({
    cam,
    radius: 30,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 },
    look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
  });
  const levelColors = ['#246d69', '#468e7b', '#80b595', '#d2c28c', '#edbc70'];
  function atlas() {
    const B = makeBuilder(41, colors),
      S = K.sculpt(makeSculpt(B));
    Object.assign(S, { amb: 0.3, sky: 0.1, sun: [-0.55, 0.85, 0.5], aoK: 0.3, shK: 1.3, wob: 0, fat: 0.47 });
    const height = (x, z) =>
      -0.32 +
      2.25 * Math.exp(-((x + 0.7) ** 2 / 1.45 + (z + 0.5) ** 2 / 1.15)) +
      1.45 * Math.exp(-((x - 1.05) ** 2 / 0.65 + (z - 0.35) ** 2 / 0.9)) +
      0.55 * Math.exp(-((x + 1.6) ** 2 / 0.5 + (z - 1) ** 2 / 0.6)) +
      0.07 * Math.sin(x * 5 + z * 2) * Math.cos(z * 4) * Math.exp(-(x * x + z * z) / 8);
    const bands = K.contour.bands({ step: 0.28, offset: -0.4 });
    const flat = { shape: 'square', softness: 0.03, depth: 'plane' };
    const mat = bands.material([
      { r: [0, 1], footprint: flat },
      { r: [1, 2], footprint: flat },
      { r: [1, 2], footprint: flat },
      { r: [2, 3], footprint: flat },
      { r: [2, 3], footprint: flat },
      { r: [3, 4], footprint: flat },
      { r: [3, 4], footprint: flat },
      { r: [4, 5], footprint: flat },
      { r: [5], footprint: flat }
    ]);
    S.box([0, -0.65, 0], [3.25, 0.12, 2.65], { r: [0, 1] }, { res: 0.14 });
    S.box([0, -0.48, 0], [3.18, 0.055, 2.58], { r: [1, 2] }, { res: 0.12 });
    S.terrain(mat, { h: height, x0: -3, x1: 3, z0: -2.4, z1: 2.4, res: 0.055 });
    S.bake();
    const plan = K.contour.heightfield(height, {
      bounds: { min: [-3, -2.4], max: [3, 2.4] },
      levels: K.contour.levels({ min: -0.2, max: 2.2, step: 0.16 }),
      cell: 0.07
    });
    K.contour.draw(B, plan, {
      width: 0.014,
      step: 0.07,
      lift: 0.035,
      majorEvery: 4,
      majorScale: 2,
      footprint: 'flat',
      color: m => (m.major ? '#ffe0a2' : levelColors[m.band % levelColors.length]),
      emissive: true,
      objectId: 'elevation-ribbons'
    });
    // Scalar isolines on a moving-looking, curved water chart. Geometry is baked once.
    const water = K.contour.surface(
      (u, v) => {
        const x = u * 6 - 3,
          z = v * 4.8 - 2.4;
        return {
          p: [x, -0.18 + 0.018 * Math.sin(x * 4 + z * 3), z],
          n: [-0.072 * Math.cos(x * 4 + z * 3), 1, -0.054 * Math.cos(x * 4 + z * 3)]
        };
      },
      {
        field: (x, y, z) =>
          height(x, z) > -0.16 ? null : Math.hypot((x + 0.45) * 0.8, z + 0.15) + 0.07 * Math.sin(x * 3 - z * 2),
        levels: K.contour.levels({ min: 0.2, max: 4, step: 0.18 }),
        cell: 0.025,
        maxCells: 500000
      }
    );
    K.contour.draw(B, water, {
      width: 0.014,
      step: 0.09,
      color: m => (m.major ? '#89c7bc' : '#255968'),
      alpha: 1.5,
      objectId: 'tide-lines'
    });
    // A chart can also describe a curved waterfall rather than a flat UV sheet.
    const falls = K.contour.surface(
      (u, v) => ({
        p: [1.82 + (v - 0.5) * 0.36, 0.65 - 1.02 * u, -0.35 + 0.17 * Math.sin(u * Math.PI)],
        n: [0, 0.17 * Math.PI * Math.cos(u * Math.PI), 1.02]
      }),
      { field: (x, y, z, u, v) => v, levels: K.contour.levels({ min: 0, max: 1, step: 0.13 }), cell: 0.035 }
    );
    K.contour.draw(B, falls, { width: 0.019, step: 0.055, color: '#c6e4c3', emissive: true, objectId: 'fall-ribbons' });
    const w = B.finish(settings({ target: [0, 0.5, 0], dist: 10, yaw: 0.48, pitch: 0.62 }));
    w.contourStats = plan.stats;
    return w;
  }
  function oracle() {
    const B = makeBuilder(72, colors),
      S = K.sculpt(makeSculpt(B));
    Object.assign(S, { amb: 0.4, wob: 0, fat: 0.45 });
    S.lathe([0, -1.9, 0], 0.16, () => 1.35, { r: [0, 1, 2] }, { res: 0.1, maxRadius: 1.35 });
    S.lathe([0, -1.74, 0], 0.1, () => 1.08, { r: [1, 2, 3] }, { res: 0.09, maxRadius: 1.08 });
    S.bake();
    const ellipse = (x, y, z, c, r) =>
        (Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]) - 1) * Math.min(...r),
      smooth = (a, b, k) => {
        const h = Math.max(k - Math.abs(a - b), 0) / k;
        return Math.min(a, b) - h * h * k * 0.25;
      },
      body = (x, y, z) => {
        let d = smooth(
          smooth(
            ellipse(x, y, z, [0, -0.72, 0], [1.27, 0.78, 0.58]),
            ellipse(x, y, z, [0, 0.03, 0], [0.36, 0.8, 0.34]),
            0.22
          ),
          ellipse(x, y, z, [0, 1.12, 0], [0.66, 0.9, 0.56]),
          0.25
        );
        d = smooth(d, ellipse(x, y, z, [0, 1.05, 0.56], [0.13, 0.25, 0.26]), 0.1);
        d = smooth(d, ellipse(x, y, z, [0, 0.65, 0.41], [0.28, 0.17, 0.2]), 0.1);
        for (const sign of [-1, 1]) {
          d = smooth(d, ellipse(x, y, z, [sign * 0.65, 1.08, -0.02], [0.14, 0.27, 0.14]), 0.06);
          d = Math.max(d, -ellipse(x, y, z, [sign * 0.26, 1.3, 0.5], [0.19, 0.125, 0.18]));
        }
        return d;
      },
      bounds = { min: [-1.5, -1.5, -0.8], max: [1.5, 2.1, 0.95] },
      plan = K.contour.slices(body, {
        bounds,
        levels: K.contour.levels({ min: -1.4, max: 1.98, step: 0.105 }),
        cell: 0.055
      });
    const batch = K.contour.draw(B, plan, {
      width: 0.024,
      step: 0.07,
      lift: 0,
      majorEvery: 5,
      majorScale: 1.7,
      color: m => (m.major ? '#ffcb7c' : m.band % 2 ? '#8bdac6' : '#397e82'),
      emissive: true,
      alpha: 2.8,
      objectId: 'oracle-ribbons'
    });
    // Wavy meridians illustrate isolines that wrap an arbitrary parametric surface.
    const torus = K.contour.surface(
      (u, v) => {
        const a = u * Math.PI * 2,
          b = v * Math.PI * 2,
          r = 1.85 + 0.12 * Math.cos(b);
        return {
          p: [Math.cos(a) * r, -0.25 + 0.12 * Math.sin(b), Math.sin(a) * r],
          n: [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)]
        };
      },
      { field: (x, y, z, u, v) => v + 0.055 * Math.sin(u * Math.PI * 8), levels: [0.2, 0.45, 0.7], cell: 0.025 }
    );
    K.contour.draw(B, torus, {
      width: 0.012,
      step: 0.08,
      color: '#dba75d',
      emissive: true,
      alpha: 1.4,
      objectId: 'orbital-ribbons'
    });
    const w = B.finish(settings({ target: [0, 0.15, 0], dist: 7.8, yaw: 0.22, pitch: 0.18 })),
      stage = K.stage(w);
    const fx = stage.add(
      K.materialisation.bind(stage, {
        id: 'peeling-contours',
        ids: batch.ids,
        flow: K.flow.sum(K.flow.wind([0.28, 0.2, 0.08]), K.flow.vortex([0, 0.3, 0], [0, 1, 0], 0.28, 6)),
        width: 0.008,
        length: 0.025,
        peel: 0.65,
        drag: 1.4,
        emissive: true
      })
    );
    const story = [
      {
        at: 2,
        action: 'release',
        options: { fraction: 0.3, stagger: 1.8, velocity: [0.15, 0.13, 0], normalImpulse: 0.15 }
      },
      { at: 5.5, action: 'rejoin', options: { duration: 2.8, stagger: 0.6 } }
    ];
    fx.timeline(story, { loop: 11 });
    stages.oracle = stage;
    effects.oracle = fx;
    w.contourStats = plan.stats;
    return w;
  }
  worlds.atlas = atlas();
  worlds.oracle = oracle();
  for (const id of Object.keys(worlds)) cameras[id] = { ...worlds[id].cam };
  return {
    state,
    worlds,
    effects,
    stages,
    get world() {
      return worlds[state.view];
    },
    get camera() {
      return cameras[state.view];
    },
    update(dt) {
      if (!state.paused) {
        state.time += dt;
        if (state.view === 'oracle') stages.oracle.update(dt, state.time);
      }
    },
    command(name) {
      const fx = effects.oracle;
      state.view = 'oracle';
      fx.timeline([]);
      if (name === 'peel') fx.release({ stagger: 1.1, velocity: [0.25, 0.2, 0], normalImpulse: 0.12 });
      else if (name === 'home') fx.rejoin({ duration: 2.4, stagger: 0.25 });
      else {
        fx.reset();
        fx.timeline(
          [
            {
              at: 2,
              action: 'release',
              options: { fraction: 0.3, stagger: 1.8, velocity: [0.15, 0.13, 0], normalImpulse: 0.15 }
            },
            { at: 5.5, action: 'rejoin', options: { duration: 2.8, stagger: 0.6 } }
          ],
          { loop: 11 }
        );
      }
    },
    seek(t) {
      effects.oracle.reset();
      effects.oracle.advance(t);
      state.time = t;
    },
    changedRows() {
      const stage = stages[state.view],
        rows = [];
      if (stage)
        for (let i = 0; i < stage.rows.length; i++)
          if (stage.rows[i]) {
            rows.push(i);
            stage.rows[i] = 0;
          }
      return rows;
    }
  };
}
if (typeof module !== 'undefined') module.exports = contourRibbonDemo;
