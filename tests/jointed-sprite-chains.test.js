const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K } = require('..').load();
const { style, create } = K.spriteChains;
const palette = ['#20232d', '#f4c185', '#ac5e59', '#6db9a8'];
const art = (rows, start, end) => ({
  stamp: { width: rows[0].length, height: rows.length, rows },
  sockets: [start, end]
});
const straight = art(['.1...','11111','...01'], [0,1], [4,1]);
const diagonal = art(['110..','.111.','..011','....1'], [0,0], [4,3]);
const bent = art(['1...1','12221','.222.'], [0,1], [4,1]);
const compressed = art(['.2.','222','.2.'], [0,1], [2,1]);
const contact = art(['.3...','33333','.....'], [0,1], [4,1]);
const fullStyle = () => style({ palette, straight: [straight, diagonal], bent: [bent], compressed: [compressed], contact: [contact] });
const dims = { width: 38, height: 27 };
const pixel = ({ w, rgba }, x, y) => Array.from(rgba.subarray((y * w + x) * 4, (y * w + x + 1) * 4));

test('matching direction and size preserve every authored texel through translation and a quarter turn', () => {
  const family = fullStyle();
  const base = create({ points: [[7,6,0],[11,6,0]], pins: [0,1], style: family });
  const authored = K.pixelStamps.image({ ...straight.stamp, palette });
  const frame = base.render(dims);
  const turned = base.render({ ...dims, project: ([x,y]) => [23 - y,x] });
  for (let y = 0; y < authored.height; y++) for (let x = 0; x < authored.width; x++) {
    const rgba = Array.from(authored.rgba.subarray((y * authored.width + x) * 4, (y * authored.width + x + 1) * 4));
    assert.deepEqual(pixel(frame, 7 + x, 5 + y), rgba);
    assert.deepEqual(pixel(turned, 18 - y, 7 + x), rgba);
  }
  assert.equal(frame.segments[0].cel, 0);
  assert.equal(turned.segments[0].cel, 0);
  const diagonalFrame = create({ points: [[7,6,0],[11,9,0]], pins: [0,1], style: family }).render(dims);
  const expected = K.pixelStamps.image({ ...diagonal.stamp, palette });
  assert.equal(diagonalFrame.segments[0].cel, 1);
  for (let y = 0; y < expected.height; y++) for (let x = 0; x < expected.width; x++)
    assert.deepEqual(pixel(diagonalFrame, 7 + x, 6 + y),
      Array.from(expected.rgba.subarray((y * expected.width + x) * 4, (y * expected.width + x + 1) * 4)));
});

test('bend cels mirror with the turn and both links stay registered to the same socket', () => {
  const family = fullStyle();
  const pose = y => create({ points: [[6,12,0],[10,12,0],[14,12,0]], style: family,
    pins: [0,1,{ index: 2, at: [10,y,0] }] }).render(dims);
  const down = pose(16), up = pose(8);
  assert.deepEqual(down.segments.map(s => s.state), ['bent','bent']);
  assert.deepEqual(up.segments.map(s => s.state), ['bent','bent']);
  assert.deepEqual(down.segments[0].to, down.segments[1].from);
  assert.equal(pixel(down, 8, 13)[3], 255);
  assert.equal(pixel(down, 8, 11)[3], 0);
  assert.equal(pixel(up, 8, 11)[3], 255);
  assert.equal(pixel(up, 8, 13)[3], 0);
  const collapsed = create({ points: [[6,12,0],[10,12,0]], style: family,
    pins: [0,{ index: 1, at: [6,12,0] }] }).render(dims);
  assert.equal(collapsed.segments[0].state, 'compressed');
  assert.equal(pixel(collapsed, 6, 12)[3], 255);
});

test('a moving pin drives compression and replay gives the same motion when sampled out of order', () => {
  const make = () => create({
    points: [[4,10,0],[12,10,0],[20,10,0],[28,10,0]], style: fullStyle(),
    gravity: [0,0,0], stretch: .012, bend: 0,
    pins: [0, { index: 3, at: t => [28 - 12 * Math.min(t,1),10,0] }]
  });
  const chain = make(), late = chain.render({ ...dims, time: 2.4 });
  assert(late.segments.every(s => s.state === 'compressed'));
  assert(late.points[1][0] < 12);
  assert(chain.render(dims).segments.every(s => s.state === 'straight'));
  assert.deepEqual(chain.render({ ...dims, time: 2.4 }), late);
  assert.deepEqual(make().render({ ...dims, time: 2.4 }), late);
  chain.sample(1.27);
  assert.deepEqual(chain.render({ ...dims, time: 2.4 }), late);
  const layer = chain.layer();
  assert.deepEqual(layer.source({ w: dims.width, h: dims.height, time: 4, sceneTime: 2.4 }), late);
  assert.equal(layer.source({ w: dims.width, h: dims.height, time: 4, sceneTime: -1 }).time, 0);
});

test('joint radius and contact pose follow a moving signed-distance surface', () => {
  const chain = create({
    points: [[6,2,0],[10,2,0],[14,2,0]], pins: [], style: fullStyle(), gravity: [0,80,0],
    sdf: (x,y,z,time) => 11 - time - y, radius: 1.4
  });
  const frame = chain.render({ ...dims, time: 1 });
  assert(chain.sample(0).contacts.every(hit => hit === null));
  assert(frame.points.every(p => Math.abs(p[1] - 8.6) < 1e-5));
  for (const hit of frame.contacts) {
    assert.deepEqual(hit.normal, [0,-1,0]);
    assert.equal(hit.point[1], 10);
  }
  assert(frame.segments.every(s => s.onContact && s.state === 'contact'));
  assert.deepEqual(pixel(frame, 8, 9), [109,185,168,255]);
});

test('a world layer projects visible sockets through the scene camera and clips hidden links', () => {
  const chain = create({
    points: [[-.5,0,-2],[.5,0,-2],[1,0,0]], pins: [0,1,2], style: fullStyle()
  });
  const layer = chain.layer({ space: 'world', resolution: [20,20] });
  assert.equal(layer.needsCamera, true);
  const { segments } = layer.source({ w:20,h:20,time:0,camera:{
    view: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], tangent: 1, aspect: 1
  } });
  assert.deepEqual(segments[0].from, [7,10]);
  assert.deepEqual(segments[0].to, [12,10]);
  assert.equal(segments[1], null);
});
