const test = require('node:test');
const assert = require('node:assert/strict');
const kit = require('..').load(), { KIT: K } = kit, C = K.contour;
const square = { min: [-1.2, -1.2], max: [1.2, 1.2] }, cube = { min: [-1.2, -1.2, -1.2], max: [1.2, 1.2, 1.2] };
const sphere = (x, y, z) => Math.hypot(x, y, z) - 1;
const near = (a, b, e = 1e-5) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
function round() { return C.slices(sphere, { bounds: cube, levels: [-.5, 0, .5], cell: .08 }); }

test('SDF contours follow closed surfaces on every slicing axis', () => {
  for (const [axis, index] of ['x', 'y', 'z'].map((v, i) => [v, i])) {
    const p = C.slices(sphere, { bounds: cube, levels: [-.5, 0, .5], cell: .08, axis });
    assert.equal(p.paths.length, 3);
    for (const path of p.paths) {
      assert(path.closed); assert.deepEqual(path.points[0], path.points.at(-1));
      path.points.forEach((v, i) => { near(v[index], path.level); near(Math.hypot(...v), 1, .002); near(K.V.dot(v, path.normals[i]), 1, .002); });
    }
    assert(Object.isFrozen(p.paths[0].points[0]));
    assert.deepEqual(C.ribbons(JSON.parse(JSON.stringify(p))),C.ribbons(p));
  }
});

test('height contours reuse scalar samples across levels and follow the surface normals', () => {
  let calls = 0;
  const p = C.heightfield((x, z) => { calls++; return x * x + z * z; }, { bounds: square, levels: [.2, .5, .9], cell: .1 });
  assert.equal(p.paths.length, 3);
  assert.equal(p.stats.evaluations, calls);
  assert(calls < 2500);
  for (const path of p.paths) for (let i = 0; i < path.points.length; i++) {
    const [x, y, z] = path.points[i]; near(y, path.level); near(x * x + z * z, path.level, .006);
    near(K.V.dist(path.normals[i], K.V.norm([-2*x, 1, -2*z])), 0);
  }
});

test('surface isolines wrap canonical charts and respect undefined regions', () => {
  const chart = K.procedural.surface.plane({ id: 'wall', origin: [0, 0, 0], u: [2, 0, 0], v: [0, 2, 0] });
  const p = C.surface(chart, { field: (x, y) => y, levels: [.4, 1, 1.6], cell: .05 });
  assert.equal(p.paths.length, 3); assert(p.paths.every(p => !p.closed));
  for (const path of p.paths) for (const v of path.points) near(v[1], path.level);
  const cut = C.surface((u, v) => u > .4 && u < .6 ? null : { p: [u, v, 0], n: [0, 0, 1] }, { field: (x, y) => y, levels: [.5], cell: .05 });
  assert.equal(cut.paths.length, 2);
  assert(cut.paths.every(p => p.points.every(v => v[0] < .41 || v[0] > .59)));
  const inferred = C.surface((u,v) => ({p:[u,v,0]}), {field:(x,y)=>y,levels:[.5],cell:.1});
  inferred.paths[0].normals.forEach(n=>assert.deepEqual(n,[0,0,1]));
});

test('extraction budgets are shared across levels and invalid fields fail explicitly', () => {
  let calls = 0;
  assert.throws(() => C.heightfield(() => { calls++; return 0; }, { bounds: square, levels: [0, 1], cell: .01, maxCells: 100 }), /cell budget/);
  assert.equal(calls, 0);
  assert.throws(() => C.slices(sphere, { bounds: cube, levels: [0], cell: .1, maxEvaluations: 2 }), /evaluation budget/);
  assert.throws(() => C.slices(sphere, { bounds: cube, levels: [0], cell: .1, maxVertices: 2 }), /vertex/);
  assert.throws(() => C.heightfield(() => NaN, { bounds: square, levels: [0] }), /finite/);
  assert.throws(() => C.slices(sphere, { bounds: cube, levels: [2] }), /outside/);
  assert.throws(() => C.levels({ min: 0, max: 1, step: .001 }), /budget/);
  assert.deepEqual(C.levels({ min: -.5, max: .5, step: .25 }), [-.5,-.25,0,.25,.5]);
  assert.deepEqual(C.heightfield(()=>1,{bounds:square,levels:[]}).paths,[]);
});

test('ribbons retain surface frames, physical dashes, major widths and bounded counts', () => {
  const p = C.surface((u,v)=>({p:[u*2,v,0],n:[0,0,1]}),{field:(x,y)=>y,levels:[.5],cell:.1});
  const r = C.ribbons(p, { step: .04, width: .02, majorScale: 2, dash: [.2, .1], lift: .01 });
  assert(r.marks.length > 20);
  for (const m of r.marks) {
    near(m.position[2], .01); near(m.width,.04); near(K.V.dot(m.normal,m.tangent),0);
    const phase=(m.arc% .3 + .3) % .3; assert(phase < .200001);
  }
  assert.throws(()=>C.ribbons(round(),{maxMarks:1}),/mark budget/);
  assert.throws(()=>C.ribbons(round(),{maxWork:1}),/work budget/);
  assert.throws(()=>C.ribbons(round(),{width:()=>NaN}),/width/);
});

