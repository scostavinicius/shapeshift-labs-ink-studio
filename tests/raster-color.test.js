const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..');
const {KIT,PixelLook}=ink.load(), C=KIT.procedural.rasterColor, R=KIT.procedural.raster;
const pixels=(rows,width=rows.length)=>({width,height:rows.length/width,channels:4,data:Uint8Array.from(rows.flat())});
const read=value=>Array.from({length:value.width*value.height},(_,i)=>[...value.data.slice(i*4,i*4+4)]);
const tone=(n,a=255)=>[n,n,n,a];

test('ordered raster resolution uses the native matcher, accents and screen phase',()=>{
  const source=pixels([tone(117),tone(117),[255,187,88,120],tone(90,0)]);
  const policy={palette:['#000000','#ffffff'],reserved:['#ffbb58'],match:'perceptual',dither:{
    pattern:'bayer',strength:1,pairs:[{colors:['#000000','#ffffff']}] }};
  const result=C.resolve(source,policy,{phase:[2,1]});
  const plan=PixelLook.preparePalette(policy);
  const expected=read(source).slice(0,3).map((rgba,x)=>plan.index(rgba.slice(0,3).map(n=>n/255),x+2,1));
  assert.deepEqual([...result.indices.data],[...expected,-1]);
  assert.deepEqual(read(result.value)[2],[255,187,88,120]);
  assert.deepEqual(read(result.value)[3],tone(90,0));
  assert.deepEqual(result.palette,['#000000','#ffffff','#ffbb58']);
  assert.deepEqual(read(source)[0],tone(117));
});

test('diffusion is deterministic, respects pair ranges and preserves colors outside the selected region',()=>{
  const width=16, height=8;
  const rows=Array.from({length:width*height},(_,i)=>i===7 ? [255,187,88,155] : i===9 ? tone(127,0) : tone(127));
  const source=pixels(rows,width), allowed={colors:['#000000','#ffffff']};
  const policy={palette:['#000000','#ffffff'],reserved:['#ffbb58'],dither:{pairs:[allowed]}};
  const opts={method:'diffusion'};
  const result=C.resolve(source,policy,opts);
  assert.deepEqual(result,C.resolve(source,policy,opts));
  const white=[...result.indices.data].filter(n=>n===1).length;
  assert.ok(white>45 && white<80);
  assert.deepEqual(read(result.value)[7],[255,187,88,155]);
  assert.equal(result.indices.data[9],-1);
  const solid=C.resolve(source,policy,{method:'solid'});
  for (const pairs of [[],[{...allowed,lightness:[0,.02]}]]) {
    const restricted=C.resolve(source,{...policy,dither:{pairs}},opts);
    assert.deepEqual(restricted.value,solid.value);
  }
  const mask={width,height,channels:1,data:Uint8Array.from({length:width*height},(_,i)=>i%width<8 ? 255 : 0)};
  const masked=C.resolve(source,policy,{...opts,mask});
  assert.equal(masked.indices.data[12],-1);
  assert.deepEqual(read(masked.value)[12],tone(127));
  assert.deepEqual(C.resolve(source,policy,{...opts,strength:0}),solid);
});

test('gradient mapping uses raw numeric channels, named ramp stops and animated Ink ramps',()=>{
  const source={width:3,height:1,channels:1,data:Float32Array.of(-2,0,2)};
  const palette={palette:['#1d273f','#99c7ab','#ffd6ad'],roles:{stone:[0,1,2]}};
  const mapped=C.gradient(source,'stone',{channel:0,range:[-2,2],palette});
  assert.deepEqual(read(mapped),[[29,39,63,255],[153,199,171,255],[255,214,173,255]]);
  const path=C.gradient(source,{colors:['#ff0000','#00ffff']},{channel:0,range:[-2,2]});
  assert.deepEqual([read(path)[0],read(path)[2]],[[255,0,0,255],[0,255,255,255]]);
  const field={type:'primary',shadow:'#100010',accent:'#112233',highlight:'#ffffff',
    animation:{interpolation:'linear',keys:[{time:0},{time:1,highlight:'#ffa800'}]}};
  const result=C.gradient(pixels([tone(255,127)]),field,{channel:'r',time:1});
  assert.deepEqual(read(result),[[255,168,0,127]]);
  assert.throws(()=>C.gradient(source,'unknown',{palette}),/Unknown or empty/);
});

