const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const ink = require('..');
const {KIT} = ink.load(), D = KIT.procedural.drawing2d, R = KIT.procedural.raster;
const pixel = (r,x,y) => Array.from(r.data.slice((y*r.width+x)*4,(y*r.width+x+1)*4));
const render = (commands,width=30,height=24,edges='hard') => D.render({width,height,commands,edges});

test('reused rasterizer handles rounded shapes, even-odd paths, edges and straight alpha',()=>{
  const value = render([
    {type:'rect',rect:[0,0,30,24],fill:'#203040'},
    {type:'rect',rect:[2,2,12,8],radius:3,fill:'#ffffff'},
    {type:'ellipse',rect:[16,1,10,10],fill:'#ff0000'},
    {type:'path',d:'M 2 13 H 26 V 22 H 2 Z M 7 15 L 21 15 21 20 7 20 Z',fill:'#77bbcc'}
  ]);
  assert.deepEqual(pixel(value,7,6),[255,255,255,255]);
  assert.deepEqual(pixel(value,2,2),[32,48,64,255]);
  assert.deepEqual(pixel(value,20,6),[255,0,0,255]);
  assert.deepEqual(pixel(value,3,14),[119,187,204,255]);
  assert.deepEqual(pixel(value,9,17),[32,48,64,255]);
  const translucent = render([{type:'rect',rect:[0,0,1,1],color:'#b1583c10'}],1,1);
  assert.deepEqual(pixel(translucent,0,0),[177,88,60,16]);
  const edges = render([{type:'rect',rect:[.5,0,1,1],color:'#ff0000'}],2,1,'smooth');
  assert.deepEqual(pixel(edges,0,0),[255,0,0,128]);
});

test('typed curve paths and variable-width ribbons draw traversable strips',()=>{
  const p = D.path('m 1 3 c 2 0 4 0 6 0 l 13 0');
  assert.equal(p.points.length,14);
  assert.deepEqual(p.points.at(-1),[20,3]);
  const band = D.ribbon([[2,8],[12,8],[24,8]],{width:[0,6,10],fill:'#43b3cc'});
  const value = render([band]);
  assert.equal(pixel(value,12,6)[3],255);
  assert.equal(pixel(value,2,5)[3],0);
  assert.equal(pixel(value,22,5)[3],255);
  const ring = D.ribbon(D.path('M 8 8 L 20 8 20 18 8 18 Z'),{width:2});
  const loop = render([ring]);
  assert.equal(pixel(loop,8,12)[3],255);
  assert.equal(pixel(loop,14,12)[3],0);
  assert.deepEqual(D.path('M 2 1 a 0 5 0 0 0 5 3').points.at(-1),[7,4]);
  assert.throws(()=>D.path('M 0 0 C 5'),/Wrong arguments/);
  assert.throws(()=>D.path('M 1 1 L 2 2; foo'),/Invalid drawing path token/);
  assert.throws(()=>D.path('M 0 0 L 2 2 M 3 3 L 4 4'),/one contour/);
  assert.throws(()=>D.ribbon([[0,0],[0,0]]),/distinct/);
});

test('bitmap text aligns wrapped rows and supports custom glyphs in draws',()=>{
  const style = {scale:2,tracking:1,leading:3,align:'right',columns:2,color:'#ffa04080',customGlyphs:{X:['#']}};
  const {value,metrics}=D.text('XXX',style);
  assert.deepEqual(metrics,{width:25,height:35,lines:2,scale:2});
  assert.deepEqual(pixel(value,0,0),[255,160,64,128]);
  assert.equal(pixel(value,0,19)[3],0);
  assert.deepEqual(pixel(value,13,19),[255,160,64,128]);
  const result = render([{type:'text',text:'X',...style,at:[-1,1]}],8,8);
  assert.deepEqual(pixel(result,0,1),[255,160,64,128]);
  assert.equal(pixel(result,1,1)[3],0);
});

test('relative boxes use parent content, aligned edges and anchored raster placement',()=>{
  const definitions=[
    {id:'badge',parent:'panel',size:[12,8],anchor:[1,1],pivot:[1,1],offset:[-2,-1]},
    {id:'panel',size:['50%','75%'],anchor:[.5,.5],pivot:[.5,.5],padding:[4,2,4,2]},
    {id:'left',size:['50%','100%']},
    {id:'right',size:['50%','100%'],anchor:[.5,0]}
  ];
  const a=D.boxes({width:101,height:80,boxes:definitions});
  const b=D.boxes({width:201,height:80,boxes:definitions});
  assert.equal(a.left.rect[2],a.right.rect[0]);
  assert.deepEqual(a.badge.rect,[58,59,12,8]);
  assert.deepEqual(b.badge.rect,[133,59,12,8]);
  assert.throws(()=>D.boxes({width:30,height:20,boxes:[{id:'x',parent:'y'},{id:'y',parent:'x'}]}),/parent cycle/);
  assert.throws(()=>D.boxes({width:30,height:20,boxes:[{id:'x',parent:'missing'}]}),/Unknown layout parent/);
  const src=R.canvas({width:8,height:2,color:[110,80,190]});
  const contain=D.place(src,a.badge);
  assert.deepEqual([contain.x,contain.y,contain.source.width,contain.source.height],[58,62,12,3]);
  const cover=D.place(src,a.badge,{fit:'cover'});
  assert.deepEqual([cover.x,cover.y,cover.source.width,cover.source.height],[58,59,12,8]);
  assert.equal(pixel(cover.source,0,0)[0],110);
});