test('bands wrap correctly across negative elevations and select retained sculpt materials', () => {
  const a={r:[1]},b={r:[2]},bands=C.bands({step:.2,colors:['#000000','#ffffff']}),mat=bands.material([a,b]);
  assert.equal(mat.materialAt(0,-.1,0),b);assert.equal(mat.materialAt(0,.1,0),a);
  assert.deepEqual(bands.paint([0,-.1,0]),[255,255,255]);near(bands.sample([0,.3,0]).fraction,.5);
  const field=C.bands({field:(x,y,z)=>Math.hypot(x,y,z),step:.5});assert.equal(field.sample([0,0,1.1]).index,2);
});

function fixture(kit, flat = false) {
  const sphere=(x,y,z)=>Math.hypot(x,y,z)-1,cube={min:[-1.2,-1.2,-1.2],max:[1.2,1.2,1.2]};
  const B=kit.makeBuilder(1,[0x071b27,0x74d3ce]),K=kit.KIT,p=K.contour.slices(sphere,{bounds:cube,levels:K.contour.levels({min:-.9,max:.9,step:.15}),cell:.1});
  const batch=K.contour.draw(B,p,{step:.08,width:.02,footprint:flat?'flat':'soft',emissive:true,objectId:'ribbon-orb'});
  const world=B.finish({cam:{target:[0,0,0],dist:4.7,yaw:.1,pitch:.15},radius:10,dither:0,fog:{c:0,start:1,max:0},look:{pixelSize:1,clean:1,splatCoverage:'continuous'}});
  return {world,batch};
}
test('native drawing preserves provenance, software depth and validates before mutation', () => {
  const {world,batch}=fixture(kit,true);
  assert.equal(batch.ids.length,world.count);assert(world.splatFootprints.styles.some(p=>p.depth==='plane'));
  assert(world.renderMetadata.objects.includes('ribbon-orb'));
  const render=require('../cli/render').render;
  const a=render(world,{w:100,h:100,px:1,raw:true}).rgb;
  assert(a.some((v,i)=>v!==[7,27,39][i%3]));
  const B=kit.makeBuilder(1,[0]);let i=0;
  assert.throws(()=>C.draw(B,round(),{color:()=>++i>4?[NaN,0,0]:'#ffffff'}),/colors/);assert.equal(B.count(),0);
  assert.throws(()=>C.draw(B,round(),{footprint:'wrong'}),/footprint/);assert.equal(B.count(),0);
});

test('actual contour carriers peel continuously and rejoin without extra particles', () => {
  const {world,batch}=fixture(kit),original=world.data.slice(),stage=K.stage(world),fx=stage.add(K.materialisation.bind(stage,{id:'ribbons',ids:batch.ids,width:.008,length:.02,peel:.4,flow:K.flow.wind([.3,.1,0])}));
  fx.release({stagger:0,velocity:[.3,0,0],normalImpulse:0});fx.advance(0);
  assert.equal(world.count,batch.ids.length);near(world.data[0],original[0]);
  fx.advance(.6);assert(Math.abs(world.data[0]-original[0])>.01);assert.equal(fx.stats.drifting,world.count);
  fx.rejoin({duration:.5});fx.advance(.8);assert.equal(fx.stats.home,world.count);
  assert.deepEqual(world.data,original);
});

test('WebGL contours render, orbit and materialise',{skip:!process.env.INK_TEST_CHROME},()=>{
  const result=require('../cli/look-webgl')({chrome:process.env.INK_TEST_CHROME,hardware:true},fixture,(kit,build,backend)=>{
    const {world:w,batch}=build(kit),b=backend(96,96,{raw:true});b.draw(w);const a=b.image();b.draw(w,{camera:{...w.cam,yaw:.9,pitch:.6}});const c=b.image();
    const stage=kit.KIT.stage(w),fx=stage.add(kit.KIT.materialisation.bind(stage,{id:'h',ids:batch.ids,flow:kit.KIT.flow.wind([.4,.1,0])}));fx.release({stagger:0});fx.advance(.6);b.draw(w,{changedRows:Array.from({length:Math.ceil(w.count/512)},(_,i)=>i)});const d=b.image();b.close();return {a,c,d};
  });assert(result.a!==result.c,'camera must change the contour projection');assert(result.a!==result.d,'flight must update rendered carrier geometry');
});
