/* Render synchronized native frames, then lay them out for comparison. */
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const { upscale } = require('../cli/render.js');
const { pose } = require('../cli/diarama-pose.js');
const makeScene = require('./tideline-looks.js');
const styles = require('./tideline-looks.json');

if (process.argv.length !== 3) throw new Error('Usage: node examples/render-tideline-looks.cjs <output-directory>');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out,{recursive:true});

const kit = ink.load(), scene = makeScene(kit), font = kit.KIT.inspection.font({});
const width=232, height=140, fps=20, frames=Math.round(makeScene.duration*fps), stillFrame=fps;
const view={w:width,h:height,px:1,raw:true};
const looks=Object.keys(styles);
const notes={
  'ink-wash':'FEATHERED PIGMENT / CONTINUOUS',
  'cut-paper':'CUT EDGES / 8 POSES PER SEC',
  'enamel':'CLEARCOAT / 12 POSES PER SEC',
  'stained-glass':'LEAD AND BACKLIGHT / 6 POSES PER SEC',
  mixed:'INK SKY / PAPER CLIFF / ENAMEL FRAME / GLASS SEA'
};
const colors=[[199,173,127],[231,169,111],[237,199,128],[181,159,232]];
const reports=looks.map(id=>({id,label:styles[id].label,rate:styles[id].cadence,poseTimes:[],ferry:[]}));

function renderAt(world,time) {
  let camera;
  pose(world,time,{kit});
  const frame=ink.render(world,{...view,t:time,cameraFrame:value=>{camera=value.pose;}});
  return {frame,camera};
}

function canvas(w,h) {
  const rgb=new Uint8Array(w*h*3);
  for (let i=0;i<rgb.length;i+=3) rgb.set([16,24,33],i);
  return {w,h,rgb};
}

function caption(image,x,y,text,color=[218,226,224],scale=1) {
  for (const [i,ch] of [...text].entries()) {
    const glyph=font.get(ch);
    for (let v=0;v<7;v++) for (let u=0;u<6;u++) {
      if (!glyph?.[v*6+u]) continue;
      for (let j=0;j<scale;j++) for (let k=0;k<scale;k++)
        image.rgb.set(color,((y+v*scale+j)*image.w+x+(i*6+u)*scale+k)*3);
    }
  }
}

function paste(image,frame,x,y) {
  for (let row=0;row<frame.h;row++)
    image.rgb.set(frame.rgb.subarray(row*frame.w*3,(row+1)*frame.w*3),((y+row)*image.w+x)*3);
}

function comparison(images,time) {
  const image=canvas(952,680);
  caption(image,12,11,'TIDELINE SIGNAL',[230,225,207],2);
  caption(image,12,34,'ONE SHOT / FOUR AUTHORED TREATMENTS / 232 X 140 ART PIXELS');
  caption(image,828,15,time.toFixed(2)+' SEC',[230,225,207]);
  for (const [i,id] of looks.entries()) {
    const x=12+i%2*472, y=54+Math.floor(i/2)*308;
    caption(image,x,y,styles[id].label.toUpperCase(),colors[i]);
    caption(image,x+158,y,notes[id],[166,183,186]);
    paste(image,upscale(images[i],2),x,y+14);
  }
  return image;
}

function save(file,image) { PNG.write(path.join(out,file),image.w,image.h,image.rgb); }
const worlds = looks.map(look=>scene.build(scene.seed,{controls:{look}}));
const clips=worlds.map(()=>[]), boards=[], times=[], cameras=[];
for (let k=0;k<frames;k++) {
  const time=k/fps, images=[];
  times.push(time);
  for (const [i,world] of worlds.entries()) {
    const {frame,camera}=renderAt(world,time);
    if (!camera || frame.w!==width || frame.h!==height) throw new Error('The review needs a camera on the native grid');
    if (!i) cameras.push(camera);
    else if (JSON.stringify(cameras[k])!==JSON.stringify(camera)) throw new Error('Look variants sampled different cameras');
    reports[i].poseTimes.push(world.clock);
    reports[i].ferry.push(world.anim.rig.at('ferry',[0,-.93,.83]));
    clips[i].push(frame);
    images.push(frame);
  }
  boards.push(comparison(images,time));
}
save('tideline-comparison.png',boards[stillFrame]);
PNG.animate(path.join(out,'tideline-comparison.apng'),boards,fps);
for (const [i,id] of looks.entries()) {
  save(id+'.png',clips[i][stillFrame]);
  PNG.animate(path.join(out,id+'.apng'),clips[i],fps);
  reports[i].distinctPoses=new Set(reports[i].poseTimes).size;
}
const mixed=renderAt(scene.build(scene.seed,{controls:{look:'mixed'}}),1).frame;
const combination=canvas(720,485);
caption(combination,12,13,'TIDELINE SIGNAL / MIXED MATERIALS',[230,225,207],2);
caption(combination,12,41,notes.mixed);
paste(combination,upscale(mixed,3),12,56);
save('mixed.png',mixed);
save('tideline-mixed.png',combination);
fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({width,height,fps,times,cameras,looks:reports},null,2)+'\n');
console.log(reports.map(({label,distinctPoses})=>label+' '+distinctPoses+' poses').join(' / '));
