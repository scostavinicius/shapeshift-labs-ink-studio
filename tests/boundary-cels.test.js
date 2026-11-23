const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const ink=require('..'), kit=ink.load();
const {KIT:K,makeBuilder,makeSculpt}=kit;
const B=K.boundaryCels;

test('all three frost sizes are editable indexed clips in the stamp catalog',()=>{
  const clips=K.pixelStamps.catalog().clips.filter(clip=>clip.id.startsWith('boundary-frost-'));
  assert.equal(clips.length,15);
  const stamp=K.pixelStamps.clip('boundary-frost-hook-inside',{swatches:{core:'#fffffd'}});
  assert.equal(stamp.width,5);
  assert.equal(stamp.height,5);
  assert.equal(stamp.palette[3],'#fffffd');
});

function pixels(lines) {
  const w=lines[0].length,h=lines.length, text=lines.join('');
  const splatId=Uint32Array.from(text,ch=>'.ABX'.indexOf(ch));
  const rgb=new Uint8Array(w*h*3), colors=[[21,39,49],[94,132,134],[170,108,66],[41,33,52]];
  for(let i=0;i<splatId.length;i++)rgb.set(colors[splatId[i]],i*3);
  return {frame:{w,h,rgb},splatId,world:{count:3,renderMetadata:{
    materials:[null,'ice','copper','bolt'],materialIds:new Uint32Array([1,2,3])
  }}};
}
const solo={width:1,height:1,rows:['0'],palette:['#f1efd9']};
const palette={scenePalette:[0x152731,0x5e8486,0xaa6c42,0x292134]};
const settings=(overrides={})=>({id:'ice-edge',inside:{select:{material:'ice'}},
  outside:{select:{material:'copper'}},gaps:[{material:'bolt'}],cornerRun:1,...overrides});
function use(sample,rule=settings()){
  return B.apply(sample.frame,{splatId:sample.splatId},B.prepare({rules:[rule]},palette),sample.world,{captureSites:true});
}

test('visible seams select turns and deliberate gaps while protecting the bolt and other side',()=>{
  const scene=pixels([
    'BBBBBBBBBBBBBB','BBBBBBBBBBBBBB','BBAAAAXAAAAABB','BBAAAAAAAAAABB','BBAAAAABBBBBBB',
    'BBAAAAABBBBBBB','BBAAAAAAAAAABB','BBAAAAAAAAAABB','BBBBBBBBBBBBBB','BBBBBBBBBBBBBB'
  ]);
  const result=use(scene), {byKind,sites}=result.report;
  assert(byKind.inside>0 && byKind.outside>0 && byKind.gap>0 && byKind.straight>0);
  assert(sites.some(site=>site.kind==='gap'&&site.mirror));
  const {rgb}=scene.frame;
  assert(result.report.changedPixels>6);
  for(let i=0;i<scene.splatId.length;i++){
    const p=i*3, color=result.rgb.slice(p,p+3);
    if(scene.splatId[i]!==1)assert.deepEqual(color,rgb.slice(p,p+3));
  }
  const fresh=use(scene);
  assert.deepEqual(fresh.report,result.report);
  assert.deepEqual(fresh.rgb,result.rgb);
});

test('footprint thresholds choose separately authored native cels and open contours use taper',()=>{
  const size=(id,minPixels,stamp)=>({id,minPixels,spacing:4,
    cels:{straight:stamp,inside:null,outside:null,taper:solo,gap:null}});
  const family={sizes:[size('small',0,solo),size('long',9,
    {width:3,height:1,rows:['000'],palette:['#00eeaf']})]};
  const a=pixels(['BBBBBBBBBBB','..AAAAAA...','...........']);
  const b=pixels(['BBBBBBBBBBBBBBBB','..AAAAAAAAAAA...','................']);
  const small=use(a,settings({family})), long=use(b,settings({family}));
  assert(small.report.bySize['ice-edge/small']>0);
  assert(long.report.bySize['ice-edge/long']>0);
  assert.equal(long.report.byKind.taper,2);
  assert(long.report.sites.some(row=>row.kind==='taper'&&row.mirror));
  assert(long.rgb.some((_,i)=>i%3===0&&long.rgb[i]===0&&long.rgb[i+1]===238&&long.rgb[i+2]===175));
  assert.throws(()=>B.prepare({rules:[settings({family:{sizes:[size('bad',1,solo)]}})]}),/starting at zero/);
});

test('swatch and light-band sources can meet on one material with exact integer placement',()=>{
  const scene=pixels(['BBBBBBBB','BBBBBBBB','AAAAAAAA','AAAAAAAA','AAAAAAAA']);
  scene.world.renderMetadata.materialIds[1]=1;
  const rule=settings({inside:{select:{material:'ice'},swatches:['#5e8486']},
    outside:{select:{material:'ice'},luma:[.40,.52]}, gaps:[]});
  const adjusted=use(scene,rule);
  assert(adjusted.report.changedPixels>0);
  assert(adjusted.report.sites.every(row=>row.at[1]===2&&row.turn===0));
  assert.deepEqual(adjusted.rgb.slice(0,8*6),scene.frame.rgb.slice(0,8*6));
});

