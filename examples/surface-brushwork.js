module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'surface-brushwork',
  name: 'Grain, river, fold',
  seed: 407,
  build(seed) {
    const B = makeBuilder(seed, [
      0x151a27, 0x242c3a, 0x343f4d, 0x505b61, 0x788383, 0xabb3a7,
      0x33212a, 0x65372f, 0x965335, 0xc7814e, 0xe6b178,
      0x213842, 0x34515b, 0x587577, 0x90a49b, 0xc6c9ac,
      0x32223e, 0x543346, 0x824658, 0xbb666c, 0xe3a09b,
      0x7a6647, 0xb8975b, 0xe8cb88, 0xe9e5d1
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun: K.V.norm([-.58, .64, .53]), amb: .27, sky: .18, sunK: .61, wob: 0 });
    const paint = (r, ink, paper, origin, scale, settings) => ({
      r, engraving: { brushwork: { groupScale: 3.2, groupContrast: .35, ...settings }, origin,
        ink, paper, scale, seed: seed + r[0], strength: .84, tone: 'hybrid' }
    });
    const floor = { r: [1, 2, 3, 4] }, support = { r: [0, 1, 2, 3] }, trim = { r: [8, 21, 22, 23] };
    const wood = paint([6, 7, 8, 9, 10], '#4b2828', '#e8a56b', [-2.3, .1, 0], .104, { width: .2 });
    const stone = paint([11, 12, 13, 14, 15], '#2b4853', '#c1c6a9', [0, .1, 0], .126, { width: .31 });
    const cloth = paint([16, 17, 18, 19, 20], '#512b49', '#eea19a', [2.3, .1, 0], .096, { width: .25 });
    const box = (at, half, mat, objectId, res = .066, rd = .04) => S.box(at, half, mat, { objectId, res, rd });
    box([0, -.38, .2], [8, .3, 5], floor, 'floor', .18, .045);
    for (const x of [-2.3, 0, 2.3]) {
      box([x, -.01, 0], [.97, .14, .77], support, 'pedestals', .079, .096);
      box([x, .13, 0], [.89, .055, .68], floor, 'pedestals', .078, .059);
      box([x, -.018, .779], [.26, .037, .013], trim, 'labels', .044, .012);
    }
    S.bake();

    S.lathe([-2.3, .18, 0], 2.28, t =>
      .34 + .14 * Math.sin(Math.PI * t) + .08 * Math.cos(5.5 * Math.PI * t) +
      .054 * Math.cos(19 * Math.PI * t),
    wood, { objectId: 'timber', res: .035, maxRadius: .63 });
    for (const y of [.27, 2.30])
      S.torus([-2.3, y, 0], .43, .045, wood, { objectId: 'timber', res: .03 });
    const woodDark = { r: [6, 7, 8] };
    for (const x of [-2.51, -2.3, -2.09]) {
      S.tube([[x, .44, .507], [x - .058, .69, .49], [x + .073, .94, .428],
        [x + .065, 1.12, .50], [x, 1.30, .52]], .016, .016, woodDark, { objectId: 'inlay', res: .034 });
    }
    S.bake();

    const axis = K.M.rot([0,0,1], -.28);
    const ax = [[axis[0],axis[3],axis[6]], [axis[1],axis[4],axis[7]], [axis[2],axis[5],axis[8]]];
    S.ball([.055, 1.24, .015], [.77, .62, .6], stone, { objectId: 'river-stone', res: .037, ax, bump: [.027, 5] });
    S.ball([-.1, .695, .05], [.59, .32, .55], { ...stone, r: [11,12,13] }, { objectId: 'river-stone', res: .045 });
    S.ball([.1, .386, .1], [.77, .23, .62], stone, { objectId: 'river-stone', res: .047, bump: [.02, 5] });
    S.bake();

    const halfWidth = .73, halfHeight = .87, thickness = .045;
    const fold = (x, y) => .117 * Math.sin(13 * x + y * 2.8) + .046 * Math.sin(7 * x - 2 * y) + .17 * y * y;
    const center = [2.3, 1.34, .13];
    S.solid(center, 1.31, (x, y, z) => {
      const q = [Math.abs(x) - halfWidth, Math.abs(y) - halfHeight, Math.abs(z - fold(x,y)) - thickness];
      return .45 * (Math.hypot(...q.map(n => Math.max(0,n))) + Math.min(0, Math.max(...q)));
    }, (res, emit) => {
      const cols = Math.ceil(2 * halfWidth / res), rows = Math.ceil(2 * halfHeight / res);
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const x = (i / cols * 2 - 1) * halfWidth, y = (j / rows * 2 - 1) * halfHeight;
        for (const face of [-1, 1]) emit(x, y, fold(x,y) + face * thickness);
      }
    }, cloth, { objectId: 'folded-cloth', res: .029 });
    for (const side of [-1, 1]) {
      const y = side * halfHeight;
      const seam = Array.from({ length: 22 }, (_, i) => {
        const x = (i / 21 * 2 - 1) * halfWidth;
        return [center[0] + x, center[1] + y, center[2] + fold(x,y) + thickness + .012];
      });
      S.tube(seam, .022, .022, trim, { objectId: 'cloth-hem', res: .026 });
    }
    S.tube([[1.47, 2.26, .25], [3.13, 2.26, .25]], .037, .037, trim, { objectId: 'cloth-rail', res: .035 });
    S.bake();

    return B.finish({
      cam: { target: [0, 1.12, 0], dist: 5.3, yaw: .19, pitch: .11, ortho: true, sway: 0 },
      radius: 8, dither: 0,
      fog: { c: 0, start: 1, max: 0 },
      skyEnvironment: { defaults: { zenith: '#141a29', horizon: '#3a465a', ground: '#343842', sunStrength: 0 } },
      look: { splatCoverage: 'continuous' }
    });
  }
});
