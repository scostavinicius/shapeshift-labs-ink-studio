const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT, makeBuilder, makeSculpt } = ink.load();

const view = {w:64,h:48,px:1,ortho:true};
const candidates = { palette:['#465666','#aebecd'], dither:{pattern:'checker',strength:1,
  pairs:[{colors:['#465666','#aebecd']}] } };
const colorAt = (frame,[x,y]) => '#'+Buffer.from(frame.rgb.subarray((y*frame.w+x)*3,(y*frame.w+x)*3+3)).toString('hex');

function plate(look = {}) {
  const b = makeBuilder(7,[0x0a0f18,0x8090a0]), sculpt = KIT.sculpt(makeSculpt(b));
  sculpt.amb = 1;
  sculpt.sunK = 0;
  sculpt.sky = 0;
  sculpt.box([0,0,-.07],[1.15,.8,.08],{r:[1],materialId:'steel'},{res:.072,objectId:'panel'});
  sculpt.bake();
  return b.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},dither:1,look});
}

test('explicit stage tracing reports the actual authorised dither decision on both ranks', () => {
  const world = plate({renderStages:[
    {stage:'material',palette:{palette:['#7b8b9c']}},
    {stage:'palette',select:{object:'panel'},assetId:'shades/panel',palette:candidates}
  ]});
  const frame = ink.render(world,view);
  const reports = [[31,24],[32,24]].map(at=>ink.inspectPalettePixel(world,{...view,at}));
  for (const [i,report] of reports.entries()) {
    const { winner } = report;
    assert.equal(report.object,'panel');
    assert.equal(report.material,'steel');
    assert.deepEqual(report.decisions.map(row=>row.rule.stage),['material','palette']);
    assert.equal(winner.rule.asset,'shades/panel');
    assert.equal(winner.rule.select.object,'panel');
    assert.equal(winner.swatch,colorAt(frame,[31+i,24]));
    assert.equal(report.outputColor,winner.swatch);
    assert.equal(winner.dither.pattern,'checker');
    assert.equal(winner.dither.authorized,true);
    assert.deepEqual(winner.dither.coordinates,[31+i,24]);
    assert.deepEqual(new Set(winner.dither.pair),new Set(candidates.palette));
  }
  assert.notEqual(reports[0].winner.swatch,reports[1].winner.swatch);
  assert(reports.some(report=>report.winner.method==='dither-pair'));
});

test('legacy, coverage-aware and supersampled local resolves use the same target rule and swatch as the renderer', () => {
  const world = plate({paletteConstraints:{targets:[{select:{material:'steel'},...candidates}]}});
  for (const options of [{},{coverageAware:true},{colored:true},{stable:{resolve:'coverage'}}]) {
    const settings = {...view,...options};
    const at = [32,24], frame = ink.render(world,settings);
    const trace = ink.inspectPalettePixel(world,{...settings,at});
    assert.equal(trace.outputColor,colorAt(frame,at));
    assert.equal(trace.winner.rule.domain,'target');
    assert.equal(trace.winner.rule.select.material,'steel');
    assert.equal(trace.outputMatchesSwatch,true);
    assert.equal(trace.winner.dither.authorized,true);
  }
});

test('the inspector distinguishes masked swatch choices from the blend they produce', () => {
  const world = plate({paletteConstraints:{targets:[{select:{object:'panel'},palette:['#24ef50'],
    mask:{type:'axis',direction:[1,0,0],range:[-2,3],interpolation:'linear'}}]}});
  const at = [32,24];
  const trace = ink.inspectPalettePixel(world,{...view,at});
  assert.equal(trace.outputColor,colorAt(ink.render(world,view),at));
  assert.equal(trace.winner.rule.domain,'scene');
  const mask = trace.decisions.at(-1);
  assert.equal(mask.rule.stage,'mask');
  assert(mask.weight > 0 && mask.weight < .5);
  assert.equal(mask.swatch,'#24ef50');
  assert.equal(mask.blended,true);
  assert.equal(trace.outputMatchesSwatch,false);
});

test('a composed shadow reports the material swatch that beat the shared palette', () => {
  const scene = require('../examples/palette-composition.js')(ink.load());
  const world = scene.build(scene.seed), at = [42,41], settings = {w:240,h:160,px:2};
  const trace = ink.inspectPalettePixel(world,{...settings,at});
  assert.equal(trace.object,'woven panel');
  assert.equal(trace.material,'fabric');
  assert.equal(trace.winner.rule.stage,'effect');
  assert.equal(trace.winner.rule.domain,'material');
  assert.equal(trace.winner.rule.effect,'shadow');
  assert.equal(trace.winner.swatch,colorAt(ink.render(world,settings),at));
});

test('CLI pixel inspection uses native art coordinates and exposes the dither pair', () => {
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), scene = path.resolve(__dirname,'../examples/render-stages.js');
  const json = execFileSync(process.execPath,[cli,'palette','inspect',scene,'--params','{"stage":"palette"}',
    '--w','760','--h','420','--px','2','--at','180,144'],{encoding:'utf8'});
  const report = JSON.parse(json);
  assert.deepEqual([report.x,report.y,report.width,report.height],[180,144,380,210]);
  assert.equal(report.material,'pale');
  assert.equal(report.winner.inputColor,'#78b3ff');
  assert.equal(report.winner.swatch,'#a6ced4');
  assert.deepEqual(report.winner.dither.pair,['#77a6c6','#a6ced4']);
  assert.throws(()=>ink.inspectPalettePixel(plate(),{...view,at:[64,1]}),/outside the 64 x 48 art grid/);
});
