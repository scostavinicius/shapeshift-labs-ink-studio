module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'signal-box-approval',
  name: 'Signal box at blue hour',
  seed: 64,
  build(seed) {
    const B = makeBuilder(seed, [
      0x13202c, 0x21323e, 0x304552, 0x425c66, 0x607980, 0x84968e,
      0x192e3b, 0x2b4553, 0x396675, 0x48888e, 0x60aca3, 0x91ceb2, 0xc6e7c0,
      0x3e303d, 0x68434a, 0x985b51, 0xc77f5d, 0xe6a26e, 0xffcb86, 0xffedb4,
      0x263944, 0x324b54, 0x4a676b, 0x696f6c, 0xada18a, 0xe2cca0
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { wob: .004, amb: .35, sky: .15, sunK: .47, sun: K.V.norm([-.68, .7, .27]) });
    const atlas = SpriteSurface.make(128);
    atlas.face([-3.8, -.66, -.97], [7.6, 0, 0], [0, 4.42, 0], 128, 76, (x, y) => {
      const strut = (x + 3) % 23, level = y % 22;
      if (level === 1 || strut < 2) return 0x21323e;
      const window = x > 79 && x < 124 && y > 17 && y < 45;
      if (window) {
        if (strut === 5 || strut === 6 || y === 19 || y === 42) return 0x607980;
        const mountain = 37 - 4 * Math.sin(x * .108) - 3 * Math.sin(x * .235);
        if (y > mountain) return 0x263944;
        return y < 29 ? 0x304552 : 0x425c66;
      }
      const speckle = (x * 17 + y * 23 + y * x * 5) % 43 < 3;
      return speckle ? 0x304552 : 0x263944;
    });
    const steel = { r: [1, 2, 3, 4, 5] }, dark = { r: [0, 1, 2, 3] }, jacket = { r: [6, 7, 8, 9] };
    const trim = { r: [2, 4, 22, 23, 24] }, brass = { r: [13, 14, 15, 16, 17, 18] };
    const glove = { r: [1, 6, 7, 21, 23] };
    const box = (at, half, mat, id, res = .054, rd = .055) => S.box(at, half, mat, { objectId: id, res, rd });
    const ball = (at, rad, mat, id, res = .041) => S.ball(at, rad, mat, { objectId: id, res });
    const tube = (at, a, b, mat, id, res = .044) => S.tube(at, a, b, mat, { objectId: id, res });

    box([0, -.27, .52], [3.8, .24, 2.6], dark, 'floor', .23, .12);
    box([1.05, .40, .12], [.76, .42, .41], steel, 'console', .071, .12);
    box([1.05, .781, .17], [.71, .073, .45], trim, 'console', .072);
    box([1.06, .505, .518], [.54, .16, .036], dark, 'console', .052, .029);
    for (const x of [.71, .93, 1.15, 1.37]) {
      box([x, .48, .563], [.061, .049, .017], brass, 'console', .035, .017);
      box([x, .56, .563], [.045, .012, .012], { r: [8, 9, 10, 11] }, 'console', .033, .011);
    }
    box([.74, .837, .23], [.191, .074, .191], dark, 'lever-base', .046);
    tube([[.74, .852, .23], [.80, 1.147, .36], [.97, 1.413, .44]], .064, .052, steel, 'lever', .031);
    ball([.968, 1.418, .452], [.143, .134, .121], { r: [16] }, 'lever-accent', .028);
    S.bake();

    for (const side of [-1, 1]) {
      const x = -.67 + side * .15;
      tube([[x, .715, .15], [x + side * .03, .40, .23], [x + side * .04, .12, .27]], .118, .107, dark, 'operator');
      ball([x + .035, .107, .328], [.117, .096, .163], glove, 'operator');
    }
    box([-.66, .904, .13], [.335, .369, .202], jacket, 'operator', .053, .118);
    box([-.645, .716, .30], [.264, .046, .036], trim, 'operator', .039, .03);
    box([-.58, 1.067, .321], [.113, .122, .055], steel, 'operator', .045, .048);
    box([-.58, 1.07, .378], [.055, .035, .018], brass, 'operator', .025, .013);
    tube([[-.92, 1.152, .113], [-1.091, .919, .189], [-1.04, .742, .31]], .101, .092, jacket, 'operator');
    ball([-1.025, .735, .315], [.095, .086, .093], glove, 'operator');
    tube([[-.367, 1.159, .153], [-.048, 1.004, .30], [.316, 1.161, .444], [.748, 1.274, .49]], .111, .080, jacket, 'operator');
    ball([.779, 1.289, .492], [.109, .086, .082], glove, 'operator', .035);
    box([-.63, 1.315, .153], [.17, .069, .139], steel, 'operator', .043);
    box([-.64, 1.593, .146], [.296, .251, .21], { r: [2, 7, 21, 22, 4] }, 'helmet', .039, .127);
    box([-.624, 1.619, .345], [.219, .094, .026], { r: [7] }, 'visor', .024, .043);
    box([-.65, 1.829, .127], [.302, .05, .20], trim, 'helmet', .05, .043);
    for (const x of [-.935, -.347]) ball([x, 1.592, .178], [.047, .085, .079], trim, 'helmet', .028);
    tube([[-.849, 1.826, .042], [-.887, 2.055, .031]], .019, .016, trim, 'helmet', .037);
    ball([-.887, 2.052, .031], .035, { r: [11], em: true }, 'helmet', .024);
    S.bake();

    return B.finish({
      cam: { target: [.04, 1.05, .13], dist: 4.35, yaw: .16, pitch: .097, ortho: true, sway: 0 },
      radius: 5, dither: 0, fog: { c: 0, max: 0 }, spriteSurfaces: atlas.finish(),
      look: { splatCoverage: 'continuous' }
    });
  }
});
