const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const runWebGL = require('../cli/look-webgl.js');
const { KIT: K } = ink.load();

const camera = {
  view: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-5,1],
  clipNear: .4, clipFar: 20, tangent: .5, aspect: 100/60, ortho: true
};
const context = { camera, width: 100, height: 60 };
const state = (frame, id) => frame.samples.find(row => row.id === id)?.state;
const linked = frame => frame.leaders.map(row => row.id);

test('a held leader follows the current surface pose and gives up its slot when the hold expires', () => {
  const probe = K.surfaceProbe.create({
    space: 'screen', at: ({ time, world }) => world?.pause ? null : [time < .1 ? 42 : 56,30],
    radius: 5, hold: .24, maxLeaders: 1, samples: [
      { id: 'ridge', at: ({ sceneTime, world }) => world?.hide ? null : [-.14 + .4 * sceneTime,0,0] },
      { id: 'plate', at: [.10,0,0] },
      { id: 'paint', at: [.12,-.01,0], leader: false }
    ]
  });
  const draw = (time, world) => probe.sample({ ...context, time, world });
  const initial = draw(0);
  assert.equal(state(initial, 'ridge'), 'hit');
  assert.deepEqual(linked(initial), ['ridge']);
  const moving = draw(.1);
  assert.equal(state(moving, 'ridge'), 'held');
  assert.equal(state(moving, 'plate'), 'hit');
  assert.equal(state(moving, 'paint'), 'hit');
  assert.deepEqual(linked(moving), ['ridge']);
  assert(moving.leaders[0].at[0] > initial.leaders[0].at[0]);
  assert.equal(state(draw(.25), 'ridge'), 'idle');
  assert.deepEqual(linked(draw(.25)), ['plate']);

  let frame = draw(0, { pause: true });
  assert.equal(state(frame, 'plate'), 'idle');
  assert.deepEqual(linked(frame), []);
  draw(0);
  frame = draw(.1, { hide: true });
  assert.equal(state(frame, 'ridge'), undefined);
  assert.deepEqual(linked(frame), ['plate']);
  assert.equal(state(draw(.1), 'ridge'), 'idle');
});

test('world range separates projected overlaps and authored mark cels preserve exact pixels', () => {
  const probe = K.surfaceProbe.create({
    at: [0,0,0], radius: .24, maxLeaders: 0, style: { hit: '#f7ffbb' }, samples: [
      { id: 'far', at: [0,0,-1], color: '#203c63', mark: 'dot' },
      { id: 'near', at: [0,0,0], mark: ['#..','..#'] },
      { id: 'clipped', at: [0,0,9] }
    ]
  });
  const frame = probe.sample(context);
  assert.deepEqual(frame.samples.map(({ id, state }) => [id,state]), [['far','idle'],['near','hit']]);
  assert.deepEqual(linked(frame), []);
  assert.deepEqual(probe.commands(frame).filter(command => command.fill === '#f7ffbb').map(c => c.rect),
    [[49,29,1,1],[51,30,1,1]]);
  const duplicate = [{ id: 'a', at: [0,0,0] }, { id: 'a', at: [1,0,0] }];
  assert.throws(() => K.surfaceProbe.create({ at: [0,0,0], samples: duplicate }), /distinct/);
  assert.throws(() => K.surfaceProbe.create({ at: [0,0], samples: duplicate }), /anchor/);
  assert.throws(() => K.surfaceProbe.create({ at: [0,0,0], samples: [{ ...duplicate[0], mark: ['##','#'] }] }), /cel/);
});

function renderFixture({ KIT, makeBuilder }) {
  const B = makeBuilder(10, [0x0f1928]);
  B.iso(.08, -.23, 0, .04, 0, 1, { k: 6, sp: Math.PI * 2, rg: .6 });
  const world = B.finish({ cam: { target: [0,0,0], dist: 4, yaw: 0, pitch: 0 }, look: { pixelSize: 1 } });
  const probe = KIT.surfaceProbe.create({
    at: [16,12], space: 'screen', radius: 20, maxLeaders: 0, hold: 0, style: { hit: '#f7ffbb' },
    samples: [{ id: 'splat', at: { splat: 0 }, mark: 'cross' }]
  });
  world.look.renderGraph = { passes: [{ id: 'overlay', type: 'composite', isolated: true, layer: probe.layer() }] };
  return world;
}

function pixels(image) {
  const points = [];
  for (let i = 0; i < image.data.length; i += 4)
    if (image.data[i] === 247 && image.data[i+1] === 255 && image.data[i+2] === 187)
      points.push([i / 4 % image.width, Math.floor(i / 4 / image.width)]);
  return points;
}

function renderCPU(times) {
  const world = renderFixture(ink.load());
  return times.map(t => pixels(ink.render(world, { t, interfaceTime: 3, w: 32, h: 24, px: 1, raw: true,
    transparent: true, renderGraphCapture: ['overlay'] }).renderGraphPasses.overlay));
}

test('composite probe layers follow a shader-animated splat using scene time', () => {
  const [first, raised] = renderCPU([0,.25]);
  assert.equal(first.length, 5);
  assert.equal(raised.length, 5);
  assert.equal(first[0][0], raised[0][0]);
  assert(first[0][1] > raised[0][1]);
});

test('WebGL and CPU draw the same posed pixel marks with independent scene and interface clocks', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const times = [0,.25];
  const result = runWebGL({}, renderFixture, (kit, build, backend, times) => {
    const world = build(kit);
    const gl = backend(32, 24, { raw: true, offscreen: true, transparent: true });
    try {
      return { images: times.map(time => {
        const { overlay } = gl.draw(world, { time, interfaceTime: 3, renderGraphCapture: ['overlay'] });
        return { width: overlay.width, data: [...overlay.data] };
      }) };
    } finally { gl.close(); }
  }, times);
  assert.deepEqual(result.images.map(pixels), renderCPU(times));
});
