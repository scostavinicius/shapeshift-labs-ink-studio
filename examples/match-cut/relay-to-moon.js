const palette = [
  0x110e20, 0x221a30, 0x342540, 0x50334b, 0x714951, 0x9b604f, 0xc77d55, 0xf4b571, 0xffdf9b, 0xfff0bb,
  0x0f2130, 0x152e40, 0x214655, 0x2f6270, 0x53928e, 0x87b4a5, 0xbedac3, 0xe0e0bd, 0xffedd4
];

module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'relay-to-moon',
  name: 'Relay to moonrise',
  seed: 32,
  build(seed, { controls = {} } = {}) {
    const moon = controls.shot === 'moon';
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { wob: 0, amb: .28, sky: .22, sunK: .69, sun: K.V.norm([-.46, .7, .43]) });
    const shade = (x, y) => Math.sin(x * .316 + y * 1.329) * Math.sin(x * 1.17 - y * .432);
    const sky = SpriteSurface.make(256);
    const rgb = (r, g, b) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

    function paintRelay(x, y) {
      const rib = Math.min((x + 22) % 64, 64 - (x + 22) % 64);
      if (y > 102 + 2 * Math.sin(x * .04)) return shade(x, y) > .65 ? 0x332437 : 0x1a1528;
      if (rib < 2 || y % 48 < 2) return 0x21172e;
      const warm = 12 * Math.cos((x - 52) * .018) + 6 * Math.sin(y * .065);
      const grain = shade(x, y) > .58 ? 6 : 0;
      return rgb(49 + warm + grain, 31 + warm * .63 + grain, 48 + warm * .42 + grain);
    }

    function paintInlet(x, y) {
      const horizon = 87, tide = y - horizon;
      const haze = Math.max(0, Math.min(1, (y - 23) / 65));
      if (y < horizon) {
        const farCliff = 83 - 8 * Math.max(0, Math.cos(x * .029 + .46)) - 5 * Math.sin(x * .06) ** 2;
        if (y > farCliff) return 0x214655;
        const dotted = (x * 131 + y * 67 + x * y * 19) % 919 < 2;
        if (dotted && y < 60) return 0xbedac3;
        const cloudY = 58 + 5 * Math.sin(x * .025) + 3 * Math.sin(x * .056);
        const cloud = Math.abs(y - cloudY) < 1.6 && Math.sin(x * .079) > -.05;
        const band = Math.floor(haze * 10) * 2;
        return rgb(20 + band + 6 * cloud, 39 + 2 * band + 7 * cloud, 61 + band + 8 * cloud);
      }
      if (y < horizon + 2 && Math.sin(x * .22) > -.12) return 0x65968f;
      const cliff = 114 - 22 * Math.cos((x - 234) * .025) ** 4 - 4 * Math.sin(x * .147);
      if (x > 172 && y > cliff) return shade(x, y) > .68 ? 0x213d4e : 0x142636;
      const wave = Math.sin((tide + Math.sin(x * .084) * .55) * (1.3 - tide * .013)) > .64;
      const lit = 26 * Math.exp(-(((x - 116 + 10 * shade(x, y)) / (22 + tide * .7)) ** 2));
      if (wave && shade(x * .22, y) > -.53) return rgb(34 + lit, 72 + lit, 82 + lit);
      return rgb(21 + lit * .48, 45 + lit * .64, 64 + lit * .55);
    }

    sky.face([-4.91, -2.83, -2.8], [9.82, 0, 0], [0, 5.66, 0], 242, 140, moon ? paintInlet : paintRelay);
    const shifted = B.count();
    if (moon) {
      const stone = { r: [12, 13, 14, 15, 16, 17, 18], mod(x, y, z) {
        return .16 * Math.sin(x * 12 + Math.cos(y * 8)) * Math.sin(y * 11 + z * 3) +
          .11 * Math.sin(x * 22 + y * 17);
      } };
      const name = { objectId: 'moon', res: .027 };
      S.ball([0, 0, 0], [.618, .618, .365], stone, name);
    } else {
      const iron = { r: [0, 1, 2, 3, 4] }, brass = { r: [3, 4, 5, 6, 7, 8] };
      const copper = { r: [2, 3, 4, 5, 6] }, glint = { r: [7, 8, 9], em: true };
      const front = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
      S.tube([[-3.91, -2.4, -.22], [-2.04, -1.48, -.22], [-.66, -.46, -.22], [0, 0, -.27]], .14, .19, iron, { res: .071 });
      S.tube([[-3.84, -1.89, -.24], [-2.04, -1.14, -.24], [-.57, -.25, -.24]], .049, .065, copper, { res: .055 });
      S.ball([0, 0, -.14], [.91, .91, .225], iron, { res: .062 });
      S.torus([0, 0, .025], .807, .079, brass, { ax: front, res: .04 });
      S.torus([0, 0, .105], .684, .034, copper, { ax: front, res: .027 });
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * i / 4;
        S.ball([.803 * Math.cos(a), .803 * Math.sin(a), .103], .047, i % 2 ? brass : glint, { res: .029 });
      }
      const lensFace = [8, 9], lensRib = [7, 8];
      const glass = { r: lensFace, em: true, rf(x, y) {
        return Math.cos(30 * y + 1.3 * Math.sin(5 * x)) > .6 ? lensRib : lensFace;
      } };
      S.ball([0, 0, .12], [.604, .604, .16], glass, { res: .026, objectId: 'relay-lens' });
    }
    S.bake();
    const world = B.finish({
      cam: { target: [0, 0, 0], dist: 7.25, yaw: 0, pitch: 0, ortho: true, sway: 0 },
      radius: 7, dither: 0, fog: { c: 0, max: 0 }, spriteSurfaces: sky.finish(),
      look: { splatCoverage: 'continuous' }
    });
    const stage = K.stage(world);
    stage.stateful = false;
    stage.add({ pre(_dt, t) {
      const u = moon ? t - .35 : t;
      const x = moon ? -.92 + .72 * u + .19 * Math.sin(u * 1.8) : -1.25 + .79 * u + .35 * Math.sin(u * 1.35);
      const y = moon ? -.38 + .51 * u + .19 * Math.sin(u * 2.6) : -.53 + .65 * u - .16 * Math.sin(u * 2.3);
      for (let i = shifted; i < world.count; i++) {
        const row = i * 16;
        stage.D[row] = stage.base[row] + x;
        stage.D[row + 1] = stage.base[row + 1] + y;
        stage.touch(i);
      }
    } });
    return world;
  }
});
