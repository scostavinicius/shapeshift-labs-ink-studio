const { test } = require('node:test');
const assert = require('node:assert/strict');
const Drawing = require('../src/drawing-primitives.js');
const { drawing2d } = require('..').load().KIT.procedural;

const spec = { type: 'rayFan', origin: [9.5,9.5], angles: [0,Math.PI/2], radii: [3,7], count: 3 };

test('ray fans retain the inner opening and rasterize both end rays', () => {
  const rendered = drawing2d.render({ width: 20, height: 20, commands: [spec] });
  const alpha = (x,y) => rendered.data[(y*rendered.width+x)*4+3];
  assert.equal(alpha(9,9),0);
  assert.equal(alpha(14,9),255);
  assert.equal(alpha(9,14),255);
  assert(alpha(13,13) > 200);
  const full = Drawing.command({ ...spec, count: 4, angles: [0,Math.PI*2] });
  const [batch] = Drawing.geometry(full,null,20,20);
  assert.equal(batch.lines.length,4);
  assert(Math.abs(batch.lines[3][1][0]-9.5) < 1e-10);
  assert.equal(batch.lines[3][1][1],2.5);
});

test('world ray fans use plane axes and camera clipping', () => {
  const cmd = Drawing.command({ ...spec, space: 'world', origin: [0,0,-.5],
    u: [0,0,-1], v: [1,0,0], radii: [.1,3], count: 2 });
  const camera = { view: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
    tangent: .5, aspect: 1, clipNear: 1, clipFar: 4 };
  const [batch] = Drawing.geometry(cmd,camera,20,20);
  assert.equal(batch.lines.length,1);
  assert.throws(() => Drawing.command({ ...spec, angles: [0,7] }), /one turn/);
});
