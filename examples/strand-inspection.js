/* Three named paths in a bridge junction, with a moving translucent pickup. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  const id = 'strand-inspection', seed = 30;
  const palette = [0x142332, 0x21374a, 0x2d4a60, 0x3a6071, 0x65878d, 0x9db4aa,
    0x73434b, 0x996251, 0xca8b60, 0xf4be83, 0xffdf9f,
    0x244e62, 0x317b84, 0x57aeaa, 0x99e4c6, 0xe2f8d8, 0xb89ab6, 0xf0c5d5];
  const steel = { r: [1, 2, 3, 4, 5] }, copper = { r: [6, 7, 8, 9, 10] }, ceramic = { r: [11, 12, 13, 14, 15] };
  const sun = [-.36,.68,.83], C = K.curveSplats;
  const path = (id, points) => ({ kind: 'path', id, points });

  function build(value) {
    const B = makeBuilder(value, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun:K.V.norm(sun), sky:.17, amb:.45, sunK:.66 });
    for (const x of [-2.12, 2.12]) {
      S.box([x,-.35,-.18],[.215,.86,.28],steel,{res:.09,rd:.11});
      S.box([x,-1.16,-.18],[.38,.20,.39],steel,{res:.096,rd:.09});
      for (const y of [-.74,.33]) {
        S.ball([x,y,.19],[.174,.166,.13],copper,{res:.061});
        S.ball([x,y,.284],[.083,.081,.066],ceramic,{res:.044});
      }
    }
    S.tube([[-2.14,-1.13,-.31],[2.14,-1.13,-.31]],.097,.097,steel,{res:.08});
    S.bake();
    C.draw(B, path('Copper feed', [[-2.12,.33,.19],[-1.72,.49,.06],[-1.27,.48,-.04],
      [-.84,.34,-.15],[.76,-.25,-.15],[1.30,-.53,-.015],[1.73,-.74,.073],[2.12,-.74,.19]]),
    { object:'bridge', material:'copper', width:.21, edge:'hard', caps:'blunt', color:'#f4be83', lighting:'metal-wire' });
    C.draw(B, path('Return thread', [[-2.10,-.71,-.10],[-1.56,-.96,-.39],[-.90,-.91,-.51],
      [-.18,-.64,-.56],[.62,-.68,-.54],[1.35,-.87,-.41],[2.10,-.72,-.10]]),
    { object:'bridge', material:'silk', width:.10, edge:'hard', caps:'blunt', color:'#b89ab6', lighting:'matte-thread' });
    const pickup = C.bind(B, path('Jade pickup', [[-2.12,-.74,.19],[-1.74,-.60,.28],[-1.34,-.41,.37],
      [-.85,-.35,.44],[.71,.30,.44],[1.24,.54,.38],[1.77,.44,.29],[2.12,.33,.19]]),
    (rest, {time}) => rest.points.map(([x,y,z]) => {
      const weight = Math.max(0, 1 - (x / 2.12) ** 2);
      return [x + .17 * weight * Math.sin(time * Math.PI), y + .24 * weight * Math.sin(time * Math.PI), z];
    }), { object:'bridge', material:'jade', width:.185, section:'elliptical', aspect:.67, edge:'hard',
      opacity:.66, caps:'blunt', color:'#99e4c6', lighting:'glossy-hair' });
    const world = B.finish({ id, cam:{ target:[0,-.15,.04], yaw:-.12, pitch:.13, dist:6.1 },
      look:{ pixelSize:1, edgeFilter:true }, dither:0, radius:6, fog:{ c:0, start:1, max:0 },
      liveSun:{ direction:sun, ambient:.46, intensity:.65, shadows:false } });
    world.anim = { update(dt, time) { pickup.pose(world, { time }); } };
    return world;
  }

  return { id, seed, name:'Woven signal bridge', build };
};
