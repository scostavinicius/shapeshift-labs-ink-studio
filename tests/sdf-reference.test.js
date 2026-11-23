const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ink = require('..');
const { cameraCapture } = require('../cli/render.js');
const { bind } = require('../cli/sdf-reference-field.js');
const { trace } = require('../cli/sdf-path-trace.js');
const { settingsFor } = require('../cli/sdf-reference-review.js');

const { KIT, makeBuilder, makeSculpt, SplatProvenance } = ink.load();
const palette = [0x182333,0xe0e0e0,0xe84326,0x70e5ed];
const camera = {target:[0,.5,0],yaw:0,pitch:0,dist:5,ortho:true,sway:0};

function fixture(author, meta = {}) {
  const B = makeBuilder(19,palette), S = makeSculpt(B);
  S.keepReferenceSdf=true;
  author(S,B);
  S.bake();
  return B.finish({cam:camera,radius:4,liveSun:false,...meta});
}

function capture(world, more = {}) {
  const options = {w:44,h:36,px:1,raw:true};
  let view;
  ink.render(world,{...options,...cameraCapture(options,camera=>{view=camera;})});
  return trace(world,options,view,settingsFor({width:options.w,height:options.h,times:[0],samples:24,...more}));
}

test('finite reference fields resolve a carved passage and exclude moved sculpt rows',()=>{
  const world = fixture(S=>{
    S.box([0,0,0],[1,1,.2],{r:[1],fat:.18},{objectId:'arch',res:.32});
    S.box([0,0,0],[.24,.35,.4],{r:[1]},{neg:true,objectId:'arch',res:.25});
    S.box([1.65,0,0],[.28,.6,.2],{r:[2]},{objectId:'strip',res:.25});
  });
  const geo = bind(world,.001,160);
  assert.equal(geo.intersect([0,0,2],[0,0,-1],0,4),undefined);
  const wall=geo.intersect([.6,.5,2],[0,0,-1],0,4);
  assert(Math.abs(wall.t-1.8)<.003);
  assert(wall.normal[2]>.99);
  assert(geo.support(wall)>.01);
  const data=world.data.slice();
  for (let i=0;i<world.count;i++)
    if (world.renderMetadata.objects[world.renderMetadata.objectIds[i]]==='strip') data[i*16]+=.5;
  const moved=bind({...world,data},.001,160);
  assert.equal(moved.stats.excludedMoving,1);
  assert.equal(moved.intersect([1.65,0,2],[0,0,-1],0,4),undefined);
  assert(moved.intersect([.6,.5,2],[0,0,-1],0,4));
  assert.equal(SplatProvenance.subset(world,[0,1]).referenceSdfs,undefined);
});

test('secondary diffuse rays transfer the painted wall color to a neutral receiver',()=>{
  const world=fixture(S=>{
    S.box([0,-.13,0],[1.45,.13,1.16],{r:[1]},{res:.29});
    S.box([0,.64,-.76],[1.2,.64,.055],{r:[2]},{res:.25});
  },{ cam:{...camera,pitch:.38}, areaLights:[
    {id:'wall-wash',at:[0,.51,-.17],normal:[0,0,-1],size:[.3,.38],intensity:8,radius:1.14,visible:false}
  ] });
  const direct=capture(world,{bounces:0}), bounced=capture(world,{bounces:2});
  assert.equal(direct.stats.indirectPixels,0);
  assert(bounced.stats.indirectPixels>20);
  assert(bounced.coverage.some((coverage,p)=>{
    const i=p*3;
    return coverage>.95 && bounced.normals[i+1]>.99 && bounced.indirect[i]>22 &&
      bounced.indirect[i]>bounced.indirect[i+1]*2 && bounced.rgb[i]>direct.rgb[i]+6;
  }));
  assert.deepEqual(capture(world,{bounces:2}).rgb,bounced.rgb);
  assert.notDeepEqual(capture(world,{bounces:2,seed:2}).sampling,bounced.sampling);
});

test('closed dielectric paths reach the object behind, and a backlight transmits through paper',()=>{
  const world = fixture(S=>{
    S.box([-.56,.5,-.23],[.34,.34,.06],{r:[1],em:.8},{res:.22});
    S.box([-.56,.5,.34],[.34,.34,.105],{r:[3],glass:true,a:.2},{res:.21});
    const paper=KIT.surface.material({r:[2]},{layers:{back:{type:'transmission',color:3,strength:.86,thickness:.1}}});
    S.box([.59,.52,.34],[.34,.34,.028],paper,{res:.21});
  },{ lights:[{p:[.59,.52,-.25],intensity:2.8,radius:1.3,color:[1,1,1]}] });
  const result=capture(world);
  for (const x of [15,28]) {
    const j=(18*result.w+x)*3, rgb=Array.from(result.transmission.subarray(j,j+3));
    assert(rgb[2]>80 && rgb[2]>rgb[0]*1.25, `Pixel ${x} transmitted ${rgb}`);
  }
  assert(result.stats.transmissionPixels > 20);
});

test('optical extinction depends on the distance traced inside the solid',()=>{
  const world=fixture(S=>{
    const filter={ r:[1],optical:{absorption:2} };
    for (const [x,depth] of [[-.56,.08],[.56,.27]]) {
      S.box([x,.5,-.34],[.34,.34,.055],{r:[1],em:1},{res:.21});
      S.box([x,.5,.28],[.34,.34,depth],filter,{res:.21});
    }
  });
  const result=capture(world);
  const a=result.transmission[(18*result.w+15)*3], b=result.transmission[(18*result.w+28)*3];
  assert(a>140 && b>70 && a>b+32, `Thin slab ${a}, thick slab ${b}`);
});

test('command captures selected frames with a standalone review and every diagnostic image', t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sdf-reference-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const root=path.resolve(__dirname,'..'), output=path.join(directory,'out');
  const run = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','sdf-reference',
    'examples/sdf-reference/signal-conservatory.js','--out',output,...args],{cwd:root,stdio:'pipe'});
  run('--w','30','--h','20','--samples','4','--t','0,1.4','--raw');
  const report = JSON.parse(fs.readFileSync(path.join(output,'review.json')));
  assert.equal(report.format,'ink-studio/sdf-reference');
  assert.deepEqual(report.frames.map(frame=>frame.time),[0,1.4]);
  for (const frame of report.frames) {
    const filenames=Object.values(frame.files);
    assert.equal(filenames.length,9);
    for (const file of filenames) {
      const image=fs.readFileSync(path.join(output,file));
      assert.equal(image.readUInt32BE(16),30);
      assert.equal(image.readUInt32BE(20),20);
    }
    assert(frame.stats.referencePixels>0 && frame.stats.rays>30*20*4);
  }
  const html=fs.readFileSync(path.join(output,'index.html'),'utf8');
  assert.match(html,/data:image\/png;base64,/);
  assert.doesNotMatch(html,/\/\*REFERENCE_DATA\*\//);
  assert.throws(()=>run('--samples','3'),/even 4–256/);
});
