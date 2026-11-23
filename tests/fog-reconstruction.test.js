const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const { KIT:K, makeBuilder, makeSculpt } = ink.load();
const { surfaceGuide } = require('../cli/fog-reconstruction.js');
const { atmosphereQuality } = require('../cli/scene-optics.js');

function fixture() {
  const B = makeBuilder(27,[0x182732,0x4a697a,0x9f4839,0xe0aa6a]);
  const S = makeSculpt(B);
  S.box([0,0,.60],[1.68,1.06,.12],{r:[1]},{res:.057,objectId:'wall'});
  S.box([.02,.05,.862],[.30,.64,.05],{r:[2]},{res:.035,objectId:'courier'});
  S.bake();
  const bounds = {min:[-4,-3,.735],max:[4,3,.868]};
  const density = K.procedural.density.bounded({ bounds,sample:(x,y)=>.7+.27*Math.sin(x*1.8+y) });
  return B.finish({
    cam:{target:[0,0,0],dist:4.4,yaw:0,pitch:0,ortho:true,sway:0},radius:6,
    dither:0,look:{splatCoverage:'continuous'},
    atmosphere:[K.atmosphere.field({field:density,density:12,step:.027,color:'#9adaf1',lit:false})]
  });
}

function onEdge(owners,p,width,height) {
  const x=p%width, y=Math.floor(p/width), owner=owners[p];
  return x>0 && owners[p-1]!==owner || x+1<width && owners[p+1]!==owner ||
    y>0 && owners[p-width]!==owner || y+1<height && owners[p+width]!==owner;
}

test('object-guided coarse fog preserves the native fog and color on a same-depth foreground outline',()=>{
  const world=fixture(), width=81,height=57;
  const options={w:width,h:height,px:1,raw:true,captureFog:true,passes:['objectId','depth','fogTransmittance']};
  const render=(scale,reconstruction)=>ink.render(world,{...options,volumeQuality:{scale,reconstruction,stats:true}});
  const native=render(1), legacy=render(4,'depth'), low=render(4);
  assert.deepEqual(low.rgb,render(4,'object').rgb);
  const ids=native.passes.objectId, courier=native.passes.objects.indexOf('courier');
  const edge=Array.from(ids.keys()).filter(p=>ids[p]===courier && onEdge(ids,p,width,height));
  const washed=edge.filter(p=>legacy.fog[p] > native.fog[p]+.12);
  assert(edge.length>25 && washed.length>=12,`Edge pixels ${edge.length}, washed ${washed.length}`);
  for (const p of edge) {
    assert.equal(low.fog[p],native.fog[p]);
    assert.equal(low.passes.fogTransmittance[p],native.passes.fogTransmittance[p]);
    assert.deepEqual(low.rgb.subarray(p*3,p*3+3),native.rgb.subarray(p*3,p*3+3));
  }
  assert(low.volumeStats.coarseRays===Math.ceil(width/4)*Math.ceil(height/4));
  assert(low.volumeStats.boundaryRejectedTaps>0 && low.volumeStats.boundaryRays>0);
  assert(low.volumeStats.rays < native.volumeStats.rays*.44);
  assert.equal(low.volumeStats.rays,low.volumeStats.coarseRays+low.volumeStats.fallbackRays);
});

test('coarse taps on the same object cannot cross a thin intervening silhouette',()=>{
  const depths=new Float32Array([3,3,3,3,3,3,3,3,3]);
  const owners=new Uint32Array([11,11,11,11,9,11,11,11,11]);
  const guide=surfaceGuide(9,1,depths,owners,undefined,.22);
  assert.deepEqual(Array.from(guide.boundaries),[0,0,0,1,1,1,0,0,0]);
  assert(guide.connected(0,3));
  assert(!guide.connected(3,6));
  assert(!guide.connected(6,3));
  assert(guide.connected(6,8));
  assert.throws(()=>atmosphereQuality({reconstruction:'blur'}),/object or depth/);
});

test('temporal fog history rejects owner changes and current or previous boundaries at the same depth',()=>{
  const history=K.atmosphere.history({weight:.5});
  const depth=new Float32Array([3,3,3,3]);
  const values=new Float32Array([.2,0,0,.8,.2,0,0,.8,.2,0,0,.8,.2,0,0,.8]);
  history.filter(values.slice(),depth,0,'camera',
    {owners:new Uint32Array([1,2,2,2]),boundaries:new Uint8Array([0,0,1,0])});
  const next=values.map((n,i)=>i%4===0?.6:n);
  history.filter(next,depth,.05,'camera',
    {owners:new Uint32Array([2,2,2,2]),boundaries:new Uint8Array([0,1,0,0])});
  assert([next[0],next[4],next[8]].every(n=>Math.abs(n-.6)<1e-6));
  assert(Math.abs(next[12]-.4)<1e-6);
});

test('mixed per-fragment media retain the exact layered path',()=>{
  const world={...fixture(),aerialPerspective:{start:0,density:.18,contrast:.16}};
  const options={w:64,h:42,px:1,raw:true,captureFog:true};
  const native=ink.render(world,{...options,volumeQuality:{scale:1,stats:true}});
  const low=ink.render(world,{...options,volumeQuality:{scale:4,stats:true}});
  assert.equal(low.volumeStats.mode,'layered');
  assert.deepEqual(low.fog,native.fog);
  assert.deepEqual(low.rgb,native.rgb);
});

test('fog review exports synchronized clips and measures the moving subject edge', t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-fog-review-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const root=path.resolve(__dirname,'..');
  const example='examples/depth-aware-fog/sluice-courier.js';
  const out=path.join(directory,'review'), settings=['--w','104','--h','64','--raw'];
  const run=(...args)=>execFileSync(process.execPath,['cli/ink-studio.js',...args],{cwd:root,stdio:'pipe'});
  run('fog-reconstruction','review',example,'--out',out,'--subject','courier',
    '--from','.6','--to','.9','--fps','10',...settings);
  const report=JSON.parse(fs.readFileSync(path.join(out,'review.json')));
  assert.equal(report.format,'ink-studio/fog-reconstruction-review');
  assert.equal(report.samples.length,3);
  assert(report.samples.every(s=>s.crop && s.objectError===0 && s.renderStats.object.rays<s.renderStats.native.rays*.5));
  assert.equal(new Set(report.samples.map(s=>s.crop.w+'×'+s.crop.h)).size,1);
  assert(report.samples.some(s=>s.correctedPixels>0));
  for (const lane of ['depth','object','native']) {
    const image=fs.readFileSync(path.join(out,lane+'.png'));
    assert.equal(image.readUInt32BE(16),104);
    assert.equal(image.readUInt32BE(20),64);
    assert.equal(image.readUInt32BE(image.indexOf('acTL')+4),3);
  }
  const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  assert.match(html,/data:image\/png;base64,/);
  assert.doesNotMatch(html,/\/\*FOG_REVIEW_DATA\*\//);
  const renderOut=path.join(directory,'ordinary-depth.png');
  run('render',example,'--out',renderOut,'--t','.6','--px','1','--volume-scale','4','--volume-reconstruction','depth',...settings);
  const PNG=require('../cli/png.js');
  assert.deepEqual(PNG.read(renderOut).rgb,PNG.read(path.join(out,'depth.png')).rgb);
});
