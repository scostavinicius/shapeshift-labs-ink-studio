const fs = require('node:fs');
const path = require('node:path');
const Atlas = require('../src/atlas-sprites.js');
const { spriteAtlas, writeAtlas, assessmentView, assessAtlas } = require('./sprite-atlas.js');
const { compare, gaps } = require('./impostor-error.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const embed=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const lanes=['source','uniform','adaptive'];

function review(world, adaptive, options, directory) {
  const { metadata }=adaptive, plan=metadata.adaptiveViews, ring=plan?.rings[0];
  if (plan?.rings.length!==1 || options.times.length!==1)
    throw new RangeError('Visible-error review requires a single pose and elevation');
  const { width:w,height:h,pivot,view,pose,times:[time] }=options, pitch=ring.pitch;
  const directions=ring.yaws.length, anchor=ring.yaws[0], fps=12;
  const registered=assessmentView(world,view);
  const uniform=spriteAtlas(world,{...options,adaptive:false,view:registered,yaw:anchor,directions,
    columns:directions,pitches:[pitch]});
  pose?.(world,time);

  const images={ uniform,adaptive };
  const compiled=Object.fromEntries(Object.entries(images).map(([id,value])=>[id,Atlas.compile(value)]));
  const tiles=new Map();
  const protections=new Map();
  function direct(yaw) {
    return assessAtlas(world,registered,{yaw,pitch},pivot,w,h,time,plan.protect);
  }
  function prediction(id,direction) {
    const view=compiled[id].select(0,'impostor',direction), { yaw,rect }=view;
    if (tiles.has(view)) return tiles.get(view);
    if (!protections.has(yaw)) protections.set(yaw,direct(yaw).protect);
    const sheet=images[id], alpha=new Uint8Array(w*h), rgb=new Uint8Array(w*h*3);
    for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
      const s=((rect.y+y)*sheet.metadata.width+rect.x+x)*4;
      alpha[p]=sheet.images.color[s+3];
      for (let c=0;c<3;c++) rgb[p*3+c]=sheet.images.color[s+c];
    }
    const tile={ w,h,rgb,alpha,yaw,protect:protections.get(yaw) };
    tile.gaps=gaps(tile);
    tiles.set(view,tile);
    return tile;
  }

  const count=Math.min(60,plan.probes), frames=[], pictures=[], clips=Object.fromEntries(lanes.map(id=>[id,[]]));
  const tally=Object.fromEntries(lanes.slice(1).map(id=>[id,{ score:0,silhouette:0,gaps:0,highlight:0,max:0 }]));
  for (let i=0;i<count;i++) {
    const yaw=anchor+(Math.floor(i*plan.probes/count)+.5)*Math.PI*2/plan.probes;
    const direction=Atlas.basis(yaw,pitch).normal;
    const source=direct(yaw), frame={ yaw,protectedPixels:source.protect.reduce((sum,p)=>sum+p,0) }, picture={};
    for (const id of lanes) {
      const variant=id==='source'?source:prediction(id,direction);
      const raster=PNG.packFrame(variant);
      clips[id].push(raster);
      picture[id]=embed(PNG.encodeFrame(raster));
      if (id==='source') continue;
      const mark=new Uint8Array(w*h*4), error=compare(source,variant,mark), result=tally[id];
      result.max=Math.max(result.max,error.score);
      for (const key of Object.keys(error)) result[key]+=error[key]/count;
      frame[id]={ yaw:variant.yaw,...error };
      picture[id+'Error']=embed(PNG.encode(w,h,mark,4));
    }
    frames.push(frame);
    pictures.push(picture);
  }
  const report={ format:'ink-studio/impostor-view-review',version:1,
    title:world.name??'Visible-error impostor bake',scene:world.id??null,width:w,height:h,
    time,pitch,baseYaw:anchor,fps,directions,assessment:plan,
    angles:{ uniform:uniform.metadata.frames.map(frame=>frame.yaw),adaptive:ring.yaws },
    heldOut:{ count,uniform:tally.uniform,adaptive:tally.adaptive },frames };
  json(path.join(directory,'review.json'),report);
  writeAtlas(path.join(directory,'uniform-atlas'),uniform);
  for (const id of lanes) write(path.join(directory,id+'.png'),PNG.encodeAnimation(clips[id],fps));
  const template=fs.readFileSync(path.join(__dirname,'impostor-view-review.html'),'utf8');
  const payload=JSON.stringify({report,pictures}).replaceAll('<','\\u003c');
  write(path.join(directory,'index.html'),template.replace('/*IMPOSTOR_VIEW_DATA*/',()=>payload));
  return report;
}

module.exports = { review };
