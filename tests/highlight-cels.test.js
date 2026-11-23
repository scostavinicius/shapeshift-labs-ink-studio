const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { KIT: K, CameraLens } = ink.load();

const camera = (yaw = 0, tangent = 1) => {
  const pose = CameraLens.orbitPose(yaw, 0, 5, [0,0,0]);
  return { eye: pose.eye, view: CameraLens.matrix(pose), ortho: true, tangent, aspect: 1 };
};
const lamp = (x, shadows = false) => K.lightEmitters.disc({
  id: 'lamp', at: [x, 0, 3], normal: [0, 0, -1], size: [.1,.1], radius: 12, intensity: 2, sampleGrid: 1, visible: false, shadows
});

test('material cels select independent pixel grids and use both the lamp and the camera angle', () => {
  const api = K.highlightCels;
  const placements = [{ id: 'rim', family: 'brass', light: 'lamp', at: [0, 0, 0], span: 1 }];
  const plan = api.prepare(placements);
  const pick = (view, x) => api.frame(plan, {}, view, {
    w: 100, h: 100, time: 0, lights: K.lightEmitters.prepare([lamp(x)])
  })[0];
  const pin = pick(camera(0, 4), 0), hook = pick(camera(0, 2), -3), arc = pick(camera(), 3);
  assert.deepEqual([pin.pose, hook.pose, arc.pose], ['pin', 'hook-left', 'arc-right']);
  assert.deepEqual([pin.image.width, hook.image.width, arc.image.width], [1, 3, 9]);
  assert.equal(pick(camera(), 0).pose, 'arc-front');
  assert.equal(pick(camera(.74), 0).pose, 'arc-grazing');
  assert.equal(pick(camera(Math.PI), 0), undefined);
  const pixels = [];
  api.pixels([hook], 100, 100, (x,y) => pixels.push([x-hook.left, y-hook.top]));
  assert.deepEqual(pixels, [[1,0],[0,1],[1,1]]);
  const stock = K.pixelStamps.catalog().clips.filter(({ id }) => id.startsWith('highlight-'));
  assert.equal(stock.length, 24);
  assert.ok(stock.every(cel => K.pixelStamps.image(K.pixelStamps.clip(cel.id)).width === cel.width));
  assert.throws(() => api.prepare([{ ...placements[0], family: 'unknown' }]), /unknown/);
});

test('a painted blocker keeps a shadowed anchor dark', () => {
  const { SpriteSurface } = ink.load(), api = K.highlightCels;
  const surfaces = SpriteSurface.make(8);
  surfaces.face([-1,-1,1], [2,0,0], [0,2,0], 1, 1, () => 0x445566, { castsShadow: true });
  const world = { spriteSurfaces: surfaces.finish() };
  const plan = api.prepare([{ id: 'rim', at: [0,0,0], family: 'brass', light: 'lamp' }]);
  const options = { w: 60, h: 60, time: 0, lights: K.lightEmitters.prepare([lamp(0, true)]) };
  assert.deepEqual(api.frame(plan, world, camera(), options), []);
  assert.equal(api.frame(plan, world, camera(), { ...options, cutoutShadows: false }).length, 1);
});

function fixture({ KIT: K, makeBuilder, SpriteSurface }) {
  const atlas = SpriteSurface.make(8), rock = 0x243343;
  atlas.face([-1,-1,0], [2,0,0], [0,2,0], 1, 1, () => rock);
  atlas.face([.007,-.6,.5], [.028,0,0], [0,1.2,0], 1, 1, () => 0x674d52);
  return makeBuilder(3, [0x0c1420, rock, 0x674d52]).finish({
    cam: { target: [0,0,0], yaw: 0, pitch: 0, dist: 4, fov: .6, ortho: true }, radius: 4,
    spriteSurfaces: atlas.finish(),
    areaLights: [K.lightEmitters.disc({ id: 'lamp', at: [0,1,3], normal: [0,-.2,-1], size: [.1,.1], visible: false,
      sampleGrid: 1, intensity: .5, shadows: false })],
    highlightCels: [{ id: 'rim', at: [0,0,0], light: 'lamp',
      family: { sizes: [{ id: 'mark', minPixels: 0, cels: [{ id: 'pose',
        stamp: { width: 5, height: 1, rows: ['01234'],
          palette: ['#ffc281','#ffd28d','#fff1ce','#cefff4','#b9f0e7'] } }] }] } }]
  });
}
const colors = [[255,194,129],[255,210,141],[255,241,206],[206,255,244],[185,240,231]];

test('headless writes the exact native pixels and leaves the foreground owner above them', () => {
  const world = fixture(ink.load()), options = { w: 64, h: 64, px: 1, raw: true };
  const off = ink.render(world, { ...options, highlightCels: false });
  const on = ink.render(world, options);
  function pixel(frame, x) {
    const p = (32 * 64 + x) * 3;
    return [...frame.rgb.subarray(p,p+3)];
  }
  for (const [i, color] of colors.entries()) {
    const x = 30 + i;
    if (i === 2) assert.deepEqual(pixel(on,x), pixel(off,x));
    else assert.deepEqual(pixel(on,x), color);
  }
  const styledOptions = { ...options, raw: false, colored: true };
  const styled = ink.render(world, styledOptions);
  assert.deepEqual(pixel(styled,30), colors[0]);
  assert.deepEqual(pixel(styled,32), pixel(ink.render(world, { ...styledOptions, highlightCels:false }),32));
  assert.deepEqual(ink.render(world, { ...options, areaLights: false }).rgb,
    ink.render(world, { ...options, highlightCels: false, areaLights: false }).rgb);
});

test('a grazing view keeps the full cel on the slanted receiving plane', () => {
  const kit = ink.load(), world = fixture(kit), surface = kit.SpriteSurface.make(8);
  surface.face([-1,-1,0], [2,0,0], [0,2,0], 1, 1, () => 0x243343);
  world.spriteSurfaces = surface.finish();
  const { rgb } = ink.render(world, { w:64, h:64, px:1, raw:true, yaw:.82 });
  for (const [r,g,b] of colors) {
    assert.ok(rgb.some((n,i) => i%3 === 0 && n === r && rgb[i+1] === g && rgb[i+2] === b));
  }
});

test('WebGL keeps exact swatches and masks behind solid geometry without reading it back', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const run = require('../cli/look-webgl');
  const result = run({}, fixture, (kit, make, backend) => {
    const world = make(kit), gpu = backend(64, 64, { raw: true, scale: 1, offscreen: true });
    const probes = Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['p' + i, [30+i,32]]));
    try {
      gpu.draw(world, { highlightCels: false });
      const off = gpu.sample(probes);
      const read = WebGL2RenderingContext.prototype.readPixels;
      let reads = 0;
      WebGL2RenderingContext.prototype.readPixels = function (...args) { reads++; return read.apply(this,args); };
      try { gpu.draw(world); }
      finally { WebGL2RenderingContext.prototype.readPixels = read; }
      const on = gpu.sample(probes);
      return { off: Object.values(off), on: Object.values(on), reads };
    } finally {
      gpu.close();
    }
  });
  assert.equal(result.reads, 0);
  for (const [i, pixel] of result.on.entries())
    assert.deepEqual(pixel, i === 2 ? result.off[i] : colors[i]);
});
