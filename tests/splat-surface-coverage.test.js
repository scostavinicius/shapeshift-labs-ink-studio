const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ makeBuilder }, style) {
  const b = makeBuilder(3, [0, 0xf3db9c]);
  for (let y = -7; y <= 7; y++) for (let x = -8; x <= 8; x++) {
    if (Math.abs(x) < 3 && Math.abs(y) < 3) continue;
    b.disc(x * .144, y * .144, 0, [0,0,1], .053, .009, b.P[1], 1.35);
  }
  if (style) b.describePixelStyle(0, b.count(), style);
  return b.finish({ cam: { target: [0,0,0], dist: 4, pitch: .08, yaw: 0 },
    radius: 5, dither: 0 });
}

const width = 120, height = 88;
const view = { w: width, h: height, px: 1, raw: true, passes: ['coverage', 'depth'] };
const pans = [-.46, -.23, 0, .23, .46];
function interior(read) {
  let sum = 0, count = 0;
  for (let y = 20; y < 31; y++) for (let x = 43; x <= 75; x++) {
    sum += read(y * width + x);
    count++;
  }
  return sum / count;
}

test('matched native orbit frames close gaps in the opaque lattice and keep the aperture', () => {
  const world = fixture(ink.load());
  const legacy = ink.render(world, view).passes.coverage;
  assert.deepEqual(ink.render(world, { ...view, splatCoverage: 'legacy' }).passes.coverage, legacy);
  for (const yaw of pans) {
    const baseline = ink.render(world, { ...view, yaw }).passes.coverage;
    const joined = ink.render(world, { ...view, yaw, splatCoverage: 'continuous' }).passes;
    assert(interior(p => joined.coverage[p] - baseline[p]) > .08, 'continuous coverage raises the interior fill');
    assert(interior(p => joined.coverage[p]) > .96, 'interior remains nearly opaque throughout the orbit');
    assert.equal(joined.coverage[44 * width + 60], 0, 'the authored opening remains empty');
    assert(joined.depth.some(Number.isFinite), 'joined pixels populate the depth pass');
  }
  assert.throws(() => ink.render(world, { ...view, splatCoverage: 'nearest' }), /Splat coverage/);
  const ray = { origin: [.45, .648, 2], direction: [0,0,-1], maxDistance: 4 };
  const pick = mode => ink.createSplatPicker(world, { splatCoverage: mode }).ray(ray);
  assert(pick('continuous').transmission < pick('legacy').transmission);
});

test('material coverage survives baking and keeps soft brushes and optical splats separate', () => {
  const { KIT } = ink.load();
  const world = KIT.diorama.build({ id: 'soft-coverage', solids: [
    { kind: 'ball', at: [0,0,0], r: .6, mat: { role: 'stone', pixelStyle: { coverage: 'soft' } } }
  ] });
  const opaque = { ...world, materialPixelStyles: undefined };
  const render = (source, mode) => ink.render(source, { ...view, splatCoverage: mode });
  assert.deepEqual(render(world,'continuous').rgb, render(world,'legacy').rgb);
  assert.deepEqual(render(world,'continuous').rgb, render(opaque,'soft').rgb);
  assert.notDeepEqual(render(world,'continuous').rgb, render(opaque,'legacy').rgb);
  assert(render(world,'continuous').passes.depth.every(value => value === Infinity));

  const kit = ink.load(), b = kit.makeBuilder(2, [0,0xf7b899]);
  b.disc(-.27,0,0,[0,0,1],.26,.055,b.P[1],.30);
  b.disc(.27,0,0,[0,0,1],.26,.055,b.P[1],1.3,{gl:true,nd:true});
  b.disc(0,.36,0,[0,0,1],.16,.036,b.P[1],2,{nd:true,em:true,k:3,rg:.8,sp:1});
  const effects = b.finish({ cam: world.cam });
  assert.deepEqual(render(effects,'legacy').rgb,render(effects,'continuous').rgb);
});

test('WebGL applies continuous and material soft coverage at native art resolution', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  function browser(kit, make, backend, {width,height,pans}) {
    const gpu = backend(width,height,{ raw: true });
    const world = make(kit);
    const { coverageStride, softCoverage } = kit.ContributionRules;
    const soft = make(kit,{ edge: coverageStride * (softCoverage + 1), mode: 0, steps: 0 });
    const frames = [];
    try {
      for (const yaw of pans) {
        const camera = { ...world.cam, yaw };
        gpu.draw(world,{ camera, splatCoverage: 'legacy' });
        const legacy = gpu.image();
        gpu.draw(world,{ camera, splatCoverage: 'continuous' });
        frames.push({legacy, continuous:gpu.image()});
      }
      gpu.draw(soft,{splatCoverage:'continuous'});
      const softMaterial = gpu.image();
      gpu.draw(world,{splatCoverage:'soft'});
      return { frames, softMaterial, softScene:gpu.image() };
    } finally { gpu.close(); }
  }
  const result = runWebGL({},fixture,browser,{width,height,pans:[-.46,0,.46]});
  assert.equal(result.softMaterial,result.softScene);
  for (const { legacy, continuous } of result.frames) {
    const before=Buffer.from(legacy,'base64'), after=Buffer.from(continuous,'base64');
    assert(interior(p => after[p*3] - before[p*3]) > 10);
    assert(interior(p => after[p*3]) > 227);
    assert.equal(after[(44*width+60)*3],0);
  }
});
