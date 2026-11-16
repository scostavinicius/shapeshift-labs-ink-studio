// O Farol Flutuante: a lighthouse on a floating island at night. Its beam turns, a stream runs off the edge as a waterfall,
// smoke leaves the cottage chimney, fireflies drift, a flag flies, and two small rocks float alongside.
module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'farol',
  name: 'O Farol Flutuante',
  seed: 11,
  build(seed) {
    const V = K.V,
      M = K.M;
    const B = makeBuilder(seed, [
      0x06070f, // 0 night
      0x11131f, // 1 rock darkest
      0x22253a, // 2 rock dark
      0x3a3d56, // 3 rock
      0x5c5f78, // 4 rock light
      0x8d8fa0, // 5 stone pale
      0x16301f, // 6 grass dark
      0x26502c, // 7 grass
      0x3f7c36, // 8 grass light
      0x7fb24a, // 9 grass tip
      0x24160f, // 10 wood dark
      0x47291a, // 11 wood
      0x74482a, // 12 wood light
      0x4c1020, // 13 red dark
      0x8e2328, // 14 red
      0xc9433a, // 15 red light
      0xb7b2a6, // 16 white shade
      0xece4cc, // 17 white
      0xffd77a, // 18 lamp
      0xff9f45, // 19 lamp warm
      0xfff6d8, // 20 lamp core
      0x112a40, // 21 water deep
      0x1f5878, // 22 water
      0x4a9cbc, // 23 water light
      0xc6eef6, // 24 foam
      0x2b2140, // 25 roof dark
      0x47335f, // 26 roof
      0x6c4f86, // 27 roof light
      0x7a2f5c, // 28 blossom dark
      0xb85486, // 29 blossom
      0xe88bb0, // 30 blossom light
      0xffc9dc, // 31 blossom pale
      0xc8f070, // 32 firefly
      0x3a3448 // 33 smoke
    ]);
    const S = K.sculpt(makeSculpt(B)),
      rig = K.rig(B, S);
    S.sun = B.norm([-0.35, 0.75, 0.55]);
    S.res = 0.1;
    S.amb = 0.2;
    S.sky = 0.3;

    const TOP = 0.3,
      ROCK = { r: [1, 2, 2, 3, 4], mod: (x, y, z) => 0.25 * (B.n3(x * 0.8, y * 1.6, z * 0.8) - 0.5) },
      // one material for the whole island: grass where it faces up, layered rock on the sides and underneath
      LAND = {
        r: [6, 7, 7, 8, 9],
        blade: { h: 0.16, w: 0.04 },
        tex: (x, y, z, ny, t) => {
          if (ny > 0.45) return undefined;
          const band = Math.floor(y * 1.4 + 0.6 * B.n3(x * 0.4, 0, z * 0.4));
          return S.pick(band % 2 ? [2, 3, 3, 4] : [3, 4, 4, 5], t);
        }
      },
      STONE = { r: [2, 3, 4, 5] },
      WOOD = { r: [10, 11, 12] },
      ISL = S.grp(0.5);

    // ---- the island: a turned, ragged cone, with a mound where the lighthouse stands
    const radius = t => (0.35 + 5.6 * Math.pow(Math.min(t / 0.8, 1), 1.8)) * (1 + 0.05 * Math.sin(t * 23));
    S.lathe([0, TOP - 5.2, 0], 5.2, radius, LAND, Object.assign({ bump: [0.35, 0.9] }, ISL));
    S.ball([-2.2, TOP - 0.2, -1.4], [2.2, 0.75, 2.0], LAND, Object.assign({ bump: [0.12, 1.4] }, ISL));
    // rocks hanging under it
    for (const [x, y, z, r] of [
      [1.6, -2.4, 1.2, 0.9],
      [-1.4, -3.1, -0.6, 0.7],
      [0.4, -4.4, 0.3, 0.5],
      [2.8, -1.4, -1.6, 0.8]
    ])
      S.rock([x, y, z], r, ROCK, { res: 0.1 });

    // ---- a pond, and a stream from it to the edge
    const PX = 1.6,
      PZ = 2.3;
    const water = {
      r: [22],
      em: true,
      tex: (x, y, z) => {
        const v = B.fbm(x * 0.9 + 7, z * 0.9, 1.7, 2);
        if (Math.sin(z * 9 + 2 * Math.sin(x * 2.3)) > 0.97) return 24;
        return v > 0.58 ? 23 : v < 0.42 ? 21 : 22;
      }
    };
    S.lathe([PX, TOP - 0.1, PZ], 0.2, 1.35, water, { res: 0.07 });
    S.box([3.5, TOP + 0.02, PZ], [1.95, 0.12, 0.4], water, { res: 0.07 });
    // stones round the pond
    for (let k = 0; k < 9; k++) {
      const a = k * 0.7 + 0.4;
      if (Math.cos(a) > 0.8) continue;
      S.rock([PX + Math.cos(a) * 1.45, TOP + 0.02, PZ + Math.sin(a) * 1.45], 0.17 + 0.06 * (k % 3), STONE, { res: 0.06 });
    }

    // ---- the lighthouse
    const LX = -2.2,
      LZ = -1.4,
      LB = TOP + 0.5,
      TH = 4.4,
      BAND = { r: [13, 14, 15], tex: (x, y, z, ny, t) => (Math.floor((y - LB) / 0.75) % 2 ? S.pick([16, 17, 17], t) : undefined) };
    S.lathe([LX, LB - 0.35, LZ], 0.55, [1.15, 1.0], STONE, { res: 0.08 });
    S.lathe([LX, LB, LZ], TH, [0.85, 0.52], BAND, { res: 0.07 });
    const GY = LB + TH;
    S.lathe([LX, GY, LZ], 0.14, [0.85, 0.85], { r: [1, 2, 3] }, { res: 0.06 });
    S.torus([LX, GY + 0.42, LZ], 0.8, 0.035, { r: [1, 2, 3] }, { res: 0.04 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * B.TAU;
      S.tube(
        [
          [LX + Math.cos(a) * 0.8, GY + 0.12, LZ + Math.sin(a) * 0.8],
          [LX + Math.cos(a) * 0.8, GY + 0.42, LZ + Math.sin(a) * 0.8]
        ],
        0.025,
        0.025,
        { r: [1, 2] },
        { res: 0.03 }
      );
    }
    // the lamp room: dark frame posts round a glowing lamp, then the roof
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * B.TAU + 0.3;
      S.tube(
        [
          [LX + Math.cos(a) * 0.5, GY + 0.14, LZ + Math.sin(a) * 0.5],
          [LX + Math.cos(a) * 0.5, GY + 1.0, LZ + Math.sin(a) * 0.5]
        ],
        0.04,
        0.04,
        { r: [1, 2] },
        { res: 0.03 }
      );
    }
    const LAMP = [LX, GY + 0.58, LZ];
    S.ball(LAMP, 0.3, { r: [19, 18, 20], em: true }, { res: 0.05 });
    S.lathe([LX, GY + 1.0, LZ], 0.75, t => 0.68 * (1 - t) + 0.03, { r: [13, 14, 15] }, { res: 0.06 });
    S.ball([LX, GY + 1.82, LZ], 0.1, { r: [18, 20], em: true }, { res: 0.04 });
    // a door and two small windows on the tower
    S.box([LX + 0.55, LB + 0.45, LZ + 0.62], [0.24, 0.42, 0.06], WOOD, { res: 0.05, ax: rotY(0.72) });
    for (const h of [1.8, 3.2]) S.ball([LX + 0.5, LB + h, LZ + 0.5], [0.1, 0.16, 0.1], { r: [19, 18], em: true }, { res: 0.04 });
    S.lights.push({ p: LAMP, r: 6, s: 0.9 }, { p: [LX + 0.9, LB + 0.6, LZ + 0.9], r: 2.2, s: 0.4 });

    // ---- the cottage, with a stepped roof and a chimney
    const CX = 0.9,
      CZ = -2.9,
      CY = TOP + 0.05;
    S.box([CX, CY + 0.6, CZ], [1.1, 0.6, 0.8], { r: [16, 17], mod: plank }, { res: 0.07 });
    for (let k = 0; k < 5; k++)
      S.box([CX, CY + 1.28 + k * 0.17, CZ], [1.3 - k * 0.04, 0.09, 0.95 - k * 0.19], { r: [25, 26, 27] }, { res: 0.06 });
    S.box([CX + 0.75, CY + 1.9, CZ - 0.2], [0.14, 0.4, 0.14], STONE, { res: 0.05 });
    S.box([CX - 0.25, CY + 0.42, CZ + 0.81], [0.22, 0.4, 0.04], WOOD, { res: 0.04 });
    for (const dx of [0.45, -0.75]) S.box([CX + dx + 0.1, CY + 0.72, CZ + 0.81], [0.14, 0.14, 0.03], { r: [19, 18, 20], em: true }, { res: 0.035 });
    S.lights.push({ p: [CX, CY + 0.7, CZ + 1.3], r: 2.4, s: 0.5 });

    // ---- a blossom tree on the far side of the pond, and bushes
    S.tree(3.7, TOP - 0.05, -2.4, {
      h: 2.6,
      r: 0.14,
      lean: [0.1, -0.05],
      nb: 4,
      spread: 1.3,
      cr: 0.65,
      cl: 3,
      bark: WOOD,
      leaf: { r: [28, 29, 30, 31], leaf: {} },
      roots: 0,
      lres: 0.1
    });
    for (const [x, z, r] of [
      [-0.6, 2.6, 0.45],
      [-3.8, 1.2, 0.5],
      [0.2, -0.4, 0.32],
      [-4.4, -2.4, 0.4]
    ])
      S.rock([x, TOP + r * 0.35, z], r, { r: [6, 7, 8, 9], leaf: {} }, { res: 0.09 });
    // a little keeper in a hood with a lantern, at the foot of the path
    S.fig(-0.8, TOP, 0.9, 0.9, { r: [25, 26, 27] }, { hood: true, face: 0.6 });
    S.ball([-0.55, TOP + 0.38, 1.12], 0.07, { r: [19, 18, 20], em: true }, { res: 0.02 });
    S.lights.push({ p: [-0.55, TOP + 0.5, 1.12], r: 1.3, s: 0.45 });
    // a path of stepping stones from the keeper to the lighthouse door
    for (let k = 0; k < 5; k++) {
      const u = k / 4;
      S.ball(
        [-0.8 + (LX + 0.7 + 0.8) * u, TOP + 0.02 + 0.45 * u * u, 0.6 + (LZ + 0.9 - 0.6) * u],
        [0.22, 0.05, 0.18],
        STONE,
        { res: 0.05 }
      );
    }

    // ---- two small floating rocks, each a part of the rig so they can bob
    const SMALL = [
      [-5.2, 1.4, 2.6, 0.75],
      [5.0, 2.6, -2.8, 0.55]
    ];
    SMALL.forEach(([x, y, z, r], k) => {
      S.lathe([x, y - r * 1.8, z], r * 1.8, t => 0.12 + r * Math.pow(t, 1.6), LAND, {
        res: 0.08,
        tag: 'float' + k,
        bump: [0.1, 2]
      });
    });
    S.bake();

    // ---- what moves: the beam, emitted into its own part, plus pools for water, smoke and fireflies
    rig.own('beam', () => {
      for (const s of [1, -1]) {
        K.shafts(B, { from: LAMP, dir: [s, -0.05, 0], len: 8, r: 0.32, n: 26, col: 18, a: 0.7 });
        K.shafts(B, { from: LAMP, dir: [s, -0.05, 0], len: 5, r: 0.12, n: 18, col: 20, a: 1.2 });
      }
    });
    const flies = K.flock(B, { kind: 'fly', n: 26, home: { c: [0, 1.4, 0], r: 4.6, h: 1.6 }, sdf: S.sdf, cols: [32, 32, 18], seed: 5 });
    K.weather.fall(B, { kind: 'leaf', box: [2.0, 5.4, -4.0, -0.6], top: 3.2, n: 40, cols: [29, 30, 31], ground: () => TOP, wind: [0.3, 0.2] });
    // stars far behind
    for (let i = 0; i < 160; i++) {
      const a = B.rr(0, B.TAU),
        e = B.rr(-0.4, 1.1),
        d = 34;
      B.iso(Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d, Math.sin(a) * Math.cos(e) * d, B.rr(0.05, 0.11), B.P[B.pick([17, 18, 24, 5])], 2.5, {
        em: true,
        nd: true,
        k: 6,
        ph: B.rr(0, 6),
        sp: B.rr(1, 3),
        rg: 0
      });
    }
    const pool = K.pool(B, 900);
    const flag = K.cloth(B, {
      at: [CX - 0.9, CY + 2.7, CZ + 0.2],
      u: [0.9, 0, 0.1],
      v: [0, -0.5, 0],
      nu: 9,
      nv: 5,
      pins: (i, j) => i === 0,
      wind: K.xpbd.gust([2.2, 0, 1]),
      pattern: (u, v) => (v < 0.34 ? [13, 14, 15] : v < 0.67 ? [16, 17, 17] : [13, 14, 15]),
      sdf: S.sdf
    });
    // its pole
    S.tube(
      [
        [CX - 0.9, CY + 1.2, CZ + 0.2],
        [CX - 0.9, CY + 2.8, CZ + 0.2]
      ],
      0.03,
      0.025,
      WOOD,
      { res: 0.03 }
    );
    S.bake();

    const W = B.finish({
      cam: { target: [0, 0, 0], dist: 25, pitch: 0.24, yaw: 0.55, sway: 0.2 },
      detail: 12,
      palName: 'Farol',
      dither: 0.25,
      radius: 13
    });
    const st = K.stage(W);
    rig.bind(st);
    const ps = K.particles(st, pool, { flow: K.flow.sum(K.flow.wind([0.4, 0.6, 0.2]), K.flow.curl(0.6, 0.5)) });
    st.add(flag);
    st.add(flies);
    st.add(ps);
    const EDGE = [5.45, TOP + 0.06, PZ],
      CHIM = [CX + 0.75, CY + 2.35, CZ - 0.2];
    let smokeAt = 0;
    st.add({
      update(dt, t) {
        // the beam turns about the lamp
        rig.set('beam', M.rot([0, 1, 0], t * 0.9), LAMP, LAMP);
        SMALL.forEach(([x, y, z], k) => {
          const bob = 0.18 * Math.sin(t * 0.9 + k * 2.1);
          rig.set('float' + k, M.rot([0, 1, 0], 0.05 * Math.sin(t * 0.5 + k)), [x, y, z], [x, y + bob, z]);
        });
        rig.apply();
        // the waterfall: a sheet of drops leaving the stream's lip, foam where they start
        const n = Math.ceil(dt * 260);
        for (let i = 0; i < n; i++) {
          const w = B.rr(-0.32, 0.32);
          ps.emit({
            p: [EDGE[0] + B.rr(-0.05, 0.05), EDGE[1], EDGE[2] + w],
            v: [B.rr(0.9, 1.4), B.rr(-0.2, 0.1), w * 0.15],
            life: B.rr(0.9, 1.3),
            size: B.rr(0.05, 0.08),
            cols: B.R() < 0.25 ? [24, 23, 23] : [23, 22, 22],
            grav: 6,
            streak: 0.12,
            fade: 0.4
          });
        }
        if (t > smokeAt) {
          smokeAt = t + 0.12;
          ps.emit({
            p: [CHIM[0] + B.rr(-0.05, 0.05), CHIM[1], CHIM[2] + B.rr(-0.05, 0.05)],
            v: [0.15, 0.55, 0.05],
            life: 2.4,
            size: B.rr(0.07, 0.11),
            grow: 0.5,
            cols: [5, 4, 3, 2],
            ride: 0.4,
            fade: 0.6
          });
        }
      }
    });
    return W;

    function rotY(a) {
      const c = Math.cos(a),
        s = Math.sin(a);
      return [
        [c, 0, -s],
        [0, 1, 0],
        [s, 0, c]
      ];
    }
    function plank(x, y) {
      return (y * 6) % 1 < 0.14 ? -0.25 : 0;
    }
  }
});
