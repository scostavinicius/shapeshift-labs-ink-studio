const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');

function fixture({ makeBuilder }) {
  const world = makeBuilder(9,[0x0c1014]).finish({});
  world.look = { renderGraph: { passes: [{ id: 'art', type: 'composite', layer: { draw: [
    { type: 'rayFan', origin: [10.5,10.5], angles: [0,Math.PI/2], count: 3, radii: [4,17],
      color: '#ff7050', falloff: { from: [14.5,10.5], to: [23.5,10.5], curve: 'linear' } },
    { type: 'registrationGrid', origin: [30.5,18.5], step: 9, color: '#788faa', markColor: '#f8faff',
      guides: [{axis:'u',index:0,span:[0,3]}], omit: [[.5,-.5,1,1]], crosses: [{ at: [2,1], size: 7 }] },
    { type: 'polygon', points: [[10.5,32.5],[26.5,32.5],[26.5,42.5],[10.5,42.5]],
      color: '#83c8fc', stroke: '#cbe8ff', fillFalloff: { from: [14.5,37.5], to: [22.5,37.5] } }
  ] } }] } };
  return world;
}

const points = { ray: [14,10], fadedRay: [22,10], guide: [32,18], gap: [40,18],
  cross: [48,27], stroke: [25,32], fill: [13,37], fadedFill: [24,37] };

function cpu() {
  const frame = studio.render(fixture(studio.load()),{ w:64, h:48, raw:true });
  return Object.fromEntries(Object.entries(points).map(([name,[x,y]]) =>
    [name,Array.from(frame.rgb.subarray((y*64+x)*3,(y*64+x)*3+3))]));
}

test('the three drawing tools compose through the same render-graph layer', () => {
  const result = cpu();
  assert.deepEqual(result.ray,[255,112,80]);
  assert(result.fadedRay[0] < 50);
  assert.deepEqual(result.guide,[120,143,170]);
  assert.notDeepEqual(result.gap,result.guide);
  assert.deepEqual(result.cross,[248,250,255]);
  assert.deepEqual(result.stroke,[203,232,255]);
  assert.deepEqual(result.fill,[131,200,252]);
  assert.deepEqual(result.fadedFill,result.gap);
});

test('CPU and WebGL agree on ray fans, registration guides and independent fades', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({},fixture,(kit,make,backend,points) => {
    const draw = backend(64,48,{raw:true,offscreen:true});
    try {
      draw.draw(make(kit));
      return draw.sample(points);
    } finally {
      draw.close();
    }
  },points);
  for (const [key,pixel] of Object.entries(cpu()))
    assert(result[key].every((value,i) => Math.abs(value-pixel[i]) <= 1),key);
});
