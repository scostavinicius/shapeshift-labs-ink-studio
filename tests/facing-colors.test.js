const assert = require('node:assert/strict');
const test = require('node:test');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const { FacingColors } = ink.load();

const palette = [0x000000, 0x24426b, 0x407ca7, 0x94bada, 0xa861d0];
const replace = { bands: [{ maxAngle: 39, color: 3 }, { maxAngle: 90, color: 4 }] };
const shift = { mode: 'shift', bands: [
  { maxAngle: 39, steps: 0 }, { maxAngle: 65, steps: -1 }, { maxAngle: 90, steps: 1 }
] };

test('facing profiles select exact swatches or move on the material ramp', () => {
  const n = [0,0,1], base = [64/255,124/255,167/255];
  const sample = (definition, view) => FacingColors.shade(definition, base, n, view, base.slice());
  const profile = FacingColors.prepare(replace, palette);
  assert.deepEqual(sample(profile,[0,0,1]),[148/255,186/255,218/255]);
  assert.deepEqual(sample(profile,[1,0,0]),[168/255,97/255,208/255]);
  assert.deepEqual(sample(profile,[0,0,-1]),sample(profile,[0,0,1]));
  const offsets = FacingColors.prepare(shift,palette,{ inheritedRamp: [1,2,3] });
  assert.deepEqual(sample(offsets,[0,0,1]),base);
  assert.deepEqual(sample(offsets,[1,0,1]),[36/255,66/255,107/255]);
  assert.deepEqual(sample(offsets,[1,0,0]),[148/255,186/255,218/255]);
  assert.throws(() => FacingColors.prepare({ bands:[{ maxAngle:20,color:2 }] },palette), /last facing band/);
  assert.throws(() => FacingColors.prepare({ bands:[{ maxAngle:90,color:22 }] },palette), /palette/);
});

function fixture({ KIT, makeBuilder, makeSculpt }, palette, definitions, patterned) {
  const builder = makeBuilder(4,palette);
  const sculpt = KIT.sculpt(makeSculpt(builder));
  sculpt.pixel = patterned;
  for (const [index, facingColors] of definitions.entries()) {
    const cloth = KIT.surface.material({ r:[1,2,3] },{ facingColors });
    sculpt.box([-1.24 + index * 2.48,0,0],[.85,.8,.27],cloth,{ res:.055 });
  }
  sculpt.bake();
  const world = builder.finish({ cam:{ yaw:0,pitch:0,dist:9,target:[0,0,0] },
    radius:4,dither:0,look:{ pixel:patterned } });
  const matrices = new Float32Array(12);
  KIT.bones.bind(world,{
    ids: Array.from({length:world.count},(_,i)=>i), bid:new Uint8Array(world.count), M:matrices,
    pose(t) {
      const angle = t * Math.PI/3, c = Math.cos(angle), s = Math.sin(angle);
      matrices.set([c,0,s,0,1,0,-s,0,c,0,0,0]);
    }
  });
  world.anim.update(.05,0);
  return world;
}

test('CPU facing colors reach the art grid and follow animated normals', () => {
  for (const patterned of [false,true]) {
    const world = fixture(ink.load(),palette,[replace,shift],patterned);
    assert.deepEqual(world.surfaces.at(-1).facingRamp,[1,2,3]);
    const options = { w:96,h:72,px:1,ortho:true,outline:false };
    const count = (frame,[r,g,b]) => {
      let n = 0;
      for (let i=0;i<frame.rgb.length;i+=3)
        n += Number(frame.rgb[i]===r && frame.rgb[i+1]===g && frame.rgb[i+2]===b);
      return n;
    };
    const violet = [168,97,208];
    const front = ink.render(world,options);
    world.anim.update(.05,1);
    const turned = ink.render(world,options);
    const disabled = ink.render(world,{...options,facingColors:false});
    assert(count(turned,violet) > count(front,violet) + 20);
    assert.equal(count(disabled,violet),0);
  }
});

function renderFixture(toolkit, build, backend, [palette, replace, shift]) {
  const results = [];
  for (const patterned of [false,true]) {
    const world = build(toolkit,palette,[replace,shift],patterned);
    const draw = backend(96,72,{ offscreen:true,ortho:true,outline:false,colored:false,dither:0,damp:false });
    try {
      const count = (image, color) => {
        const bytes = atob(image);
        let matches = 0;
        for (let i=0;i<bytes.length;i+=3)
          matches += Number(color.every((value, j) => bytes.charCodeAt(i+j) === value));
        return matches;
      };
      const violet = [168,97,208];
      draw.draw(world);
      const front = count(draw.image(),violet);
      world.anim.update(.05,1);
      draw.draw(world,{ time:1 });
      const turned = count(draw.image(),violet);
      draw.draw(world,{ time:1, facingColors:false });
      const disabled = count(draw.image(),violet);
      results.push({ patterned, front,turned,disabled });
    } finally { draw.close(); }
  }
  return { results };
}

test('WebGL applies facing bands on its normal and indexed art grids', { skip: !process.env.INK_TEST_CHROME }, () => {
  const { results } = runWebGL({},fixture,renderFixture,[palette,replace,shift]);
  for (const mode of results) {
    assert(mode.turned > mode.front + 20, JSON.stringify(results));
    assert.equal(mode.disabled,0);
  }
});
