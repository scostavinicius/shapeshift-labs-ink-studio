const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const PNG = require('../cli/png.js');
const kit = studio.load(), K = kit.KIT, W = K.world;

function diorama() {
  const track = (target, a, b) => ({ target, keys: [{ time: 0, value: a, ease: 'linear' }, { time: 2, value: b }] });
  return {
    id: 'unified-timeline', camera: { target: [0, .3, 0], yaw: 0, pitch: .2, dist: 5 },
    solids: [
      { id: 'body', kind: 'box', at: [0, 0, 0], half: [.55, .35, .2], part: 'body', mat: 'stone', res: .1 },
      { id: 'head', kind: 'box', at: [0, .7, 0], half: [.18, .22, .18], part: 'head', mat: 'moss', res: .1 }
    ],
    parts: { body: { joint: [0, 0, 0] }, head: { parent: 'body', joint: [0, .5, 0] } },
    effects: [
      { do: 'lamp', at: [0, 0, 2], strength: 0, follow: 'head' },
      { do: 'sparks', at: [0, .6, 0], n: 0, every: .02 }
    ],
    parameterBindings: {
      controls: { glow: .1 },
      bindings: [{ path: '/effects/0/strength', parameter: 'glow' }]
    },
    timeline: {
      duration: 2,
      tracks: [
        track('/camera/yaw', 0, 1),
        track('/poses/body/translation', [0, 0, 0], [2, 0, 0]),
        track('/poses/head/translation', [0, 0, 0], [0, 1, 0]),
        track('/poses/head/rotation', [0, 0, 0], [0, 0, Math.PI]),
        track('/effects/0/strength', 0, 2),
        track('/effects/1/n', 0, 8)
      ],
      markers: [{ id: 'beat', label: 'Hold', time: 1 }],
      audio: [{ id: 'room', cue: 'room-tone', time: 0, duration: 2 }],
      events: [{ id: 'cut', kind: 'cut', time: 1 }]
    }
  };
}

test('nested trims retime pose keys, markers, audio offsets, and event boundaries together', () => {
  const source = {
    duration: 10, tracks: [{ target: '/value', keys: [{ time: 0, value: -1 }] }],
    sequences: {
      leaf: {
        duration: 4, tracks: [{ target: '/value', keys: [{ time: 0, value: 0, ease: 'linear' }, { time: 4, value: 4 }] }],
        markers: [{ id: 'downbeat', time: 2 }],
        audio: [{ id: 'bed', cue: 'room', time: 0, duration: 4, offset: .5, gain: .3 },
          { id: 'tap', cue: 'tap', time: 2 }],
        events: [{ id: 'excluded', kind: 'test', time: .5 }, { id: 'start', kind: 'test', time: 1 },
          { id: 'cut', kind: 'test', time: 3 }]
      },
      take: { clips: [{ id: 'inner', sequence: 'leaf', time: 2, in: 1, out: 3, duration: 4 }] }
    },
    clips: [{ id: 'outer', sequence: 'take', time: 4, in: 3, out: 6, duration: 1.5 },
      { id: 'second', sequence: 'leaf', time: 7, in: 1, out: 3, duration: 1 }]
  };
  const timeline = K.timeline.compile(source);
  assert.equal(timeline.duration, 10);
  assert.deepEqual(timeline.markers.map(({ path, time }) => [path, time]), [[['outer', 'inner'], 4.5], [['second'], 7.5]]);
  assert.deepEqual(timeline.sample(4.5).edits.map(row => row.value), [2]);
  const [audio] = timeline.sample(4.5).audio;
  assert.deepEqual([audio.time, audio.end, audio.position, audio.rate, audio.gain], [4, 5.5, 2.5, 1, .3]);
  assert.equal(timeline.sample(5.5).audio.length, 0);
  assert.equal(timeline.sample(6).edits[0].value, -1);
  assert.deepEqual(timeline.events.map(({ id, time }) => [id, time]), [['cut', 5.5], ['start', 7], ['cut', 8]]);
  const [spedUp] = timeline.sample(7.25).audio;
  assert.deepEqual([spedUp.position, spedUp.rate], [2, 2]);
  assert.deepEqual(timeline.between(3, 4.5).map(row => row.phase ?? row.type), ['start', 'marker', 'audio']);
  assert.deepEqual(timeline.between(4.5, 5.5).map(row => row.phase ?? row.type), ['end', 'event']);
  assert.equal(timeline.between(5.5, 5.5).length, 0);
  source.sequences.leaf.tracks[0].keys[0].value = 95;
  assert.equal(timeline.sample(4.5).edits[0].value, 2);
});

