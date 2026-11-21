const { test } = require('node:test');
const assert = require('node:assert/strict');
const studio = require('..');
const { drawing2d } = studio.load().KIT.procedural;
const fade = (from, to) => ({ from, to, curve: 'linear' });
const alpha = (image, x, y) => image.data[(y*image.width+x)*4+3];

test('polygon fill fades without changing its outline, including through translated hard drawing', () => {
  const image = drawing2d.render({ width: 32, height: 24, edges: 'hard', commands: [{
    type: 'rect', rect: [0,0,20,16], translate: [4,4], width: 1,
    fill: '#dd70a0', stroke: '#ffffff', falloff: fade([1.5,0],[17.5,0]), strokeFalloff: false
  }] });
  assert.equal(alpha(image,5,10),255);
  assert.equal(alpha(image,13,10),128);
  assert.equal(alpha(image,21,10),0);
  assert.equal(alpha(image,21,4),255);
});

test('grid axes can fade independently through scene compositing', () => {
  const world = studio.load().makeBuilder(1, [0]).finish({});
  const grid = { type: 'grid', origin: [2.5,2.5], step: 10, counts: [2,2], color: '#ffffff',
    uFalloff: fade([5.5,0],[19.5,0]),
    vFalloff: { type: 'radial', center: [2.5,5.5], radii: [1,6] } };
  const { alpha: a } = studio.render(world, { w: 25, h: 25, transparent: true, raw: true,
    renderGraph: { passes: [{ type: 'composite', id: 'grid', layer: { draw: [grid] } }] } });
  assert.equal(a[12*25+5],255);
  assert.equal(a[12*25+19],0);
  assert.equal(a[5*25+2],255);
  assert.equal(a[18*25+2],0);
});
