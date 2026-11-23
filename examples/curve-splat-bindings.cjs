/* Render the binding studies at native art resolution and assemble a review board. */
const path = require('node:path'), ink = require('..'), kit = ink.load(), { KIT: K } = kit;
const scene = require('./curve-splat-bindings.js')(kit);
const { pose } = require('../cli/diarama-pose.js');
const PNG = require('../cli/png.js'), { write } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-bindings');
const still = process.argv.includes('--still'), fps = 12, count = 48;
const width = 1112, height = 826, w = 172, h = 87, scale = 3, top = 44;
const panels = [
  ['bones', 'Bone-driven piping', 'TWO-BONE BLEND ACROSS THE JOINT', '#f4c28a'],
  ['sockets', 'Socket lacing', 'THE LEVER MOVES THE LAST ANCHOR', '#97dbcd'],
  ['cloth', 'Embroidered cloth', 'UV STROKES FOLLOW THE SIMULATED FOLDS', '#e4c99d'],
  ['strands', 'Hair and tassel', 'XPBD STRANDS LAG THROUGH THE HEAD TURN', '#a6d9f1']
].map(([study, label, note, color], i) => ({
  world: scene.build(scene.seed, { controls: { study } }), label, note, color,
  x: 23 + (i % 2) * 550, y: i < 2 ? 130 : 469
}));
function render(frame) {
  const commands = [], white = '#edeee3', dim = '#a8bdc9', line = '#3f5a6e';
  const rect = (x,y,w,h,fill) => commands.push({ type:'rect', rect:[x,y,w,h], fill });
  const text = (value,x,y,size,color=white) => commands.push({ type:'text', text:value, at:[x,y], scale:size, color });
  rect(0,0,width,height,'#141e2d');
  rect(24,24,27,4,'#97dbcd');
  text('INK STUDIO / CURVE SPLATS',65,20,2,'#97dbcd');
  text('Rig and simulation bindings',21,49,5);
  text('LIVE NATIVE POSES / 172 X 87 ART PIXELS',24,103,2,dim);
  for (const {label,note,color,x,y} of panels) {
    text(label,x,y,3,color);
    text(note,x,y+29,1,dim);
    rect(x-2,y+top-2,w*scale+4,h*scale+4,line);
  }
  rect(23,801,1066,3,line);
  rect(23,801,Math.max(1,1066*frame/(count-1)),3,'#97dbcd');
  const plate = K.procedural.drawing2d.render({ width,height,commands,edges:'hard' });
  const t = .32 + frame/fps;
  for (const { world,x,y } of panels) {
    pose(world,t,{kit});
    const image = ink.render(world,{ raw:true,w,h,px:1,t });
    for (let v=0;v<h*scale;v++) for (let u=0;u<w*scale;u++) {
      const j=(Math.floor(v/scale)*w+Math.floor(u/scale))*3, q=((y+top+v)*width+x+u)*4;
      plate.data[q]=image.rgb[j]; plate.data[q+1]=image.rgb[j+1]; plate.data[q+2]=image.rgb[j+2];
    }
  }
  return PNG.packRGBA(plate);
}
const poster = 8;
if (still) write(path.join(out,'curve-splat-bindings.png'),PNG.encodeFrame(render(poster)));
else {
  const apng=[];
  for(let i=0;i<count;i++) {
    const frame=render(i);
    write(path.join(out,'frames','frame-'+String(i).padStart(3,'0')+'.png'),PNG.encodeFrame(frame));
    if(i===poster) write(path.join(out,'curve-splat-bindings.png'),PNG.encodeFrame(frame));
    if(i%2===0) apng.push(frame);
  }
  write(path.join(out,'curve-splat-bindings-apng.png'),PNG.encodeAnimation(apng,fps/2));
}
console.log('Rendered curve-splat bindings to '+out);
