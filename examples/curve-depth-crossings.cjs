/* Native art views of an interlace, a fog crossing and a sun-shadow switch. */
const path = require('node:path'), ink = require('..'), kit = ink.load(), K = kit.KIT, C = K.curveSplats;
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-depth-crossings');
const w = 168, h = 112, scale = 2, width = 1100, height = 598, top = 184, rate = 12, frames = 48;
const background = '#182433', textColor = '#f3ece0', dim = '#a6bbcd', rule = '#3d566c';
const gold = '#f7c484', teal = '#92e1c7', rose = '#e0aeb1';
const palette = [background,'#22344a','#314352','#425969','#527483','#7799a0','#a5bfc4',
  '#24616e','#3b8d91','#61b8ad',teal,'#d0f3cc','#6f4649','#986055','#ba795c','#db9c69',gold,'#ffe8ad',
  '#655865','#856873','#a98a90',rose,'#d8cbc3'];
const colors = palette.map(color => Number.parseInt(color.slice(1), 16));
const camera = { target: [0,0,0], dist: 6.55, yaw: 0, pitch: 0 };
const guide = (id, points) => ({ kind: 'path', id, points });
const stripe = (id, points, width, color, extra = {}) => ({
  source: guide(id, points), object: id, width, color, edge:'hard', ...extra
});
const points = (count, point) => Array.from({length: count}, (_, i) => point(i / (count - 1)));
const weaveStrands = [];
for (let i = 0; i < 4; i++) {
  const span = -.99 + i * .66;
  weaveStrands.push(stripe('amber-' + i, points(51, u => {
    const x = 3.90 * (u - .5);
    return [x, span, .158 * Math.cos(Math.PI * ((x + .99) / .66 + i))];
  }), .18, i % 2 ? '#db9c69' : gold, { lighting: { preset:'metal-wire', diffuse:.13, specular:.38 } }));
  weaveStrands.push(stripe('turquoise-' + i, points(47, u => {
    const y = 3.10 * (u - .5);
    return [span, y, -.158 * Math.cos(Math.PI * ((y + .99) / .66 + i))];
  }), .17, i % 2 ? '#61b8ad' : teal, { lighting: { preset:'matte-thread', diffuse:.16, sheen:.27 } }));
}
const weave = { id:'interlaced-cords', format:C.format, version:1, background, palette:palette.slice(1), camera,
  look: {edgeFilter: true}, strands:weaveStrands, liveSun: {direction:[-.4,.53,1], ambient:.56, intensity:.67, shadows:false} };
const weaveWorld = C.world(weave);

function sculpted(finish, build) {
  const B = kit.makeBuilder(19, colors), S = K.sculpt(kit.makeSculpt(B));
  S.captureAlbedo = true;
  const block = (id, at, half, ramp, albedo, res = .105) =>
    S.box(at, half, { r:ramp, albedo, materialId:id }, { res, rd:.025 });
  const draw = ({ source, ...style }) => C.draw(B, source, style);
  build(block, () => S.bake(), draw);
  return B.finish({ cam:camera, radius:6, dither:0, fog:{ c:0,start:1,max:0 }, ...finish });
}

const mistCamera = { target:[0,.05,0], dist:6.0, yaw:0, pitch:.09 };
const haze = K.procedural.density.fromSdf({
  bounds:{ min:[-2.20,-1.15,-1.92], max:[2.8,1.0,.58] },
  field:(x,y,z)=>Math.hypot((x-.28)/2.41,(y+.08+.13*Math.sin(1.8*x))/.91,(z+.65)/1.18)-1,
  feather:.44, breakup:.38, noise:(x,y,z,t)=>.5+.23*Math.sin(4.7*x+7.9*y+z+t)+.17*Math.sin(12*y-3*z)
});
const mistWorld = sculpted({
  cam:mistCamera, look:{ edgeFilter:{ rules:[{ select:{ material:'ribbon' } }] } },
  liveSun:{ direction:[-.58,.74,1], ambient:.77,intensity:.44,shadows:false },
  atmosphere:[K.atmosphere.field({ field:haze, density:.79, step:.2, color:'#7497a7', lit:false })],
  volumeQuality:{ samples:1, jitter:'off' }
}, (block,bake,draw) => {
  block('basalt',[-.41,-.08,-.06],[.33,.94,.28],[2,3,4],'#425969');
  block('cap',[-.41,.87,-.06],[.40,.10,.33],[3,4,5],'#527483');
  block('plinth',[-.41,-.92,-.06],[.51,.16,.39],[1,2,3],'#314352');
  bake();
  draw(stripe('returning-cord', points(34,u => [-2.25+4.5*u,.30+.22*Math.cos(5.5*u),-1.41+2.55*u]),
    .153,gold,{ material:'ribbon' }));
  draw(stripe('mist-ribbon', points(39,u => [-2.21+4.42*u,.70*Math.sin(4.3*u-.5)-.31,1.19-2.54*u]),
    .184,'#55bdb4',{ edge:'beta', opacity:.66, material:'ribbon',
      along:{ pigment:{ samples:['#d0f3cc','#61b8ad','#3b8d91'] } } }));
  draw(stripe('distant-guide', points(28,u => [-2.14+4.28*u,.45+.17*Math.sin(6.0*u),-1.39]),
    .08,rose,{ opacity:.64, edge:'hard', material:'ribbon' }));
});

