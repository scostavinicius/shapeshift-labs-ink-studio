/* Orbit the four editable bundle recipes at a matched art resolution. */
const path = require('node:path'), ink = require('..'), kit = ink.load(), { KIT: K } = kit;
const scene = require('./curve-splat-bundles.js')(kit);
const PNG = require('../cli/png.js'), { write } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-bundles');
const still = process.argv.includes('--still'), count = 48, fps = 12;
const width = 1136, height = 892, w = 174, h = 98, scale = 3, padding = 43;
const panels = [
  ['braid', 'Over-under braid', 'THREE STRANDS / SIX CHECKED CROSSINGS', '#eab78d'],
  ['twisted-cable', 'Twisted cable', 'FOUR STRANDS / CONSTANT CENTRE SPACING', '#eab88f'],
  ['clumped-hair', 'Clumped hair', 'FOUR LOCKS / SEEDED LENGTH VARIATION', '#abd8f3'],
  ['frayed-hem', 'Frayed hem', 'THIRTY-THREE ROOTS / UNEVEN TIPS', '#ecc8a7']
].map(([style, label, note, color], i) => ({
  world: scene.build(scene.seed, { controls: {style} }), label, note, color,
  x: 26 + 562 * (i % 2), y: i < 2 ? 132 : 500
}));
function board(frame) {
  const commands = [], white = '#efeee4', dim = '#a5bbc9', border = '#40596a';
  const rect = (x,y,w,h,fill) => commands.push({ type:'rect', rect:[x,y,w,h], fill });
  const text = (value,x,y,size,color=white) =>
    commands.push({ type:'text', text:value, at:[x,y], scale:size, color });
  rect(0,0,width,height,'#151f2d');
  rect(26,24,28,4,'#a4dbca');
  text('INK STUDIO / CURVE SPLATS',67,20,2,'#a4dbca');
  text('Strand bundles',23,48,5);
  text('GUIDE-PATH STUDIES / 174 X 98 ART PIXELS',26,102,2,dim);
  for (const { label, note, color, x, y } of panels) {
    text(label,x,y,3,color);
    text(note,x,y+28,1,dim);
    rect(x-2,y+padding-2,w*scale+4,h*scale+4,border);
  }
  rect(26,861,1084,3,border);
  rect(26,861,Math.max(1,1084*frame/(count-1)),3,'#a4dbca');
  const plate = K.procedural.drawing2d.render({ width,height,commands,edges:'hard' });
  const angle = 2 * Math.PI * frame / count;
  for (const { world, x, y } of panels) {
    const image = ink.render(world, { raw:true,w,h,px:1,yaw:.44*Math.sin(angle)-.10,pitch:.13+.17*Math.cos(angle) });
    for (let v=0;v<h*scale;v++) for (let u=0;u<w*scale;u++) {
      const j=(Math.floor(v/scale)*w+Math.floor(u/scale))*3;
      const q=((y+padding+v)*width+x+u)*4;
      for (let c=0;c<3;c++)plate.data[q+c]=image.rgb[j+c];
    }
  }
  return PNG.packRGBA(plate);
}
const poster = 5;
if (still) write(path.join(out,'strand-bundles.png'),PNG.encodeFrame(board(poster)));
else {
  const animation=[];
  for(let i=0;i<count;i++) {
    const frame=board(i);
    write(path.join(out,'frames','frame-'+String(i).padStart(3,'0')+'.png'),PNG.encodeFrame(frame));
    if(i===poster) write(path.join(out,'strand-bundles.png'),PNG.encodeFrame(frame));
    if(i%2===0) animation.push(frame);
  }
  write(path.join(out,'strand-bundles-apng.png'),PNG.encodeAnimation(animation,fps/2));
}
console.log('Rendered strand bundle studies to '+out);
