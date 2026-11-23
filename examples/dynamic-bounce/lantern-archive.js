module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'lantern-archive',
  name: 'Lantern archive',
  seed: 68,
  build(seed) {
    const B = makeBuilder(seed, [
      0x14202b, 0x243442, 0x374b57, 0x4d6267, 0x687b79, 0x839186, 0xa2aa91, 0xc7c6a7,
      0x392a35, 0x623844, 0x935043, 0xc76b53, 0xeb9870, 0xffbf80, 0xffdfa2, 0xffefc1,
      0x153840, 0x235c61, 0x367f78, 0x63b7a3, 0x9cdec4, 0xd4f5ca, 0x8ab6c6, 0x537b9a, 0x525473, 0x846887
    ]);
    const S = K.sculpt(makeSculpt(B)), rig = K.rig(B, S);
    Object.assign(S, { captureAlbedo: true, wob: .006, amb: .32, sky: .13, sunK: .35,
      sun: K.V.norm([-.64, .65, .36]) });
    const charcoal = { r: [0, 1, 2, 3], albedo: '#63717a' };
    const slate = { r: [1, 2, 3, 4], albedo: '#6d8185' };
    const plaster = { r: [2, 3, 4, 5, 6, 7], albedo: '#c4c5aa' };
    const lining = { r: [1, 2, 3, 4, 5], albedo: '#ccc6ae' };
    const iron = { r: [1, 2, 8, 9] }, brass = { r: [8, 9, 10, 12, 13, 14] };
    const red = { r: [9, 10, 11, 12], albedo: '#d26047' };
    const jade = { r: [16, 17, 18, 19] };
    const options = (objectId, res, tag) => ({ objectId, res, ...(tag && { tag }) });
    const box = (at, half, mat, id, res = .09, rd = .055, tag) =>
      S.box(at, half, mat, { ...options(id, res, tag), rd });
    const ball = (at, size, mat, id, res = .052) => S.ball(at, size, mat, options(id, res));
    const tube = (path, a, b, mat, id, res = .057) => S.tube(path, a, b, mat, options(id, res));

    box([0, -.25, .12], [4.14, .22, 2.3], charcoal, 'foundation', .24, .13);
    box([0, -.052, .45], [4.03, .054, 1.74], plaster, 'plaster', .174, .026);
    box([0, 1.04, -.90], [4.10, 1.05, .115], charcoal, 'back-wall', .195);
    for (const x of [-3.15, -.86, 1.42, 3.70])
      box([x, 1.09, -.69], [.081, 1.10, .111], slate, 'frame', .083, .043);
    for (const x of [-2.04, .18, 2.45]) {
      box([x, 1.00, -.735], [.985, .88, .081], lining, 'reflector', .134, .076);
      for (const y of [.27, 1.59]) box([x, y, -.65], [.90, .029, .033], slate, 'frame', .077, .019);
      for (const side of [-1, 1]) {
        box([x + side * .95, .69, -.597], [.019, .39, .023], slate, 'frame', .058, .014);
        ball([x + side * .89, 1.73, -.617], .041, brass, 'frame', .038);
      }
    }
    for (const [i, x] of [-1.97, .15, 2.31].entries()) {
      box([x, .109, -.10], [.59, .105, .48], slate, 'base', .076, .055);
      box([x, .246, -.10], [.49, .072, .386], plaster, 'plaster', .062, .052);
      S.lathe([x, .315, -.07], i === 1 ? .49 : .40, [.29, .17, .23], plaster, options('plaster', .058));
      ball([x, i === 1 ? .90 : .782, -.07], [.195, .216, .172], plaster, 'plaster', .051);
    }
    box([0, 2.095, -.64], [4.02, .103, .286], slate, 'frame', .112);
    for (let i = 0; i < 17; i++)
      box([-3.65 + i * .46, .025, 1.36], [.161, .020, .038], slate, 'mark', .068, .02);
    S.bake();

    const hinge = [-3.07, 1.09, -.51];
    box([-2.58, 1.09, -.51], [.48, .70, .049], iron, 'painted-shutter', .059, .025, 'shutter');
    box([-2.58, 1.09, -.452], [.436, .631, .025], red, 'painted-shutter', .047, .029, 'shutter');
    box([-2.58, 1.07, -.566], [.436, .631, .025], jade, 'painted-shutter', .047, .029, 'shutter');
    for (const y of [.65, 1.48])
      box([-2.55, y, -.416], [.361, .032, .020], brass, 'painted-shutter', .045, .023, 'shutter');
    S.bake();

    const lanternStart = B.count();
    const amber = { r: [12, 13, 14, 15], em: true }, caseOpts = options('lantern', .035);
    S.lathe([0, -.20, 0], .055, [.166, .147], brass, caseOpts);
    S.lathe([0, -.145, 0], .273, [.124, .108], amber, caseOpts);
    S.lathe([0, .128, 0], .057, [.160, .12], brass, caseOpts);
    tube([[-.126, .16, 0], [-.07, .269, 0], [.064, .269, 0], [.128, .16, 0]], .021, .019, brass, 'lantern', .027);
    for (const [x, z] of [[-.115, .066], [.115, .066], [0, -.120]])
      tube([[x, -.17, z], [x, .154, z]], .017, .017, iron, 'lantern', .026);
    S.bake();
    const lanternEnd = B.count();

    const mothStart = B.count();
    const glow = { r: [18, 19, 20], em: true }, eye = { r: [20, 21], em: true };
    ball([0, 0, 0], [.086, .146, .071], eye, 'moth', .026);
    for (const side of [-1, 1]) {
      ball([side * .108, .014, -.02], [.138, .118, .054], glow, 'moth', .034);
      ball([side * .08, -.088, .016], [.085, .082, .054], glow, 'moth', .035);
      ball([side * .102, .037, .029], .040, eye, 'moth', .023);
      tube([[side * .03, .103, 0], [side * .08, .171, .03], [side * .141, .197, .063]], .012, .009, glow, 'moth', .024);
    }
    S.bake();
    const mothEnd = B.count();
    const phase = t => Math.PI * 2 * t / 3;
    const lantern = t => [.50 + 1.18 * Math.sin(phase(t)), 1.16 + .18 * Math.cos(phase(t) * 2), .63];
    const moth = t => [2.21 + .50 * Math.cos(phase(t) + .27), 1.10 + .27 * Math.sin(phase(t) * 2), .36 + .18 * Math.sin(phase(t))];
    const world = B.finish({
      cam: { target: [.10, .94, 0], dist: 7.7, yaw: .085, pitch: .24, ortho: true, sway: 0 },
      radius: 9, dither: 0, look: { splatCoverage: 'continuous' },
      areaLights: [{ id: 'walking-lantern', at: lantern, normal: [0, -.33, -.944],
        shape: 'disk', size: [.24, .24], color: '#ffae56', intensity: 15, radius: 2.32, sampleGrid: 1,
        shadows: false, visible: false }],
      bounceProbes: {
        samples: 144, reach: 2.25, bounceStrength: 3.05, skyStrength: 0,
        cast: { include: [{ object: 'painted-shutter' }, { object: 'reflector' }] },
        receive: { include: [{ object: 'plaster' }] },
        dynamic: { reflect: [{ object: 'painted-shutter' }],
          emit: [{ select: { object: 'moth' }, gain: 12 }], lights: ['walking-lantern'] },
        probes: [
          { id: 'west-alcove', at: [-2.01, .84, .06], radius: 1.6 },
          { id: 'central-table', at: [.15, .82, .21], radius: 1.45 },
          { id: 'east-alcove', at: [2.16, .84, .04], radius: 1.45 },
          { id: 'far-store', at: [7.7, .83, .1], radius: 1.45 }
        ]
      }
    });
    const stage = K.stage(world);
    stage.stateful = false;
    stage.t0 = 0;
    rig.bind(stage);
    function move(first, end, target, flutter = 0) {
      const [x, y, z] = target;
      for (let i = first; i < end; i++) {
        const q = i * 16, horizontal = stage.base[q];
        stage.D[q] = x + horizontal * (1 - flutter);
        stage.D[q + 1] = y + stage.base[q + 1];
        stage.D[q + 2] = z + stage.base[q + 2] + Math.abs(horizontal) * flutter;
        stage.touch(i);
      }
    }
    stage.add({ pre(_dt, t) {
      rig.set('shutter', K.M.rot([0, 1, 0], -1.0 + .86 * Math.cos(phase(t))), hinge, hinge);
      rig.apply();
      move(lanternStart, lanternEnd, lantern(t));
      move(mothStart, mothEnd, moth(t), .35 + .32 * Math.sin(phase(t) * 6));
    } });
    return world;
  }
});
