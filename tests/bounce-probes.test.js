const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const { KIT: K, makeBuilder, makeSculpt } = ink.load();
const { create } = require('../cli/bounce-probes.js');

const colors=[0x233749,0x6e746d,0xff4b2b,0xe9e7d2];
const frameOptions={w:86,h:70,px:1,raw:true,passes:['objectId','depth','coverage']};
const skyEnvironment={
  profiles:{
    blue:{ zenith:'#548dff',horizon:'#638fff',ground:'#211d18',sunStrength:0 },
    amber:{ zenith:'#ff8235',horizon:'#ff993e',ground:'#211d18',sunStrength:0 }
  },
  sequences:{ cycle:{ duration:4,keys:[{at:0,profile:'blue'},{at:2,profile:'amber'}] } },
  tracks:[{ id:'sky',sequence:'cycle' }]
};

function tile(B, color, id, y=.04, z=0) {
  const first=B.count();
  for (let x=-3;x<=3;x++) for (let r=-3;r<=3;r++)
    B.disc(x*.14,y,z+r*.14,[0,1,0],.14,.012,B.P[color],1.65);
  B.describeSplats(first,B.count(),{ object:id });
  return [first,B.count()];
}
function canopy(color=2, liveSun=false) {
  const B=makeBuilder(1,colors), [first,end]=tile(B,1,'receiver');
  B.describeAlbedo(first,end,'#92968e');
  tile(B,color,'awning',1.2,-.18);
  const settings={ samples:128,reach:3,bounceStrength:1.7,skyStrength:0,
    probes:[{id:'under-awning',at:[0,.43,0],radius:1.65,bounds:{min:[-1,-.3,-1],max:[1,.85,1]}}],
    receive:{include:[{object:'receiver'}]},cast:{include:[{object:'awning'}]} };
  return B.finish({ cam:{target:[0,.5,0],yaw:.12,pitch:.36,dist:4.8,ortho:true},dither:0,radius:4,
    bounceProbes:settings, liveSun });
}
function owned(frame,name) {
  const { objectId,objects,coverage }=frame.passes;
  const id=objects.indexOf(name), pixels=[];
  for (let p=0;p<objectId.length;p++) if (objectId[p]===id && coverage[p]>.97) pixels.push(p);
  return pixels;
}
const color=(frame,p)=>[...frame.rgb.subarray(p*3,p*3+3)];

test('a baked red canopy warms its receiver directionally and round-trips as portable data',()=>{
  const world=canopy(), definition=JSON.parse(JSON.stringify(world.bounceProbes));
  assert.equal(definition.format,'ink-studio/bounce-probes');
  assert.deepEqual(ink.bakeBounceProbes(world,definition),definition);
  const probes=create(world,definition);
  const upward=probes.sample([0,.40,0],[0,1,0]).rgb;
  const downward=probes.sample([0,.40,0],[0,-1,0]).rgb;
  assert(upward[0]>.12 && upward[0]>upward[2]*4 && upward[0]>downward[0]*3);
  assert.equal(probes.sample([0,1,0],[0,1,0]),null);

  const off=ink.render(world,{...frameOptions,bounceProbes:false});
  const on=ink.render(world,{...frameOptions,bounceProbes:definition});
  const receiver=owned(on,'receiver'), awning=owned(on,'awning');
  assert(receiver.length>10 && awning.length>10);
  assert(receiver.some(p=>on.rgb[p*3]-off.rgb[p*3]>7));
  assert(awning.every(p=>color(on,p).every((n,k)=>n===color(off,p)[k])));
  assert.deepEqual(on.passes.depth,off.passes.depth);
  assert.deepEqual(on.passes.coverage,off.passes.coverage);
});

test('the active sky relights stored visibility inside live fill without rebaking',()=>{
  const B=makeBuilder(3,colors), [first,end]=tile(B,1,'terrace');
  B.describeAlbedo(first,end,'#c3c8c1');
  const world=B.finish({cam:{target:[0,.0,0],dist:4,yaw:0,pitch:.57,ortho:true},radius:3,dither:0,skyEnvironment,
    liveSun:{ambient:.25,intensity:0,skyBounce:{color:'#ffffff',intensity:.18}},
    bounceProbes:{cast:{include:[]},skyStrength:.72,probes:[{id:'exterior',at:[0,.35,0],radius:2.5}]}});
  const definition=world.bounceProbes, saved=JSON.stringify(definition);
  const blue=ink.render(world,{...frameOptions,t:0}), amber=ink.render(world,{...frameOptions,t:2});
  const [p]=owned(blue,'terrace');
  assert(blue.rgb[p*3+2]>blue.rgb[p*3]+30);
  assert(amber.rgb[p*3]>amber.rgb[p*3+2]+30);
  const globalFill = t=>ink.render(world,{...frameOptions,t,bounceProbes:false});
  assert.deepEqual(color(globalFill(0),p),color(globalFill(2),p));
  assert.equal(JSON.stringify(definition),saved);
});

test('a probe behind a pale wall favors the exposed side of an opening',()=>{
  const B=makeBuilder(5,colors), S=K.sculpt(makeSculpt(B));
  const light={r:[3]}, floor={r:[1]};
  S.box([-1.15,.6,0],[.08,1.0,1.03],light,{res:.11,objectId:'pale-wall'});
  S.box([0,1.35,0],[1.23,.07,1.09],floor,{res:.12});
  S.box([0,-.12,0],[1.23,.08,1.09],floor,{res:.12});
  for (const z of [-1.04,1.04]) S.box([0,.57,z],[1.15,.7,.06],floor,{res:.12});
  S.bake();
  const world=B.finish({ skyEnvironment,bounceProbes:{ samples:192,reach:4,skyStrength:1,bounceStrength:0,
    probes:[{id:'opening',at:[.23,.45,0],radius:2}]}});
  const sky=K.skyEnvironment.compile(skyEnvironment).frame(0).sky;
  const probes=create(world,undefined,sky);
  const site=[.23,.45,0];
  assert(probes.sample(site,[1,0,0]).rgb[2] > probes.sample(site,[-1,0,0]).rgb[2]*2);
  const bounced=create(world,{...world.bounceProbes,bounceStrength:1.4,skyStrength:0});
  assert(bounced.sample(site,[-1,0,0]).rgb[0]>.08);
});

test('JSON dioramas bake authored probes and reject invalid probe files',()=>{
  const finish={bounceProbes:{probes:[{id:'near',at:[0,.4,-.2],radius:2}],samples:48}};
  const spec={id:'probe-fixture',finish,solids:[{id:'floor',kind:'box',at:[0,-.16,0],half:[1,.16,1],mat:'stone'}]};
  const world=K.diorama.build(spec);
  assert.equal(world.bounceProbes.probes[0].open.length,48);
  assert.throws(()=>K.diorama.build({...spec,finish:{bounceProbes:{...finish.bounceProbes,samples:0}}}),/finish\.bounceProbes/s);
  assert.throws(()=>ink.bakeBounceProbes(world,{...world.bounceProbes,version:2}),/version/);
});
