module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'lock-bridge-crossing',
  name: 'Passing on the lock bridge',
  seed: 49,
  build(seed) {
    const B = makeBuilder(seed, [
      0x142630, 0x1e3843, 0x274b55, 0x38636b, 0x57817f, 0x75a19a,
      0x272836, 0x443d4a, 0x605559, 0x7d716c, 0x9c8b7a, 0xc2ac8c, 0xe1c6a0,
      0x133639, 0x1f514f, 0x368074, 0x5aaf95, 0x9ed0a4, 0xe3ebbf,
      0x4a2d36, 0x743b3b, 0xa05747, 0xcf7854, 0xf5a76e, 0xffdb91, 0xffefb8
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { wob: .002, amb: .36, sky: .18, sunK: .55, sun: K.V.norm([-.58, .76, .42]) });
    const ends = { r: [6, 7, 8, 9] }, iron = { r: [1, 2, 3, 4] };
    const gold = { r: [19, 20, 21, 22, 23, 24] };
    const box = (at, half, mat, detail = .07, radius = .045) => S.box(at, half, mat, { res: detail, rd: radius });
    const surface = SpriteSurface.make(256);
    surface.face([-8, -.26, 5.9], [16, 0, 0], [0, 0, -11.8], 244, 168, (x, y) => {
      const ripple = 4 * Math.sin(x * .095) + 2 * Math.sin(x * .34 + y * .2);
      if ((y + Math.floor(ripple)) % 16 === 0 && Math.sin(x * .14 + y * .58) > -.22) return 0x426e73;
      if (Math.sin(y * .49 + Math.sin(x * .071) * 2) > .55) return 0x2a515c;
      return Math.sin(y * .18 + x * .02) > -.35 ? 0x254951 : 0x21424d;
    });
    surface.face([-4.58, 0, 1.9], [9.16, 0, 0], [0, 0, -3.8], 220, 92, (x, y) => {
      if (x % 10 === 0) return 0x5b4b49;
      if (x % 10 === 1 || y === 1 || y === 90) return 0xc5a37c;
      const grain = Math.sin(y * .23 + Math.cos(x * .51)) > .89;
      if (grain && (x + y) % 7 < 4) return 0x926f5a;
      return Math.floor(x / 10) % 6 === 1 ? 0xa08269 : 0xb19273;
    });
    for (const z of [-1.93, 1.93]) {
      box([0, -.11, z], [4.6, .12, .10], ends, .14);
      for (const x of [-4.28, -2.15, 0, 2.15, 4.28]) {
        box([x, -.22, z], [.10, .24, .12], iron, .08);
        box([x, .03, z], [.09, .04, .105], gold, .054);
      }
    }
    for (const x of [-4.21, 4.21]) {
      for (const z of [-1.67, 1.67]) {
        box([x, .32, z], [.14, .38, .16], ends, .08);
        box([x, .688, z], [.17, .074, .17], iron, .059);
        S.ball([x, .774, z], [.091, .087, .085], { r: [23, 24, 25], em: true }, { res: .038 });
      }
    }
    S.bake();

    const movers = [];
    function runner(name, coat, trim, satchel, facing) {
      const first = B.count();
      const o = { res: .028, objectId: name };
      const ellipsoid = (at, size, material) => S.ball(at, size, material, o);
      const block = (at, half, material, rd = .044) => S.box(at, half, material, { ...o, rd });
      const sleeve = (points, a, b, material) => S.tube(points, a, b, material, o);
      const boot = { r: [0, 1, 2, 6, 7] };
      const brass = { r: [20, 21, 22, 23, 24] };
      const visor = { r: [0, 1, 2, 3, 5] };
      const gleam = { r: [17, 18], em: true };
      for (const side of [-1, 1]) {
        const x = side * .133;
        sleeve([[x, .63, 0], [x + .03 * side, .34, .006], [x, .10, .041]], .099, .071, boot);
        ellipsoid([x, .080, .080], [.101, .074, .132], boot);
      }
      block([0, .74, 0], [.245, .255, .144], coat, .100);
      block([-.075 * facing, .75, -.121], [.175, .193, .103], satchel, .065);
      block([0, .555, .096], [.231, .056, .081], trim);
      block([.042 * facing, .555, .179], [.061, .045, .025], brass, .018);
      for (const side of [-1, 1]) {
        sleeve([[side * .215, .900, -.012], [side * .292, .749, .020], [side * .278, .595, .069]], .078, .064, coat);
        ellipsoid([side * .285, .579, .075], [.058, .059, .064], trim);
      }
      ellipsoid([.026 * facing, 1.205, .008], [.223, .239, .172], coat);
      block([.046 * facing, 1.22, .139], [.152, .073, .053], visor, .035);
      block([.114 * facing, 1.236, .186], [.037, .027, .009], gleam, .012);
      block([.030 * facing, 1.370, .017], [.229, .062, .196], trim, .045);
      block([-.201 * facing, 1.247, -.036], [.041, .095, .082], trim, .026);
      S.bake();
      movers.push({ first, end: B.count(), facing });
    }
    runner('jade-runner', { r: [13, 14, 15, 16, 17] }, { r: [13, 14, 15, 16, 17] }, gold, 1);
    runner('copper-runner', { r: [19, 20, 21, 22, 23] }, gold, { r: [13, 14, 15, 16, 17] }, -1);

    const world = B.finish({
      cam: { target: [0, .58, 0], dist: 9.65, yaw: .105, pitch: .38, ortho: true, sway: 0 },
      radius: 9, dither: 0, spriteSurfaces: surface.finish(), look: { splatCoverage: 'continuous' }
    });
    const stage = K.stage(world);
    stage.stateful = false;
    stage.t0 = 0;
    stage.add({ pre(_dt, t) {
      const phase = Math.min(1, Math.max(0, t / 2.82));
      const progress = phase * .76 + .24 * phase * phase * (3 - 2 * phase);
      for (const { first, end, facing } of movers) {
        const dx = facing * (-3.29 + 6.58 * progress);
        const stride = Math.sin(t * 9.4 + (facing > 0 ? 0 : 1.25));
        for (let i = first; i < end; i++) {
          const q = i * 16, x = stage.base[q], y = stage.base[q + 1], z = stage.base[q + 2];
          const foot = Math.max(0, 1 - y / .66), swing = Math.sign(x) * stride;
          stage.D[q] = x + dx + facing * swing * .20 * foot;
          stage.D[q + 1] = y + Math.max(0, swing) * .11 * foot + .034 * stride * stride * (1 - foot);
          stage.D[q + 2] = z - facing * 1.39;
          stage.touch(i);
        }
      }
    } });
    return world;
  }
});
