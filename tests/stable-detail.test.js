const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { StableDetail, SurfaceLook } = ink.load();
const Critic = require('../cli/critic.js');
const runWebGL = require('../cli/look-webgl.js');
const scene = require('../examples/stable-detail.js')(ink.load());

function fixture({ makeBuilder }) {
  const B=makeBuilder(2,[0,0x507862,0xf2d387]);
  const chart=2+1*64+2*64**2+1*64**3, reverse=1+2*64+1*64**2+2*64**3;
  B.fineTile(chart,reverse,chart,reverse,.15,0,0,0,.15,0,B.P[1]);
  B.disc(-.7,0,0,[0,0,1],.32,.04,B.P[1],3);
  B.disc(.7,0,0,[0,0,1],.093,.02,B.P[2],3,{nd:true});
  B.disc(0,.75,0,[0,0,1],.015,.01,B.P[2],3);
  return B.finish({cam:{target:[0,0,0],dist:12,yaw:0,pitch:0,sway:0},look:{fine:true},radius:6,dither:0});
}

test('detail range fades continuously in art pixels and preserves long thin geometry',()=>{
  const {texture,geometry}=StableDetail.prepare(true);
  assert.equal(StableDetail.weight(texture,0),0);
  assert.equal(StableDetail.weight(texture,5),1);
  assert.equal(StableDetail.weight([.5,1.5],1),.5);
  assert.equal(StableDetail.texturePixels(4,0,0,2,1),1);
  assert.equal(StableDetail.texturePixels(8,0,0,4,2),1);
  assert(StableDetail.geometryPixels(9,0,.001,1)>geometry[1]);
  assert.throws(()=>StableDetail.prepare({geometry:[1,1]}),/art-pixel/);
  assert.equal(StableDetail.prepare({texture:false}).texture,null);
});

test('fine tiles and small static accents fade independently of solid silhouettes',()=>{
  const world=fixture(ink.load());
  const clean={...world,count:1,fine:undefined};
  const view={w:95,h:71,px:1,raw:true,ortho:true};
  const near=ink.render(world,{...view,dist:4,stableDetail:true});
  const far=ink.render(world,{...view,dist:36,stableDetail:true});
  const plain=ink.render(clean,{...view,dist:36});
  const legacy=ink.render(world,{...view,dist:36,stableDetail:false});
  const count = (frame,x0,x1,color) => {
    let matches=0;
    for(let y=30;y<40;y++)for(let x=x0;x<x1;x++){
      if(frame.rgb[(y*frame.w+x)*3]>color) matches++;
    }
    return matches;
  };
  assert(count(near,20,43,190)>0,'the fine tile resolves near the camera');
  assert(count(legacy,48,54,190)>count(far,48,54,190),'the subpixel accent loses its peak');
  assert.equal(count(plain,40,47,190),count(far,40,47,190),'the fine tile falls back to its matte color');
  const silhouette=(33*view.w+47)*3;
  assert(legacy.rgb[silhouette]>190);
  assert.equal(far.rgb[silhouette],legacy.rgb[silhouette],'the opaque micro-silhouette stays visible');
  const upscaled=ink.render(world,{...view,w:view.w*2,h:view.h*2,px:2,dist:36,stableDetail:true});
  assert.deepEqual(upscaled.rgb,far.rgb);
});

test('an on-axis accent eases through the zoom threshold in many levels',()=>{
  const B=ink.load().makeBuilder(1,[0,0xffffff]);
  B.disc(0,0,0,[0,0,1],.08,.01,B.P[1],3,{nd:true});
  const world=B.finish({cam:{target:[0,0,0],dist:8,yaw:0,pitch:0},radius:4,dither:0});
  const peak=Array.from({length:120},(_, i)=>ink.render(world,{
    w:33,h:33,px:1,raw:true,dist:4+i*.22,stableDetail:true
  }).rgb[(16*33+16)*3]);
  assert(peak[0]>240 && peak.at(-1)===0);
  assert(new Set(peak).size>20);
  assert(peak.slice(1).every((value,i)=>value<=peak[i] && peak[i]-value<14));
});

test('subpixel motifs and specular accents yield to the broader finish',()=>{
  const sun=[0,0,1], rgba=[.15,.2,.25];
  const highlight={type:'specular',color:'#fffaff',roughness:.3,strength:.52};
  const broad=SurfaceLook.prepare({layers:{highlight}},[],sun);
  const detailed=SurfaceLook.prepare({layers:{highlight,flecks:{...highlight,detailSize:.08}}},[],sun);
  const projected=SurfaceLook.prepare({layers:{ink:{type:'projected',pattern:'stripes',scale:.3,width:.2,color:'#fffaff'}}},[],sun);
  const testSample={position:[0,0,0],normal:sun,view:sun,footprint:.02,stableDetail:StableDetail.prepare(true)};
  const sample=(finish, footprint)=>SurfaceLook.shade(finish,{...testSample,detailFootprint:footprint},rgba).slice(0,3);
  assert(sample(detailed,.02)[0]>sample(broad,.02)[0]);
  assert.deepEqual(sample(detailed,.3),sample(broad,.3));
  assert.deepEqual(sample(projected,.3),rgba);
  assert(sample(projected,.02)[0]>rgba[0]);

  const glints=SurfaceLook.prepare({layers:{grain:{type:'glints',color:'#ffffff',scale:.1,radius:.4,density:1,tilt:0}}},[],sun);
  const glitter=footprint=>SurfaceLook.shade(glints,{
    ...testSample,position:[.05,.05,.05],detailFootprint:footprint
  },rgba);
  assert(glitter(.02)[4]>.1);
  assert.equal(glitter(.3)[4],0);
});

test('the native slow pan and zoom have fewer change-and-return pixels',()=>{
  const world=scene.build(scene.seed), camera=world.cam;
  const render = (cameraAt, stableDetail) => Array.from({length:28},(_,i)=>ink.render(world,{
    w:144,h:88,px:1,raw:true,stableDetail,...cameraAt(i)
  }));
  const pan = i => ({target:[camera.target[0]+i*.014,camera.target[1],camera.target[2]+i*.007]});
  const zoom = i => ({zoom:1+i*.012});
  for(const cameraAt of [pan,zoom]){
    const measure=enabled=>Critic.flicker(render(cameraAt,enabled),{bg:world.pal[0]});
    const baseline=measure(false), stable=measure(true);
    assert(baseline>.001 && stable<baseline*.90, 'flicker on: '+stable+' off: '+baseline);
  }
});

test('WebGL filters fine tiles and no-depth accents on the same art grid',{
  skip: !process.env.INK_TEST_CHROME
},()=>{
  function browser(kit, build, backend) {
    const world=build(kit), gpu=backend(95,71,{colored:false,dither:0,outline:false});
    try {
      const render=(dist,stableDetail)=> {
        gpu.draw(world,{camera:{...world.cam,dist,ortho:true},stableDetail});
        return gpu.image();
      };
      return { before:render(36,false), after:render(36,true), near:render(4,true) };
    } finally { gpu.close(); }
  }
  const result=runWebGL({},fixture,browser,{});
  assert.notEqual(result.before,result.after);
  const bright = (encoded,left,right) => {
    const rgb=Buffer.from(encoded,'base64');
    let count=0;
    for(let y=30;y<40;y++)for(let x=left;x<right;x++)if(rgb[(y*95+x)*3]>190)count++;
    return count;
  };
  assert(bright(result.near,20,43)>0);
  assert(bright(result.before,48,54)>bright(result.after,48,54));
});
