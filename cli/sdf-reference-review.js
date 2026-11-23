const fs = require('node:fs');
const path = require('node:path');
const { render, cameraCapture } = require('./render.js');
const { trace } = require('./sdf-path-trace.js');
const { clamp } = require('./sdf-reference-field.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const integer = (n,a,b) => Number.isSafeInteger(n) && n>=a && n<=b;
const finite = (n,a,b) => Number.isFinite(n) && n>=a && n<=b;
const diagnosticMaps = ['coverage','geometry','shading','spacing','sampling'];
const settingsFor = ({ width,height,times,samples = 32,bounces = 3,epsilon = .001,steps = 160,seed = 1,exposure = 1 }) => {
  if (!integer(width,8,512) || !integer(height,8,512) || !Array.isArray(times) || !integer(times.length,1,12) ||
      times.some(t=>!finite(t,0,3600)) || new Set(times).size !== times.length)
    throw new RangeError('SDF reference needs an 8–512 pixel grid and 1–12 distinct frame times in 0–3600 seconds');
  if (!integer(samples,4,256) || samples%2 || width*height*times.length*samples>6e6)
    throw new RangeError('Use an even 4–256 samples per pixel and at most 6 million primary samples per review');
  if (!integer(bounces,0,6) || !finite(epsilon,.0001,.02) || !integer(steps,32,512) ||
      !integer(seed,0,0xffffffff) || !finite(exposure,.05,8))
    throw new RangeError('SDF reference needs 0–6 bounces, 32–512 steps, epsilon .0001–.02, an unsigned 32-bit seed and exposure .05–8');
  return { width,height,times,samples,bounces,epsilon,steps,seed,exposure };
};

function compare(splat, reference, camera, settings) {
  const size = reference.w*reference.h;
  const maps = Object.fromEntries(diagnosticMaps.map(key=>[key,new Uint8Array(size*4)]));
  const stats = { referencePixels:0, missingCoverage:0, extraCoverage:0, unretainedForeground:0,
    depthMismatch:0, normalMismatch:0, comparableShading:0, meanShadingDifference:0,
    sparseSampling:0, unsupportedSampling:0, unstableSampling:0 };
  const passes = splat.passes;
  const dotNormals = (i,n) => n[i]*passes.normal[i]+n[i+1]*passes.normal[i+1]+n[i+2]*passes.normal[i+2];
  const mark = (key,p,color,alpha) => maps[key].set([...color,Math.round(clamp(alpha,0,255))],p*4);
  for (let p=0;p<size;p++) {
    const i=p*3, depth=reference.depth[p], z=passes.depth[p], hit=Number.isFinite(depth);
    const inScope = Boolean(reference.rows[passes.splatId[p]-1]);
    const pixelWidth=2*camera.tangent*(camera.ortho ? 1 : hit ? depth : camera.distance)/reference.h;
    const tolerance=Math.max(settings.epsilon*6,pixelWidth*1.4);
    if (hit) stats.referencePixels++;
    const noise=reference.sampling[p];
    if (noise>=.08) {
      stats.unstableSampling++;
      mark('sampling',p,[255,171,72],56+noise*305);
    }
    // An out-of-scope foreground can cover reference surfaces. Keep it out of the numeric comparisons.
    if (!inScope && Number.isFinite(z) && (!hit || z<=depth+tolerance)) {
      stats.unretainedForeground++;
      mark('coverage',p,[173,184,200],99);
      continue;
    }
    if (hit && reference.spacing[p]>pixelWidth*1.35) {
      if (Number.isFinite(reference.spacing[p])) {
        stats.sparseSampling++;
        mark('spacing',p,[154,125,247],64+reference.spacing[p]/pixelWidth*45);
      } else {
        stats.unsupportedSampling++;
        mark('spacing',p,[232,201,255],215);
      }
    }
    const nativeCoverage = inScope ? (passes.surfaceCoverage[p] || passes.coverage[p]) : Number.isFinite(z) ? 0 : passes.coverage[p];
    const delta=reference.coverage[p]-nativeCoverage;
    if (delta>=.28) {
      stats.missingCoverage++;
      mark('coverage',p,[80,213,245],55+delta*188);
    } else if (delta<=-.28 && inScope) {
      stats.extraCoverage++;
      mark('coverage',p,[255,109,148],55-delta*188);
    }
    if (!hit || !inScope || !Number.isFinite(z) || Math.abs(delta)>=.28) continue;
    const depthError=Math.abs(depth-z), normal=passes.normal;
    const cosine=normal && Math.hypot(normal[i],normal[i+1],normal[i+2])>.5 ? dotNormals(i,reference.normals) : 1;
    if (depthError>tolerance) {
      stats.depthMismatch++;
      mark('geometry',p,[255,162,83],80+depthError/tolerance*34);
    }
    if (cosine<.83) {
      stats.normalMismatch++;
      if (depthError<=tolerance) mark('geometry',p,[149,143,255],65+(1-cosine)*230);
    }
    if (depthError>tolerance || cosine<.83) continue;
    stats.comparableShading++;
    const difference=Math.max(Math.abs(splat.rgb[i]-reference.rgb[i]),
      Math.abs(splat.rgb[i+1]-reference.rgb[i+1]),Math.abs(splat.rgb[i+2]-reference.rgb[i+2]));
    stats.meanShadingDifference += difference/255;
    if (difference>=16) mark('shading',p,[247,192,108],40+difference*1.4);
  }
  stats.meanShadingDifference /= Math.max(1,stats.comparableShading);
  return { maps, stats };
}

function review(world, directory, { pose,view,...values }) {
  const settings = settingsFor(values);
  const { width:w,height:h,times } = settings;
  const frames=[], pictures=[];
  for (const [i,t] of times.entries()) {
    pose(world,t);
    const options = { ...view({ w,h,t }), px:1,sdfAssist:false,composite:false,renderGraph:false,renderGrid:false,
      inspection:false,shutter:false,cameraGuides:false,motionalCoverage:false,
      passes:['coverage','surfaceCoverage','splatId','depth','normal'] };
    let camera;
    const splats=render(world,{ ...options,...cameraCapture(options,value=>{ camera=value; }) });
    if (!camera || camera.width!==w || camera.height!==h || splats.w!==w || splats.h!==h)
      throw new Error('SDF reference requires a native render with a shared pinhole or orthographic camera');
    const reference=trace(world,options,camera,settings);
    const { maps,stats }=compare(splats,reference,camera,settings);
    const images = { splats: PNG.encode(w,h,splats.rgb), reference: PNG.encode(w,h,reference.rgb) };
    for (const [key,data] of Object.entries(maps)) images[key]=PNG.encode(w,h,data,4);
    for (const key of ['indirect','transmission']) images[key]=PNG.encode(w,h,reference[key]);
    const files={}, frame={ time:t,stats:{ ...reference.stats,...stats },files };
    const picture={};
    for (const [key,bytes] of Object.entries(images)) {
      files[key]=`frame-${String(i+1).padStart(2,'0')}-${key}.png`;
      write(path.join(directory,files[key]),bytes);
      picture[key]='data:image/png;base64,'+bytes.toString('base64');
    }
    frames.push(frame);
    pictures.push(picture);
  }

  const report = { format:'ink-studio/sdf-reference', version:1, title:world.name ?? 'SDF path-traced reference',
    scene:world.id ?? null, settings, frames };
  json(path.join(directory,'review.json'),report);
  const source=fs.readFileSync(path.join(__dirname,'sdf-reference-review.html'),'utf8');
  const data=JSON.stringify({ report,pictures }).replaceAll('<','\\u003c');
  write(path.join(directory,'index.html'),source.replace('/*REFERENCE_DATA*/',()=>data));
  return report;
}

module.exports = { review,settingsFor };
