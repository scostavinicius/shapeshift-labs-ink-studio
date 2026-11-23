const fs = require('node:fs');
const path = require('node:path');
const { render } = require('./render.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const lanes = ['depth','object','native'];
const integer = (n,a,b) => Number.isSafeInteger(n) && n>=a && n<=b;
const embed = data => 'data:image/png;base64,'+data.toString('base64');

function collectEdges(passes, subject, reference, baseline, guided) {
  const { w,h,objectId:ids,objects } = passes;
  const selected = subject === undefined ? null : objects.findIndex(id=>id!=null && String(id)===subject);
  if (selected === -1) throw new RangeError('Fog review subject is not a named object in the frame: '+subject);
  const overlay=new Uint8Array(w*h*4);
  let x0=w, y0=h, x1=-1, y1=-1, edgePixels=0, correctedPixels=0, depthError=0, objectError=0;
  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    const owner=ids[p];
    if (!owner || selected!==null && owner!==selected) continue;
    x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y);
    if ((!x || ids[p-1]===owner) && (x+1===w || ids[p+1]===owner) &&
        (!y || ids[p-w]===owner) && (y+1===h || ids[p+w]===owner)) continue;
    edgePixels++;
    const deltaDepth=Math.abs(baseline[p]-reference[p]), deltaObject=Math.abs(guided[p]-reference[p]);
    depthError+=deltaDepth;
    objectError+=deltaObject;
    if (deltaDepth>=.04 && deltaDepth-deltaObject>=.03) {
      correctedPixels++;
      overlay.set([246,117,85,Math.round(70+Math.min(1,deltaDepth)*145)],p*4);
    }
  }
  const crop = selected!==null && x1>=x0 ? cropAround(w,h,x0,y0,x1,y1) : null;
  return { overlay,crop,edgePixels,correctedPixels,
    depthError:depthError/Math.max(1,edgePixels),objectError:objectError/Math.max(1,edgePixels) };
}

function cropAround(width,height,x0,y0,x1,y1) {
  const h=Math.min(height,Math.max(30,Math.ceil((y1-y0+1)*1.42)));
  const w=Math.min(width,Math.max(30,Math.ceil(h*.93),x1-x0+17));
  const x=Math.max(0,Math.min(width-w,Math.round((x0+x1-w+1)/2)));
  const y=Math.max(0,Math.min(height-h,Math.round((y0+y1-h+1)/2)));
  return { x,y,w,h };
}

function review(world, directory, { pose,view,width,height,from,to,fps,scale,subject }) {
  const frames=Math.round((to-from)*fps);
  if (!integer(width,16,512) || !integer(height,16,512) || !Number.isFinite(from) || from<0 ||
      !Number.isFinite(to) || to<=from || to>120 || !integer(fps,1,30) || !integer(frames,2,72) ||
      width*height*frames>1.8e6 || !integer(scale,2,4))
    throw new RangeError('Fog review needs a native art grid, a scale from 2–4 and 2–72 frames');
  const movies=Object.fromEntries(lanes.map(id=>[id,[]])), pictures=[], samples=[];
  for (let i=0;i<frames;i++) {
    const time=from+i/fps;
    pose(world,time);
    const sample = view({ w:width,h:height,t:time });
    const options = { ...sample,px:1,captureFog:true,composite:false,renderGraph:false,renderGrid:false,
      inspection:false,shutter:false,cameraGuides:false,motionalCoverage:false };
    const lane = (factor,reconstruction,passes) => render(world,{ ...options,passes,
      volumeQuality:{ ...options.volumeQuality,scale:factor,reconstruction,stats:true } });
    const captures={ native:lane(1,'object',['objectId']), depth:lane(scale,'depth'), object:lane(scale,'object') };
    if (lanes.some(id=>!captures[id].fog || captures[id].volumeStats?.mode!==id ||
      captures[id].w!==width || captures[id].h!==height))
      throw new RangeError('Fog review requires bounded fog in the opaque native pass');
    const { overlay,crop,...edges }=collectEdges(captures.native.passes,subject,
      captures.native.fog,captures.depth.fog,captures.object.fog);
    const picture={ mark:embed(PNG.encode(width,height,overlay,4)) };
    const renderStats={};
    for (const id of lanes) {
      const image=PNG.packFrame(captures[id]);
      movies[id].push(image);
      picture[id]=embed(PNG.encodeFrame(image));
      renderStats[id]=captures[id].volumeStats;
    }
    samples.push({ frame:i,time,crop,...edges,renderStats });
    pictures.push(picture);
  }

  // Track the subject with a fixed-size crop so stepping through the shot keeps the same magnification.
  const cropWidth=Math.max(...samples.map(sample=>sample.crop?.w ?? 0));
  const cropHeight=Math.max(...samples.map(sample=>sample.crop?.h ?? 0));
  for (const {crop} of samples) if (crop) {
    crop.x=Math.max(0,Math.min(width-cropWidth,crop.x-Math.floor((cropWidth-crop.w)/2)));
    crop.y=Math.max(0,Math.min(height-cropHeight,crop.y-Math.floor((cropHeight-crop.h)/2)));
    crop.w=cropWidth;
    crop.h=cropHeight;
  }
  const report={ format:'ink-studio/fog-reconstruction-review', version:1, title:world.name??'Fog reconstruction',
    scene:world.id??null,subject:subject??null,width,height,from,to,fps,scale,samples };
  for (const id of lanes) write(path.join(directory,id+'.png'),PNG.encodeAnimation(movies[id],fps));
  json(path.join(directory,'review.json'),report);
  const source=fs.readFileSync(path.join(__dirname,'fog-reconstruction-review.html'),'utf8');
  const data=JSON.stringify({report,pictures}).replaceAll('<','\\u003c');
  write(path.join(directory,'index.html'),source.replace('/*FOG_REVIEW_DATA*/',()=>data));
  return report;
}

module.exports = { review };
