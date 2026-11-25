const {toOKLab} = require('../src/color-space.js');

const radix = 0x1000000;
const marks = {palette:1,accents:2,flicker:4};
const color = value=>typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value);
const packed = (bytes,at)=>bytes[at]*65536+bytes[at+1]*256+bytes[at+2];
const unpack = value=>[value>>16,value>>8&255,value&255];
const hex = value=>'#'+value.toString(16).padStart(6,'0');
const size = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const range = (value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const fields = (value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(key=>keys.includes(key));
const label = value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
const check = (condition,message)=>{if (!condition) throw new TypeError(message);};
const pairKey = (a,b)=>Math.min(a,b)*radix+Math.max(a,b);
const position = (p,w)=>[p%w,Math.floor(p/w)];

function prepare(spec) {
  function section(value,keys,defaults,test) {
    if (value===false) return null;
    check(value===undefined||fields(value,keys),'Invalid video approval check settings');
    const rules = {...defaults,...value};
    test(rules);
    return rules;
  }
  const palette = section(spec.palette,['pairs','minRetained','minContacts','maxDamagedShare'],
    {minRetained:.5,minContacts:2,maxDamagedShare:.12},rules=>{
      const {pairs,minRetained,minContacts,maxDamagedShare} = rules;
      check(range(minRetained,.05,1)&&size(minContacts,1,1000000)&&range(maxDamagedShare,0,.999),
        'Invalid palette retention or contact thresholds');
      if (pairs===undefined) return;
      check(Array.isArray(pairs)&&size(pairs.length,1,64),'Use one to 64 protected palette pairs');
      const ids = new Set(), colors = new Set();
      rules.pairs = pairs.map(row=>{
        check(fields(row,['id','colors'])&&label(row.id)&&!ids.has(row.id)&&Array.isArray(row.colors)&&
          row.colors.length===2&&row.colors.every(color),'A protected palette pair needs an ID and two hex swatches');
        const values = row.colors.map(value=>parseInt(value.slice(1),16)), key = pairKey(...values);
        check(values[0]!==values[1]&&!colors.has(key),'Palette pairs must use distinct swatches and pairs');
        ids.add(row.id);
        colors.add(key);
        return {id:row.id,colors:values,key};
      });
    });
  const accents = section(spec.accents,['colors','minSourceContrast','minChromaContrast','minRetained','maxBleed'],
    {minSourceContrast:.10,minChromaContrast:.08,minRetained:.55,maxBleed:.24},rules=>{
      check(range(rules.minSourceContrast,.025,1)&&range(rules.minChromaContrast,.025,1)&&
        range(rules.minRetained,.05,1)&&range(rules.maxBleed,0,1),
        'Invalid one-pixel accent thresholds');
      if (rules.colors===undefined) return;
      check(Array.isArray(rules.colors)&&size(rules.colors.length,1,64)&&rules.colors.every(color),
        'Accent colors need one to 64 hex swatches');
      rules.colors = new Set(rules.colors.map(value=>parseInt(value.slice(1),16)));
    });
  const flicker = section(spec.flicker,['minChange','sourceTolerance','returnTolerance','minPixels'],
    {minChange:12,sourceTolerance:2,returnTolerance:5,minPixels:2},rules=>{
      check(size(rules.minChange,1,255)&&size(rules.sourceTolerance,0,Math.min(16,rules.minChange-1))&&
        size(rules.returnTolerance,0,rules.minChange-1)&&size(rules.minPixels,1,4200000),
      'Invalid flicker amplitude, tolerance or pixel threshold');
    });
  check(palette||accents||flicker,'Enable at least one video approval check');
  return {palette,accents,flicker};
}

function displayColor() {
  const cache = new Map();
  return value=>{
    let lab = cache.get(value);
    if (!lab) {
      if (cache.size>=65536) cache.clear();
      lab = toOKLab(unpack(value).map(value=>value/255));
      cache.set(value,lab);
    }
    return lab;
  };
}
const vector = (a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot = (a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const projection = (a,b,axis,length)=>dot(vector(a,b),axis)/length;
const average = (a,b)=>[(a[0]+b[0])*.5,(a[1]+b[1])*.5,(a[2]+b[2])*.5];

function frequentSwatches(rgb) {
  const counts = new Map(), count = rgb.length/3, step = Math.max(1,Math.ceil(count/65536));
  for (let p=0;p<count;p+=step) {
    const value = packed(rgb,p*3);
    counts.set(value,(counts.get(value)??0)+1);
  }
  return [...counts.entries()].filter(([,count])=>count>=4)
    .sort(([ca,a],[cb,b])=>b-a||ca-cb).slice(0,12).map(([value])=>value);
}

function paletteCheck({w,h,source,art,mask},settings,lab) {
  if (!settings) return null;
  const colors = settings.pairs?[...new Set(settings.pairs.flatMap(pair=>pair.colors))]:frequentSwatches(source);
  const swatches = new Map(colors.map(value=>[value,{sums:[0,0,0],count:0,first:0}]));
  const pairs = new Map();
  function add(pair) {
    const axis = vector(lab(pair.colors[0]),lab(pair.colors[1])), length = dot(axis,axis);
    if (settings.pairs||length>=.025**2) pairs.set(pair.key,{...pair,axis,length,contacts:0,losses:0,worst:null,locations:[]});
  }
  if (settings.pairs) for (const pair of settings.pairs) add(pair);
  else for (const [index,a] of colors.entries()) for (const b of colors.slice(index+1))
    add({id:hex(a)+' / '+hex(b),colors:[a,b],key:pairKey(a,b)});
  if (!pairs.size) return {sampled:0,observed:[],failures:[]};
  function contact(p,q,a,b) {
    if (a===b||!swatches.has(b)) return;
    const row = pairs.get(pairKey(a,b));
    if (!row) return;
    const [i,j] = a===row.colors[0]?[p,q]:[q,p];
    const x = packed(art,i*3), y = packed(art,j*3);
    const retained = projection(lab(x),lab(y),row.axis,row.length);
    row.contacts++;
    if (retained>=settings.minRetained) return;
    row.losses++;
    if (row.locations.length<96) row.locations.push(i,j);
    if (!row.worst||retained<row.worst.retained)
      row.worst = {at:[position(i,w),position(j,w)],decodedColors:[hex(x),hex(y)],retained};
  }
  for (let p=0;p<w*h;p++) {
    const i=p*3, a=packed(source,i), swatch=swatches.get(a);
    if (!swatch) continue;
    if (!swatch.count) swatch.first=p;
    swatch.count++;
    for (let k=0;k<3;k++) swatch.sums[k]+=art[i+k];
    if (p%w<w-1) contact(p,p+1,a,packed(source,i+3));
    if (p+w<w*h) contact(p,p+w,a,packed(source,i+w*3));
  }
  const failures = [], observed = [];
  let sampled=0;
  for (const row of pairs.values()) {
    const {id,colors,contacts,losses,worst,locations,axis,length} = row;
    const swatch = colors.map(value=>swatches.get(value));
    const mean = settings.pairs&&swatch.every(value=>value.count);
    const local = contacts>=settings.minContacts;
    if (!mean&&!local) continue;
    sampled++;
    if (settings.pairs) observed.push(id);
    const means = mean?swatch.map(value=>toOKLab(value.sums.map(sum=>sum/value.count/255))):null;
    const meanRetained = means?projection(...means,axis,length):null;
    const damagedShare = contacts?losses/contacts:0;
    const edgeFailure = local&&damagedShare>settings.maxDamagedShare;
    const swatchFailure = meanRetained!==null&&meanRetained<settings.minRetained;
    if (!edgeFailure&&!swatchFailure) continue;
    if (edgeFailure) for (const point of locations) mask[point]|=marks.palette;
    if (swatchFailure&&!edgeFailure) for (const point of swatch.map(value=>value.first)) mask[point]|=marks.palette;
    failures.push({id,colors:colors.map(hex),contacts,damagedContacts:losses,damagedShare,meanRetained,worst,
      ...(swatchFailure&&{sampleAt:swatch.map(value=>position(value.first,w))})});
  }
  return {sampled,observed,failures};
}

function accentCheck({w,h,source,art,mask},settings,lab) {
  if (!settings) return null;
  let sampled=0, damaged=0, worst=null, worstLoss=0;
  const threshold=settings.minSourceContrast**2;
  function at(p,d,extendsToSecond,center) {
    const q=packed(source,(p-d)*3);
    if (q===center||q!==packed(source,(p+d)*3)) return;
    const axis=vector(lab(center),lab(q)), length=dot(axis,axis);
    if (length<threshold) return;
    const mid=lab(packed(art,p*3)), near=average(lab(packed(art,(p-d)*3)),lab(packed(art,(p+d)*3)));
    const contrast=projection(mid,near,axis,length);
    const chroma=[0,axis[1],axis[2]], chromaLength=dot(chroma,chroma);
    const chromaRetained=chromaLength>=settings.minChromaContrast**2?projection(mid,near,chroma,chromaLength):null;
    const retained=chromaRetained===null?contrast:Math.min(contrast,chromaRetained);
    let bleed=0;
    if (extendsToSecond&&q===packed(source,(p-2*d)*3)&&q===packed(source,(p+2*d)*3)) {
      const outer=average(lab(packed(art,(p-2*d)*3)),lab(packed(art,(p+2*d)*3)));
      bleed=Math.max(0,projection(near,outer,axis,length),chromaRetained===null?0:projection(near,outer,chroma,chromaLength));
    }
    return {retained,contrastRetained:contrast,chromaRetained,bleed,axis:d===1?'horizontal':'vertical'};
  }
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const p=y*w+x, center=packed(source,p*3);
    if (settings.colors&&!settings.colors.has(center)) continue;
    const horizontal=x>0&&x<w-1?at(p,1,x>1&&x<w-2,center):null;
    const vertical=y>0&&y<h-1?at(p,w,y>1&&y<h-2,center):null;
    if (!horizontal&&!vertical) continue;
    sampled++;
    let hit=false;
    for (const result of [horizontal,vertical]) {
      if (!result) continue;
      const loss=Math.max(settings.minRetained-result.retained,result.bleed-settings.maxBleed);
      if (loss<=0) continue;
      hit=true;
      if (loss>worstLoss) {
        worst={at:[x,y],sourceColor:hex(center),decodedColor:hex(packed(art,p*3)),...result};
        worstLoss=loss;
      }
    }
    if (hit) { damaged++; mask[p]|=marks.accents; }
  }
  return {sampled,damaged,worst};
}

function flickerCheck(a,b,c,settings) {
  if (!settings) return null;
  const {sourceTolerance,minChange,returnTolerance,minPixels}=settings;
  let held=0, affected=0, worst=null, maximum=0;
  for (let p=0;p<b.w*b.h;p++) {
    const i=p*3;
    let stable=true;
    for (let k=i;k<i+3;k++) {
      const min=Math.min(a.source[k],b.source[k],c.source[k]), max=Math.max(a.source[k],b.source[k],c.source[k]);
      if (max-min>sourceTolerance) { stable=false; break; }
    }
    if (!stable) continue;
    held++;
    let swing=0;
    for (let k=i;k<i+3;k++) {
      const first=a.art[k]-a.source[k], middle=b.art[k]-b.source[k], last=c.art[k]-c.source[k];
      const up=middle-first, down=middle-last;
      if (Math.sign(up)!==Math.sign(down)||Math.abs(first-last)>returnTolerance) continue;
      swing=Math.max(swing,Math.min(Math.abs(up),Math.abs(down)));
    }
    if (swing<minChange) continue;
    affected++;
    b.mask[p]|=marks.flicker;
    if (swing>maximum) {
      maximum=swing;
      worst={at:position(p,b.w),swing,source:[a,b,c].map(frame=>hex(packed(frame.source,i))),
        decoded:[a,b,c].map(frame=>hex(packed(frame.art,i)))};
    }
  }
  if (affected<minPixels) {
    if (affected) for (let i=0;i<b.mask.length;i++) b.mask[i]&=~marks.flicker;
    return {held,affected,flagged:false};
  }
  return {held,affected,flagged:true,worst};
}

module.exports = {prepare,displayColor,paletteCheck,accentCheck,flickerCheck,marks,hex};
