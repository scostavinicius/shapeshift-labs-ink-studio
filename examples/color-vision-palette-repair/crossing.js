module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'signal-crossing', name: 'Signal crossing', seed: 57,
  build(seed) {
    const B = makeBuilder(seed, [0x151e30, 0x22291f, 0x293b48, 0x3e525c, 0x576b6d, 0x77847b,
      0x332b35, 0x554144, 0x775359, 0x9d6e67, 0x788c49, 0x8c8348, 0xcd5357, 0x9eece1, 0xcab28d, 0x596840]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun: K.V.norm([-.52, .76, .39]), amb: .32, sky: .14, sunK: .52 });
    const iron = { r: [2, 3, 4, 5], materialId: 'iron' }, trim = { r: [6, 7, 8, 9], materialId: 'copper' };
    const stone = { r: [1, 2, 3, 4, 5], materialId: 'slate' }, moss = { r: [1, 15, 10, 11], materialId: 'moss' };
    const flat = (index, materialId) => ({ r: [index], em: true, materialId });
    const box = (at, half, mat, objectId, res = .061, rd = .025) => S.box(at, half, mat, { objectId, res, rd });
    box([0, -.23, .04], [3.38, .25, 1.7], stone, 'foundation', .13, .1);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 11; i++) {
      const x = (i - 5) * .58 + (j % 2) * .18;
      box([x, .19 + j * .43, -.46], [.28, .20, .23], (i + 3*j) % 7 === 0 ? iron : stone, 'retaining-wall', .079);
    }
    for (const [x, y, width] of [[-1.95, .27, .41], [-1.64, .16, .35], [1.77, .21, .32], [2.15, .26, .38], [.23, .16, .37]]) {
      S.rock([x, y, .67], [width, .14, .28], moss, { res: .063, objectId: 'moss-bank' });
    }
    for (const [x, label, ground, pattern] of [
      [-.92, 'west', 10, ['00100', '00010', '11111', '00010', '00100']],
      [.92, 'east', 11, ['10001', '01010', '00100', '01010', '10001']]
    ]) {
      box([x, .59, .22], [.11, .61, .13], iron, label + '-post', .048);
      box([x, 1.27, .18], [.69, .61, .13], trim, label + '-housing', .056, .085);
      box([x, 1.27, .32], [.592, .515, .032], flat(ground, 'enamel'), label + '-plate', .038, .045);
      for (let y = 0; y < pattern.length; y++) for (let i = 0; i < pattern[y].length; i++) {
        if (pattern[y][i] === '0') continue;
        box([x + (i - 2) * .133, 1.27 + (2-y) * .133, .364], [.068, .068, .021],
          flat(12, 'signal-red'), label + '-signal', .025, .008);
      }
      for (const dx of [-.57, .57]) for (const dy of [-.485, .485])
        S.ball([x + dx, 1.27 + dy, .365], .034, { r: [14] }, { res: .019, objectId: label + '-rivets' });
    }
    box([0, 2.36, -.23], [2.21, .105, .32], trim, 'lintel', .069, .049);
    box([0, 2.41, .04], [2.27, .038, .085], iron, 'lintel', .065);
    for (const x of [-1.81, 0, 1.81]) {
      box([x, 2.15, -.02], [.095, .139, .076], iron, 'crossing-lamps', .041);
      S.ball([x, 2.13, .074], [.064, .072, .035], flat(13, 'lamp-glow'), { res: .020, objectId: 'crossing-lamps' });
    }
    S.bake();
    return B.finish({ cam: { target: [0, 1.20, .04], dist: 4.15, yaw: .13, pitch: .11, ortho: true, sway: 0 },
      radius: 5, dither: 0, look: { splatCoverage: 'continuous' } });
  }
});
