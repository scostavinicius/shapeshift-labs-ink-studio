const fs=require('node:fs');
const path=require('node:path');
const { render }=require('./render.js');
const { spriteAtlas,writeAtlas,assessmentView }=require('./sprite-atlas.js');
const { write,json }=require('./asset-files.js');
const PNG=require('./png.js');

const embed=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const lanes=['before','corrected','sprite'];
const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;

function atlasFrame(atlas,index) {
  const {metadata,images}=atlas, {x,y,width:w,height:h}=metadata.frames[index].rect;
  const rgb=new Uint8Array(w*h*3), alpha=new Uint8Array(w*h);
  for (let row=0,p=0;row<h;row++) for (let column=0;column<w;column++,p++) {
    const src=((y+row)*metadata.width+x+column)*4;
    rgb.set(images.color.subarray(src,src+3),p*3);
    alpha[p]=images.color[src+3];
  }
  return { w,h,rgb,alpha };
}

function compare(a,b,overlay) {
  let count=0;
  for (let p=0,j=0;p<a.alpha.length;p++,j+=3) {
    const aa=a.alpha[p], ba=b.alpha[p], coverage=Math.abs(aa-ba);
    const difference=Math.max(coverage,Math.abs(a.rgb[j]*aa-b.rgb[j]*ba)/255,
      Math.abs(a.rgb[j+1]*aa-b.rgb[j+1]*ba)/255,Math.abs(a.rgb[j+2]*aa-b.rgb[j+2]*ba)/255);
    if (!difference||overlay&&difference<6) continue;
    count++;
    if (overlay) overlay.set(ba+12<aa ? [243,114,146,155] : [102,235,201,Math.min(187,72+difference)],p*4);
  }
  return count;
}

function review(world,editor,directory,{pose,view,width,height,from,to,fps}) {
  const frames=Math.round((to-from)*fps), assets=editor.assets();
  if (!assets.length) throw new RangeError('Pose corrective review needs at least one active sculpt asset');
  if (!integer(width,16,384)||!integer(height,16,384)||!Number.isFinite(from)||from<0||
    !Number.isFinite(to)||to<=from||to>120||!integer(fps,1,30)||!integer(frames,2,72)||width*height*frames>1.6e6)
    throw new RangeError('Pose corrective review needs a native art grid and 2–72 frames');
  const times=Array.from({length:frames},(_,i)=>from+i/fps), pivot=world.cam.target;
  const settings=assessmentView(world,view({w:width,h:height,t:from}));
  const yaw=settings.yaw??world.cam.yaw, pitch=settings.pitch??world.cam.pitch;
  const capture=t=>{
    pose(world,t);
    return render(world,{...settings,t,w:width,h:height,px:1,ortho:true,transparent:true,
      target:pivot,yaw,pitch,spriteReconstruction:false});
  };
  let before;
  try {
    editor.set([]);
    before=times.map(capture);
  } finally {
    editor.set(assets);
  }
  const corrected=times.map(t=>({ image:capture(t),weights:editor.state() }));
  const atlas=spriteAtlas(world,{width,height,pose,times,fps,pivot,yaw,pitches:[pitch],directions:1,
    columns:Math.min(8,frames),maps:['depth','normal','emission','silhouette'],view:settings});
  const clips=Object.fromEntries(lanes.map(id=>[id,[]])), pictures=[], samples=[];
  for (const [i,time] of times.entries()) {
    const {image,weights}=corrected[i], sprite=atlasFrame(atlas,i);
    const captures={ before:before[i],corrected:image,sprite }, overlay=new Uint8Array(width*height*4);
    const changed=compare(before[i],image,overlay), spriteDifference=compare(image,sprite);
    const picture={ marks:embed(PNG.encode(width,height,overlay,4)) };
    for (const id of lanes) {
      const raster=PNG.packFrame(captures[id]);
      clips[id].push(raster);
      picture[id]=embed(PNG.encodeFrame(raster));
    }
    samples.push({ frame:i,time,weights,changed,spriteDifference });
    pictures.push(picture);
  }

  const report={format:'ink-studio/pose-corrective-review',version:1,title:world.name??'Pose correctives',
    scene:world.id??null,width,height,from,to,fps,samples};
  writeAtlas(path.join(directory,'sprite-atlas'),atlas);
  for (const id of lanes) write(path.join(directory,id+'.png'),PNG.encodeAnimation(clips[id],fps));
  json(path.join(directory,'correctives.json'),assets);
  json(path.join(directory,'review.json'),report);
  const template=fs.readFileSync(path.join(__dirname,'pose-corrective-review.html'),'utf8');
  const data=JSON.stringify({report,pictures}).replaceAll('<','\\u003c');
  write(path.join(directory,'index.html'),template.replace('/*POSE_CORRECTIVE_DATA*/',()=>data));
  return report;
}

module.exports={ review };
