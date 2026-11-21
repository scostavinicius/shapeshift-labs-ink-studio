const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');

const palettes = [
  { id:'slate',palette:['#162234','#a0b6c4','#e3eff4'],match:'perceptual' },
  { id:'amber',palette:['#401d25','#eb9d43'],dither:{pattern:'bayer',strength:1} }
];
const view = {w:112,h:88,px:2,t:.25,transparent:true};
const grade = { stage:'frame',stack:{name:'Lift',steps:[{type:'exposure',stops:.5}]} };

function panel() {
  const { makeBuilder } = ink.load(), builder = makeBuilder(4,[0x121f2d,0x596c84,0xffffff]);
  builder.disc(0,0,0,[0,0,1],.65,.04,builder.P[1],3);
  builder.describeSplats(0,1,{object:'plate',material:'ceramic'});
  return builder.finish({ cam:{target:[0,0,0],dist:4,yaw:0,pitch:0},dither:0,
    look:{renderStages:[grade,
      {stage:'frame',palette:{palette:['#ff00ff']}},
      {stage:'palette',palette:{palette:['#00ff00']}}]} });
}

test('candidate palettes use the same graded pixels, camera, alpha and native grid',()=>{
  const world = panel();
  let samples = 0;
  const out = ink.compareShotPalettes(world,{...view,palettes,shotFrame(){ samples++; }});
  const { report, reference, alternatives } = out;
  const captured = ink.render(world,{...view,renderStages:[grade]});
  assert.equal(samples,1);
  assert.deepEqual(reference.rgb,captured.rgb);
  assert.deepEqual(reference.alpha,captured.alpha);
  assert.deepEqual([report.width,report.height,report.pixelSize],[56,44,2]);
  assert.equal(report.time,.25);
  assert.deepEqual(report.sample.camera.target,[0,0,0]);
  assert.equal(report.referenceStage,'frame');
  assert.notDeepEqual(alternatives[0].image.rgb,alternatives[1].image.rgb);
  for (const [i,{image,heatmap}] of alternatives.entries()) {
    assert.deepEqual(image.alpha,reference.alpha);
    assert.deepEqual(heatmap.alpha,reference.alpha);
    assert.deepEqual([image.w,image.h,heatmap.w,heatmap.h],[56,44,56,44]);
    const {usage,error} = report.alternatives[i];
    const actual = new Map();
    for (let p=0;p<image.alpha.length;p++) if (image.alpha[p]) {
      const swatch = '#'+Buffer.from(image.rgb.subarray(p*3,p*3+3)).toString('hex');
      actual.set(swatch,(actual.get(swatch) ?? 0)+1);
    }
    assert.deepEqual(usage.swatches.map(row=>row.pixels),usage.swatches.map(row=>actual.get(row.swatch) ?? 0));
    assert.equal(usage.pixels,error.pixels);
    assert(usage.transparentPixels>0);
    assert(error.materials.some(row=>row.material==='ceramic' && row.pixels>0));
    assert.deepEqual(error.legend,report.legend);
  }
  assert(report.alternatives[0].usage.swatches.some(row=>row.pixels===0));
  const reversed = ink.compareShotPalettes(world,{...view,palettes:palettes.slice().reverse()});
  assert.deepEqual(reversed.alternatives.slice().reverse(),alternatives);
});

test('legacy capture works and invalid palette alternatives are rejected',()=>{
  const world = panel(), options = {...view,palettes,renderStages:false};
  const expected = ink.render(world,{...options,captureQuantization:true}).quantization;
  const actual = ink.compareShotPalettes(world,options);
  assert.equal(actual.report.referenceStage,'legacy');
  assert.deepEqual(actual.reference.rgb,expected.graded);
  assert.throws(()=>ink.compareShotPalettes(world,{palettes:palettes.slice(0,1)}),/2 to 12/);
  assert.throws(()=>ink.compareShotPalettes(world,{palettes:[palettes[0],palettes[0]]}),/distinct/);
  assert.throws(()=>ink.compareShotPalettes(world,{palettes:[palettes[0],{...palettes[1],t:.5}]}),/settings|accept/);
  assert.throws(()=>ink.compareShotPalettes(world,{palettes:[palettes[0],{
    ...palettes[1],dither:{space:'object'}
  }]}),/screen grid/);
});

test('CLI holds a checkpoint tick and writes the entire native comparison', t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-matched-palettes-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const scene = path.join(dir,'scene.json'), checkpoint = path.join(dir,'checkpoint.json');
  const plan = path.join(dir,'palettes.json'), output = path.join(dir,'output');
  const cli = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),...args]);
  fs.writeFileSync(scene,JSON.stringify({format:'ink-studio/world',id:'palette-world',dt:.1,seed:17,
    entities:{wall:{position:[0,.4,0],visual:{half:[.5,.4,.35]}}},
    visual:{resolution:.15,bounds:{min:[-1.25,-.25,-1],max:[1.25,1,1]},look:{renderStages:[grade]}}}));
  fs.writeFileSync(plan,JSON.stringify(palettes));
  cli('sim','run',scene,'--ticks','6','--checkpoint',checkpoint);
  cli('palette','compare',checkpoint,plan,'--w','144','--h','96','--px','2','--out',output);
  const report = JSON.parse(fs.readFileSync(path.join(output,'comparison.json')));
  assert.equal(report.scene,'palette-world');
  assert.equal(report.simulation.tick,6);
  assert.equal(report.time,report.simulation.time);
  assert(report.time>0);
  const files = [report.files.reference,...report.alternatives.flatMap(row=>Object.values(row.files))];
  for (const filename of files) {
    const image = PNG.raster(path.join(output,filename));
    assert.deepEqual([image.w,image.h],[72,48]);
  }
  const sheet = PNG.raster(path.join(output,report.files.comparison));
  assert(sheet.w>3*72 && sheet.h>2*48);
});