test('invalid and conflicting timeline tracks, cue IDs, and sequence cycles are rejected', () => {
  const track = { target: '/a', keys: [{ time: 0, value: 1 }, { time: 1, value: 2 }] };
  assert.throws(() => K.timeline.compile({ tracks: [track, track] }), /one track per target/);
  assert.throws(() => K.timeline.compile({ tracks: [track, { ...track, target: '/a/b' }] }), /property and its child/);
  assert.throws(() => K.timeline.compile({ duration: .5, tracks: [track] }), /contain its keys/);
  assert.throws(() => K.timeline.compile({ audio: [{ id: 'cue', cue: 'a', time: 1 }, { id: 'cue', cue: 'b', time: 2 }] }),
    /duplicate timeline audio/);
  assert.throws(() => K.timeline.compile({ sequences: { take: { clips: [{ id: 'self', sequence: 'take', time: 0 }] } } }),
    /sequence cycle/);
  const spec = diorama();
  spec.timeline.tracks[0].target = '/poses/missing/rotation';
  assert(K.diorama.check(spec).some(row => row.path === 'timeline' && /Unsupported timeline target/.test(row.problem)));
  spec.timeline.tracks[0].target = '/camera/pitch';
  spec.timeline.tracks[0].keys[0].value = true;
  assert(K.diorama.check(spec).some(row => row.path === 'timeline' && /Invalid keyframe/.test(row.problem)));
  assert.throws(() => W.runtime.validate({ timeline: { tracks: [{ ...track, target: '/entities/name/position' }] } }),
    /Unsupported timeline target/);
});

test('JSON scene and model use the same keyed camera, parented poses, lamps, and particles', () => {
  const spec = diorama();
  const world = studio.createSceneEditor(spec).build({ controls: { glow: .25 } });
  world.anim.update(0, 0);
  assert.equal(world.cam.yaw, 0);
  assert.equal(world.lab.lit.lights[0].s, 0);
  assert.equal(world.lab.ps.live, 0);
  world.anim.update(.05, 1);
  assert.equal(world.cam.yaw, .5);
  assert.deepEqual(world.lab.rig.at('head', [0, .5, 0]), [1, 1, 0]);
  assert.deepEqual(world.lab.lit.lights[0].p, [1.5, 1, 2]);
  assert.equal(world.lab.lit.lights[0].s, 1);
  assert.equal(world.lab.ps.live, 4);
  assert.equal(world.parameters.values().glow, .25);
  assert.equal(world.timeline.sample(1).audio[0].position, 1);
  assert.deepEqual(world.timeline.between(0, 1).map(row => row.type), ['marker', 'event']);
  const [animation] = K.diorama.scene(spec).model(1, { fps: 2, resolution: .18 }).animations;
  assert.deepEqual(animation.frames.map(frame => frame.time), [0, .5, 1, 1.5, 2]);
  const index = world.lab.rig.names.indexOf('head');
  assert.deepEqual(animation.frames[2].matrices[1], Array.from(world.lab.rig.M.slice(index * 12, index * 12 + 12)));
  assert.equal(spec.camera.yaw, 0);
  assert.equal(spec.effects[0].strength, 0);
});

