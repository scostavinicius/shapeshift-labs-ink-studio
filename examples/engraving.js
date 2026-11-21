/* The Copperplate Cabinet: native SDF objects, nested tonal maps and animated plates. */
function engravingDemo({ KIT: K, makeBuilder, makeSculpt }) {
  const colors = [
    0x0c1729, 0x15263b, 0x2b4358, 0x46616a, 0x71868a, 0xaab4a6, 0xd2cab0, 0xf0dbb2, 0xffedcb, 0x75452d, 0xa8663c,
    0xd09352, 0xf2bb70
  ];
  const ink = '#15263b',
    paper = '#f0dbb2';
  function setup(seed) {
    const B = makeBuilder(seed, colors),
      S = K.sculpt(makeSculpt(B));
    Object.assign(S, {
      pixel: false,
      sun: K.V.norm([-0.45, 0.8, 0.55]),
      amb: 0.3,
      sky: 0.18,
      sunK: 0.85,
      fat: 0.34,
      aoK: 0.25
    });
    return { B, S };
  }
  const print = (style, scale, options = {}) => ({
    style,
    scale,
    ink,
    paper,
    tone: 'hybrid',
    strokeWidth: 1.25,
    seed: 51,
    ...options
  });
  const m = setup(31),
    B = m.B,
    S = m.S,
    tags = K.deform.tags(S);
  const wing = { r: [3, 4, 5, 6, 7, 8], engraving: print('engraving', 0.46, { projection: 'plane', tone: 'normal' }) },
    body = { r: [2, 3, 4, 5, 6, 7], engraving: print('woodcut', 0.35, { projection: 'cylinder', across: [0, 1, 0] }) },
    gold = { r: [9, 10, 11, 12], engraving: false },
    dark = { r: [0, 1, 2], engraving: false };
  const axes = angle => {
    const M = K.M.rot([0, 0, 1], angle);
    return [
      [M[0], M[3], M[6]],
      [M[1], M[4], M[7]],
      [M[2], M[5], M[8]]
    ];
  };
  for (const sign of [-1, 1]) {
    const tag = sign < 0 ? 'left' : 'right';
    S.ball([sign * 1.3, 0.65, -0.02], [1.25, 0.86, 0.13], wing, {
      ax: axes(sign * 0.35),
      res: 0.065,
      tag,
      objectId: 'forewings'
    });
    S.ball(
      [sign * 0.97, -0.72, -0.06],
      [0.97, 0.76, 0.12],
      { ...wing, engraving: print('hatching', 0.38, { projection: 'plane' }) },
      { ax: axes(-sign * 0.28), res: 0.065, tag, objectId: 'hindwings' }
    );
    // Raised bronze borders, eye spots, and branching veins give the print real relief.
    for (const [x, y, r] of [
      [1.54, 0.72, 0.37],
      [1.05, -0.8, 0.25]
    ]) {
      S.torus([sign * x, y, 0.115], r, 0.045, gold, { ax: S.AZ, res: 0.05, tag, objectId: 'ocelli' });
      S.ball([sign * x, y, 0.123], [r * 0.77, r * 0.77, 0.06], dark, { res: 0.05, tag, objectId: 'ocelli' });
      S.ball([sign * (x - 0.05), y + 0.06, 0.18], [r * 0.29, r * 0.29, 0.035], gold, {
        res: 0.035,
        tag,
        objectId: 'ocelli'
      });
    }
    for (let j = 0; j < 7; j++) {
      const a = -1.2 + j * 0.36,
        r = 1.05;
      S.tube(
        [
          [sign * 0.2, 0.12, 0.12],
          [sign * (0.55 + 0.13 * j), 0.16 + j * 0.1, 0.15],
          [sign * (1.15 + r * 0.74 * Math.cos(a)), 0.63 + r * 0.65 * Math.sin(a), 0.085]
        ],
        0.017,
        0.009,
        gold,
        { res: 0.028, tag, objectId: 'veins' }
      );
    }
    for (let j = 0; j < 3; j++)
      S.tube(
        [
          [sign * 0.13, 0.3 - j * 0.25, 0.2],
          [sign * 0.4, 0.1 - j * 0.3, 0.21],
          [sign * (0.65 + j * 0.07), -0.23 - j * 0.27, 0.22]
        ],
        0.023,
        0.012,
        gold,
        { res: 0.04, tag: 'body', objectId: 'legs' }
      );
    const ant = [];
    for (let j = 0; j < 16; j++) {
      const t = j / 15;
      ant.push([sign * (0.1 + 0.62 * t), 0.84 + 0.9 * t, 0.23 - 0.05 * t]);
    }
    S.tube(ant, 0.025, 0.008, gold, { res: 0.025, tag: 'body', objectId: 'antennae' });
    for (let j = 1; j < 13; j++) {
      const t = j / 15,
        x = sign * (0.1 + 0.62 * t),
        y = 0.84 + 0.9 * t;
      for (const side of [-1, 1])
        S.tube(
          [
            [x, y, 0.23],
            [x + sign * (0.1 + 0.08 * (1 - t)) * side, y + 0.08, 0.22]
          ],
          0.012,
          0.004,
          gold,
          { res: 0.025, tag: 'body', objectId: 'antennae' }
        );
    }
  }
  for (let i = 0; i < 8; i++)
    S.ball([0, 0.65 - i * 0.21, 0.12], [0.18 * (1 - i * 0.045), 0.19, 0.18], body, {
      res: 0.05,
      tag: 'body',
      objectId: 'abdomen'
    });
  S.ball([0, 0.73, 0.15], [0.25, 0.28, 0.22], body, { res: 0.045, tag: 'body', objectId: 'thorax' });
  for (const sign of [-1, 1])
    S.ball([sign * 0.17, 0.88, 0.28], 0.07, gold, { res: 0.025, tag: 'body', objectId: 'eyes' });
  S.bake();
  const moth = B.finish({
    cam: { target: [0, 0.1, 0], dist: 8.4, yaw: 0.05, pitch: 0.13, ortho: true },
    radius: 15,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 },
    look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
  });
  const ids = tags.of('left', 'right', 'body'),
    M = new Float32Array(36),
    owner = new Set(tags.left),
    right = new Set(tags.right),
    bid = Float32Array.from(ids, i => (owner.has(i) ? 1 : right.has(i) ? 2 : 0));
  const rig = K.bones.bind(moth, {
    ids,
    bid,
    M,
    pose(t) {
      for (let bone = 0; bone < 3; bone++) {
        const sign = bone === 1 ? -1 : 1,
          a = bone ? sign * (0.2 + 0.32 * Math.sin(t * 1.1)) : 0.025 * Math.sin(t * 0.7),
          R = K.M.rot([0, 1, 0], a),
          pivot = [sign * 0.12, 0.2, 0],
          at = K.M.app(R, pivot);
        M.set([...R, pivot[0] - at[0], 0.06 * Math.sin(t * 0.8) + pivot[1] - at[1], pivot[2] - at[2]], bone * 12);
      }
    }
  });
  // A floating conservatory: stepped cliffs, a domed pavilion, water and etched trees.
  const c = setup(87),
    Q = c.S,
    stone = { r: [2, 3, 4, 5, 6, 7, 8], engraving: print('engraving', 0.62, { projection: 'triplanar' }) },
    copper = {
      r: [9, 10, 11, 12],
      engraving: print('hatching', 0.55, { ink: '#75452d', paper: '#f2bb70', projection: 'triplanar' })
    },
    shadow = { r: [0, 1, 2], engraving: false },
    tree = { r: [2, 3, 4, 5, 6], engraving: print('woodcut', 0.48, { projection: 'triplanar' }) };
  Q.box([0, -0.47, 0], [4.4, 0.4, 2.9], stone, { rd: 0.28, res: 0.19, objectId: 'plinth' });
  Q.box([0, 0.01, -0.72], [4.1, 0.13, 1.95], stone, { rd: 0.12, res: 0.16, objectId: 'terrace' });
  Q.box(
    [0, -0.02, 1.6],
    [3.95, 0.04, 1],
    {
      r: [1, 2, 3, 4],
      engraving: print('hatching', 0.8, { projection: 'plane', across: [0, 0, 1], tone: 'normal', ambient: 0.7 })
    },
    { res: 0.13, objectId: 'water' }
  );
  for (let j = 0; j < 6; j++)
    Q.box([-0.2, 0.08 + j * 0.12, 0.45 - j * 0.19], [0.65, 0.07, 0.11], copper, { res: 0.09, objectId: 'stairs' });
  for (const x of [-1.55, 1.55]) {
    Q.box([x, 1.02, -0.7], [0.12, 0.95, 0.13], copper, { res: 0.09, objectId: 'columns' });
    Q.box([x, 1.97, -0.7], [0.26, 0.08, 0.27], copper, { res: 0.08, objectId: 'capitals' });
  }
  Q.box([0, 1.99, -0.7], [1.82, 0.1, 1.01], stone, { res: 0.12, rd: 0.05, objectId: 'entablature' });
  Q.ball([0, 2.03, -0.7], [1.82, 1.42, 1.01], stone, { res: 0.105, objectId: 'dome' });
  // Paired dark apertures and fine pilasters give the façade a crisp rhythm.
  for (let i = 0; i < 7; i++) {
    const x = -1.35 + i * 0.45;
    Q.box([x, 1.12, 0.26], [0.14, 0.59, 0.055], shadow, { res: 0.09, objectId: 'windows' });
    Q.ball([x, 1.72, 0.26], [0.14, 0.17, 0.055], shadow, { res: 0.065, objectId: 'arches' });
    Q.tube(
      [
        [x - 0.2, 0.22, 0.34],
        [x - 0.2, 1.94, 0.34]
      ],
      0.024,
      0.024,
      copper,
      { res: 0.08, objectId: 'pilasters' }
    );
  }
  Q.torus([0, 3.45, -0.7], 0.23, 0.045, copper, { res: 0.05, objectId: 'finial' });
  for (const sign of [-1, 1])
    for (let j = 0; j < 4; j++) {
      const x = sign * (2.35 + (j % 2) * 0.7),
        z = -1.8 + j * 0.8,
        h = 0.9 + (j % 3) * 0.28;
      Q.tube(
        [
          [x, 0.14, z],
          [x, h * 0.75, z]
        ],
        0.055,
        0.02,
        copper,
        { res: 0.1, objectId: 'trunks' }
      );
      for (let level = 0; level < 4; level++)
        Q.ball([x, 0.35 + h * level * 0.22, z], [0.28 - level * 0.045, h * 0.31, 0.26 - level * 0.04], tree, {
          res: 0.1,
          objectId: 'cypress'
        });
    }
  for (let i = 0; i < 13; i++)
    Q.ball([-3.9 + i * 0.65, -0.45 + 0.11 * Math.sin(i), 2.5], [0.34, 0.3, 0.28], stone, {
      res: 0.13,
      objectId: 'shore-rocks'
    });
  Q.bake();
  const city = c.B.finish({
    cam: { target: [0, 1.13, -0.2], dist: 14.8, yaw: 0.34, pitch: 0.38, ortho: true },
    radius: 20,
    dither: 0,
    fog: { c: 0, start: 1, max: 0 },
    look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' }
  });
  const worlds = { moth, city },
    originals = Object.fromEntries(Object.entries(worlds).map(([id, w]) => [id, w.engraving])),
    controls = Object.fromEntries(
      Object.entries(worlds).map(([id, w]) => [id, K.cameraRig.control(() => ({ camera: w.cam }), { handoff: 0.35 })])
    );
  const state = {
    view: 'moth',
    time: 0,
    paused: false,
    native: false,
    turntable: false,
    movingLight: true,
    style: 'original',
    density: 1,
    scale: 1,
    ink: null,
    paper: null
  };
  function edit() {
    for (const [id, w] of Object.entries(worlds)) {
      w.engraving = originals[id];
      for (let slot = 1; slot <= w.engraving.styles.length; slot++) {
        const old = originals[id].styles[slot - 1];
        K.engraving.update(w, slot, {
          ...old,
          ...(state.style !== 'original' && { style: state.style }),
          density: old.density * state.density,
          scale: old.scale * state.scale,
          ...(state.ink && { ink: state.ink }),
          ...(state.paper && { paper: state.paper })
        });
      }
    }
  }
  return {
    state,
    worlds,
    originals,
    rig,
    edit,
    get world() {
      return worlds[state.view];
    },
    get control() {
      return controls[state.view];
    },
    get light() {
      const t = state.movingLight ? state.time * 0.25 : 0;
      return K.V.norm([-0.8 * Math.cos(t), 0.5, 0.4 + 0.35 * Math.sin(t)]);
    },
    reset() {
      state.style = 'original';
      state.density = state.scale = 1;
      state.ink = state.paper = null;
      state.native = state.turntable = false;
      edit();
      this.control.release();
    },
    update(dt) {
      if (!state.paused) state.time += dt;
      rig.update(dt, state.time);
      if (state.turntable) this.control.input({ yaw: dt * 0.12 });
      this.control.update(dt, state.time);
    }
  };
}
if (typeof module !== 'undefined') module.exports = engravingDemo;
