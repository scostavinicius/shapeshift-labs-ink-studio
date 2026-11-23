module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  const name = 'Surface-bound strokes', id = 'surface-bound-strokes', seed = 16;
  const chartSpec = { kind: 'cylinder', id: 'body', origin: [0, -1.10, 0], radius: 1.23, height: 2.20 };
  const chart = K.procedural.surface.cylinder(chartSpec);
  const shades = {
    ink: ['#132638', '#395661', '#708d8e', '#a5b9b3', '#d0d9c5', '#ece9ce'],
    stitch: ['#262139', '#452d37', '#69413f', '#915547', '#be7958', '#dba371'],
    hatch: ['#182e33', '#2a4650', '#4e6e68', '#77917c', '#a6ad85', '#d2ca97'],
    groove: ['#22252f', '#543744', '#845052', '#b47162', '#cd9678', '#e5b48b']
  };
  const curve = points => K.curve.spline(points.map(([u, v]) => [u, v, 0]), 7).map(([u, v]) => [u, v]);
  const mark = (id, points, profile = {}, options = {}) => ({
    source: { kind: 'surface', id, chart, points, ...profile },
    edge: 'hard', width: .073, material: 'ink', object: 'body', ...options
  });
  const leaf = (u, v, sign, length, height) => curve([[u, v], [u + sign * length * .65, v + height * .74],
    [u + sign * length, v + height], [u + sign * length * .66, v + height * .3], [u, v]]);
  const arc = (height, rise, u = .25, span = .14) =>
    Array.from({ length: 15 }, (_, index) => {
      const t = index / 14;
      return [u + span * (2 * t - 1), height + rise * Math.sin(Math.PI * t)];
    });
  function designs(study) {
    if (study === 'ink') {
      const blue = '#17405b', highlight = '#2b6b82', shift = { lift: .008 };
      const stem = curve([[.155,.20],[.203,.32],[.232,.50],[.270,.66],[.325,.80],[.370,.82]]);
      const leaves = [[.203,.32,-1,.061,.17],[.232,.50,1,.079,.052],[.24,.54,-1,.071,.183],
        [.27,.66,1,.065,.042],[.312,.78,-1,.035,.107]];
      return [
        mark('stem', stem, shift, { color: blue, width: .095, taper: [[0,1],[.84,.7],[1,.15]] }),
        ...leaves.map((args, i) => mark('leaf-' + i, leaf(...args), { ...shift, closed: true },
          { color: i % 2 ? highlight : blue, width: .061 })),
        ...[.125,.878].map((v,i) => mark('rim-' + i, [[.55,v],[.80,v],[1.05,v],[1.30,v],[1.55,v]],
          { ...shift, closed: true, coordinates: 'lifted' }, { color: highlight, width: .051 }))
      ];
    }
    if (study === 'stitch') {
      const seam = v => .235 + .038 * Math.sin(4.65 * (v - .3));
      const strip = Array.from({ length: 19 }, (_, i) => {
        const v = .145 + i * .039;
        return mark('stitch-' + i, [[seam(v) - .034, v], [seam(v + .038) + .034, v + .038]],
          { lift: { samples: [0, .085, .115, .083, 0] }, inset: .006, profileSamples: 22 }, {
            section: 'round', edge: 'hard', width: .072, color: i % 3 === 0 ? '#edc692' : '#d99c67',
            material: 'thread', lighting: 'matte-thread', taper: [[0,.65],[.24,1],[.76,1],[1,.65]]
          });
      });
      return [
        mark('leather-seam', Array.from({ length: 13 }, (_, i) => {
          const v = .13 + .75 * i / 12;
          return [seam(v), v];
        }),
          { lift: .003 }, { color: '#4c2a37', width: .079, material: 'seam' }),
        ...strip
      ];
    }
    if (study === 'hatch') {
      const ink = '#243f43';
      const lines = Array.from({ length: 18 }, (_, i) => {
        const u = .10 + i * .0164, v = .16 + .061 * i;
        const end = Math.min(.82 + .007 * Math.sin(i), v + .31);
        const begin = Math.min(.61, v * .82);
        return mark('hatch-' + i, curve([[u, begin], [u + .032, (begin + end) / 2 - .026], [u + .046, end]]),
          { lift: .006 }, { color: ink, width: .045 + .019 * (i % 4 === 0), taper: [[0,.55],[.2,1],[.8,1],[1,.35]] });
      });
      const cross = Array.from({ length: 7 }, (_, i) => {
        const v = .185 + .049 * i;
        return mark('cross-' + i, curve([[.132 + .024 * i, v + .095], [.19 + .022 * i, v + .057], [.242 + .022 * i, v]]),
          { lift: .009 }, { color: '#3b5d5d', width: .037, taper: [[0,.5],[.2,1],[1,.55]] });
      });
      return [...lines, ...cross,
        mark('upper-rule', arc(.772, .10), { lift: .008 }, { color: '#416363', width: .052 }),
        mark('lower-rule', arc(.157, -.047), { lift: .008 }, { color: '#416363', width: .052 })];
    }
    return [
      ...[0, 1, 2].map(i => mark('flute-' + i,
        curve([[.115 + i*.076,.155],[.129 + i*.073,.345],[.179 + i*.075,.60],[.199 + i*.058,.805]]),
        { inset: .018 + i*.012 }, { radius: .087, material: 'cut' })),
      mark('shoulder', arc(.80, .075), { inset: .019 }, { radius: .056, material: 'cut' }),
      mark('foot', arc(.144, -.049), { inset: .025 }, { radius: .052, material: 'cut' })
    ];
  }

  const pack = value => parseInt(value.slice(1), 16);
  function build(value = seed, { controls = {} } = {}) {
    const { study = 'ink' } = controls;
    if (!Object.hasOwn(shades, study)) throw new RangeError('Choose ink, stitch, hatch or groove');
    const B = makeBuilder(value, shades[study].map(pack));
    const S = K.sculpt(makeSculpt(B));
    const cut = study === 'groove', body = { r: [1,2,3,4,5], materialId: 'body', fat: .46, a: 1.4 };
    const rim = { r: [1,2,3,4], materialId: 'rim', fat: .52 };
    Object.assign(S, { keepRenderSdf: true, captureAlbedo: true, amb: .52, sky: .12, sunK: .62, sun: K.V.norm([-.62,.61,.55]) });
    const marks = designs(study);
    const part = S.lathe(chartSpec.origin, chartSpec.height, chartSpec.radius, body,
      { hold: cut, res: cut ? .072 : .11, objectId: 'body' });
    if (cut) K.curveSplats.carve(S, part, marks, { inner: [1,2,3,4] });
    S.lathe([0, -1.20, 0], .107, 1.266, rim, { res: .083, objectId: 'rim' });
    S.lathe([0, 1.09, 0], .10, 1.266, rim, { res: .083, objectId: 'rim' });
    S.bake();
    if (!cut) for (const { source, ...look } of marks) K.curveSplats.draw(B, source, look);
    return B.finish({
      cam: { target: [0, 0, 0], dist: 5.45, yaw: .06, pitch: .21 },
      radius: 4, fog: { start: 1, max: 0, c: 0 }, dither: 0,
      look: { pixelSize: 1, sdfAssist: { epsilon: .0012 } },
      liveSun: { direction: [-.56, .65, .68], intensity: 1, ambient: .45, shadows: false }
    });
  }
  return { name, id, seed, build };
};