test('channel operations and stacks keep alpha unless an output explicitly changes it',()=>{
  const source=pixels([[80,110,220,128]]);
  const channels=C.channels(source,{order:['b',{channel:'g',gain:-1,bias:255},'r']});
  assert.deepEqual(read(channels),[[220,145,80,128]]);
  const mixed=C.stack(source,{name:'Mix',steps:[{type:'channelMix',matrix:[[0,0,1],[0,1,0],[1,0,0]]}]});
  assert.deepEqual(read(mixed),[[220,110,80,128]]);
  const palette={palette:['#506edc','#ff0033'],roles:{body:[0],signal:[1]}};
  const replaced=C.stack(source,{name:'Role',steps:[{type:'paletteRemap',remap:{rules:[{from:'body',to:'signal'}]}}]},{palette});
  assert.deepEqual(read(replaced),[[255,0,51,128]]);
});

test('keying outputs a matte and replacement selects original pixels without cascading rules',()=>{
  const source=pixels([[0,255,0,255],[0,230,0,128],[255,0,0,192],[0,0,255,255]]);
  const result=C.key(source,{color:'#00ff00',metric:'rgb',tolerance:0,softness:.20});
  assert.deepEqual(read(result.value).map(row=>row[3]),[0,62,192,255]);
  assert.deepEqual([...result.matte.data],[0,62,192,255]);
  assert.deepEqual(read(C.key(source,{mode:'channel',channel:'r',range:[200,255]}).value)[2],[255,0,0,0]);
  const swapped=C.replace(source,[{from:'#ff0000',to:'#0000ff'},{from:'#0000ff',to:'#ffaa00'}]);
  assert.deepEqual(read(swapped).slice(2),[[0,0,255,192],[255,170,0,255]]);
  const mask={width:4,height:1,data:[0,0,0,255]};
  assert.deepEqual(read(C.replace(source,[{from:'#ff0000',to:'#ffffff'}],{mask})),read(source));
});

function savedPack() {
  return KIT.authoring.assetPacks.savePaletteLook({
    id:'studio/twilight',label:'Twilight',ramp:{stops:[[0,'#201030'],[1,'#a0dac0']]},
    palette:['#201030','#a0dac0'],reserved:['#ffbb58'],
    dither:{pairs:[{colors:['#201030','#a0dac0']}]}
  });
}

test('versioned look assets bind their original ramp and palette before applying the raster mask',()=>{
  const source=pixels([tone(15),tone(240),[255,187,88,121],tone(55)]);
  const pack=savedPack(), data=JSON.parse(JSON.stringify(pack));
  data.looks[0].stack={name:'Tint',steps:[{type:'exposure',stops:1}]};
  const options={channel:'r',method:'solid',mask:{width:4,height:1,data:[255,255,255,0]}};
  const binding={asset:'studio/twilight',revision:1};
  const {value,metadata}=C.look(source,data,binding,options);
  assert.deepEqual(read(value),[[32,16,48,255],[160,218,192,255],[255,187,88,121],tone(55)]);
  assert.deepEqual(metadata,{id:'studio/twilight',revision:1,stack:true,ramp:true,palette:true});
  const bundle=KIT.authoring.assetPacks.bundle([data],['studio']);
  assert.deepEqual(C.look(source,bundle,binding,options).value,value);
  const partial=C.look(source,pack,{...binding,strength:.1},options).value;
  assert.deepEqual(read(partial).slice(0,2),[[32,16,48,255],[160,218,192,255]]);
  assert.deepEqual(read(C.look(source,pack,false,options).value),read(source));
  assert.throws(()=>C.look(source,pack,{...binding,revision:2}),/requires pack revision/);
});

test('CLI consumes a PNG and a saved look manifest using ordinary graph assets',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-raster-color-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const PNG=require('../cli/png.js'), source=pixels([tone(15),tone(240),[255,187,88,121]]);
  fs.writeFileSync(path.join(dir,'frame.png'),PNG.encode(source.width,source.height,source.data,4));
  fs.writeFileSync(path.join(dir,'pack.json'),JSON.stringify(savedPack()));
  const node=(node,port)=>({node,...(port && {port})});
  const file=path.join(dir,'project.json');
  fs.writeFileSync(file,JSON.stringify({format:'ink-studio/graph-project',version:1,assets:{
    frame:{format:'png',file:'frame.png'},palette:{format:'json',file:'pack.json'}
  },nodes:{
    frame:{op:'pngAsset',inputs:{name:'frame'}},pack:{op:'jsonAsset',inputs:{name:'palette'}},
    look:{op:'color.look',inputs:{source:node('frame'),pack:node('pack'),binding:{asset:'studio/twilight',revision:1}}}
  },outputs:{value:node('look'),look:node('look','metadata')},exports:{image:{output:'value',format:'png'}}}));
  const run=spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'graph','run',file,'--out',dir],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(run.stdout);
  assert.equal(report.outputs.look.revision,1);
  const image=PNG.raster(path.join(dir,'artifacts/image.png'));
  assert.deepEqual([...image.data.slice(-4)],[255,187,88,121]);
});
