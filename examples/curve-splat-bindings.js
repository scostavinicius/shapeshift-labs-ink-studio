/* Four native animation sources drive the same continuous strand primitive. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  const { V, M, curveSplats: C } = K, seed = 37, id = 'curve-splat-bindings';
  const palette = [0x12202f,0x172a39,0x253d51,0x38576a,0x628698,0xb3bdb5,0xeaddbd,
    0x562f41,0x8e4949,0xbc6b52,0xe69c68,0xf5d398,0x20565e,0x2e8184,0x57b6a9,0xb7efd4];
  const steel = { r: [1,2,3,4,5] }, copper = { r: [7,8,9,10,11] }, jade = { r: [12,13,14,15] };
  const pale = '#ffcc7d', dark = '#a65049', mint = '#91efd4';
  const stripes = (a, b) => ({ keys: [[0,a],[.18,b],[.31,a],[.48,b],[.61,a],[.78,b],[.89,a]], interpolation: 'step' });
  const mark = (id, points) => ({ kind: 'path', id, points });
  const turn = time => 2 * Math.PI * time / 3.6;
  const baseCamera = { target: [0,0,0], yaw: .10, pitch: .10, dist: 5.7 };
  const plain = (B, cam = {}) => B.finish({ cam: { ...baseCamera, ...cam }, radius: 4,
    fog: { c: 0, start: 1, max: 0 }, look: { pixelSize: 1 }, dither: 0,
    liveSun: { shadows: false, ambient: .42, intensity: 1.03, direction: [-.48,.57,.8] } });
  function sculpture(B) {
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun: V.norm([-.48,.57,.8]), sky: .12, amb: .49, sunK: .63 });
    return S;
  }

  function arm(B) {
    const S = sculpture(B), joint = [0, 0, 0], end = [1.65,0,.02];
    S.tube([[-1.65,0,0],[-.09,0,0]], .18, .17, steel, { res: .08 });
    S.ball([-1.73,0,0], [.27,.29,.26], copper, { res: .075 });
    S.ball(joint, [.33,.33,.23], jade, { res: .075 });
    S.bake();
    const jointRows = B.count();
    S.tube([[.07,0,0],end], .16, .13, steel, { res: .074 });
    S.ball(end, [.22,.23,.2], copper, { res: .065 });
    S.bake();
    const native = B.count(), ids = Array.from({ length: native }, (_, i) => i);
    const hose = C.bind(B, mark('supply-line', [[-1.72,.09,.2],[-.98,.19,.25],[-.46,.42,.18],
      [.02,.44,.23],[.52,.31,.22],[.99,.15,.18],[1.63,.09,.20]]),
    C.drivers.bones([0,0,0,{ bone: 0, second: 1, weight: .46 },1,1,1]), {
      object: 'arm', material: 'supply-line', edge: 'hard', width: .17, caps: 'blunt',
      lighting: { preset: 'metal-wire', highlightColor: '#ffd5aa' }, along: { pigment: stripes(pale, dark) }
    });
    const world = plain(B), bones = new Float32Array(24);
    K.bones.bind(world, { ids, bid: ids.map(i => Number(i >= jointRows)), M: bones, curveBindings: [hose], pose(t) {
      const a = turn(t);
      bones.set([...M.id(), 0,0,0]);
      bones.set([...M.mul(M.rot([0,0,1], .68 * Math.sin(a)), M.rot([0,1,0], .39 * Math.cos(a))), 0,0,0], 12);
    } });
    world.anim.update(0, 0);
    return world;
  }

  function sockets(B) {
    const S = sculpture(B), rig = K.rig(B, S);
    const hinge = [1.06,.63,0], grip = [1.51,-.26,.17];
    S.tube([[-1.64,.62,0],[1.06,.62,0]], .105, .105, steel, { res: .074 });
    S.ball([-1.48,.60,.12], [.22,.20,.20], jade, { res: .066 });
    S.ball(hinge, [.25,.26,.20], copper, { res: .073 });
    S.tube([hinge,[1.57,.31,0],grip], .14, .12, steel, { tag: 'lever', res: .071 });
    S.ball(grip, [.22,.18,.19], jade, { tag: 'lever', res: .066 });
    S.bake();
    const anchors = ['hook', [-.99,.02,.17], [-.42,-.67,.18], [.28,-.69,.22], [.93,-.55,.23], 'grip'];
    const binding = C.bind(B, mark('lacing', [[-1.48,.52,.22], ...anchors.slice(1,-1), grip]),
      C.drivers.sockets(anchors), { object: 'lacing', edge: 'hard', width: .15, section: 'flattened',
        lighting: 'glossy-hair', twist: [[0,0],[1,1.2]], along: { pigment: stripes(mint, '#3b828a') } });
    const world = plain(B), st = K.stage(world);
    rig.bind(st);
    st.socket('hook', [-1.48,.52,.22]);
    st.socket('grip', V.add(grip, [0,0,.12]), 'lever');
    st.add({ update(dt, t) {
      const a = turn(t);
      rig.set('lever', M.rot([0,0,1], .63 + .55 * Math.sin(a)), hinge, hinge);
      rig.apply();
    } });
    st.add(binding);
    st.update(0, 0);
    return world;
  }

  function cloth(B) {
    const S = sculpture(B);
    S.tube([[-1.39,1.03,.02],[1.39,1.03,.02]], .13, .13, steel, { res: .065 });
    for (const x of [-1.47,1.47]) S.ball([x,1.03,.02], [.19,.17,.16], copper, { res: .06 });
    S.bake();
    const cape = K.cloth(B, { at: [-1.28,.97,0], u: [2.56,0,0], v: [0,-2.09,0], nu: 17, nv: 13,
      pins: (_, j) => j === 0, substeps: 9, gravity: [0,-6.2,0], mass: .032, air: .8, dabs: 2,
      pattern(u, v) {
        return u < .12 || u > .88 || v > .87 ? [7,8,9,10] : [2,3,4,12,13];
      },
      wind: (x, y, z, t) => [1.25 * Math.sin(turn(t)-.8*y), .22, 1.9 + 1.48 * Math.sin(turn(t)+1.3*x)] });
    cape.bindStroke({ id: 'embroidered-hem', points: [[.09,.13],[.09,.91],[.91,.91],[.91,.13]], inset: .033 },
      { object: 'cape', material: 'embroidery', edge: 'hard', width: .066, caps: 'blunt',
        along: { pigment: stripes('#80dbae','#efcd88') } });
    const crest = Array.from({ length: 33 }, (_, i) => {
      const a = 2 * Math.PI * i / 32;
      return [.5 + .22 * Math.cos(a), .5 + (.18 + .055 * Math.cos(3 * a)) * Math.sin(a)];
    });
    cape.bindStroke({ id: 'embroidered-crest', points: crest, inset: .04, closed: true },
      { object: 'cape', material: 'embroidery', edge: 'hard', width: .086, color: pale });
    const world = plain(B, { target: [0,-.03,0], dist: 5.4 }), st = K.stage(world);
    st.add(cape);
    st.update(0,0);
    return world;
  }

  function strands(B) {
    const S = sculpture(B), rig = K.rig(B, S);
    S.lathe([0,-1.23,0], .3, .77, steel, { res: .08 });
    S.ball([0,-.70,0], [.78,.34,.45], jade, { res: .082 });
    S.ball([0,-.28,0], [.28,.40,.24], copper, { res: .077, tag: 'head' });
    S.ball([0,.28,0], [.42,.59,.39], copper, { res: .072, tag: 'head' });
    S.ball([0,.31,.36], [.105,.13,.14], copper, { res: .058, tag: 'head' });
    for (const x of [-.19,.19]) S.ball([x,.45,.35], [.074,.044,.057], steel, { res: .041, tag: 'head' });
    S.ball([0,.68,-.06], [.45,.29,.37], steel, { res: .070, tag: 'head' });
    S.bake();
    const roots = Array.from({ length: 18 }, (_, i) => {
      const a = -.80 + i * 2.37 / 17;
      return { id: 'lock-' + i, p: [.40 * Math.cos(a), .68 + .08 * Math.sin(i * .7), -.37 * Math.sin(a)],
        n: [.65 + .28 * Math.cos(a), -.51, -.33 * Math.sin(a)], part: 'head', len: .93 + .20 * Math.sin(i * .46) };
    });
    const hair = K.hair(B, { roots, renderer: 'curve-splats', len: 1.43, segs: 10,
      bend: .006, gravity: [0,-3.8,0], damp: 1.2, substeps: 8, shape: .063, trim: .1,
      droop: .48, frizz: .024, width: .040, ramp: [2,3,4,13,14],
      wind: (x,y,z,t) => [2.5 + 2.3 * Math.sin(turn(t) - y), .35, -.75 * Math.cos(turn(t))],
      curveProfile: { edge: 'beta', lighting: { preset: 'glossy-hair', highlightColor: '#91dfef' },
        profileSamples: 18, width: { samples: [.078,.10,.081,.036] } } });
    const tassel = K.hair(B, { roots: [{ id: 'ear-tassel', part: 'head', p: [-.38,.38,.19], n: [-.28,-1,.27] }],
      renderer: 'curve-splats', len: .85, segs: 9, bend: .012, gravity: [0,-5.9,0], shape: .09,
      trim: 0, frizz: .006, substeps: 8, ramp: [7,9,11], object: 'tassel',
      curveProfile: { edge: 'hard', width: .083, lighting: 'matte-thread',
        taper: [[0,1],[.82,.76],[1,.89]], along: { pigment: stripes(pale, dark) } } });
    const world = plain(B, { target: [.17,-.05,0], yaw: .15, dist: 4.8 }), st = K.stage(world);
    rig.bind(st);
    st.add({ update(dt,t) {
      const a = turn(t), pivot = [0,-.34,0];
      rig.set('head', M.mul(M.rot([0,1,0], .93 * Math.sin(a)), M.rot([0,0,1], .19 * Math.cos(a))),
        pivot, V.add(pivot, [.21 * Math.sin(a),0,0]));
      rig.apply();
    } });
    st.add(hair);
    st.add(tassel);
    st.update(0,0);
    return world;
  }

  const studies = { bones: arm, sockets, cloth, strands };
  return { id, name: 'Rig and simulation curve bindings', seed, build(value = seed, { controls = {} } = {}) {
    const study = controls.study ?? 'strands';
    if (!Object.hasOwn(studies, study)) throw new RangeError('Choose bones, sockets, cloth or strands');
    return studies[study](makeBuilder(value, palette));
  } };
};