test('flood fill respects seed tolerance, diagonal connectivity and source immutability',()=>{
  const source={width:3,height:3,channels:1,data:[10,14,35,200,16,200,200,200,10]};
  const options={seed:[0,0],tolerance:5,color:'#ffa030'};
  const result=D.floodFill(source,options);
  assert.equal(result.stats.area,2);
  assert.deepEqual([...result.mask.data],[255,255,0,0,0,0,0,0,0]);
  assert.deepEqual(pixel(result.value,1,0),[255,160,48,255]);
  assert.deepEqual(pixel(result.value,1,1),[16,16,16,255]);
  assert.equal(source.data[0],10);
  const diagonals={width:2,height:2,channels:1,data:[10,99,99,10]};
  assert.equal(D.floodFill(diagonals,{...options,connectivity:4}).stats.area,1);
  assert.equal(D.floodFill(diagonals,{...options,connectivity:8}).stats.area,2);
  assert.throws(()=>D.floodFill(source,{seed:[3,0]}),/in-bounds/);
});

test('component extraction returns row-major IDs, crops and an exact isolation mask',()=>{
  const raw=render([
    {type:'polygon',points:[[0,0],[4,0],[4,4],[3,4],[3,1],[0,1]],fill:'#ffaa00'},
    {type:'rect',rect:[0,2,2,2],fill:'#2266cc'},
    {type:'rect',rect:[5,0,1,1],fill:'#ffffff'}
  ],6,4);
  const {value,labels}=D.components(raw,{minArea:2});
  assert.deepEqual(value.map(({id,area})=>[id,area]),[[1,7],[2,4]]);
  assert.equal(labels.data[5],0);
  assert.equal(labels.data[2*6],2);
  const crop=D.extract(raw,labels,value[0]);
  assert.deepEqual([crop.width,crop.height],[4,4]);
  assert.deepEqual(pixel(crop,0,0),[255,170,0,255]);
  assert.deepEqual(pixel(crop,0,2),[0,0,0,0]);
  assert.equal(D.components({width:2,height:2,channels:1,data:[1,0,0,1]},{connectivity:8}).value.length,1);
});

test('CLI draws, segments, extracts and packs components through stock graph nodes',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-drawing-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source = path.join(dir,'project.json'), cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const node=(name,port)=>({node:name,...(port && {port})}), input=name=>({input:name});
  const spec={format:'ink-studio/graph-project',version:1,groups:{Cut:{
    inputs:{item:'record',labels:'raster',source:'raster'},
    nodes:{crop:{op:'raster.extractComponent',inputs:{component:input('item'),labels:input('labels'),source:input('source')}}},
    outputs:{value:node('crop')}
  }},nodes:{
    icons:{op:'draw.render',inputs:{width:12,height:6,edges:'hard',commands:[
      {type:'ellipse',rect:[0,0,4,4],fill:'#22ddaa'},{type:'rect',rect:[7,1,4,4],fill:'#ff8822'}
    ]}},
    parts:{op:'raster.components',inputs:{source:node('icons')}},
    crops:{op:'array.map',group:'Cut',inputs:{items:node('parts'),labels:node('parts','labels'),source:node('icons')}},
    sheet:{op:'raster.pack',inputs:{sprites:node('crops'),options:{maxWidth:16}}}
  },outputs:{atlas:node('sheet','atlas'),parts:node('parts')},
  exports:{atlas:{output:'atlas',format:'atlas'},regions:{output:'parts',format:'json'}}};
  fs.writeFileSync(source,JSON.stringify(spec));
  const result=spawnSync(process.execPath,[cli,'graph','run',source,'--out',dir],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const atlas=ink.readSpriteAtlas(path.join(dir,'artifacts/atlas/atlas.json')).snapshot();
  assert.deepEqual(atlas.metadata.frames.map(frame=>frame.rect.width),[4,4]);
  const regions=JSON.parse(fs.readFileSync(path.join(dir,'artifacts/regions.json')));
  assert.equal(regions.length,2);
});
