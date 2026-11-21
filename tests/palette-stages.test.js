const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const PNG=require('../cli/png.js');
const {compareStages}=require('../cli/palette-stages.js');

test('stage deltas pair actual pixels and distinguish merges, hue changes and new swatches',()=>{
  const rgb=(...colors)=>Uint8Array.from(colors.flatMap(c=>Array.from(Buffer.from(c,'hex'))));
  const source={w:4,h:1,rgb:rgb('ff3838','25ad7a','25ad7a','bbbbbb'),alpha:Uint8Array.of(255,255,255,0)};
  const dest={w:4,h:1,rgb:rgb('295edb','295edb','999999','ffffff')};
  const result=compareStages(source,dest,{hueThreshold:22,minChroma:.025,limit:12});
  assert.equal(result.pairedPixels,3);
  assert.equal(result.changedPixels,3);
  assert.equal(result.mergedSwatches,1);
  assert.equal(result.merges[0].swatch,'#295edb');
  assert.equal(result.merges[0].sourceSwatches,2);
  assert.equal(result.introducedCount,2);
  assert.equal(result.hue.shiftedPixels,2);
  assert.equal(result.hue.neutralizedPixels,1);
});

const {KIT,makeBuilder,makeSculpt}=ink.load();
const view={w:128,h:112,px:2,ortho:true};
const grade={stage:'frame',stack:{name:'Night',steps:[{type:'channelMix',
  matrix:[[.7,.1,0],[0,.7,.1],[0,.1,.8]],offset:[.025,.04,.09]}]}};
const resolve={stage:'palette',palette:{palette:['#060b13','#647988']}};

function panel() {
  const b=makeBuilder(3,[0x161e2d,0x555555,0xeeeeee]);
  const s=makeSculpt(b);
  Object.assign(s,{amb:.16,sky:.05,sunK:0});
  const paint={
    type:'projected',stage:'material',pattern:'indexed',
    projection:{origin:[-1,-1,0],across:[0,1,0]},
    raster:{width:2,height:1,slots:[0,1],palette:['#21adba','#eaa64f'],size:[2,2]}
  };
  const mat=KIT.surface.material({r:[1,2],materialId:'panel'},{layers:{paint}});
  s.box([0,0,0],[.8,.75,.13],mat,{res:.08,objectId:'board'});
  s.bake();
  return b.finish({cam:{target:[0,0,0],dist:3.7,yaw:0,pitch:0,sway:0},dither:0,
    look:{splatCoverage:'continuous',renderStages:[grade,resolve]}});
}

test('material paint, lit input, actual grade and final export come from the same raster grid',()=>{
  const world=panel(), base=ink.render(world,view);
  const {rasters,report}=ink.reviewPaletteStages(world,{...view,allowed:['#647988']});
  assert.deepEqual(rasters.final.rgb,base.rgb);
  assert.deepEqual(rasters.graded.rgb,ink.render(world,{...view,renderStages:[grade]}).rgb);
  assert.deepEqual(rasters.lit.rgb,ink.render(world,{...view,renderStages:[]}).rgb);
  assert.deepEqual([report.width,report.height,report.pixelSize],[64,56,2]);
  const paint=report.stages.base.swatches.map(row=>row.swatch);
  assert(paint.includes('#21adba') && paint.includes('#eaa64f'));
  assert(report.stages.base.pixels<report.stages.lit.pixels);
  assert(report.transitions[0].pairedPixels===report.stages.base.pixels);
  assert(report.transitions[2].mergedSwatches>0);
  assert(report.unexpectedFinal.pixels>0);
  assert(report.unexpectedFinal.introducedAt.final>0);
  const scoped=ink.reviewPaletteStages(world,{...view,select:{object:'board'}});
  assert(scoped.report.stages.final.pixels<report.stages.final.pixels);
  assert(scoped.rasters.final.alpha.includes(0));
});

test('frame-stage palettes appear in the actual graded capture',()=>{
  const world=panel(), framePalette={stage:'frame',palette:{palette:['#a05239']}};
  world.look={...world.look,renderStages:[grade,framePalette,resolve]};
  const output=ink.reviewPaletteStages(world,view);
  assert.deepEqual(output.report.stages.graded.swatches,[{swatch:'#a05239',pixels:64*56}]);
  assert.notDeepEqual(output.rasters.graded.rgb,output.rasters.final.rgb);
});

test('legacy resolve exposes its lit input and final output with no separate grade',()=>{
  const {makeBuilder,makeSculpt}=ink.load();
  const builder=makeBuilder(12,[0x151e2c,0xa58775,0xf2cc9e]), s=makeSculpt(builder);
  s.captureAlbedo=true;
  s.box([0,0,0],[.7,.7,.25],{r:[1,2],materialId:'brick'},{res:.075});
  s.bake();
  const world=builder.finish({cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0},dither:.4});
  for (const options of [{},{colored:true},{stable:{resolve:'coverage'}}]) {
    const settings={...view,...options,transparent:true};
    const {rasters,report}=ink.reviewPaletteStages(world,settings);
    assert.equal(rasters.graded,null);
    assert.equal(report.stages.graded.available,false);
    assert.deepEqual(rasters.final.rgb,ink.render(world,settings).rgb);
    assert(report.stages.base.pixels>0);
    assert.deepEqual(report.transitions.map(row=>[row.from,row.to]),[['base','lit'],['lit','final']]);
  }
});

test('CLI exports all four native stage images and their comparison report', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-stage-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), scene=path.resolve(__dirname,'../examples/render-stages.js');
  execFileSync(process.execPath,[cli,'palette','stages',scene,'--params','{"stage":"review"}',
    '--w','144','--h','84','--px','2','--out',dir]);
  const report=JSON.parse(fs.readFileSync(path.join(dir,'stages.json')));
  for (const stage of ['base','lit','graded','final']) {
    assert(report.stages[stage].available);
    const frame=PNG.raster(path.join(dir,report.files[stage]));
    assert.deepEqual([frame.w,frame.h],[72,42]);
  }
  assert.equal(report.transitions.length,3);
});
