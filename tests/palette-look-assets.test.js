const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const kit = studio.load(), { KIT, SurfaceLook } = kit;
const { assetPacks, looks } = KIT.authoring;
const rampSource = require('../examples/lighting-ramp-palette.json');
const fit = require('../examples/palette-dither-fit.json');
const id = 'workshop/slate';

test('approved lighting stops bind as material finish across different scene palettes',()=>{
  const api = KIT.palette.lightingRamps, draft = api.suggest(rampSource);
  draft.ramps.stone.swatches.highlight = 26;
  const approval = api.approve(draft), ramp = {approved:approval,role:'stone'};
  const pack = assetPacks.savePaletteLook({id,label:'Slate finish',ramp});
  const catalog = assetPacks.create({packs:assetPacks.merge([],assetPacks.bundle([pack])).packs});
  const spec = looks.material({r:[0,1]}, {asset:id,revision:1}, catalog).surface;
  const stop = spec.layers.lookAssetRamp.lightingRamp.stops.at(-1);
  assert.deepEqual(stop,[draft.ramps.stone.positions.at(-1),rampSource.palette[26]]);
  const outputs = [[0,0xffffff],[0x110044,0x55fa11]].map(palette=>{
    const prepared = SurfaceLook.prepare(spec,palette,[0,0,1]);
    return SurfaceLook.shade(prepared,{position:[0,0,0],normal:[0,0,1],view:[0,0,1]},[0,0,0]).slice(0,3);
  });
  assert.deepEqual(outputs,Array(2).fill([217/255,175/255,122/255]));
  const run = KIT.world.runtime.create({format:'ink-studio/world',id:'slate-room',seed:8,assetPacks:[pack],
    entities:{wall:{position:[0,.4,0],visual:{half:[.5,.4,.35],lookAsset:{asset:id,revision:1}}}},
    visual:{resolution:.15,bounds:{min:[-1,-.25,-1],max:[1,1,1]}}});
  const world = KIT.world.visual(kit,run.view(),run.query());
  const surface = world.surfaces.find(row=>row.settings.lookAssetId===id);
  assert.deepEqual(surface.settings.layers.lookAssetRamp.lightingRamp,spec.layers.lookAssetRamp.lightingRamp);
  assert.throws(()=>looks.scene({asset:id},catalog),/material lookAsset/);
  assert.strictEqual(assetPacks.savePaletteLook({id,ramp},pack),pack);
  const next = assetPacks.reviseLook(pack,id,{lightingRamp:{stops:[[0,'#141a21'],[1,'#a6b5d0']]}});
  assert.equal(next.revision,2);
  assert.throws(()=>looks.bind({asset:id,revision:1},assetPacks.create({packs:[next]})),/requires pack revision 1/);
});

test('only approved dither pairs and chosen reference colours survive promotion and revision',()=>{
  const { report } = KIT.palette.reviewDither(fit), reviewed = report.pairs.find(pair=>pair.status==='reviewed');
  const colors = fit.policy.palette;
  const extraction = KIT.palette.extract({width:colors.length,height:1,data:Uint8Array.from(
    colors.flatMap(color=>Array.from(Buffer.from(color.slice(1),'hex'))))});
  const indices = colors.map(color=>extraction.palette.indexOf(color));
  const reserved = [{color:colors.at(-1),match:false,dither:false}];
  const pack = assetPacks.savePaletteLook({id,label:'Slate swatches',palette:{reference:extraction,indices},
    reserved,dither:{review:report,approved:[reviewed.index],strength:.65},match:'perceptual'});
  const { palette } = pack.looks[0];
  assert.deepEqual(palette.palette,colors);
  assert.deepEqual(palette.reserved,reserved);
  assert.deepEqual(palette.dither.pairs,[{colors:reviewed.colors,lightness:reviewed.lightnessRanges[0]}]);
  const bound = looks.bind(id,assetPacks.create({packs:[pack]}));
  assert.equal(bound.palette.match,'perceptual');
  const next = assetPacks.savePaletteLook({id,reserved:[{color:colors.at(-1),match:true}]},pack);
  assert.equal(next.revision,2);
  assert.deepEqual(next.looks[0].palette.dither,palette.dither);
  assert.throws(()=>assetPacks.savePaletteLook({id,dither:{review:report,approved:[999]}},pack),/measured/);
  assert.throws(()=>assetPacks.savePaletteLook({id,palette:['#aa44cc']},pack),/Dither pair colors/);
  const accent = assetPacks.savePaletteLook({id:'workshop/accents',label:'Accents',reserved},next);
  assert.deepEqual(accent.looks.map(look=>look.id),[id,'workshop/accents']);
  assert.equal(accent.revision,3);
});

test('CLI saves linked findings in a native look pack and renders the bound material',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-look-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const put = (name,value)=>{
    const file = path.join(dir,name);
    fs.writeFileSync(file,JSON.stringify(value));
    return file;
  };
  const cli = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),...args],
    {encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const reviewed = KIT.palette.reviewRamp({stops:[[0,'#26314c'],[.45,'#82664e'],[1,'#ffc695']]});
  put('review.json',reviewed);
  const spec = put('approval.json',{id,label:'Slate ramp',ramp:{review:'review.json',interpolation:'smooth'}});
  const pack = path.join(dir,'pack.json');
  cli('palette','save-look',spec,'--out',pack);
  const report = JSON.parse(cli('look','inspect',pack));
  assert.equal(report.valid,true);
  assert.deepEqual(report.rules[0].lightingRamp.stops,reviewed.stops.map(row=>[row.position,row.color]));
  const scene = put('scene.json',{id:'ramp-test',style:'slate',camera:{target:[0,.4,0],dist:5,yaw:.35,pitch:.3},
    finish:{look:{renderStages:[]}},
    solids:[{kind:'box',id:'plate',at:[0,.4,0],half:[.8,.4,.55],round:.12,res:.08,
      mat:{role:'stone',lookAsset:id}}]});
  const image = path.join(dir,'render.png'), bypassed = path.join(dir,'bypassed.png');
  const view = ['--asset-pack',pack,'--w','112','--h','88','--px','1'];
  cli('render',scene,...view,'--out',image);
  cli('render',scene,...view,'--look','off','--out',bypassed);
  const PNG = require('../cli/png.js');
  assert.notDeepEqual(PNG.raster(image).data,PNG.raster(bypassed).data);
  cli('palette','save-look',spec,'--pack',pack,'--out',pack);
  assert.equal(JSON.parse(fs.readFileSync(pack,'utf8')).revision,1);
});
