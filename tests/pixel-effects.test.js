const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..');
const {KIT}=ink.load(), E=KIT.procedural.pixelEffects, D=KIT.procedural.drawing2d, R=KIT.procedural.raster;
const rect=(x,y,w,h,fill='#ffffff')=>({type:'rect',rect:[x,y,w,h],fill});
const draw=(width,height,commands)=>D.render({width,height,commands,edges:'hard'});
const pixel=(value,x,y=0)=>[...value.data.slice((y*value.width+x)*4,(y*value.width+x+1)*4)];
const sample=(mask,x,y)=>mask.data[y*mask.width+x];

test('kernel blur normalizes weights, resolves alpha without hidden RGB, and honors edges',()=>{
  const image={width:3,height:1,channels:4,data:Uint8Array.of(255,0,0,0,0,180,70,255,0,0,255,0)};
  const blur=E.kernelBlur(image,{kernel:[[1,2,1]],edge:'transparent'});
  assert.deepEqual(pixel(blur,0),[0,180,70,64]);
  assert.deepEqual(pixel(blur,1),[0,180,70,128]);
  assert.deepEqual(pixel(blur,2),pixel(blur,0));
  assert.deepEqual(pixel(image,0),[255,0,0,0]);
  const solid=R.canvas({width:3,height:2,color:[120,85,66,160]});
  assert.deepEqual(E.kernelBlur(solid,{kind:'box',radius:2}),solid);
  assert.throws(()=>E.kernelBlur(image,{kernel:[[1,1]]}),/odd dimensions/);
  const impulse=draw(5,1,[rect(0,0,1,1)]);
  assert.ok(pixel(E.kernelBlur(impulse,{kernel:[[1,1,1]],edge:'wrap'}),4)[3]>0);
  assert.equal(pixel(E.kernelBlur(impulse,{kernel:[[1,1,1]],edge:'clamp'}),4)[3],0);
});

test('path blur follows arc-length displacements with no streak across the corner',()=>{
  const image=draw(7,7,[rect(2,2,1,1,'#ffaa66')]);
  const path=D.path('M 10 10 L 12 10 L 12 12');
  const blur=E.pathBlur(image,path,{samples:3,filter:'nearest'});
  assert.deepEqual(pixel(blur,2,2),[255,170,102,85]);
  assert.deepEqual(pixel(blur,4,2),pixel(blur,2,2));
  assert.deepEqual(pixel(blur,4,4),pixel(blur,2,2));
  assert.equal(pixel(blur,3,3)[3],0);
  const backward=E.pathBlur(image,path,{samples:3,anchor:'end'});
  assert.equal(pixel(backward,0,0)[3],85);
  assert.equal(pixel(backward,4,4)[3],0);
});

test('distance outlines, bevels and glow produce reusable masks and stable edges',()=>{
  const image=draw(9,9,[rect(2,2,5,5,'#646464')]);
  const outline=E.outline(image,{outer:1,inner:1,color:'#e69964',innerColor:'#ff3333'});
  assert.equal(sample(outline.outer,1,3),255);
  assert.equal(sample(outline.outer,1,1),0);
  assert.equal(sample(outline.inner,2,4),255);
  assert.deepEqual(pixel(outline.value,2,4),[255,51,51,255]);
  const bevel=E.bevel(image,{width:2,direction:[-1,0],strength:1});
  assert.ok(pixel(bevel.value,2,4)[0]>100 && pixel(bevel.value,6,4)[0]<100);
  assert.ok(sample(bevel.height,2,4)<sample(bevel.height,4,4));
  const glow=E.glow(image,{radius:3,strength:1});
  assert.ok(sample(glow.mask,1,4)>0);
  assert.deepEqual(pixel(glow.value,4,4),pixel(image,4,4));
  assert.equal(pixel(glow.glow,0,0)[3]>0,true);
  const bright=draw(9,9,[rect(0,0,9,9,'#222222'),rect(4,4,1,1)]);
  assert.ok(pixel(E.glow(bright,{channel:'luma',threshold:220,radius:3,strength:5,placement:'over'}).value,3,4)[0]>34);
});