test('transparent background can define a silhouette without gaining color or alpha',()=>{
  const scene=pixels(['........','.AAAAAA.','.AAAAAA.','........']);
  scene.frame.alpha=Uint8Array.from(scene.splatId,id=>id?255:0);
  const result=use(scene,settings({outside:{background:true},paint:'outside'}));
  assert(result.report.placed>0);
  assert.equal(result.report.changedPixels,0);
  assert.equal(result.rgb,scene.frame.rgb);
});

function sceneFixture({KIT:K,makeBuilder,makeSculpt},rule){
  const model=makeBuilder(19,[0x14242f,0x426b6d,0x9b6446,0x3b2839]);
  const S=K.sculpt(makeSculpt(model));
  for(const [x,y,material,object,slot] of [
    [-.65,.1,'ice','panel',1],[.65,.1,'copper','panel',2],[0,.5,'bolt','bolt',3]
  ])S.box([x,y,material==='bolt'?.24:0],
    material==='bolt'?[.13,.14,.14]:[.65,.56,.14],{r:[slot],materialId:material},{objectId:object,res:.065});
  S.bake();
  return model.finish({cam:{target:[0,.15,0],dist:3.9,yaw:0,pitch:0,sway:0},
    radius:4,detail:22,dither:0,look:{pixel:true,boundaryCels:{rules:[rule]}}});
}
test('the CPU render uses visible native owners and leaves ownership and depth untouched',()=>{
  const world=sceneFixture(kit,settings());
  const opts={w:132,h:88,px:1,ortho:true,passes:['materialId','depth'],captureBoundarySites:true};
  const off=ink.render(world,{...opts,boundaryCels:false}), on=ink.render(world,opts);
  assert(on.boundaryCels.changedPixels>0);
  assert.deepEqual(on.passes.materialId,off.passes.materialId);
  assert.deepEqual(on.passes.depth,off.passes.depth);
  const bolt=on.passes.materials.indexOf('bolt');
  assert(bolt>0);
  for(let i=0;i<on.passes.materialId.length;i++)if(on.passes.materialId[i]===bolt)
    assert.deepEqual(on.rgb.slice(i*3,i*3+3),off.rgb.slice(i*3,i*3+3));
});

function browserCheck(createRenderer,fixture,rule) {
  const width=132,height=88, canvas=new OffscreenCanvas(width,height);
  const world=fixture({KIT,makeBuilder,makeSculpt},rule);
  const renderer=createRenderer(canvas,{toolkit:{KIT,PixelLook}}), gl=canvas.getContext('webgl2');
  const colors=new Set(KIT.pixelStamps.clip('boundary-frost-hook-straight').palette.map(hex=>parseInt(hex.slice(1),16)));
  function draw(frame){
    renderer.render(world,{width,height,ortho:true,outline:false,colored:false,dither:0,...frame});
    const bytes=new Uint8Array(width*height*4);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    if(gl.getError())throw Error('WebGL error after boundary pass');
    return bytes;
  }
  const plain=draw({boundaryCels:false});
  let summary;
  const art=draw({boundaryCelsFrame:report=>{summary=report},captureBoundarySites:true});
  let changed=0;
  for(let i=0;i<art.length;i+=4){
    if(art[i]===plain[i]&&art[i+1]===plain[i+1]&&art[i+2]===plain[i+2])continue;
    if(!colors.has(art[i]*65536+art[i+1]*256+art[i+2]))throw Error('Boundary color lost its authored swatch');
    changed++;
  }
  if(changed<5||summary.changedPixels!==changed||!summary.byKind.gap)throw Error('Missing visible seam or gap');
  const restored=draw({boundaryCels:false});
  if(restored.some((n,i)=>n!==plain[i]))throw Error('Turning cels off changed the render');
  renderer.dispose();
}

test('WebGL places the same indexed library cels and preserves the foreground gap',
  {skip:!process.env.INK_TEST_CHROME},t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-boundary-cels-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const page=path.join(dir,'index.html');
    fs.writeFileSync(path.join(dir,'bundle.js'),ink.bundle());
    fs.writeFileSync(page,`<!doctype html><pre id="result">PENDING</pre><script src="bundle.js"></script><script type="module">
import {createRenderer} from ${JSON.stringify(pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href)};
const output=document.querySelector('#result');
try {
  (${browserCheck.toString()})(createRenderer,${sceneFixture.toString()},${JSON.stringify(settings())});
  output.textContent='PASS';
} catch(error) { output.textContent=error.stack; }
</script>`);
    const software=process.platform==='darwin'?[]:['--enable-unsafe-swiftshader','--use-angle=swiftshader'];
    const run=spawnSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking',
      '--allow-file-access-from-files',...software,'--user-data-dir='+path.join(dir,'profile'),
      '--dump-dom',pathToFileURL(page).href],{timeout:90000,encoding:'utf8',stdio:['ignore','pipe','ignore']});
    if(run.error)throw run.error;
    assert.equal(run.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1],'PASS');
  });
