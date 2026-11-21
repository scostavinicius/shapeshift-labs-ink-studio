const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

const root = path.resolve(__dirname,'..');
const example = require('../examples/palette-check-courier.json');

function fixture() {
  const {KIT,makeBuilder,makeSculpt}=ink.load();
  const builder=makeBuilder(37,[0x1a2233,0x9bbdd0,0xffc481]);
  const sculpt=KIT.sculpt(makeSculpt(builder));
  sculpt.box([0,-.3,0],[.52,.46,.18],{r:[1],em:true},{objectId:'courier',res:.08});
  sculpt.ball([0,.47,0],.30,{r:[2],em:true},{objectId:'courier',surfaceId:'core',res:.05});
  sculpt.bake();
  return builder.finish({cam:{target:[0,0,0],dist:3.8,yaw:0,pitch:0,sway:0},dither:0,
    look:{renderStages:[{stage:'palette',select:{surface:'core'},palette:{palette:['#ffc481']}}]}});
}

test('palette checks apply to each matching native sample and report measured failures',()=>{
  const plan={
    subjects:[{id:'Courier',select:{object:'courier'}},{id:'Core',select:{surface:'core'}},
      {id:'Missing',select:{object:'missing'}}],
    views:[{id:'Front',yaw:0},{id:'Oblique',yaw:.6}],
    states:[{id:'Later',time:1},{id:'Earlier',time:0}],
    checks:[
      {id:'Accent',type:'swatch',subject:'Core',swatch:'#FFC481'},
      {id:'Contour',type:'readability',subject:'Courier',minSamples:16,maxWeakColorShare:1,maxCroppedEdges:0},
      {id:'Too strict',type:'readability',subject:'Courier',minLightnessP10:1,views:['Oblique'],states:['Later']},
      {id:'Missing',type:'swatch',subject:'Missing',swatch:'#ffc481',views:['Front']},
      {id:'Mismatched',type:'swatch',subject:'Core',swatch:'#ff0000',states:['Earlier']}
    ]
  };
  const posed=[];
  const options={plan,width:144,height:96,view:{px:2,ortho:true},pose(_world,t){posed.push(t);}};
  const {image,report}=ink.checkPaletteShot(fixture(),options);
  assert.deepEqual(posed,[0,1]);
  assert.deepEqual([report.width,report.height,report.pixelSize],[72,48,2]);
  assert.deepEqual(report.summary,{passed:2,failed:3});
  assert.equal(report.passed,false);
  assert.deepEqual(report.checks.map(row=>row.evaluations),[4,4,1,2,2]);
  assert.deepEqual(report.checks.map(row=>row.failed),[0,0,1,2,2]);
  const [front,oblique,earlier]=report.samples;
  assert.deepEqual([front.view,front.state,oblique.view,oblique.state],['Front','Later','Oblique','Later']);
  assert.equal(front.results.find(row=>row.id==='Accent').metrics.share,1);
  const missing=front.results.find(row=>row.id==='Missing');
  assert.equal(missing.metrics.pixels,0);
  assert.equal(missing.metrics.share,null);
  assert(missing.failures.some(row=>row.metric==='pixels'));
  const strict=oblique.results.find(row=>row.id==='Too strict');
  assert.deepEqual(strict.failures.map(row=>row.metric),['lightnessP10']);
  const mismatch=earlier.results.find(row=>row.id==='Mismatched');
  assert.equal(mismatch.metrics.firstMismatch.swatch,'#ffc481');
  assert.equal(mismatch.metrics.exactPixels,0);
  assert.equal(mismatch.failures[0].actual,0);
  assert(image.w>144 && image.h>192);
  const typo={...plan,checks:[{...plan.checks[0],views:['Fronnt']}]};
  assert.throws(()=>ink.checkPaletteShot(fixture(),{...options,plan:typo}),/known view/);
});

test('CLI writes both artifacts on pass and regression with CI exit status',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-checks-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.join(root,'cli/ink-studio.js'), scene='examples/silhouette-protection.js';
  const plan=path.join(dir,'plan.json'), output=path.join(dir,'output');
  const run=()=>spawnSync(process.execPath,[cli,'palette','check',scene,plan,'--params','{"lanternAccent":true}',
    '--w','216','--h','136','--px','1','--out',output],{cwd:root,encoding:'utf8'});
  fs.writeFileSync(plan,JSON.stringify(example));
  let child=run();
  assert.equal(child.status,0,child.stderr);
  const report=()=>JSON.parse(fs.readFileSync(path.join(output,'report.json')));
  assert.equal(report().passed,true);
  assert.equal(report().samples.length,4);
  assert(PNG.raster(path.join(output,'board.png')).w>216*4);
  const regressed={...example,checks:example.checks.map(check=>check.type==='swatch' ?
    {...check,swatch:'#ff0000'} : check)};
  fs.writeFileSync(plan,JSON.stringify(regressed));
  child=run();
  assert.equal(child.status,2,child.stderr);
  assert.match(child.stderr,/Keep the lantern accent failed in 4 of 4 samples/);
  assert.equal(report().passed,false);
  assert.equal(report().checks[1].passed,true);
  assert(PNG.raster(path.join(output,'board.png')).w>216*4);
  fs.writeFileSync(plan,JSON.stringify({...example,checks:[]}));
  child=run();
  assert.equal(child.status,1,child.stderr);
});
