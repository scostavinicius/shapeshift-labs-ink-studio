const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..'), loaded=ink.load(), {KIT,TexturedSurface}=loaded;
const W=KIT.procedural.rasterWarp,R=KIT.procedural.raster,D=KIT.procedural.drawing2d;
const bytes=(width,height,data)=>({width,height,channels:4,data:Uint8Array.from(data.flat())});
const plane=(width,height,data)=>({width,height,channels:1,data});
const pixel=(src,x,y=0)=>[...src.data.slice((y*src.width+x)*4,(y*src.width+x+1)*4)];
const red=[255,0,0,255],green=[0,255,0,255],blue=[0,0,255,255],white=[255,255,255,255],clear=[0,0,0,0];
const solid=(color,width=4,height=1)=>R.canvas({width,height,color});
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const draw=(width,height,commands)=>D.render({width,height,commands,edges:'hard'});

test('UV fields use normalized pixel centers, explicit boundaries and premultiplied filtering',()=>{
  const src=bytes(2,1,[red,blue]);
  assert.deepEqual(W.sample(src,W.field({width:2,height:1})),src);
  const shift=W.field({width:2,height:1,matrix:[[1,0,.5],[0,1,0]]});
  assert.deepEqual(pixel(W.sample(src,shift,{filter:'nearest',edge:'wrap'}),1),red);
  assert.deepEqual(pixel(W.sample(src,shift,{edge:'transparent'}),1),clear);
  assert.deepEqual(pixel(W.sample(src,shift,{edge:'mirror'}),1),blue);
  const hidden=bytes(2,1,[[255,0,0,0],blue]);
  const result=W.sample(hidden,W.field({width:1,height:1}));
  assert.deepEqual(pixel(result,0),[0,0,255,128]);
  assert.throws(()=>W.sample(src,plane(1,1,[0])),/optional coverage/);
});

test('mesh and grid warps interoperate and keep adjacent triangle coverage complete',()=>{
  const src=draw(9,7,[rect(0,0,9,7,'#449e89'),rect(2,1,7,4,'#f58241')]);
  const points=[[0,0],[.5,0],[1,0],[0,1],[.5,1],[1,1]];
  const regular=W.grid(src,{columns:3,rows:2,points});
  assert.deepEqual(regular.value,src);
  assert.ok(regular.field.data.filter((_,i)=>i%3===2).every(n=>n===1));
  const to=points.map(([u,v])=>[u+.25,v]);
  const grid=W.grid(src,{columns:3,rows:2,points:to},{edge:'transparent'});
  assert.deepEqual(pixel(grid.value,0,3),clear);
  assert.deepEqual(W.sample(src,grid.field,{edge:'transparent'}),grid.value);
  const triangle=W.mesh(src,{from:[[0,0],[1,0],[0,1]],to:[[0,0],[1,0],[0,1]],triangles:[[0,1,2]]});
  assert.deepEqual(pixel(triangle.value,8,6),clear);
  assert.throws(()=>W.mesh(src,{from:points,to,triangles:[[0,0,1]]}),/distinct vertices/);
});

test('polar mapping wraps angles and respects aspect ratio and annulus coverage',()=>{
  const strip=bytes(4,2,[red,green,blue,white,red,green,blue,white]);
  const circle=W.polar(strip,{width:7,height:5,radii:[.14,.5],filter:'nearest'}).value;
  assert.deepEqual(pixel(circle,3,2),clear);
  assert.deepEqual(pixel(circle,5,2),red);
  assert.deepEqual(pixel(circle,3,4),green);
  assert.deepEqual(pixel(circle,1,2),blue);
  assert.deepEqual(pixel(circle,3,0),white);
  assert.deepEqual(pixel(circle,6,2),clear);
  const bands=W.polar(circle,{mode:'toPolar',width:8,height:3,radii:[.25,.45],filter:'nearest'}).value;
  assert.equal(bands.width,8);
  assert.ok(bands.data.some(n=>n===255));
});

test('displacement moves pixels in authored units and refraction leaves flat or index-one maps unchanged',()=>{
  const src=bytes(4,1,[red,green,blue,white]);
  const shift=plane(4,1,[1,1,1,1]);
  const moved=W.displace(src,shift,{scale:[1,0],edge:'transparent',filter:'nearest'}).value;
  assert.deepEqual(pixel(moved,0),clear);
  assert.deepEqual(pixel(moved,1),red);
  const slope=plane(4,1,[0,90,170,255]);
  assert.deepEqual(W.refract(src,slope,{index:1}).value,src);
  assert.deepEqual(W.refract(src,shift).value,src);
  const changed=W.refract(src,slope,{depth:22});
  assert.notDeepEqual(changed.value,src);
  assert.deepEqual(W.sample(src,changed.field),changed.value);
});

