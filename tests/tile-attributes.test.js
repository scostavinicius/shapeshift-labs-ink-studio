const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const kit = ink.load(), P = kit.KIT.procedural;
const compile = P.pixelEffects.tileAttributes.compile;
const bitmap = (width, height, data) => ({ width, height, data, channels: 1 });
const rgba = (image, x, y) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], clear = [0, 0, 0, 0];
const palette = { palette: ['#0000ff', '#00ff00', '#ff0000', '#00ff00'], roles: { ground: 0, sign: 1, alarm: 2, spare: 3 } };

test('tile palette paint preserves the original bits, supports partial tiles, and can be restored', () => {
  const bits = Array.from({ length: 9 * 3 }, (_, i) => i % 2);
  const source = { ...bitmap(9, 3, bits), pivot: [4, 1] };
  const original = compile(source, palette, { defaults: { ink: 'sign', paper: 'ground' } });
  const painted = original.paint([{ cell: [1, 0], attributes: { ink: 'spare', paper: null, priority: 4 } }]);
  const saved = JSON.parse(JSON.stringify(painted.tileMap()));
  const restored = compile(source, palette, { defaults: painted.defaults, cells: saved });
  bits.fill(0);
  source.pivot[0] = 0;
  const before = original.frame(), after = painted.frame(), reload = restored.frame();
  assert.deepEqual(after.value.pivot, [4, 1]);
  assert.deepEqual(rgba(before.value, 7, 0), green);
  assert.deepEqual(rgba(after.value, 8, 0), clear);
  assert.deepEqual(rgba(after.value, 8, 1), green);
  assert.deepEqual(after.inspect([1, 0]).attributes, { ink: 'spare', paper: null, priority: 4 });
  assert.deepEqual(reload.value.data, after.value.data);
  assert.deepEqual(painted.paint([{ cell: [1, 0], attributes: null }]).frame().value, before.value);
  assert.throws(() => painted.paint([
    { cell: [0, 0], attributes: { ink: 'alarm' } }, { cell: [2, 0], attributes: { ink: 1 } }
  ]), /outside/);
  assert.equal(painted.frame().inspect([0, 0]).attributes.ink, 'sign');
  assert.throws(() => compile(bitmap(1, 1, [255]), palette), /bitmap/);
});

test('coverage clips, uses sprite alpha, and applies one winning write to a whole tile', () => {
  const source = bitmap(7, 4, Uint8Array.from({ length: 28 }, (_, i) => i % 2));
  const screen = compile(source, palette, { tileSize: [3, 2], cells: [
    { cell: [1, 0], attributes: { ink: 'spare', priority: 5 } },
    { cell: [2, 0], attributes: { ink: 'spare', priority: 5 } }
  ] });
  const mask = { width: 6, height: 1, channels: 4, data: new Uint8Array([
    255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 32,
    255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0
  ]) };
  const sprite = { id: 'sprite', priority: 2, mask, at: [-1, 0], threshold: 32, attributes: { ink: 'alarm' } };
  const effect = { id: 'effect', priority: 2, rect: [2, 0, 11, 1], attributes: { paper: 'alarm' } };
  const frame = screen.frame({ writes: [sprite, effect] });
  assert.equal(frame.inspect([0, 0]).winner, 'effect');
  assert.equal(frame.inspect([1, 0]).winner, null);
  assert.equal(frame.inspect([2, 0]).winner, null);
  assert.deepEqual(rgba(frame.value, 0, 0), red); // x=0 is outside the effect's pixel footprint.
  assert.deepEqual(rgba(frame.value, 1, 0), green); // Ink stays painted after the paper-only effect wins.
  assert.deepEqual(rgba(frame.value, 3, 1), blue);
  assert.deepEqual(rgba(frame.value, 3, 2), green);
  assert.deepEqual(rgba(frame.value, 6, 0), blue);
  const after = screen.frame({ writes: [effect, sprite] });
  assert.equal(after.inspect([0, 0]).winner, 'sprite');
  assert.deepEqual(rgba(after.value, 1, 0), red);
  assert.deepEqual(rgba(after.value, 0, 0), blue);
  assert.deepEqual(screen.frame({ writes: [{ ...sprite, at: [2, 0], priority: 8 }] }).inspect([1, 0]).attributes.ink, 'alarm');
  assert.equal(screen.frame({ writes: [{ ...sprite, at: [4, 0], priority: 8, threshold: 33 }] }).inspect([2, 0]).winner, null);
  assert.equal(screen.frame().inspect([0, 0]).winner, null);
  assert.deepEqual(screen.frame({ writes: [sprite, effect] }).value, frame.value);
});

test('the procedural node renders into a named compositing layer', () => {
  const source = bitmap(2, 1, [0, 1]);
  const writes = [{ id: 'spark', cells: [[0, 0]], attributes: { ink: 'alarm' } }];
  const graph = P.graph.create({
    inputs: { source: 'raster', writes: 'array<record>' },
    nodes: { screen: { op: 'fx.tileAttributes', inputs: {
      source: { input: 'source' }, writes: { input: 'writes' }, palette
    } } },
    outputs: { screen: { node: 'screen' } }
  });
  const { outputs: { screen } } = graph.evaluate({ source, writes });
  assert.deepEqual(screen, compile(source, palette).frame({ writes }).value);
  const world = kit.makeBuilder(41, [0x111111]).finish({ radius: 3 });
  const result = ink.render(world, { w: 6, h: 3, px: 1, raw: true, transparent: true,
    renderGraph: { passes: [{ id: 'panel', type: 'composite', layer: {
      source: { slot: 'screen' }, rect: [1, 1, 4, 1], filter: 'nearest'
    } }] },
    renderGraphInputs: { screen }, renderGraphCapture: ['panel']
  }).renderGraphPasses.panel;
  assert.deepEqual(rgba(result, 1, 1), blue);
  assert.deepEqual(rgba(result, 2, 1), blue);
  assert.deepEqual(rgba(result, 3, 1), red);
  assert.deepEqual(rgba(result, 4, 1), red);
  assert.deepEqual(rgba(result, 5, 1), clear);
});