const sun = { direction:[.48,.86,-.66], ambient:.32, intensity:.90, mapSize:224, bias:.018, filter:1 };
const shadowCamera = { target:[0,.34,-.16], dist:6.54, yaw:-.45, pitch:.73 };
const shadowWorld = (cast, receive) => sculpted({ cam:shadowCamera, liveSun:sun }, (block,bake,draw) => {
  block('slate-base',[0,-.12,-.12],[2.17,.12,1.40],[2,3,4],'#66818b');
  for (const side of [-1,1]) block('post-'+side,[side*1.80,.44,.24],[.105,.44,.103],[12,13,14],'#a27362',.087);
  bake();
  draw(stripe('signal-caster',points(19,u => [-1.8+3.6*u,.86-.14*Math.sin(Math.PI*u),.24]),.144,gold,{
    shadow:{cast}, pattern:{ dash:{ spacing:.45, duty:.73, phase:.041 } }
  }));
  draw(stripe('low-receiver',points(13,u => [-1.13+2.42*u,.24,1.10-1.79*u]),.145,teal,{
    shadow:{receive}, lighting:{preset:'matte-thread',diffuse:.60,sheen:.25}
  }));
  draw(stripe('soft-caster',points(15,u => [-1.58+3.16*u,.68+.13*Math.sin(Math.PI*u),-.39]),.12,rose,{
    edge:'beta',opacity:.37,shadow:{cast}
  }));
});
const modes = [
  ['CAST ON / RECEIVE ON',true,true], ['CAST ON / RECEIVE OFF',true,false], ['CAST OFF / RECEIVE ON',false,true]
].map(([label,cast,receive]) => ({label,image:ink.render(shadowWorld(cast,receive),{w,h,px:1})}));

function board(frame) {
  const t = frame / rate, wave = Math.sin(frame / frames * Math.PI * 2);
  const base = {w,h,px:1,t}, mode = modes[Math.floor(frame / 16)];
  const panels = [
    { name:'Over and under', key:gold, x:20, note:'INTERLACED IN 3D',
      image:ink.render(weaveWorld,{ ...base, yaw:.35*wave, pitch:.10+.17*wave }) },
    { name:'Solid and mist', key:teal, x:382, note:'SLATE HIDES THE REAR SPANS',
      image:ink.render(mistWorld,{ ...base, yaw:.20*wave, pitch:.14 }) },
    { name:'Live sun shadows', key:rose, x:744, note:mode.label, image:mode.image }
  ];
  const commands = [];
  const rect = (x,y,w,h,fill) => commands.push({type:'rect',rect:[x,y,w,h],fill});
  const text = (value,x,y,size,color=textColor) => commands.push({type:'text',text:value,at:[x,y],scale:size,color});
  rect(0,0,width,height,'#111c29');
  rect(20,27,29,4,teal);
  text('INK STUDIO / CURVE SPLATS',63,22,2,dim);
  text('Depth and crossings',20,54,5);
  text('FINITE STRANDS / 168 X 112 ART PIXELS',20,109,2,dim);
  for (const { name,key,x,note } of panels) {
    text(name,x,149,3,key);
    rect(x-1,top-1,w*scale+2,h*scale+2,rule);
    rect(x,429,w*scale,68,'#1c2c3d');
    rect(x+15,444,25,3,key);
    text(note,x+15,465,2);
  }
  text('AT RIGHT, THE VIEW HOLDS WHILE THE SHADOW SWITCHES CHANGE',20,525,2,dim);
  rect(20,563,1060,4,rule);
  rect(20,563,Math.max(1,1060*frame/(frames-1)),4,teal);
  const plate = K.procedural.drawing2d.render({width,height,commands,edges:'hard'});
  for (const {x,image} of panels) for (let y=0; y<h*scale; y++) for (let u=0; u<w*scale; u++) {
    const a=(Math.floor(y/scale)*w+Math.floor(u/scale))*3, b=((top+y)*width+x+u)*4;
    for(let c=0;c<3;c++) plate.data[b+c]=image.rgb[a+c];
  }
  return PNG.packRGBA(plate);
}

json(path.join(out,'interlaced-cords.json'), weave);
const animation = [];
for (let frame=0; frame<frames; frame++) {
  const picture=board(frame);
  write(path.join(out,'frames','frame-'+String(frame).padStart(3,'0')+'.png'),PNG.encodeFrame(picture));
  if (frame%2===0) animation.push(picture);
  if (frame===8) write(path.join(out,'curve-depth-crossings.png'),PNG.encodeFrame(picture));
}
write(path.join(out,'curve-depth-crossings-apng.png'),PNG.encodeAnimation(animation,rate/2));
console.log('Rendered strand depth, mist, and shadows to '+out);