test('erosion recedes and repair fills holes or bridges only bounded breaks',()=>{
  const image=draw(7,7,[rect(2,2,3,3,'#66d8b0')]);
  const shrunk=E.erode(image,{radius:1});
  assert.equal(shrunk.mask.data.filter(Boolean).length,1);
  assert.deepEqual(pixel(shrunk.value,3,3),pixel(image,3,3));
  const ring=draw(7,7,[rect(1,1,5,5,'#66d8b0')]);
  ring.data[(3*7+3)*4+3]=0;
  const closed=E.repair(ring,{radius:1});
  assert.equal(closed.added.data.filter(Boolean).length,1);
  assert.deepEqual(pixel(closed.value,3,3),[102,216,176,255]);
  const thin=draw(9,5,[rect(1,2,2,1),rect(4,2,1,1),rect(7,2,1,1)]);
  const bridged=E.repair(thin,{method:'bridge',maxGap:1,color:'#ffa300'});
  assert.deepEqual(pixel(bridged.value,3,2),[255,163,0,255]);
  assert.equal(sample(bridged.added,5,2),0);
  assert.equal(sample(bridged.added,0,2),0);
  assert.deepEqual(E.repair(thin,{radius:0}).value,thin);
});

test('pixel sort moves full pixels stably within eligible runs',()=>{
  const data=Uint8Array.of(66,11,1,255,20,33,1,255,66,22,2,200,0,255,0,0,140,70,0,255,90,40,0,255);
  const image={width:6,height:1,channels:4,data};
  const sorted=E.pixelSort(image,{key:'r'});
  assert.deepEqual(pixel(sorted,0),[20,33,1,255]);
  assert.deepEqual(pixel(sorted,1),[66,11,1,255]);
  assert.deepEqual(pixel(sorted,2),[66,22,2,200]);
  assert.deepEqual(pixel(sorted,3),[0,255,0,0]);
  assert.deepEqual(pixel(sorted,4),[90,40,0,255]);
  const mask={width:6,height:1,channels:1,data:[0,255,255,0,0,0]};
  assert.deepEqual(E.pixelSort(image,{key:'r',mask}),image);
  assert.deepEqual(E.pixelSort(image,{key:'r',axis:'vertical'}),image);
});

test('analysis traces closed contours, including holes and image-edge regions, and emits pixel-center points',()=>{
  const image=draw(15,12,[
    rect(0,0,2,3),
    {type:'polygon',rings:[[[5,2],[13,2],[13,10],[5,10]],[[7,4],[11,4],[11,8],[7,8]]]}
  ]);
  const result=E.analyze(image);
  assert.equal(result.paths.length,3);
  assert.equal(result.paths.every(path=>path.closed && path.points.length>=3),true);
  assert.equal(result.paths.some(path=>path.points.some(([x])=>x===0)),true);
  assert.deepEqual(result.points,[[1,1.5],[9,6]]);
  assert.deepEqual(result.regions.map(region=>region.area),[6,48]);
  const none=E.analyze(image,{paths:false,pointMode:'pixels',stride:2,minArea:7});
  assert.deepEqual(none.paths,[]);
  assert.equal(none.points.every(([x,y])=>x>=5 && (x-.5)%2===0 && (y-.5)%2===0),true);
  assert.throws(()=>E.analyze(image,{pointMode:'pixels',limit:2}),/point limit/);
  assert.deepEqual(E.analyze(R.canvas({width:1,height:1})).paths,[]);
});

test('a CLI graph links a typed path into blur and exports traced paths and points',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-effects-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const n=(node,port)=>({node,...(port && {port})}), file=path.join(dir,'effect.json');
  fs.writeFileSync(file,JSON.stringify({format:'ink-studio/graph-project',version:1,nodes:{
    source:{op:'draw.render',inputs:{width:12,height:10,commands:[rect(3,3,2,2)]}},
    path:{op:'draw.path',inputs:{d:'M 0 0 L 3 0 L 3 3'}},
    smear:{op:'fx.pathBlur',inputs:{source:n('source'),path:n('path'),options:{samples:7}}},
    read:{op:'fx.analyze',inputs:{source:n('smear'),options:{threshold:24}}}
  },outputs:{image:n('smear'),lines:n('read','paths'),points:n('read','points')},
  exports:{image:{output:'image',format:'png'},lines:{output:'lines',format:'json'},points:{output:'points',format:'json'}}}));
  const run=spawnSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'graph','run',file,'--out',dir],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(run.stdout).passed,true);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'artifacts/lines.json'))).some(path=>path.closed));
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'artifacts/points.json'))).length>=1);
});
