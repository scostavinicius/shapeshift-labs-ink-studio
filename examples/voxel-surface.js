/* A canal miniature, a block automaton, and four readings of one signed field. */
function voxelSurfaceDemo({ KIT: K, makeBuilder, makeSculpt }) {
  const F = K.voxelSurface,
    { V, M } = K,
    state = { view: 'city', spread: 0, paused: false, time: 0 },
    cache = {};
  const box = (p, c, h) => Math.max(...p.map((n, k) => Math.abs(n - c[k]) - h[k]));
  const ball = (p, c, r) => V.dist(p, c) - r;
  const settings = cam => ({
    cam,
    radius: 100,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 },
    look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
  });
  function start() {
    return makeBuilder(417, [0x101e2c, 0xffffff]);
  }
  function draw(B, field, bounds, options = {}, appearance = {}) {
    const p = F.fromSdf(field, { bounds, size: 0.22, ...options });
    return F.draw(B, p, { palette: ['#387b86', '#4f9da5', '#78c0bf'], variation: 0.035, ambient: 0.4, ...appearance });
  }
  function cube(B, at, half, color, size = 0.2, options = {}) {
    return draw(
      B,
      (...p) => box(p, at, half),
      { min: V.sub(at, half), max: V.add(at, half) },
      { size, mode: 'slabs', ...options },
      { color }
    );
  }
  function city() {
    const B = start();
    // A terraced river island: slabs retain contours, columns form the water.
    draw(
      B,
      (x, y, z) =>
        Math.max(
          y - (0.35 + 0.22 * Math.sin(x * 0.9) * Math.cos(z * 0.8)),
          -0.9 - y,
          Math.abs(x) - 3.9,
          Math.abs(z) - 2.8
        ),
      { min: [-4, -1, -3], max: [4, 0.7, 3] },
      { size: [0.22, 0.2, 0.22], mode: 'slabs' },
      { color: b => (b.center[1] < -0.4 ? '#243f54' : b.center[1] < 0 ? '#376572' : '#568c8b') }
    );
    draw(
      B,
      (x, y, z) => Math.max(Math.abs(x) - 4.05, Math.abs(z + 1.25) - 0.65, Math.abs(y - 0.44) - 0.09),
      { min: [-4.1, 0.3, -1.95], max: [4.1, 0.6, -0.55] },
      { mode: 'columns', size: [0.2, 0.1, 0.2] },
      { color: b => (Math.sin(b.center[0] * 8 + b.center[2] * 5) > 0.3 ? '#4eafb6' : '#225d78'), ambient: 0.8 }
    );
    // Quays and a small stepped crossing, with clearance above the canal.
    for (const z of [-2.02, -0.5]) cube(B, [0, 0.62, z], [4, 0.1, 0.1], '#d5aa79', 0.2);
    for (let i = -3; i <= 3; i++)
      cube(B, [i * 0.22, 1.02 - Math.abs(i) * 0.05, -1.25], [0.12, 0.1, 0.8], '#e2b77d', 0.1);
    for (const x of [-0.86, 0.86]) cube(B, [x, 0.78, -1.25], [0.08, 0.5, 0.7], '#35566a', 0.16);
    const structures = [
      [-2.6, 1.3, 0.9, 0.66, 1.05, 0.64],
      [-1, 1.5, 1.45, 0.55, 1.3, 0.65],
      [0.55, 1.2, 1, 0.55, 1, 0.6],
      [2.45, 1.55, 1.55, 0.7, 1.4, 0.7],
      [2.6, 1.05, -2.3, 0.7, 0.65, 0.3]
    ];
    for (const [i, s] of structures.entries()) {
      const c = s.slice(0, 3),
        h = s.slice(3),
        windows = (b, f) => {
          if (f.normal[1] > 0.5) return '#d6a26a';
          const p = b.center,
            lit = Math.abs(f.normal[2]) > 0.5 && Math.sin(p[0] * 24 + i * 2) > -0.2 && Math.sin(p[1] * 17) > 0.15;
          return lit ? '#9ce2d5' : i % 2 ? '#356574' : '#456f7e';
        };
      draw(
        B,
        (...p) => box(p, c, h),
        { min: V.sub(c, h), max: V.add(c, h) },
        { size: 0.16, mode: 'slabs', axis: 1 },
        { color: windows, object: 'house-' + i }
      );
      cube(B, [c[0], c[1] + h[1] + 0.13, c[2]], [h[0] + 0.15, 0.12, h[2] + 0.15], '#d59a60', 0.14);
      cube(B, [c[0] - 0.15, c[1] + h[1] + 0.38, c[2]], [0.12, 0.18, 0.12], '#344e62', 0.12);
    }
    // One closed-block tower is connected directly to the shared destruction system.
    const c = [-2.75, 1.65, -2.3],
      h = [0.5, 1.2, 0.38];
    const tower = draw(
      B,
      (...p) => box(p, c, h),
      { min: V.sub(c, h), max: V.add(c, h) },
      { size: 0.26, closed: true },
      {
        object: 'breakable-tower',
        color: (b, f) => (f.normal[1] > 0.5 ? '#efc28a' : b.center[1] % 0.52 > 0.26 ? '#b27657' : '#cf986b')
      }
    );
    // Pixel relief sign, sampled along Z: cut-out apertures between glyph strokes.
    const glyphs = ['111101111', '100101001', '111101111', '001101100', '111101111'];
    const sign = (x, y, z) => {
      const col = Math.floor((x - 1.92) / 0.09),
        row = 4 - Math.floor((y - 2.2) / 0.09);
      return col >= 0 && col < 9 && row >= 0 && row < 5 && glyphs[row][col] === '1' && Math.abs(z - 0.78) < 0.06
        ? -0.01
        : 1;
    };
    draw(
      B,
      sign,
      { min: [1.92, 2.2, 0.7], max: [2.73, 2.65, 0.86] },
      { mode: 'relief', axis: 2, size: [0.09, 0.09, 0.04], thickness: 0.08 },
      { color: '#f7d19b', emissive: true }
    );
    for (const [x, z] of [
      [-3.35, 2],
      [1.45, 2.1],
      [3.3, -0.1],
      [-1.5, -2.3]
    ]) {
      cube(B, [x, 0.95, z], [0.07, 0.65, 0.07], '#926b58', 0.12);
      draw(
        B,
        (...p) =>
          Math.min(ball(p, [x, 1.65, z], 0.43), ball(p, [x - 0.22, 1.85, z], 0.32), ball(p, [x + 0.25, 1.8, z], 0.3)),
        { min: [x - 0.6, 1.2, z - 0.5], max: [x + 0.6, 2.2, z + 0.5] },
        { size: 0.15 },
        { palette: ['#d8a486', '#f2c09a', '#bd846c'], ambient: 0.5 }
      );
    }
    for (const [x, z] of [
      [-1.45, -0.4],
      [1.5, -0.4],
      [3.5, -2]
    ]) {
      cube(B, [x, 1.05, z], [0.04, 0.5, 0.04], '#e4b77e', 0.08);
      cube(B, [x, 1.56, z], [0.13, 0.13, 0.13], '#f9d995', 0.13);
    }
    const world = B.finish(settings({ target: [0, 1.1, 0], dist: 13.6, yaw: 2.64, pitch: 0.56 })),
      stage = K.stage(world),
      groups = F.groups(tower, { prefix: 'tower' });
    const destruction = K.destruction(stage, { groups, maxPieces: 512, ground: () => 0.55, gravity: 9, points: 8 });
    return { world, camera: { ...world.cam }, stage, destruction, groups, count: tower.blocks.length };
  }
  function automaton() {
    const B = makeBuilder(417, [0x101e2c, 0xffffff, 0x24475b, 0x428c96, 0x83c9c6, 0xdca374, 0xb9eee0]);
    cube(B, [0, -0.35, 0], [2.7, 0.2, 1.9], '#24475b', 0.25);
    for (const x of [-2.4, 2.4]) cube(B, [x, -0.1, 0], [0.06, 0.05, 1.5], '#d2a170', 0.1);
    const smoothFirst = B.count(),
      S = makeSculpt(B);
    Object.assign(S, { res: 0.042, wob: 0, amb: 0.34, aoK: 0.3 });
    const body = { r: [2, 3, 4] },
      head = { r: [2, 3, 5] };
    S.box([0, 1.55, 0], [0.55, 0.6, 0.32], body, { rd: 0.18 });
    S.box([0, 2.55, 0], [0.4, 0.36, 0.35], head, { rd: 0.16 });
    for (const side of [-1, 1]) {
      S.tube(
        [
          [side * 0.42, 1.98, 0],
          [side * 1.03, 1.25, 0.12]
        ],
        0.2,
        0.17,
        body
      );
      S.tube(
        [
          [side * 0.28, 1.05, 0],
          [side * 0.5, 0.24, 0.16]
        ],
        0.23,
        0.19,
        body
      );
      S.ball([side * 0.13, 2.58, 0.331], [0.066, 0.045, 0.027], { r: [6], em: true });
    }
    S.bake();
    const batch = draw(
      B,
      S.sdf,
      { min: [-1.5, -0.1, -0.6], max: [1.5, 3.05, 0.6] },
      { size: 0.17, closed: true, gap: 0.025 },
      {
        color: (b, f) =>
          b.center[1] > 2.45 && f.normal[2] > 0.5
            ? '#b9eee0'
            : b.center[1] > 2.1
              ? '#dca374'
              : b.center[1] < 0.4
                ? '#527c8c'
                : '#428c96',
        object: 'automaton',
        variation: 0.02
      }
    );
    const world = B.finish(settings({ target: [0, 1.4, 0], dist: 6.8, yaw: 0.38, pitch: 0.19 }));
    const baseOpacity = Float32Array.from(
      { length: batch.end - smoothFirst },
      (_, i) => world.data[(smoothFirst + i) * 16 + 3]
    );
    const rows = Array.from(
      { length: ((batch.end - 1) >> 9) - (smoothFirst >> 9) + 1 },
      (_, i) => (smoothFirst >> 9) + i
    );
    let progress = 0,
      spread = 0,
      dirty = false;
    const rig = F.bind(world, batch, {
      pose(b, t, k) {
        const drift = spread * (0.6 + 0.6 * Math.sin(k * 12.91) ** 2),
          dir = V.norm(V.sub(b.center, [0, 1.4, 0]));
        return {
          translation: V.add(V.mul(dir, drift), [
            Math.sin(k * 1.7 + t) * spread * 0.12,
            Math.sin(t * 1.3 + k) * spread * 0.12,
            0
          ]),
          rotation: M.rot(V.norm([Math.sin(k), 0.4, Math.cos(k)]), spread * (0.4 + Math.sin(k * 3.3)))
        };
      }
    });
    function setProgress(next) {
      progress = next;
      // Reveal the block surface before its pieces begin to separate.
      const mix = Math.min(1, progress / 0.32);
      spread = Math.max(0, (progress - 0.32) / 0.68);
      baseOpacity.forEach((opacity, i) => {
        const id = smoothFirst + i;
        world.data[id * 16 + 3] = opacity * (id < batch.first ? 1 - mix : mix);
      });
      dirty = true;
    }
    setProgress(0);
    rig.update(0, 0);
    return {
      world,
      camera: { ...world.cam },
      step(dt, t) {
        const target = state.spread;
        if (progress !== target) {
          const next = progress + (target - progress) * (1 - Math.exp(-dt * 3));
          setProgress(Math.abs(next - target) < 0.001 ? target : next);
        }
        rig.update(dt, t);
      },
      rows() {
        if (!dirty) return [];
        dirty = false;
        return rows;
      },
      count: batch.blocks.length
    };
  }
  function study() {
    const B = start();
    const labels = ['cubes', 'columns', 'slabs', 'relief'];
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * 3.2 - 1.6,
        z = 1.3 - Math.floor(i / 2) * 2.65;
      cube(B, [x, -0.15, z], [1.35, 0.12, 1.1], '#26485e', 0.25);
      draw(
        B,
        (a, b, c) => Math.max(Math.hypot(a - x, b - 0.95, c - z) - 0.95, -(Math.hypot(a - x, c - z) - 0.3)),
        { min: [x - 1, 0, z - 1], max: [x + 1, 2, z + 1] },
        { mode: labels[i], size: 0.2, axis: i === 3 ? 2 : 1, thickness: 0.12 },
        { palette: ['#51929e', '#68b9bd', '#d6a67a'], object: labels[i] }
      );
    }
    const world = B.finish(settings({ target: [0, 0.65, 0], dist: 10.3, yaw: 0.2, pitch: 0.5 }));
    return { world, camera: { ...world.cam } };
  }
  const builders = { city, automaton, study };
  return {
    state,
    get world() {
      return this.current.world;
    },
    get camera() {
      return this.current.camera;
    },
    get current() {
      return cache[state.view] ?? (cache[state.view] = builders[state.view]());
    },
    step(dt) {
      if (!state.paused) {
        state.time += dt;
        this.current.step?.(dt, state.time);
        this.current.destruction?.update(Math.min(dt, 0.05));
      }
    },
    break() {
      const c = this.current;
      if (!c.destruction) return;
      for (const [i, g] of c.groups.entries())
        if (c.destruction.intact(g.id))
          c.destruction.release(g.id, {
            v: [Math.sin(i * 13) * 2.6, 1.5 + (i % 4) * 0.4, Math.cos(i * 7) * 2],
            w: [Math.sin(i), 1.7, Math.cos(i)]
          });
    },
    reset() {
      state.spread = 0;
      this.current.destruction?.reset();
    },
    rows() {
      const st = this.current.stage;
      if (!st) return this.current.rows?.() ?? [];
      const rows = [];
      st.rows.forEach((n, i) => {
        if (n) rows.push(i);
      });
      st.rows.fill(0);
      return rows;
    }
  };
}
if (typeof module !== 'undefined') module.exports = voxelSurfaceDemo;