test('image morph aligns moving landmarks before it blends color and restores exact endpoints',()=>{
  const a=draw(12,5,[rect(2,1,1,3,'#ff0000')]),b=draw(12,5,[rect(8,1,1,3,'#0000ff')]);
  const grid=u=>[[0,0],[u,0],[1,0],[0,1],[u,1],[1,1]];
  const control={from:grid(2.5/12),to:grid(8.5/12),triangles:[[0,1,3],[3,1,4],[1,2,4],[4,2,5]]};
  assert.deepEqual(W.morph(a,b,control,0),a);
  assert.deepEqual(W.morph(a,b,control,1),b);
  const mid=W.morph(a,b,control,.5,{filter:'nearest'});
  assert.deepEqual(pixel(mid,5,2),[128,0,128,255]);
  assert.deepEqual(pixel(mid,2,2),clear);
  assert.deepEqual(pixel(mid,8,2),clear);
});

test('pixel times select and mix exact frames and Ink raster tags',()=>{
  const frames=[solid(red),solid(blue)], map=plane(4,1,[-.5,0,.5,1.5]);
  const value=W.timeRemap(frames,map,{fps:1,time:.5});
  assert.deepEqual([0,1,2,3].map(x=>pixel(value,x)),[red,[128,0,128,255],blue,blue]);
  const wrapped=W.timeRemap(frames,plane(4,1,[0,1,1.5,-.5]),{fps:1,mode:'absolute',playback:'loop'});
  assert.deepEqual([0,1,2,3].map(x=>pixel(wrapped,x)),[red,blue,[128,0,128,255],[128,0,128,255]]);
  const mirrored=W.timeRemap(frames,plane(4,1,[0,1,2,3]),{fps:1,mode:'absolute',playback:'pingpong',interpolation:'step'});
  assert.deepEqual([0,1,2,3].map(x=>pixel(mirrored,x)),[red,blue,red,blue]);
  const layer={width:1,height:1,fps:10,layers:{base:{frames:[red,green,blue]}},
    tags:{swatch:{start:1,end:3,fps:5,loop:false}}};
  const tagged=W.frames(layer,{tag:'swatch'});
  assert.equal(tagged.fps,5);
  assert.deepEqual(tagged.times,[0,.2]);
  assert.equal(tagged.loop,false);
  assert.deepEqual(tagged.value.map(frame=>pixel(frame,0)),[green,blue]);
});

test('mesh texture batches render with 3D depth and projections are native material layers',()=>{
  const source=bytes(2,2,[red,green,blue,clear]);
  const mesh=TexturedSurface.grid({segments:[1,1],point:(u,v)=>[(u-.5)*2,1.9-v*1.8,.05*Math.cos(u*3)]});
  const batch=W.surface(source,mesh);
  assert.equal(batch.vertices.length,30);
  assert.deepEqual([...batch.pixels.slice(12)],clear);
  const B=loaded.makeBuilder(31,[0x172237,0x0000ff]);
  B.iso(0,1,-.6,.24,B.P[1],4);
  const world=B.finish({spriteSurfaces:W.surface(solid(red,2,2),mesh),radius:2,cam:{target:[0,1,0],dist:4.4,yaw:0,pitch:0}});
  const render=()=>ink.render(world,{w:84,h:70,px:1,raw:true,transparent:true});
  const at=frame=>[...frame.rgb.slice((35*84+42)*3,(35*84+43)*3)];
  assert.deepEqual(at(render()),[255,0,0]);
  world.data[2]=.7;
  const front=at(render());
  assert.ok(front[2]>150 && front[0]<80);
  const layer=W.project(source,{projection:{type:'cylinder',origin:[0,0,0],radius:1},space:'world',scale:2});
  assert.deepEqual(JSON.parse(JSON.stringify(layer)),layer);
  const material=KIT.surface.material({r:1},{layers:{decal:layer}});
  assert.equal(material.surface.layers.decal.type,'projected');
});

test('CLI graph evaluates a UV map and drives per-pixel timing with its clock',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-raster-warp-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const n=node=>({node}), file=path.join(dir,'warps.json');
  fs.writeFileSync(file,JSON.stringify({format:'ink-studio/graph-project',version:1,nodes:{
    first:{op:'raster.canvas',inputs:{width:2,height:1,color:red}},
    last:{op:'raster.canvas',inputs:{width:2,height:1,color:blue}},
    pair:{op:'data.record',inputs:{a:n('first'),b:n('last')}},
    frames:{op:'data.collect',inputs:{source:n('pair'),keys:['a','b']}},
    time:{op:'warp.timeRemap',inputs:{frames:n('frames'),map:{width:2,height:1,data:[0,.5]},options:{fps:1}}},
    field:{op:'warp.field',inputs:{width:2,height:1,matrix:[[1,0,.5],[0,1,0]]}},
    final:{op:'warp.sample',inputs:{source:n('time'),field:n('field'),options:{filter:'nearest',edge:'wrap'}}}
  },outputs:{image:n('final')},exports:{image:{output:'image',format:'png'}}}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=spawnSync(process.execPath,[cli,'graph','run',file,'--at','0.5','--out',dir],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const image=require('../cli/png.js').raster(path.join(dir,'artifacts/image.png'));
  assert.deepEqual([...image.data],[...blue,128,0,128,255]);
});
