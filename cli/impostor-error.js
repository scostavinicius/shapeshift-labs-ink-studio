const TargetSelectors = require('../src/target-selectors.js');
const ArtStability = require('../src/art-stability.js');

const covered = alpha => alpha >= 128;
const weights = Object.freeze({ silhouette:.52, gaps:.30, highlight:.18 });

function gaps({ w,h,alpha }) {
  const size=w*h, outside=new Uint8Array(size), queue=new Int32Array(size), result=new Uint8Array(size);
  let tail=0;
  function visit(p) {
    if (outside[p] || covered(alpha[p])) return;
    outside[p]=1;
    queue[tail++]=p;
  }
  for (let x=0;x<w;x++) { visit(x); visit((h-1)*w+x); }
  for (let y=1;y<h-1;y++) { visit(y*w); visit(y*w+w-1); }
  for (let head=0;head<tail;head++) {
    const p=queue[head], x=p%w;
    if (x) visit(p-1);
    if (x+1<w) visit(p+1);
    if (p>=w) visit(p-w);
    if (p+w<size) visit(p+w);
  }
  // The exterior pass finds closed holes. Opposing coverage also finds narrow open slits and notches.
  function opposing(p,negative,positive,stride) {
    let a=1,b=1;
    while (a<=negative && a<=3 && !covered(alpha[p-a*stride])) a++;
    while (b<=positive && b<=3 && !covered(alpha[p+b*stride])) b++;
    return a<=negative && b<=positive && a+b<=4;
  }
  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    if (!covered(alpha[p]) && (!outside[p] || opposing(p,x,w-1-x,1) || opposing(p,y,h-1-y,w))) result[p]=1;
  }
  return result;
}

function protectMask(frame, world, view, selectors) {
  const { w,h,alpha,passes }=frame;
  const mask=new Uint8Array(w*h);
  const stable=ArtStability.prepare(world.look?.stable,view.stable,view.ditherSpace);
  const index=selectors.length ? TargetSelectors.index(world) : null;
  const cache=new Map();
  function matches(p) {
    const row=(passes.splatId?.[p] ?? 0)-1;
    if (row>=0) {
      if (!cache.has(row)) cache.set(row,selectors.some(rule=>TargetSelectors.matches(rule,index.row(row))));
      return cache.get(row);
    }
    const object=passes.objects?.[passes.objectId?.[p]], material=passes.materials?.[passes.materialId?.[p]];
    return selectors.some(rule=>TargetSelectors.matches(rule,{ object,entity:object,material }));
  }
  for (let p=0;p<mask.length;p++) {
    if (!alpha[p]) continue;
    const e=p*3;
    if (passes.protected?.[p] || ArtStability.protectedPixel(stable,passes,p) ||
      Math.max(passes.emission[e],passes.emission[e+1],passes.emission[e+2])>.12 || index && matches(p)) mask[p]=1;
  }
  return mask;
}

function frameSample(frame, world, view, selectors) {
  const { w,h,rgb,alpha }=frame;
  if (!alpha || alpha.length!==w*h || !frame.passes?.emission)
    throw new Error('Visible-error views need a native transparent capture with art passes');
  return { w,h,rgb,alpha,gaps:gaps(frame),protect:protectMask(frame,world,view,selectors) };
}

function compare(a,b, overlay) {
  let union=0, outline=0, gapArea=0, gapError=0, protectArea=0, highlightError=0;
  for (let p=0,j=0;p<a.alpha.length;p++,j+=3) {
    const aa=a.alpha[p], ba=b.alpha[p], solidA=covered(aa), solidB=covered(ba);
    const gap=a.gaps[p] || b.gaps[p], protect=a.protect[p] || b.protect[p];
    union+=Math.max(aa,ba)/255;
    gapArea+=gap;
    protectArea+=protect;
    const delta=Math.abs(aa-ba)/255;
    if (gap) gapError+=Number(solidA!==solidB);
    else outline+=delta;
    let highlight=0;
    if (protect) {
      highlight=Math.max(delta,Math.abs(a.rgb[j]*aa-b.rgb[j]*ba)/65025,
        Math.abs(a.rgb[j+1]*aa-b.rgb[j+1]*ba)/65025,Math.abs(a.rgb[j+2]*aa-b.rgb[j+2]*ba)/65025);
      highlightError+=highlight;
    }
    if (!overlay) continue;
    if (gap && solidA!==solidB) overlay.set([248,109,164,201],p*4);
    else if (highlight>.16) overlay.set([255,192,92,Math.round(100+highlight*118)],p*4);
    else if (delta>.18) overlay.set([70,219,236,Math.round(80+delta*132)],p*4);
  }
  const silhouette=outline/Math.max(1,union), gap=gapError/Math.max(16,gapArea), highlight=highlightError/Math.max(8,protectArea);
  return { silhouette,gaps:gap,highlight,score:weights.silhouette*silhouette+weights.gaps*gap+weights.highlight*highlight };
}

module.exports = { compare, frameSample, gaps, weights };
