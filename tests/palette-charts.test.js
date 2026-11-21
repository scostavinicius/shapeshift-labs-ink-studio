const assert = require('node:assert/strict');
const {test} = require('node:test');
const {mkdtempSync,rmSync,readFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {execFileSync} = require('node:child_process');
const PNG = require('../cli/png.js');
const {KIT:K,ColorSpace,SplatEffects} = require('..').load();
const palette = ['#191f2c','#202634','#2b8c86','#fce4b4'];

test('swatch grids retain original indices, including duplicates and transparent gaps',()=>{
  const chart = K.palette.chart({palette:[...palette,palette[0]],labels:false,columns:2,cell:[2,2],gap:1});
  const raster = chart.indexed();
  assert.deepEqual([raster.width,raster.height],[5,8]);
  assert.deepEqual(raster.slots.slice(0,5),[0,0,null,1,1]);
  assert.deepEqual(raster.slots.slice(-5),[4,4,null,null,null]);
  assert.deepEqual(chart.cells[3],{index:3,bounds:[3,3,2,2]});
  assert.equal(chart.raster().alpha[2],0);
  raster.slots.fill(null);
  assert.equal(chart.indexed().slots[0],0);
  const labelled = K.palette.chart({palette});
  assert(labelled.raster().indices.some((slot,pixel)=>pixel%labelled.w<12 && Math.floor(pixel/labelled.w)<8 && slot===3));
});

test('bars use OKLab lightness and HSV saturation, and pairs are ranked in OKLab',()=>{
  const swatches = ['#000000','#ffffff','#e00000','#df0000','#ffffff'];
  const chart = type=>K.palette.chart({type,palette:swatches});
  const brightness = chart('brightness').cells;
  assert.equal(brightness[0].value,0);
  assert.equal(brightness[1].pixels,104);
  assert.equal(brightness[2].value,ColorSpace.toOKLab([224/255,0,0])[0]);
  assert.deepEqual(chart('saturation').cells.map(c=>c.value),[0,0,1,1,0]);
  const pairs = chart('closest-pairs').cells;
  assert.deepEqual(pairs.slice(0,2).map(row=>row.indices),[[1,4],[2,3]]);
  assert.equal(pairs[0].distance,0);
  assert(pairs.every((pair,i)=>!i || pair.distance>=pairs[i-1].distance));
});

test('dither tiles preserve authored pair order and Bayer coverage',()=>{
  const chart = K.palette.chart({type:'dither-pairs',palette,pairs:[[3,0]],labels:false,
    cell:[4,4],gap:0,mix:[0,.25,.5,.75,1]});
  const {indices} = chart.raster();
  for (const {bounds:[x,y,w,h],indices:pair,share,actualShare} of chart.cells) {
    assert.deepEqual(pair,[3,0]);
    let dark = 0;
    for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) {
      const slot = indices[(y+dy)*chart.w+x+dx];
      assert([3,0].includes(slot));
      dark += Number(slot===0);
    }
    assert.equal(dark/16,share);
    assert.equal(actualShare,share);
  }
  assert.throws(()=>K.palette.chart({type:'dither-pairs',palette,pairs:[[2,2]]}),/distinct/);
  assert.throws(()=>K.palette.chart({type:'closest-pairs',palette:['#111111']}),/at least two/);
});

test('the same top-left indexed asset projects with its own palette and transparent slots',()=>{
  const chart = K.palette.chart({palette,labels:false,columns:2,cell:[1,1],gap:1});
  const raster = chart.indexed({size:[3,3]});
  const resolve = value=>value===undefined ? [1,1,1] : K.procedural.materials.perceptual.parse(value);
  const prepare = raster=>SplatEffects.layer({type:'projected',pattern:'indexed',
    projection:{across:[0,1,0]},raster},undefined,resolve);
  const layer = prepare(raster);
  const sample = (x,y)=>[...layer.sample({position:[x,y,0]})];
  assert.deepEqual(sample(.5,2.5).slice(0,3),resolve(palette[0]));
  assert.deepEqual(sample(2.5,.5).slice(0,3),resolve(palette[3]));
  assert.equal(sample(1.5,.5)[3],0);
  assert.throws(()=>prepare({...raster,slots:[9,...raster.slots.slice(1)]}),/valid palette indices/);
});

test('the CLI emits true indexed PNGs and JSON with matching slots',()=>{
  const dir = mkdtempSync(join(tmpdir(),'ink-palette-chart-'));
  const cli = join(__dirname,'../cli/ink-studio.js'), fixture = join(__dirname,'../examples/palette-charts.json');
  try {
    const file = join(dir,'sheet.png');
    const run = (...args)=>execFileSync(process.execPath,[cli,'palette','chart',fixture,...args],{encoding:'utf8'});
    run('--out',file);
    const {type,cells,raster} = JSON.parse(run('--format','data'));
    assert.equal(type,'swatches');
    assert.equal(cells.length,raster.palette.length);
    const png = readFileSync(file), decoded = PNG.raster(png);
    assert.equal(png[25],3);
    assert.deepEqual([decoded.w,decoded.h],[raster.width,raster.height]);
    const swatches = raster.palette.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
    raster.slots.forEach((slot,pixel)=>{
      assert.deepEqual([...decoded.data.subarray(pixel*4,pixel*4+4)],slot===null ? [0,0,0,0] : [...swatches[slot],255]);
    });
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
