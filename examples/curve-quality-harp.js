/* A wind harp with stable silhouette cords and a tunable bank of fine strings. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  const id = 'curve-quality-harp', seed = 77;
  const palette = [0x142231,0x203447,0x2c485a,0x3c6173,0x638795,0xa0b9b7,
    0x754a47,0xa26b54,0xca9062,0xf4ba78,0xffdda1,
    0x346575,0x4f9fa0,0x7fd0bd,0xb4e9d2,0x765e80,0xa588aa,0xdaaec8];
  const steel = { r:[1,2,3,4,5] }, brass = { r:[6,7,8,9,10] }, accent = { r:[11,12,13,14] };
  const colors = ['#daafc8','#80d2bc','#58a9a7','#89d7bf','#b0f0ce','#6eaeb7','#a588aa'];
  const sun = [-.47,.70,.94], C = K.curveSplats;
  const path = (id, points) => ({ kind:'path', id, points });
  const samples = (count, point) => Array.from({ length:count + 1 }, (_, i) => point(i / count));
  const curveQuality = { layers:[
    { id:'frame cords', select:{ material:'frame-cord' }, segments:96, fragments:23000 },
    { id:'silk strings', select:{ material:'silk' }, segments:68, fragments:11500 },
    { id:'brass winding', select:{ material:'winding' }, fragments:3100 }
  ] };

  function build(value) {
    const B = makeBuilder(value,palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun:K.V.norm(sun), sky:.14, amb:.42, sunK:.72 });
    S.box([0,-1.13,-.13],[2.54,.20,.48],steel,{res:.094,rd:.15});
    S.box([0,-.96,.12],[2.42,.061,.36],brass,{res:.083,rd:.055});
    for (const side of [-1,1]) {
      const x = side * 2.12;
      S.box([x,-.05,-.12],[.18,.96,.24],steel,{res:.084,rd:.10});
      S.ball([x,.96,-.075],[.29,.21,.24],brass,{res:.067});
      S.ball([x,.96,.124],[.122,.11,.084],accent,{res:.052});
    }
    S.tube([[-2.14,.88,-.16],[-1.71,1.07,-.15],[0,1.19,-.20],[1.71,1.07,-.15],[2.14,.88,-.16]],
      .11,.11,steel,{res:.080});
    S.bake();

    for (const [i,y] of [.78,-.73].entries()) {
      const knots = samples(36, u => [4.23*(u-.5), y + (i ? -.15 : .15)*Math.sin(Math.PI*u), .35]);
      C.draw(B,path(i ? 'Lower copper rail' : 'Upper copper rail',knots),{
        material:'frame-cord',edge:'hard',width:.145,color:'#f4ba78',lighting:'metal-wire',lod:true
      });
    }
    const moving = [];
    for (const [i,color] of colors.entries()) {
      const knots = samples(46,u => [4.24*(u-.5),.55-i*.196+.105*Math.sin(Math.PI*u),.235-.046*i]);
      const source = path('Silk '+(i+1),knots);
      moving.push(C.bind(B,source,(rest,{time}) => rest.points.map(([x,y,z]) => {
        const spread = Math.sin(Math.PI * (x/4.24+.5));
        return [x,y+(.038+i*.009)*spread*Math.sin(x*2.1-time*2.7+i*.64),
          z+.12*spread*Math.sin(x*1.26-time*2.1+.42*i)];
      }), { material:'silk',edge:'hard',width:.065,color,lighting:'matte-thread',lod:{simplify:[.19,.42]} }));
    }
    for (const [i,x] of [-1.35,0,1.35].entries()) {
      const wrapping = samples(62,u => {
        const a = 13*Math.PI*u;
        return [x+.114*Math.cos(a), -.68+1.48*u, .50+.11*Math.sin(a)];
      });
      C.draw(B,path('Brass winding '+(i+1),wrapping),{ material:'winding',edge:'hard',width:.043,
        color:i===1 ? '#ffdda1' : '#d9a16d',lighting:'metal-wire',lod:{simplify:[.21,.46]} });
    }
    const world = B.finish({ id, cam:{ target:[0,-.065,0], yaw:-.44, pitch:.15, dist:6.95 },
      look:{ pixelSize:1,edgeFilter:true,curveQuality }, radius:6,
      dither:0,fog:{c:0,start:1,max:0},liveSun:{ direction:sun,ambient:.53,intensity:.64,shadows:false } });
    world.anim = { update(dt,time) { for (const strand of moving) strand.pose(world,{time}); } };
    return world;
  }
  return { id,seed,name:'Wind harp',build };
};
