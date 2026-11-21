const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const Drawing = require('../src/drawing-primitives.js');

const spec = { type: 'registrationGrid', origin: [2.5,2.5], step: 10,
  guides: [{ axis: 'u', index: 1, span: [0,4], dash: [.45,.55] },
    { axis: 'v', index: 1.5, span: [0,2] }],
  crosses: [{ at: [.5,.5], size: 5 }], omit: [[1.15,.75,1.37,.5]],
  color: '#ffffff', markColor: '#ff4000' };

test('dashed guides preserve phase across a cutout and crosses have their own color', () => {
  const image = studio.load().KIT.procedural.drawing2d.render({ width: 48, height: 26, commands: [spec] });
  const pixel = (x,y) => Array.from(image.data.subarray((y*48+x)*4,(y*48+x)*4+4));
  assert.deepEqual(pixel(7,7),[255,64,0,255]);
  assert.equal(pixel(13,12)[3],255);
  assert.equal(pixel(23,12)[3],0);
  assert.equal(pixel(28,12)[3],0);
  assert.equal(pixel(33,12)[3],255);
  assert.equal(pixel(17,6)[3],255);
  assert.equal(pixel(17,12)[3],0);
  assert.equal(pixel(17,18)[3],255);
});

test('registration rejects unbounded dash expansion and malformed guides', () => {
  assert.throws(() => Drawing.command({ ...spec, guides: [{ axis: 'u', index: 0, span: [0,20],
    dash: [.0001,.0001] }] }), /segment budget/);
  assert.throws(() => Drawing.command({ ...spec, guides: [{ axis: 'x', index: 0, span: [0,1] }] }), /u or v/);
});
