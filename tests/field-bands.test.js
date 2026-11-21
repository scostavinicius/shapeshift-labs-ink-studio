const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K, SurfaceLook } = ink.load();

const bands = {
  stops: [{at:.1,color:'#ff0000'}, {at:.3,color:'#00ff00'}, {at:.6,color:'#0000ff'}],
  edge: {width:.04,color:'#ffffff'}
};

test('projected field bands share exact stops and declare a bright inside edge', () => {
  const field = { channels:['dye'], frame:t=>({sample:(_name,x)=>x+t}) };
  const paint = {type:'projected',pattern:'bands',field:'ink',bandChannel:'dye',bands};
  const context = K.splatEffects.context({fields:{ink:field}});
  const compile = patch => SurfaceLook.prepare({layers:{paint:{...paint,...patch}}},[],undefined,context);
  const effect = compile();
  const base = [.2,.3,.4];
  const read=(x,time=0)=>SurfaceLook.shade(effect,{position:[x,0,0],normal:[0,1,0],view:[0,1,0],time},base);
  assert.deepEqual(read(.099).slice(0,3),base);
  assert.deepEqual(read(.1).slice(0,3),[1,1,1]);
  assert.deepEqual(read(.14).slice(0,3),[1,0,0]);
  assert.deepEqual(read(.3).slice(0,3),[0,1,0]);
  assert.deepEqual(read(.6).slice(0,3),[0,0,1]);
  assert.deepEqual(read(.5,.19),read(.69));
  assert.deepEqual(read(.2)[5],[[1,0,0],[0,1,0],[0,0,1],[1,1,1]]);
  assert.throws(()=>compile({bandChannel:'missing'}),/Unknown field channel/);
  assert.throws(()=>compile({bands:{stops:bands.stops.slice().reverse()}}),/strictly increasing/);
  assert.throws(()=>compile({bands:{...bands,edge:{...bands.edge,width:.21}}}),/inside the first band/);
});

test('JSON scenes carry exact band swatches through the palette resolver', () => {
  const spec = {
    id:'ink-paint',camera:{target:[0,0,0],dist:5,yaw:0,pitch:0,projection:'orthographic',sway:0},
    finish:{surfaceEffects:{fields:{ink:{
      width:48,height:24,cell:.1,origin:[-2.4,-1.2],channels:{dye:{}},
      stamps:[{at:[0,0],radius:1.3,time:.25,values:{dye:1}}]
    }}}},
    solids:[{kind:'box',at:[0,0,0],half:[1.53,.91,.085],res:.075,mat:{role:'dark',
      surface:{layers:{paint:{type:'projected',pattern:'bands',field:'ink',bandChannel:'dye',
        projection:{along:[1,0,0],across:[0,1,0]},bands}}}
    }}]
  };
  assert.deepEqual(K.diorama.check(spec).filter(p=>p.level==='error'),[]);
  const world=K.diorama.build(spec);
  for (const style of [{},{colored:true},{tone:'stipple'}]) {
    const view={w:117,h:90,px:1,...style};
    const before=ink.render(world,{...view,t:0}), after=ink.render(world,{...view,t:.5});
    const count=(image,color)=>image.use[image.palette.indexOf(color)]??0;
    for (const color of [0xff0000,0x00ff00,0x0000ff,0xffffff]) {
      assert.equal(count(before,color),0);
      assert(count(after,color)>0,color.toString(16));
    }
    assert.deepEqual(ink.render(world,{...view,t:.5}).rgb,after.rgb);
  }
});

test('bounded smoke quantizes extinction and keeps the outside clear and the rim at the first density', () => {
  const A=K.atmosphere;
  const trace=(value, stop=4)=>{
    const field=K.procedural.density.bounded({bounds:{min:[-1,-1,-.5],max:[1,1,.5]},sample:()=>value});
    const media=A.prepare([A.field({field,bands,density:2,lit:false,step:.08})]);
    return A.trace(media,[0,0,3],[0,0,-1],stop);
  };
  assert.deepEqual(trace(.099),[0,0,0,1]);
  assert.deepEqual(trace(.8,2.4),[0,0,0,1]);
  const rim=trace(.11), outer=trace(.16), body=trace(.45);
  assert.deepEqual(trace(.299),outer);
  assert.equal(rim[3],outer[3]);
  assert(Math.abs(outer[3]-Math.exp(-.2))<1e-12);
  assert(rim[0]===rim[1] && rim[1]===rim[2] && rim[0]>.1);
  assert(outer[0]>.1 && outer[1]===0 && outer[2]===0);
  assert(body[0]===0 && body[1]>.4 && body[2]===0);
  assert(Math.abs(body[3]-Math.exp(-.6))<1e-12);
});
