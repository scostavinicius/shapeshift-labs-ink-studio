/* Two optional fitted-polygon representations among native SDF sculptures. */
function mosaicDemo({ KIT: K, makeBuilder, makeSculpt }) {
  const M = K.mosaic,
    V = K.V,
    TAU = Math.PI * 2;
  const palettes = {
    lapis: ['#092b4c', '#15557b', '#167f9b', '#33b9c3', '#83d4ce', '#d99a3e', '#f2cb78', '#f8e1a1'],
    rose: ['#241c4f', '#49397e', '#7563b2', '#b074b5', '#df919e', '#db8e42', '#f3c06b', '#ffe1a0']
  };
  const state = {
    view: 'fish',
    palette: 'lapis',
    bevel: true,
    grout: true,
    transmission: 0.52,
    paused: false,
    turntable: false,
    time: 0
  };
  let worlds, controls, rig;
  const sites = (nx, ny, seed) =>
    Array.from({ length: nx * ny }, (_, i) => {
      const x = i % nx,
        y = Math.floor(i / nx);
      return {
        key: `${x}:${y}`,
        point: [
          (x + 0.5 + 0.36 * (K.hash(x, y, seed) - 0.5)) / nx,
          (y + 0.5 + 0.36 * (K.hash(x, y, seed + 11) - 0.5)) / ny
        ]
      };
    });
  function setup(seed) {
    const B = makeBuilder(
      seed,
      [0x09172a, 0x132b42, 0x28516a, 0x477b86, 0x88b8ad, 0xb87535, 0xe4b15c, 0xf4d68e, 0xffedba]
    );
    const S = K.sculpt(makeSculpt(B)),
      tube = S.tube;
    S.tube = (points, r, mat, options) => tube(points, r, r * 0.7, mat, options);
    S.cyl = (center, r, h, mat, options) => S.lathe([center[0], center[1] - h / 2, center[2]], h, r, mat, options);
    Object.assign(S, {
      pixel: false,
      amb: 0.32,
      sky: 0.24,
      sunK: 0.85,
      aoK: 0.2,
      fat: 0.3,
      sun: V.norm([-0.5, 0.9, 0.6])
    });
    return { B, S };
  }
  const dark = { r: [0, 1, 2] },
    stone = { r: [1, 2, 3, 4] },
    gold = { r: [5, 6, 7, 8] },
    leaf = { r: [2, 3, 4, 7] };
  function finish(B, cam) {
    return B.finish({
      cam,
      radius: 30,
      dither: 0,
      fog: { c: 0, start: 1, max: 0 },
      look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
    });
  }
  function add(B, plan, options, object, ambient = 0.63) {
    const mesh = M.mesh(plan, {
      gap: 0.009,
      bevel: state.bevel ? 0.006 : 0,
      thickness: 0.025,
      bevelDepth: state.bevel ? 0.012 : 0,
      grout: state.grout ? '#0c2031' : false,
      palette: palettes[state.palette],
      ...options
    });
    return { mesh, binding: M.emit(B, mesh, { object, ambient }) };
  }
  function buildFish() {
    const { B, S } = setup(54),
      palette = palettes[state.palette];
    const bodyPlan = M.voronoi({ sites: sites(19, 10, 21) });
    const body = add(
      B,
      bodyPlan,
      {
        subdivisions: 2,
        sample([u, v], h) {
          const t = v * TAU,
            r = 0.16 + 0.95 * Math.sin(u * Math.PI) ** 0.65 * (1 - 0.14 * u);
          return [(u - 0.5) * 5.2, 2.9 + (r + h) * Math.sin(t), (0.62 * r + h) * Math.cos(t)];
        },
        paint(c) {
          const [x, y] = c.key.split(':').map(Number);
          return palette[y >= 7 ? 5 + ((x + y) % 3) : (x * 3 + y) % 5];
        }
      },
      'lapis-body'
    );
    const bodyEnd = B.count();
    const tailCells = [];
    for (let i = 0; i < 10; i++) {
      const a = -1.17 + i * 0.234,
        b = a + 0.234;
      tailCells.push({
        key: 'tail-' + i,
        polygon: [
          [0, 0],
          [1.6 - 0.45 * Math.abs(Math.sin(a)), Math.sin(a) * 1.45],
          [1.6 - 0.45 * Math.abs(Math.sin(b)), Math.sin(b) * 1.45]
        ]
      });
    }
    // A fitted fan of polygon feathers; each piece follows the tail bone.
    add(
      B,
      tailCells,
      {
        gap: 0.006,
        bevel: state.bevel ? 0.008 : 0,
        thickness: 0.035,
        sample: ([u, v], h) => [2.35 + u, 2.9 + v, h],
        paint: c => palette[c.index % 2 ? 6 : 2]
      },
      'tail',
      0.85
    );
    const tailEnd = B.count();
    // Dorsal sail follows the body, with long gold seams.
    for (let i = 0; i < 8; i++)
      S.tube(
        [
          [i * 0.35 - 1, 3.6, 0],
          [i * 0.35 - 1.15, 4.15 - Math.abs(i - 3.5) * 0.09, 0]
        ],
        0.027,
        gold,
        { res: 0.045, objectId: 'dorsal-fin' }
      );
    for (const sign of [-1, 1]) {
      S.ball([-1.9, 3.12, sign * 0.53], [0.25, 0.26, 0.12], gold, { res: 0.045, objectId: 'eye-rim' });
      S.ball([-1.94, 3.13, sign * 0.64], [0.125, 0.15, 0.07], dark, { res: 0.03, objectId: 'eyes' });
      S.ball([-1.98, 3.2, sign * 0.69], 0.038, { r: [8] }, { res: 0.025, objectId: 'eye-glint' });
      S.tube(
        [
          [-2.52, 2.88, sign * 0.16],
          [-2.65, 2.83, sign * 0.26],
          [-2.73, 2.67, sign * 0.29]
        ],
        0.025,
        gold,
        { res: 0.04, objectId: 'whiskers' }
      );
      S.tube(
        [
          [-0.8, 2.45, sign * 0.46],
          [-1.05, 1.96, sign * 0.87],
          [0.25, 2.25, sign * 0.7]
        ],
        0.055,
        gold,
        { res: 0.045, objectId: 'pectoral-fins' }
      );
    }
    S.bake();
    const fishEnd = B.count();
    // Inlaid stepped plinth, scalloped radial pattern and tiny native garden details.
    S.cyl([0, -0.42, 0], 4.55, 0.7, dark, { res: 0.18, objectId: 'plinth' });
    S.torus([0, 0.03, 0], 4.3, 0.06, gold, { res: 0.085, objectId: 'brass-rim' });
    const tiles = [];
    for (let ring = 0; ring < 7; ring++)
      for (let j = 0; j < 48; j++) {
        const a = (j * TAU) / 48,
          b = ((j + 1) * TAU) / 48,
          r0 = 0.24 + ring * 0.55,
          r1 = r0 + 0.55;
        tiles.push({
          key: `${ring}:${j}`,
          polygon: [
            [r0 * Math.cos(a), r0 * Math.sin(a)],
            [r1 * Math.cos(a), r1 * Math.sin(a)],
            [r1 * Math.cos(b), r1 * Math.sin(b)],
            [r0 * Math.cos(b), r0 * Math.sin(b)]
          ]
        });
      }
    add(
      B,
      tiles,
      {
        gap: 0.018,
        bevel: state.bevel ? 0.01 : 0,
        bevelDepth: state.bevel ? 0.008 : 0,
        thickness: 0.035,
        sample: ([u, v], h) => [u, 0.04 + h, -v],
        paint: c => {
          const [r, j] = c.key.split(':').map(Number);
          return palette[r === 0 || r === 5 ? 5 + (j % 3) : (j + r) % 3];
        }
      },
      'ocean-inlay',
      0.72
    );
    for (let i = 0; i < 15; i++) {
      const a = (i * TAU) / 15,
        r = 3.7,
        x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      for (let j = 0; j < 3; j++)
        S.tube(
          [
            [x, 0.08, z],
            [x + 0.12 * Math.sin(i + j), 0.35 + j * 0.08, z + 0.1 * Math.cos(i + j)],
            [x + 0.18 * Math.sin(i + j), 0.52 + j * 0.14, z + 0.2 * Math.cos(i + j)]
          ],
          0.027,
          j % 2 ? gold : leaf,
          { res: 0.06, objectId: 'coral' }
        );
    }
    S.bake();
    const w = finish(B, { target: [0.1, 1.9, 0], dist: 13.8, yaw: 0.28, pitch: 0.27, ortho: true }),
      ids = Array.from({ length: fishEnd }, (_, i) => i),
      mat = new Float32Array(24);
    rig = K.bones.bind(w, {
      ids,
      bid: Float32Array.from(ids, i => (i >= bodyEnd && i < tailEnd ? 1 : 0)),
      M: mat,
      pose(t) {
        const bob = 0.1 * Math.sin(t * 0.85),
          a = 0.11 * Math.sin(t * 1.4),
          R = K.M.rot([0, 1, 0], a);
        mat.set([...R, 0, bob, 0], 0);
        const R2 = K.M.rot([0, 1, 0], a + 0.22 * Math.sin(t * 1.4 - 0.6)),
          p = [2.4, 2.9, 0],
          q = K.M.app(R2, p);
        mat.set([...R2, p[0] - q[0], bob + p[1] - q[1], p[2] - q[2]], 12);
      }
    });
    return w;
  }
  function buildGlass() {
    const { B, S } = setup(91),
      palette = palettes[state.palette];
    // Radial authored panes form a true rose window, not separate round stamps.
    const cells = [
      {
        key: '0:0',
        polygon: Array.from({ length: 24 }, (_, j) => [
          0.45 * Math.cos((j * TAU) / 24),
          0.45 * Math.sin((j * TAU) / 24)
        ])
      }
    ];
    for (let ring = 0; ring < 4; ring++)
      for (let j = 0; j < 24; j++) {
        const a = (j * TAU) / 24,
          b = ((j + 1) * TAU) / 24,
          r0 = 0.45 + ring * 0.55,
          r1 = r0 + 0.55;
        cells.push({
          key: `${ring + 1}:${j}`,
          polygon: [
            [r0 * Math.cos(a), r0 * Math.sin(a)],
            [r1 * Math.cos(a), r1 * Math.sin(a)],
            [r1 * Math.cos(b), r1 * Math.sin(b)],
            [r0 * Math.cos(b), r0 * Math.sin(b)]
          ]
        });
      }
    const glassOptions = {
      gap: 0.025,
      bevel: state.bevel ? 0.012 : 0,
      bevelDepth: state.bevel ? 0.012 : 0,
      thickness: 0.065,
      grout: state.grout ? '#c2964f' : false,
      subdivisions: 1,
      controls: {
        transmission: state.transmission,
        roughness: 0.13,
        ior: 1.52,
        thickness: 0.065,
        absorption: 0.9,
        coating: { weight: 0.22, roughness: 0.08 }
      },
      sample: ([u, v], h) => [u, 3.25 + v, 0.4 + h],
      paint(c) {
        const [r, j] = c.key.split(':').map(Number);
        return palette[r === 0 ? 7 : j % 6 === 0 || r === 4 ? 5 + (j % 3) : 2 + ((j + r) % 3)];
      }
    };
    add(B, cells, glassOptions, 'rose-window', 0.92);
    // Tall side wings wrap the window into an open pavilion.
    for (const sign of [-1, 1]) {
      const p = M.voronoi({ sites: sites(4, 8, sign + 70) });
      add(
        B,
        p,
        {
          ...glassOptions,
          subdivisions: 1,
          gap: 0.014,
          bevel: state.bevel ? 0.006 : 0,
          sample: ([u, v], h) => [sign * (2.85 + u * 1.9), 0.45 + v * 4.7, -0.1 - u * 1.45 + h],
          paint: c => palette[2 + ((c.index * 7) % 6)]
        },
        'side-window-' + sign,
        0.8
      );
      S.tube(
        [
          [sign * 2.86, 0.4, -0.07],
          [sign * 4.76, 0.4, -1.52],
          [sign * 4.76, 5.15, -1.52],
          [sign * 2.86, 5.15, -0.07],
          [sign * 2.86, 0.4, -0.07]
        ],
        0.065,
        gold,
        { res: 0.075, objectId: 'window-frame' }
      );
    }
    S.torus([0, 3.25, 0.43], 2.74, 0.105, gold, { ax: S.AZ, res: 0.09, objectId: 'rose-frame' });
    S.torus([0, 3.25, 0.46], 2.87, 0.045, stone, { ax: S.AZ, res: 0.085, objectId: 'outer-frame' });
    for (const sign of [-1, 1]) {
      S.cyl([sign * 2.85, 2.65, 0.38], 0.12, 5.2, stone, { res: 0.09, objectId: 'pillars' });
      for (const y of [0.3, 0.6, 4.9, 5.2])
        S.cyl([sign * 2.85, y, 0.38], 0.2, 0.11, gold, { res: 0.065, objectId: 'capitals' });
      for (let i = 0; i < 4; i++)
        S.box([sign * 3.8, 0.05 - i * 0.12, -0.5 + i * 0.45], [1.15, 0.065, 0.55], dark, {
          res: 0.15,
          objectId: 'steps'
        });
    }
    // The tree and moon are deliberately behind the glass: transmission reveals them.
    S.ball([0.4, 4, -1.9], 0.78, gold, { res: 0.095, objectId: 'moon' });
    S.tube(
      [
        [0, 0.3, -1.6],
        [-0.1, 1.1, -1.7],
        [0.15, 2.2, -1.65],
        [-0.1, 3.3, -1.7]
      ],
      0.16,
      stone,
      { res: 0.085, objectId: 'tree-trunk' }
    );
    for (let j = 0; j < 10; j++) {
      const a = j * 2.4,
        y = 1.4 + (j % 4) * 0.48,
        x = Math.sin(a) * 1.35;
      S.tube(
        [
          [0, y, -1.6],
          [x * 0.6, y + 0.5, -1.7],
          [x, y + 0.65, -1.8]
        ],
        0.055,
        gold,
        { res: 0.07, objectId: 'branches' }
      );
      for (let n = 0; n < 4; n++)
        S.ball(
          [x + 0.25 * Math.sin(n * 2 + j), y + 0.62 + 0.24 * Math.cos(n * 2), -1.8 + 0.2 * Math.sin(n + j)],
          [0.22, 0.1, 0.14],
          leaf,
          { res: 0.06, objectId: 'leaves' }
        );
    }
    // Crisp native polygon fascia keeps the inlay clear of broad SDF caps.
    const panel = [
      {
        key: 'fascia',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1]
        ]
      }
    ];
    for (const [name, sample] of [
      ['front', ([u, v]) => [-5 + 10 * u, -0.45 + 0.43 * v, 2.7]],
      ['back', ([u, v]) => [5 - 10 * u, -0.45 + 0.43 * v, -4.1]],
      ['left', ([u, v]) => [-5, -0.45 + 0.43 * v, -4.1 + 6.8 * u]],
      ['right', ([u, v]) => [5, -0.45 + 0.43 * v, 2.7 - 6.8 * u]],
      ['underlay', ([u, v]) => [-5 + 10 * u, -0.04, 2.7 - 6.8 * v]]
    ])
      add(
        B,
        panel,
        { gap: 0, bevel: 0, bevelDepth: 0, thickness: 0, grout: false, palette: ['#17384b'], sample },
        'foundation-' + name,
        0.8
      );
    const floor = M.voronoi({ sites: sites(20, 12, 3) });
    add(
      B,
      floor,
      {
        gap: 0.008,
        bevel: state.bevel ? 0.004 : 0,
        thickness: 0.025,
        bevelDepth: state.bevel ? 0.012 : 0,
        subdivisions: 1,
        sample: ([u, v], h) => [(u - 0.5) * 9.7, h, (v - 0.5) * 6.1 - 0.7],
        paint: c => palette[c.index % 13 === 0 ? 6 : c.index % 3]
      },
      'pavilion-floor',
      0.65
    );
    // Discrete warm inlays echo the glass pattern on the floor.
    for (let j = 0; j < 24; j++) {
      const a = (j * TAU) / 24,
        x = Math.cos(a) * 2,
        z = Math.sin(a) * 1.15 - 1.2;
      S.box([x, 0.045, z], [0.11, 0.025, 0.11], gold, { res: 0.06, objectId: 'floor-inlays' });
    }
    S.bake();
    return finish(B, { target: [0, 2.6, -0.25], dist: 15.8, yaw: 0.19, pitch: 0.16, ortho: true });
  }
  function rebuild() {
    worlds = { fish: buildFish(), glass: buildGlass() };
    controls = Object.fromEntries(
      Object.entries(worlds).map(([k, w]) => [k, K.cameraRig.control(() => ({ camera: w.cam }), { handoff: 0.3 })])
    );
  }
  rebuild();
  return {
    state,
    get world() {
      return worlds[state.view];
    },
    get control() {
      return controls[state.view];
    },
    get worlds() {
      return worlds;
    },
    rebuild,
    update(dt) {
      if (!state.paused) state.time += dt;
      rig.update(dt, state.time);
      if (state.turntable) this.control.input({ yaw: dt * 0.11 });
    },
    reset() {
      state.time = 0;
      this.control.release();
    }
  };
}
if (typeof module !== 'undefined') module.exports = mosaicDemo;
