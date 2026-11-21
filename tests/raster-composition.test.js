const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const ink = require('..');

const R = ink.load().KIT.procedural.raster;
const color = (rgba, width = 1, height = 1) => R.canvas({width, height, color: rgba});
const plane = (values, width = values.length) => ({width, height: values.length / width, channels: 1, data: values});
const pixel = (raster, x = 0, y = 0) => Array.from(raster.data.slice((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4));

test('raster math keeps numeric samples and masks use the requested scale and channel', () => {
  const source = color([20, 40, 60, 200], 2);
  assert.deepEqual([...R.channel(source, {channel: 'alpha'}).data], [200, 200]);
  const gate = R.math(plane([20, 120]), 100, 'greater');
  const cut = R.mask(source, gate, {scale: 1, invert: true});
  assert.deepEqual(pixel(cut), [20, 40, 60, 200]);
  assert.deepEqual(pixel(cut, 1), [20, 40, 60, 0]);
  assert.equal(pixel(source, 1)[3], 200);
  const signed = R.math(plane([10, -2]), 5, 'subtract');
  assert.deepEqual([...signed.data], [5, -7]);
  assert.deepEqual([...R.channels([signed, 8, R.channel(source, {channel: 'g'}), 255]).data],
    [5, 8, 40, 255, -7, 8, 40, 255]);
  assert.deepEqual([...R.math(source, plane([2, .5]), 'multiply').data], [40, 80, 120, 400, 10, 20, 30, 100]);
  assert.throws(() => R.math(signed, 0, 'divide'), /nonfinite/);
  assert.throws(() => R.mask(source, plane([1])), /matching dimensions/);
});

test('compositing blends straight alpha and sorts intersecting translucent sprites per pixel', () => {
  const red = color([200, 60, 0, 128], 2), blue = color([0, 120, 200, 128], 2);
  const layers = [{source: red, depth: plane([1, 3])}, {source: blue, depth: plane([3, 1])}];
  const result = R.stack({width: 2, height: 1, layers, ordering: 'depth'});
  assert.deepEqual(pixel(result.value), [134, 80, 66, 192]);
  assert.deepEqual(pixel(result.value, 1), [66, 100, 134, 192]);
  assert.deepEqual([...result.depth.data], [1, 1]);
  assert.deepEqual(pixel(R.stack({width: 2, height: 1, layers, ordering: 'depth'}).value, 1), pixel(result.value, 1));
  const tied = R.stack({width: 2, height: 1, ordering: 'depth', layers: layers.map(layer => ({...layer, depth: 1}))});
  assert.deepEqual(pixel(tied.value), pixel(result.value, 1));
  assert.deepEqual(pixel(R.blend(color([200, 100, 50]), color([128, 255, 0]), {mode: 'multiply'})), [100, 100, 0, 255]);
  assert.deepEqual(pixel(R.blend(color([20, 40, 50, 0]), color([40, 50, 60, 128]), {mode: 'multiply'})), [40, 50, 60, 128]);
  assert.deepEqual(pixel(R.blend(color([20, 40, 50]), red, {x: -2})), [20, 40, 50, 255]);
  assert.throws(() => R.stack({width: 2, height: 1, layers: [{source: red, depth: plane([1])}], ordering: 'depth'}), /matching dimensions/);
});

test('height blends obey relief with a continuous transition and preserve translucent coverage', () => {
  const base = color([200, 100, 50], 3), paint = color([0, 100, 150], 3);
  const layers = [{source: base, height: plane([2, 1, 0])}, {source: paint, height: 1}];
  const result = R.stack({width: 3, height: 1, layers, ordering: 'height', softness: .4});
  assert.deepEqual([0, 1, 2].map(x => pixel(result.value, x)), [
    [200, 100, 50, 255], [100, 100, 100, 255], [0, 100, 150, 255]
  ]);
  assert.deepEqual([...result.height.data], [2, 1, 1]);
  const translucent = R.stack({width: 1, height: 1, ordering: 'height', softness: 1, layers: [
    {source: color([200, 0, 0, 128]), height: 1}, {source: color([0, 0, 200, 128]), height: 1}
  ]});
  assert.deepEqual(pixel(translucent.value), [100, 0, 100, 192]);
  assert.deepEqual([...translucent.height.data], [1]);
});

test('sprite stacks, crop, resize and nine-slice keep their pixel registration', () => {
  const red = color([255, 0, 0]), green = color([0, 255, 0]);
  const stack = R.spriteStack([red, green], {shift: [1, -1]});
  assert.deepEqual([stack.width, stack.height], [2, 2]);
  assert.deepEqual(pixel(stack, 0, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(stack, 1, 0), [0, 255, 0, 255]);
  const tiles = {...plane([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 4), pivot: [2, 1]};
  const sliced = R.nineSlice(tiles, {width: 7, height: 5, insets: [1, 1, 1, 1], fill: 'repeat'});
  assert.deepEqual([...sliced.data.slice(0, 7)], [0, 1, 2, 1, 2, 1, 3]);
  assert.deepEqual([...sliced.data.slice(-7)], [8, 9, 10, 9, 10, 9, 11]);
  const part = R.crop(sliced, {x: 1, y: 1, width: 3, height: 2});
  assert.deepEqual([...part.data], [5, 6, 5, 5, 6, 5]);
  assert.deepEqual(part.pivot, [2.5, 0]);
  assert.deepEqual([...R.resize(part, {width: 6, height: 1}).data], [5, 5, 6, 6, 5, 5]);
  const edge = {width: 2, height: 1, data: Uint8Array.of(255, 40, 0, 255, 0, 0, 255, 0)};
  assert.deepEqual(pixel(R.resize(edge, {width: 3, height: 1, filter: 'bilinear'}), 1), [255, 40, 0, 128]);
  assert.throws(() => R.nineSlice(tiles, {width: 1, height: 1, insets: [1, 1, 1, 1]}), /insets do not fit/);
});

test('packing preserves author frame IDs, trim offsets, pivots and registered atlas maps', () => {
  const origin = R.canvas({width: 5, height: 5}), red = color([255, 0, 0], 2, 2);
  const source = R.blend(origin, red, {x: 1, y: 2});
  const normal = color([128, 128, 255], 5, 5);
  const sprites = [
    {id: 'offset', source, pivot: [3, 4], maps: {normal}},
    {id: 'tall', source: color([5, 10, 20], 3, 7)}
  ];
  const options = {maxWidth: 14, maxHeight: 14, padding: 2, extrude: 1, trim: true};
  const result = R.pack(sprites, options);
  assert.deepEqual(R.pack(sprites, options).atlas, result.atlas);
  const [a, b] = result.metadata.frames;
  assert.deepEqual([a.id, b.id], ['offset', 'tall']);
  assert.deepEqual(a.pivot, {x: 2, y: 2});
  assert.deepEqual(a.trim, {x: 1, y: 2});
  assert.equal(a.rect.width, 2);
  assert.deepEqual(pixel(result.value, a.rect.x - 1, a.rect.y), [255, 0, 0, 255]);
  assert.equal(pixel(result.value, a.rect.x - 2, a.rect.y)[3], 0);
  const handle = ink.load().KIT.sprite.atlas(result.atlas);
  assert.deepEqual(handle.select(0, 'card').rect, a.rect);
  assert.deepEqual(handle.select(1, 'card').rect, b.rect);
  assert.deepEqual(pixel({...result.value, data: result.atlas.images.normal}, a.rect.x, a.rect.y), [128, 128, 255, 255]);
  assert.throws(() => R.pack(sprites, {...options, maxWidth: 5}), /atlas width/);
});

test('CLI raster graphs compose linked layers and export a loadable Ink atlas', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-raster-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const source = path.join(dir, 'project.json'), cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const node = name => ({node: name});
  const spec = {format: 'ink-studio/graph-project', version: 1, nodes: {
    red: {op: 'raster.canvas', inputs: {width: 2, height: 2, color: [255, 0, 0]}},
    blue: {op: 'raster.canvas', inputs: {width: 1, height: 1, color: [0, 0, 255]}},
    back: {op: 'data.record', inputs: {source: node('red'), depth: 3}},
    front: {op: 'data.record', inputs: {source: node('blue'), depth: 1, x: 1}},
    records: {op: 'data.record', inputs: {back: node('back'), front: node('front')}},
    layers: {op: 'data.collect', inputs: {source: node('records'), keys: ['back', 'front']}},
    depth: {op: 'raster.depth', inputs: {width: 2, height: 2, layers: node('layers')}},
    pack: {op: 'raster.pack', inputs: {sprites: node('layers'), options: {maxWidth: 12}}}
  }, outputs: {
    picture: node('depth'), depth: {node: 'depth', port: 'depth'}, sheet: {node: 'pack', port: 'atlas'}
  }, exports: {picture: {output: 'picture', format: 'png'}, sheet: {output: 'sheet', format: 'atlas'}}};
  fs.writeFileSync(source, JSON.stringify(spec));
  const result = spawnSync(process.execPath, [cli, 'graph', 'run', source, '--out', dir], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.artifacts.length, 3);
  assert.ok(report.artifacts.every(row => fs.existsSync(path.join(dir, row.file))));
  const atlas = ink.readSpriteAtlas(path.join(dir, 'artifacts/sheet/atlas.json'));
  assert.equal(atlas.select(1, 'card').rect.width, 1);
  const output = ink.readGraphProject(source).run().outputs.picture;
  assert.deepEqual(pixel(output, 1), [0, 0, 255, 255]);
  const inspected = ink.readGraphProject(source).inspect({output: 'depth'});
  assert.equal(inspected.artifacts[0].format, 'json');
  assert.deepEqual(JSON.parse(inspected.artifacts[0].bytes).data, [3, 1, 3, 3]);
});
