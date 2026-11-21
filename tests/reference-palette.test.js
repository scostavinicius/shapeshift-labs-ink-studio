const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');
const { KIT } = ink.load();

function temporary(test) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-reference-palette-'));
  test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}

test('indexed PNG usage preserves duplicate, unused, and transparent slots in table order', t => {
  const file = path.join(temporary(t),'design.png');
  PNG.writeIndexed(file,6,1,[0,1,0,null,3,null],[[210,44,33],[210,44,33],[49,81,166],[162,141,82]]);
  const report = ink.readReferencePalette(file,{size:1});
  assert.equal(report.source,'indexed');
  assert.equal(report.reduced,false);
  assert.equal(report.requestedSize,null);
  assert.deepEqual(report.palette,['#d22c21','#d22c21','#3151a6','#a28d52','#000000']);
  assert.deepEqual(report.swatches.map(row=>row.pixels),[2,1,0,1,2]);
  assert.deepEqual(report.swatches.map(row=>row.includedPixels),[2,1,0,1,0]);
  assert.deepEqual(report.alpha,{mode:'visible',transparent:2,partial:0,opaque:4,included:4,excluded:2});
  assert.equal(ink.readReferencePalette(file,{alpha:'all'}).swatches[4].includedPixels,2);
});

test('Adam7 PNGs count packed indices and keep partially transparent palette entries', () => {
  // A 9 by 7, 2-bit indexed image with slots (x + 2*y) mod 4, UP-filtered within each pass.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHAgMAAAHQ8r9lAAAADFBMVEWmKD+mKD9Dsa9Di8ETKBZ9AAAAA3RSTlP/UAD+Va1nAAAAH0lEQVR4nGNiYALBBUCsBGQwMJUzQUQ2bmwAckFCDAAzygM4YKHxRwAAAABJRU5ErkJggg==','base64');
  const table = [[166,40,63,255],[166,40,63,80],[67,177,175,0],[67,139,193,255]];
  const slots = Array.from({length:63},(_,p)=>(p%9 + 2*Math.floor(p/9))%4);
  const report = ink.readReferencePalette(png,{alpha:'opaque'});
  assert.equal(report.bitDepth,2);
  assert.deepEqual(Array.from(PNG.raster(png).data),slots.flatMap(i=>table[i]));
  assert.deepEqual(report.swatches.map(row=>row.alpha),[255,80,0,255]);
  assert.deepEqual(report.swatches.map(row=>row.pixels),[18,14,17,14]);
  assert.deepEqual(report.swatches.map(row=>row.includedPixels),[18,0,0,14]);
  assert.deepEqual(report.alpha,{mode:'opaque',transparent:17,partial:14,opaque:32,included:32,excluded:31});
});

test('the 16-bit PNG path checks full precision alpha and reports 8-bit palette colors', () => {
  // Two reds that round to the same RGB8 entry. The first has alpha 1/65535. The third pixel is transparent blue.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAYAAABLcMj3AAAAFklEQVR4nGP4/58BBBj/XwJREB6IBABlHwfN742UzgAAAABJRU5ErkJggg==','base64');
  const report = ink.readReferencePalette(png);
  assert.equal(report.bitDepth,16);
  assert.equal(report.method,'exact');
  assert.deepEqual(report.swatches,[{index:0,color:'#ff0000',pixels:2}]);
  assert.deepEqual(report.alpha,{mode:'visible',transparent:1,partial:1,opaque:1,included:2,excluded:1});
});

const reference = [
  [255,0,0,255],[255,0,0,255],[255,0,0,255],[224,0,0,128],
  [0,0,255,255],[0,0,255,255],[0,0,223,255],[0,0,223,255],[0,255,0,0]
];
const extract = (rgba,options) => KIT.palette.extract({width:rgba.length,height:1,data:Uint8ClampedArray.from(rgba.flat())},options);

test('full-colour extraction preserves exact counts or groups all included pixels when reduced', () => {
  const exact = extract(reference,{size:4});
  assert.equal(exact.reduced,false);
  assert.deepEqual(exact.palette,['#ff0000','#0000df','#0000ff','#e00000']);
  assert.deepEqual(exact.swatches.map(row=>row.pixels),[3,2,2,1]);
  assert.deepEqual(exact.alpha,{mode:'visible',transparent:1,partial:1,opaque:7,included:8,excluded:1});

  const reduced = extract(reference,{size:2});
  assert.equal(reduced.reduced,true);
  assert.equal(reduced.method,'weighted-median-cut');
  assert.equal(reduced.sourceSwatches,4);
  assert.deepEqual(reduced.palette,['#0000ef','#f70000']);
  assert.deepEqual(reduced.swatches.map(row=>row.pixels),[4,4]);
  assert.deepEqual(reduced,extract(reference.slice().reverse(),{size:2}));

  assert.deepEqual(extract(reference,{alpha:'opaque'}).palette,['#ff0000','#0000df','#0000ff']);
  assert(extract(reference,{alpha:'all'}).palette.includes('#00ff00'));
  assert.deepEqual(extract([[81,2,32,0]]).palette,[]);
  assert.throws(()=>extract(reference,{size:0}),/palette size/);
});

test('palette extract exposes the PNG report in the CLI', t => {
  const dir = temporary(t);
  const file = path.join(dir,'reference.png'), out = path.join(dir,'report','palette.json');
  fs.writeFileSync(file,PNG.encode(9,1,Uint8Array.from(reference.flat()),4));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js'), args = [cli,'palette','extract',file,'--size','3','--alpha','opaque'];
  const fromStdout = JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
  assert.deepEqual(fromStdout,ink.readReferencePalette(file,{size:3,alpha:'opaque'}));
  assert.equal(fromStdout.reduced,false);
  execFileSync(process.execPath,[...args,'--out',out]);
  assert.deepEqual(JSON.parse(fs.readFileSync(out,'utf8')),fromStdout);

  const alias = path.join(dir,'source-alias.png');
  fs.linkSync(file,alias);
  assert.throws(()=>execFileSync(process.execPath,[...args,'--out',alias],{stdio:'pipe'}),
    /separate file from the reference image/);
  assert.deepEqual(ink.readReferencePalette(file,{size:3,alpha:'opaque'}),fromStdout);
});
