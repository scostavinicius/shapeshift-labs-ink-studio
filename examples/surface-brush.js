/* Pigment Coast: SDF forms painted with retained, surface-aligned native marks. */
function surfaceBrushDemo({ KIT: K, makeBuilder, makeSculpt }) {
  const colors = [
    0x080f25, 0x101e40, 0x19365b, 0x285176, 0x487d99, 0x84adba, 0xc7d5c7, 0x503427, 0x865036, 0xb77242, 0xe6a956,
    0xffd78d, 0xffecc1
  ];
  const brushes = {
    cliff: {
      style: 'gouache',
      direction: 'curvature',
      axis: [0, 1, 0],
      length: 0.58,
      width: 0.105,
      grain: 0.42,
      seed: 31
    },
    cloud: {
      style: 'bristle',
      direction: 'field',
      field: (x, y, z) => [1, 0.16 * Math.sin(x * 1.4 + z), 0.14],
      length: 0.68,
      width: 0.085,
      grain: 0.5,
      seed: 9
    },
    land: { style: 'gouache', direction: 'contour', axis: [0, 1, 0], length: 0.35, width: 0.13, seed: 13 },
    fish: { style: 'gouache', direction: 'axis', axis: [1, 0, 0], length: 0.23, width: 0.08, grain: 0.32, seed: 5 }
  };
  function pigment(ramp, strength = 0.2) {
    return (x, y, z, ny, t) => {
      const h = Math.sin(x * 91.7 + y * 173.3 + z * 157.9) * 43758.5453,
        u = h - Math.floor(h);
      return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor((t + (u - 0.5) * strength) * ramp.length)))];
    };
  }
  function setup(seed) {
    const b = makeBuilder(seed, colors),
      s = K.sculpt(makeSculpt(b));
    Object.assign(s, { pixel: false, sun: K.V.norm([-0.6, 0.9, 0.5]), amb: 0.34, sky: 0.2, sunK: 0.8, aoK: 0.22 });
    return { b, s };
  }
  function finish(b, cam) {
    return b.finish({
      cam,
      radius: 20,
      dither: 0,
      fog: { c: 0, start: 1, max: 0 },
      look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
    });
  }
  const coast = setup(410),
    { b, s } = coast;
  const rock = { r: [7, 8, 9, 10, 11], tex: pigment([7, 8, 9, 10, 11], 0.4), brush: brushes.cliff },
    coolRock = { r: [1, 2, 3, 4, 5], tex: pigment([1, 2, 3, 4, 5], 0.35), brush: brushes.cliff },
    moss = { r: [2, 3, 4, 5, 6], tex: pigment([2, 3, 4, 5, 6], 0.26), brush: brushes.land },
    chalk = { r: [9, 10, 11, 12], brush: { ...brushes.land, width: 0.08 } },
    trunk = { r: [7, 8, 9], brush: { ...brushes.cliff, length: 0.2, width: 0.06 } },
    pine = { r: [1, 2, 3, 4, 5], brush: { ...brushes.cliff, length: 0.34, width: 0.09 } };
  // A broken, terraced coast; the long painted sides turn with the cliff geometry.
  s.ball([-0.65, -0.9, 0], [4.4, 1.35, 2.7], coolRock, { res: 0.14, objectId: 'island' });
  for (let i = 0; i < 9; i++) {
    const a = i * 0.68,
      x = -3.3 + i * 0.75,
      z = -0.75 + 0.4 * Math.sin(a * 1.8),
      h = 1.6 + 0.7 * Math.sin(a + 0.4);
    s.box([x, -0.7, z], [0.53, h, 0.9], i % 3 ? rock : coolRock, { rd: 0.24, res: 0.115, objectId: 'cliff' });
    s.ball([x, h - 0.63, z], [0.68, 0.27, 1.02], moss, { res: 0.11, objectId: 'terrace' });
  }
  // A thin, warm path winds between the tree silhouettes.
  const path = [];
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    path.push([-3.65 + t * 7.1, 1.04 + 0.49 * Math.sin(t * 3.8 + 0.2), -0.12 + 0.6 * Math.sin(t * 6)]);
  }
  s.tube(path, 0.115, 0.115, chalk, { res: 0.09, objectId: 'path' });
  for (let i = 0; i < 11; i++) {
    const x = -3.1 + i * 0.57,
      z = -1.05 + 0.38 * Math.sin(i * 2.8),
      base = 1.1 + 0.48 * Math.sin(i * 0.46 + 0.3),
      h = 0.9 + 0.47 * (0.5 + 0.5 * Math.sin(i * 9));
    s.tube(
      [
        [x, base - 0.1, z],
        [x + 0.07, base + h * 0.7, z]
      ],
      0.055,
      0.022,
      trunk,
      { res: 0.09, objectId: 'trees' }
    );
    for (let j = 0; j < 4; j++)
      s.ball(
        [x + Math.sin(j) * 0.045, base + h * (0.36 + j * 0.2), z],
        [0.24 * (1 - j * 0.17), h * 0.27, 0.21 * (1 - j * 0.17)],
        pine,
        { res: 0.095, objectId: 'trees' }
      );
  }
  // Foreground rocks and directional tufts bring the small scale back.
  for (let i = 0; i < 20; i++) {
    const a = i * 2.4,
      x = Math.sin(a) * (2.7 + (i % 3) * 0.35),
      z = 1.3 + Math.cos(a) * 0.48;
    s.ball([x, -0.12, z], [0.18 + (i % 4) * 0.04, 0.2, 0.2], i % 2 ? rock : coolRock, { res: 0.12, objectId: 'shore' });
  }
  // Large horizontal brushwork in the cloud forms, rather than a screen filter.
  for (const [x, y, z, rx] of [
    [-3.8, 3.8, -2.4, 1.7],
    [-2.5, 4, -2.6, 1.3],
    [3.3, 4, -3, 1.7],
    [4.4, 3.8, -2.8, 1.3]
  ])
    s.ball(
      [x, y, z],
      [rx, 0.34, 0.68],
      { r: [2, 3, 4, 5, 6], tex: pigment([2, 3, 4, 5, 6], 0.32), brush: brushes.cloud },
      { res: 0.16, objectId: 'clouds' }
    );
  s.bake();
  // Small sculptural tide marks attached to a curved horizontal sheet.
  const wave = K.surfaceBrush.prepare({
    style: 'ink',
    direction: 'field',
    field: (x, y, z) => [1, 0, 0.22 * Math.cos(x * 1.6)],
    length: 0.45,
    width: 0.035,
    variants: 1
  });
  for (let row = 0; row < 7; row++)
    for (let i = 0; i < 24; i++) {
      const x = -4.3 + i * 0.37,
        z = 0.5 + row * 0.35,
        y = -0.52 + 0.04 * Math.sin(x * 2 + row);
      if ((x * x) / 20 + (z * z) / 11 > 1) continue;
      const f = K.surfaceBrush.direction(wave, [x, y, z], [0, 1, 0]);
      K.surfaceBrush.stamp(b, f, b.P[2 + ((i + row) % 3)], wave, { opacity: 1 });
    }
  const landscape = finish(b, { target: [0, 1.05, 0], dist: 19.2, yaw: 0.3, pitch: 0.42, ortho: true });
  const koi = setup(730),
    bs = koi.b,
    ss = koi.s,
    tags = K.deform.tags(ss);
  const scales = {
    r: [8, 9, 10, 11, 12],
    brush: brushes.fish,
    tex: (x, y, z, ny, t) => {
      const patch = Math.sin(x * 3.2 + z * 4) + 0.7 * Math.cos(y * 7 - x * 2.4);
      const ramp = patch > 0.35 ? [7, 8, 9, 10, 11] : [3, 4, 5, 6, 12],
        noise = Math.sin(x * 123.4 + y * 34.8 + z * 87.2) * 15332.1;
      return ramp[Math.max(0, Math.min(4, Math.floor((t + (noise - Math.floor(noise) - 0.5) * 0.32) * 5)))];
    }
  };
  const fin = {
    r: [8, 9, 10, 11, 12],
    tex: pigment([8, 9, 10, 11, 12], 0.4),
    brush: {
      style: 'bristle',
      direction: 'field',
      field: (x, y, z) => [x + 1.1, y * 0.6, z],
      length: 0.35,
      width: 0.065,
      grain: 0.42,
      seed: 3
    }
  };
  ss.ball([-0.25, 0, 0], [1.65, 0.67, 0.53], scales, { res: 0.073, tag: 'koi', objectId: 'body' });
  ss.ball([-1.5, 0.02, 0], [0.47, 0.44, 0.48], scales, { res: 0.064, tag: 'koi', objectId: 'head' });
  ss.ball([1.25, 0, 0], [0.75, 0.29, 0.29], scales, { res: 0.07, tag: 'koi', objectId: 'tail-root' });
  const axes = a => {
    const m = K.M.rot([0, 0, 1], a);
    return [
      [m[0], m[3], m[6]],
      [m[1], m[4], m[7]],
      [m[2], m[5], m[8]]
    ];
  };
  for (const sign of [-1, 1]) {
    ss.ball([1.94, sign * 0.32, 0], [0.61, 0.38, 0.065], fin, {
      res: 0.056,
      ax: axes(sign * 0.6),
      tag: 'koi',
      objectId: 'tail-fins'
    });
    ss.ball([-0.7, -0.15, sign * 0.66], [0.62, 0.07, 0.45], fin, { res: 0.055, tag: 'koi', objectId: 'pectoral-fins' });
  }
  ss.ball([0.2, 0.65, 0], [0.75, 0.32, 0.055], fin, { res: 0.06, tag: 'koi', objectId: 'dorsal-fin' });
  for (const sign of [-1, 1]) {
    ss.ball(
      [-1.61, 0.18, sign * 0.395],
      0.105,
      { r: [10, 11, 12], brush: false },
      { res: 0.035, tag: 'koi', objectId: 'eyes' }
    );
    ss.ball(
      [-1.64, 0.19, sign * 0.478],
      0.054,
      { r: [0, 1], brush: false },
      { res: 0.027, tag: 'koi', objectId: 'eyes' }
    );
    ss.tube(
      [
        [-1.8, -0.12, sign * 0.24],
        [-2.12, -0.2, sign * 0.4],
        [-2.28, -0.08, sign * 0.48]
      ],
      0.024,
      0.012,
      { r: [10, 11, 12], brush: false },
      { res: 0.05, tag: 'koi', objectId: 'whiskers' }
    );
  }
  // Distant pigment rings provide depth behind the swimmer.
  ss.torus(
    [0, 0, -1.2],
    2.9,
    0.048,
    { r: [3, 4, 5], brush: { style: 'ink', direction: 'contour', axis: [0, 0, 1], length: 0.3, width: 0.05 } },
    { res: 0.11, ax: ss.AZ, objectId: 'ring' }
  );
  ss.bake();
  const fish = finish(bs, { target: [0, 0, 0], dist: 11, yaw: 0.18, pitch: 0.28, ortho: true }),
    ids = tags.koi;
  const skin = K.deform.skin(fish, ids, { axis: [1, 0, 0], slices: 32 }),
    M = new Float32Array(skin.n * 12),
    map = K.deform.noodle({
      from: [-2.3, 0, 0],
      to: [2.6, 0, 0],
      points: [
        [-2.3, 0, 0],
        [-0.7, 0, 0],
        [0.9, 0, 0],
        [2.6, 0, 0]
      ],
      volume: false
    });
  const rig = K.bones.bind(fish, {
    ids,
    bid: skin.bid,
    bid2: skin.bid2,
    w2: skin.w2,
    M,
    pose(t) {
      map.set({
        points: [
          [-2.3, 0.06 * Math.sin(t), 0.04 * Math.sin(t)],
          [-0.7, 0.04 * Math.sin(t + 1), 0.08 * Math.sin(t * 1.4)],
          [0.9, 0.1 * Math.sin(t * 1.5), 0.24 * Math.sin(t * 1.5 + 1)],
          [2.6, 0.18 * Math.sin(t * 1.5 + 1), 0.55 * Math.sin(t * 1.5 + 2)]
        ]
      });
      skin.fill(M, 0, map);
    }
  });
  const worlds = { coast: landscape, koi: fish },
    controls = Object.fromEntries(
      Object.entries(worlds).map(([id, w]) => [id, K.cameraRig.control(() => ({ camera: w.cam }), { handoff: 0.35 })])
    );
  const originals = Object.fromEntries(Object.entries(worlds).map(([id, w]) => [id, w.splatFootprints]));
  const state = {
    view: 'coast',
    time: 0,
    paused: false,
    native: false,
    turntable: false,
    style: 'original',
    width: 1,
    length: 1
  };
  function paint() {
    for (const [id, w] of Object.entries(worlds)) {
      w.splatFootprints = originals[id];
      for (let slot = 1; slot <= w.splatFootprints.styles.length; slot++) {
        if (state.style !== 'original')
          K.splatFootprints.update(
            w,
            slot,
            K.surfaceBrush.profile({ style: state.style, seed: 31, variants: 4 }, (slot - 1) % 4)
          );
        K.splatFootprints.setTransform(w, slot, { stretch: [state.length, state.width] });
      }
    }
  }
  return {
    state,
    worlds,
    rig,
    originals,
    get world() {
      return worlds[state.view];
    },
    get control() {
      return controls[state.view];
    },
    paint,
    reset() {
      state.width = state.length = 1;
      state.style = 'original';
      state.native = false;
      state.turntable = false;
      paint();
      controls[state.view].release();
    },
    update(dt) {
      if (!state.paused) state.time += dt;
      rig.update(dt, state.time);
      if (state.turntable) this.control.input({ yaw: dt * 0.15 });
      this.control.update(dt, state.time);
    }
  };
}
if (typeof module !== 'undefined') module.exports = surfaceBrushDemo;