test('world events queue once at the corresponding ticks and presentation samples the same clock after restore', () => {
  const source = { id: 'timeline-sim', dt: .1, visual: { atmosphere: { density: .2 } }, timeline: {
    duration: 1, tracks: [
      { target: '/camera/target', keys: [{ time: 0, value: [0, 0, 0], ease: 'linear' }, { time: 1, value: [1, 0, 0] }] },
      { target: '/visual/atmosphere/density', keys: [{ time: 0, value: .2, ease: 'linear' }, { time: 1, value: .6 }] }
    ],
    events: [{ id: 'zero', time: 0, kind: 'start' }],
    sequences: { action: { duration: .2, events: [{ id: 'cue', time: .2, kind: 'spark', detail: { count: 3 } }] } },
    clips: [{ id: 'early', time: .1, sequence: 'action' }, { id: 'late', time: .37, sequence: 'action' }]
  } };
  const run = W.runtime.create(source);
  run.advance(2);
  assert.deepEqual(run.history.map(({ timeline, tick }) => [timeline.id, tick]), [['zero', 1]]);
  const checkpoint = run.checkpoint(), restored = W.runtime.create(checkpoint.world, { checkpoint });
  run.advance(6);
  restored.advance(6);
  assert.deepEqual(run.checkpoint(), restored.checkpoint());
  assert.deepEqual(run.history.map(({ timeline, tick }) => [timeline.path, tick]), [[[], 1], [['early'], 3], [['late'], 6]]);
  assert.equal(run.events[0].count, 3);
  assert.equal(W.runtime.replay(run.recording()).history.length, 3);
  const visual = W.visual(kit, restored.view(), restored.query());
  assert.deepEqual(visual.cam.target, [run.view().time, 0, 0]);
  assert(Math.abs(visual.atmosphere.density - .44) < 1e-10);
  assert.equal(restored.view().world.visual.atmosphere.density, .2);
  assert.equal(visual.timeline, restored.timeline);
});

test('CLI inspects the authored timeline and renders the keyed scene through the usual entry point', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-scene-timeline-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scene = path.join(dir, 'scene.json'), png = path.join(dir, 'frame.png');
  const report = path.join(dir, 'timeline.json'), cli = path.resolve(__dirname, '../cli/ink-studio.js');
  fs.writeFileSync(scene, JSON.stringify(diorama()));
  const call = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe' });
  call('timeline', scene, '--at', '1', '--from', '0', '--to', '1', '--out', report);
  const parsed = JSON.parse(fs.readFileSync(report));
  assert.equal(parsed.duration, 2);
  assert.equal(parsed.frame.audio[0].position, 1);
  assert.deepEqual(parsed.cues.map(row => row.type), ['marker', 'event']);
  function draw(time) {
    call('render', scene, '--t', String(time), '--raw', '--w', '96', '--h', '64', '--px', '1', '--out', png);
    return Buffer.from(PNG.read(png).rgb);
  }
  assert(!draw(0).equals(draw(1)));
  call('clip', scene, '--fps', '3', '--w', '96', '--h', '64', '--px', '1', '--out', png);
  const anim = fs.readFileSync(png), control = anim.indexOf('acTL');
  assert(control > 0);
  assert.equal(anim.readUInt32BE(control + 4), 6);
});

test('WebGL consumes the same timeline camera, light, and rig state', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, diorama, (kit, fixture, backend) => {
    const world = kit.KIT.diorama.build(fixture()), draw = backend(96, 64, { raw: true });
    try {
      world.anim.update(0, 0);
      draw.draw(world, { time: 0 });
      const initial = draw.image();
      world.anim.update(.05, 1);
      draw.draw(world, { time: 1 });
      return { changed: draw.image() !== initial, yaw: world.cam.yaw, lamp: world.lab.lit.lights[0].s,
        joint: world.lab.rig.at('head', [0, .5, 0]) };
    } finally {
      draw.close();
    }
  });
  const { changed, yaw, lamp, joint } = result;
  assert.deepEqual({ changed, yaw, lamp, joint }, { changed: true, yaw: .5, lamp: 1, joint: [1, 1, 0] });
});
