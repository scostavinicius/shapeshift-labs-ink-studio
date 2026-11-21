const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const Surface = require('../src/surface-look.js');
const { KIT: K, makeBuilder, makeSculpt } = ink.load();

const sample = { position:[0,0,0], normal:[0,0,1], view:[0,0,1] };
const base = [.15,.19,.23];
function finish(layer, direction=[0,0,-1], signals) {
  return Surface.prepare({ signals, layers:{ thin:{type:'transmission', color:'#ef9e35', strength:.8, ...layer} } },
    [], direction);
}

test('thin transmission is two-sided, tinted and additive, and responds to thickness and shadow', () => {
  const paper = finish({ thickness:.1, wrap:0 });
  const lit = Surface.shade(paper,sample,base);
  assert(lit[0]>base[0]+.45 && lit[1]>base[1]+.25);
  assert(lit[2]>=base[2] && lit[2]<base[2]+.08);
  assert.equal(lit[3],1);
  assert.equal(lit[4],0);
  assert.deepEqual(Surface.shade(paper,{...sample,normal:[0,0,-1]},base),lit);
  assert.deepEqual(Surface.shade(paper,{...sample,view:[0,0,-1]},base).slice(0,3),base);
  assert.deepEqual(Surface.shade(paper,{...sample,visibility:0},base).slice(0,3),base);
  const thick = finish({thickness:2,wrap:0});
  assert(Surface.shade(thick,sample,base)[0]<lit[0]-.25);
  assert(Surface.shade(finish({thickness:.1,wrap:.4},[1,0,0]),sample,base)[0]>base[0]);
});

test('shared finish signals can thin an edge and local light is modulated by its color and visibility', () => {
  const layer = finish({ source:'local', thickness:2, color:'#ffffff',
    drive:{ thickness:{signal:'edge',to:.06} } }, undefined, {
    edge:{type:'axis',axis:'x',range:[0,1]}
  });
  const visibility = bias => { assert.equal(bias,.08); return .5; };
  const light = { direction:[0,0,-1], intensity:.8, color:[.1,.4,1], visibility };
  const bright = Surface.shade(layer,{...sample,position:[1,0,0],transmissionLights:()=>[light]},base);
  const dense = Surface.shade(layer,{...sample,transmissionLights:()=>[light]},base);
  assert(bright[2]>dense[2]+.25);
  assert(bright[2]>bright[0]+.35);
  assert.deepEqual(Surface.shade(layer,sample,base).slice(0,3),base);
  assert.throws(()=>finish({thickness:-1}),/nonnegative thickness/);
  assert.throws(()=>finish({source:'lamp'}),/transmission needs a source/);
});

function lantern(blocker, directional = false) {
  const B = makeBuilder(15,[0x142332,0x584438,0xb47a4a,0xffa652,0xffe29d]);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S,{ sun:[0,0,-1], pixel:true, keepRenderSdf:!directional });
  const paper=K.surface.material({r:[1]}, { layers:{ thin:{ type:'transmission',
    source:directional?'sun':'local',thickness:.10,strength:1,color:'#ffe9a4',wrap:.03 } } });
  S.box([0,0,.1],[1.12,.82,.014],paper,{res:.045});
  if(blocker) S.box([-.42,0,-.36],[.35,.54,.10],{r:[1]}, {res:.06});
  S.bake();
  const world=B.finish({
    cam:{target:[0,0,0],dist:4.5,yaw:0,pitch:0,sway:0},radius:4,detail:22,dither:0,
    look:{pixel:true,splatCoverage:'continuous'},
    ...(directional ? { liveSun:{direction:[0,0,-1],ambient:.24,intensity:1,shadows:true,mapSize:256} } :
      { lights:[{p:[-.40,0,-.85],radius:2.8,intensity:2.6,color:[1,.49,.22]}] })
  });
  return world;
}

test('headless point light and live-sun transmission respect blockers behind a sheet', () => {
  for (const directional of [false,true]) {
    const view={w:100,h:82,px:1,ortho:directional,raw:!directional,captureCoverage:true};
    const clear=ink.render(lantern(false,directional),view);
    const world=lantern(true,directional);
    const blocked=ink.render(world,view);
    const off=ink.render(world,{...view,transmission:false});
    const pixel=(im,x)=>im.rgb[((im.h>>1)*im.w+x)*3];
    assert(pixel(clear,40)>pixel(off,40)+.25);
    assert(pixel(clear,40)>pixel(blocked,40)+.25);
    assert(pixel(blocked,66)>pixel(off,66)+.15);
    assert.deepEqual(blocked.coverage,off.coverage);
  }
});

test('data-authored sheets use the same transmission layer and validate its controls', () => {
  const spec={ id:'paper',
    solids:[{ kind:'box',at:[0,0,0],half:[.7,.8,.014],mat:{role:'pale',surface:{layers:{
      through:{type:'transmission',source:'sun',color:'#ffe0ac',strength:.75,thickness:.08}
    }}} }], light:{surfaceDirection:[[0,0,0,-1]]}
  };
  assert.equal(K.diorama.build(spec).surfaces[0].settings.layers.through.type,'transmission');
  spec.solids[0].mat.surface.layers.through.wrap=1.2;
  assert(K.diorama.check(spec).some(issue=>issue.path==='solids[0].mat.surface' && /wrap/.test(issue.problem)));
});
