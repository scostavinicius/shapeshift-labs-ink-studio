const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { makeBuilder } = ink.load();
const { prepare } = require('../src/motional-coverage.js');

const view = { w:64,h:48,px:1,raw:true,transparent:true,passes:['coverage','depth'] };
const scoped = { rules:[{select:{material:'wire'}}] };

function scene(ortho, block = false) {
  const b = makeBuilder(5,[0x102034,0xffcc8a,0x1a415f]);
  b.axial(0,0,0,[0,1,0],.60,.012,b.P[1],1.07);
  b.describeSplats(0,1,{material:'wire',object:'spindle'});
  if (block) b.disc(.045,0,.7,[0,0,1],.55,.02,b.P[2],3);
  return b.finish({cam:{target:[0,0,0],ortho,dist:4,yaw:0,pitch:0,sway:0},radius:4,dither:0});
}

test('slow camera and object motion preserve more consistent thin coverage in both projections',()=>{
  for (const ortho of [true,false]) {
    const world = scene(ortho), history = ink.createMotionalCoverageHistory();
    const totals = {native:[],spatial:[],motion:[]};
    for (let f=0; f<48; f++) {
      const t = f/48;
      world.data[0] = .028*Math.sin(t*Math.PI*2);
      const frame = { ...view,t,target:[.15*t,0,0] };
      for (const [name,options] of [
        ['native',{motionalCoverage:false}],
        ['spatial',{motionalCoverage:scoped}],
        ['motion',{motionalCoverage:scoped,motionalCoverageHistory:history}]
      ]) {
        const image = ink.render(world,{ ...frame,...options });
        const row = image.passes.coverage.subarray(24*view.w,25*view.w);
        totals[name].push(row.reduce((a,b)=>a+b,0));
      }
    }
    const range = n => Math.max(...n)-Math.min(...n);
    assert(range(totals.motion) < .60*range(totals.native));
    assert.notDeepEqual(totals.motion,totals.spatial);
  }
});

test('depth jumps and cuts use fresh coverage and foreground geometry still occludes',()=>{
  const world = scene(true), history = ink.createMotionalCoverageHistory();
  const settings = { ...view,motionalCoverage:scoped };
  const draw = options => ink.render(world,{ ...settings,...options });
  draw({t:0,motionalCoverageHistory:history});
  world.data[0] = .032;
  const moved = draw({t:1,motionalCoverageHistory:history});
  assert.notDeepEqual(moved.passes.coverage,draw({t:1}).passes.coverage);
  world.data[0] = .058;
  assert.deepEqual(draw({t:2,motionalCoverageHistory:history,resetRenderHistory:true}),draw({t:2}));
  world.data[0] = .09;
  world.data[2] = .7;
  assert.deepEqual(draw({t:3,motionalCoverageHistory:history}),draw({t:3}));
  world.data[0] = .12;
  assert.deepEqual(draw({t:1,motionalCoverageHistory:history}),draw({t:1}));

  const covered = scene(false,true);
  ink.render(covered,{ ...settings,t:0,motionalCoverageHistory:history,splatOrder:'surface' });
  covered.data[0] = .085;
  const hidden = ink.render(covered,{ ...settings,t:1,motionalCoverageHistory:history,splatOrder:'surface' });
  const native = ink.render(covered,{ ...settings,t:1,motionalCoverage:false,splatOrder:'surface' });
  const p = 24*64+32;
  assert.deepEqual(hidden.rgb.slice(p*3,p*3+3),native.rgb.slice(p*3,p*3+3));
  assert.equal(hidden.passes.depth[p],native.passes.depth[p]);
});

test('look rules can exclude parts and runtime overrides can turn coverage off',()=>{
  const world = scene(true);
  const native = ink.render(world,view);
  world.look = { motionalCoverage:scoped };
  assert.notDeepEqual(ink.render(world,view).rgb,native.rgb);
  assert.deepEqual(ink.render(world,{ ...view,motionalCoverage:false }),native);
  assert.deepEqual(ink.render(world,{ ...view,motionalCoverage:{rules:[{select:{object:'rail'}}]} }),native);
  assert.throws(()=>prepare({depthTolerance:-1}),/depthTolerance/);
  assert.throws(()=>prepare({rules:[{select:{medium:'mist'}}]}),/identify splats/);
});
