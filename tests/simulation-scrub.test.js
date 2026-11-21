const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load(), K = kit.KIT, W = K.world, R = W.runtime;
const copy = value => JSON.parse(JSON.stringify(value));
const near = (a, b) => assert(a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 1e-6));

function simulation() {
  return {
    format: 'ink-studio/world', id: 'moving-body', dt: .1, seed: 42,
    entities: { marker: { position: [3, 1, 0] }, crate: { sockets: { top: [0, .3, 0] } } },
    systems: { rig: { kind: 'mechanics', config: {
      drag: 0, gravity: [0, 0, 0], bodies: {
        crate: { position: [0, 1, 0], half: [.3, .15, .2], velocity: [1, 0, 0], angular: [0, 2, 0], turn: .35 }
      }
    } } },
    commands: [{ tick: 5, action: 'world/patch', args: {
      edits: [{ op: 'set', path: '/entities/marker/position', value: [4, 1, 0] }]
    } }],
    timeline: { events: [{ id: 'beat', time: .3, kind: 'beat' }] },
    visual: { bounds: { min: [-2, -.3, -2], max: [3, 1.7, 2] }, resolution: .16,
      camera: { target: [0, .6, 0], dist: 6, yaw: .4, pitch: .25 }, fields: { bodies: 'rig/bodies' } }
  };
}

const impulse = { tick: 7, action: 'rig/impulse', args: { body: 'crate', linear: [1, 0, 0] } };
const future = { tick: 40, action: 'world/event', args: { kind: 'next' } };
const track = (target, field, filters = {}) => ({ target, field, ...filters });

test('out-of-order ticks match uninterrupted solver state, commands and events while reusing a bounded cache', () => {
  const direct = R.create(simulation());
  direct.schedule([impulse, future]);
  const exact = new Map([[0, direct.checkpoint()]]);
  direct.advance(32, { onTick(view) { exact.set(view.tick, direct.checkpoint()); } });
  const session = W.scrub.create(copy(direct.recording()), { checkpointEvery: 4, checkpointCache: 5 });
  const issued = [28, 12, 20, 4, 31, 0, 19, 19, 32, 2, 32];
  for (const tick of issued) {
    const view = session.seek(tick);
    assert.equal(view.tick, tick);
    assert.deepEqual(session.checkpoint(), exact.get(tick));
    assert.deepEqual(session.events(), exact.get(tick).events);
    assert(session.status().cachedTicks.length <= 6);
    assert.equal(session.status().cachedTicks[0], 0);
  }
  assert.equal(session.status().replayedTicks, 0);
  const before = session.checkpoint();
  assert.equal(session.seekTime(.3).tick, 3);
  assert.equal(session.events()[0].kind, 'beat');
  assert.equal(session.seekTime(.3999).tick, 3);
  assert.throws(() => session.seek(33), /Scrub tick must be in/);
  assert.equal(session.view().tick, 3);
  assert.equal(before.tick, 32);
  assert.deepEqual(before.pending, [future]);
  assert.deepEqual(direct.checkpoint(), exact.get(32));
});

test('an isolated checkpoint keeps pending actions and starts the seek range at its own tick', () => {
  const direct = R.create(simulation());
  direct.schedule([impulse, future]);
  direct.advance(4);
  const base = copy(direct.checkpoint());
  const session = W.scrub.create(base, { checkpointCache: 0 });
  assert.throws(() => session.seek(3), /\[4, /);
  direct.advance(9);
  assert.equal(session.seek(9).tick, 9);
  assert.deepEqual(session.checkpoint(), direct.checkpoint());
  assert.deepEqual(session.status().cachedTicks, [4]);
  assert.deepEqual(session.seek(4).world, base.world);
  assert.deepEqual(session.checkpoint(), base);
  assert.deepEqual(session.seek(9).world, direct.view().world);
});

test('a failing step or divergent recording endpoint does not replace the displayed state or cached checkpoints', () => {
  const direct = R.create(simulation());
  direct.advance(11);
  const damaged = copy(direct.recording());
  damaged.end.world.metadata.diverged = true;
  const seek = W.scrub.create(damaged, { checkpointEvery: 2 });
  seek.seek(4);
  let before = seek.checkpoint(), status = seek.status();
  assert.throws(() => seek.seek(11), /Replay diverged at tick 11/);
  assert.equal(seek.checkpoint(), before);
  assert.deepEqual(seek.status(), status);
  assert.throws(() => seek.recordTake({ from: 4, to: 11, tracks: W.scrub.motionTracks('crate') }), /Replay diverged/);
  assert.equal(seek.checkpoint(), before);
  const failed = W.scrub.create(simulation(), { commands: [{ tick: 8, action: 'world/patch', args: {
    edits: [{ op: 'remove', path: '/metadata/missing' }]
  } }] });
  failed.seek(6);
  before = failed.checkpoint();
  status = failed.status();
  assert.throws(() => failed.seek(9), /Cannot remove missing path/);
  assert.equal(failed.checkpoint(), before);
  assert.deepEqual(failed.status(), status);
});

test('takes sample committed poses and fields including the last tick and can be edited and nested', () => {
  const session = W.scrub.create(simulation());
  const before = session.seek(9);
  const status = session.status();
  const tracks = [...W.scrub.motionTracks('crate', 'body'),
    track('/camera/target', 'world/position', { at: { entity: 'marker' } }),
    track('/effects/0/strength', 'rig/bodies', { path: '/crate/position/0' })];
  const recorded = session.recordTake({ from: 1, to: 6, every: 2, tracks });
  assert.equal(session.view().tick, before.tick);
  assert.deepEqual(session.status(), status);
  assert.deepEqual(recorded.source, { id: 'moving-body', seed: 42, dt: .1, fromTick: 1, toTick: 6, every: 2 });
  assert.deepEqual(recorded.sequence.tracks[0].keys.map(key => key.time), [0, .2, .4, .5]);
  assert.deepEqual(recorded.sequence.tracks[2].keys.map(key => key.value[0]), [3, 3, 4, 4]);
  const discrete = session.recordTake({ from: 1, to: 2, tracks: [track('/body', 'rig/bodies', { path: '/crate' })] });
  const held = W.scrub.openTake(discrete);
  assert.deepEqual(held.sample(.05).edits[0].value, held.sample(0).edits[0].value);
  const opened = W.scrub.openTake(copy(recorded));
  const start = session.seek(1), startPose = session.query().frame({ entity: 'crate' });
  assert.equal(start.tick, 1);
  session.seek(6);
  const endPose = session.query().frame({ entity: 'crate' });
  near(opened.sample(.5).edits[0].value, K.V.sub(endPose.point, startPose.point));
  near(K.M.mul(opened.sample(.5).edits[1].value, startPose.rotation), endPose.rotation);
  const relative = session.recordTake({ from: 4, to: 6, tracks: [{
    target: '/poses/body/translation', entity: 'crate', socket: 'top', channel: 'translation', reference: { entity: 'marker' }
  }] });
  const finish = session.query().frame({ entity: 'crate', socket: 'top' }).point;
  session.seek(4);
  const initial = session.query().frame({ entity: 'crate', socket: 'top' }).point;
  near(relative.sequence.tracks[0].keys.at(-1).value, K.V.sub(K.V.sub(finish, initial), [1, 0, 0]));
  session.seek(6);
  assert.throws(() => session.recordTake({ from: 1, to: 6, tracks: [track('/camera/target', 'missing/field')] }),
    /camera\/target at tick 1: missing\/field is unavailable/);
  assert.equal(session.view().tick, 6);

  const edited = copy(recorded);
  edited.sequence.tracks[0].keys.at(-1).value = [1.2, 0, 0];
  const scene = K.diorama.build({ id: 'edited-take',
    solids: [{ kind: 'box', at: [0, .8, 0], half: [.3, .15, .2], part: 'body', res: .1 }],
    parts: { body: { joint: [0, .8, 0] } }, effects: [{ do: 'lamp', at: [0, 1, 1], strength: 0 }],
    timeline: { sequences: { captured: edited.sequence }, clips: [{ id: 'slow', sequence: 'captured', time: 1, duration: 1 }] }
  });
  scene.anim.update(0, 0);
  scene.anim.update(.05, 2);
  near(scene.lab.rig.at('body', [0, .8, 0]), [1.2, .8, 0]);
  near(K.M.tr(scene.lab.rig.M.slice(12, 21)), K.M.tr(opened.sample(.5).edits[1].value));
  assert.deepEqual(scene.cam.target, [4, 1, 0]);
  assert.equal(scene.lab.lit.lights[0].s, recorded.sequence.tracks[3].keys.at(-1).value);
});

test('rigid orientation keys follow the shortest arc and preserve a rotation at every fractional sample', () => {
  const aroundY = degrees => K.M.rot([0, 1, 0], degrees * Math.PI / 180);
  const keys = K.anim.keyframeTrack.create({ R: 'orientation' }, [
    { time: 0, value: { R: aroundY(170) }, ease: 'linear' }, { time: 1, value: { R: aroundY(-170) } }
  ]);
  near(keys.sample(.5).R, aroundY(180));
  assert(K.anim.keyframeTrack.orientation(keys.sample(.25).R));
  assert.throws(() => K.anim.keyframeTrack.create({ R: 'orientation' }, [{ time: 0, value: {
    R: [1, 0, 0, 0, 2, 0, 0, 0, 1]
  } }]), /Invalid orientation/);
});

test('CLI scrubs a shared recording, opens the final checkpoint and renders earlier frames consistently', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-motion-scrub-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const file = name => path.join(dir, name);
  fs.writeFileSync(file('world.json'), JSON.stringify(simulation()));
  fs.writeFileSync(file('actions.json'), JSON.stringify([impulse, future]));
  function call(...args) {
    const child = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return child.stdout && JSON.parse(child.stdout);
  }
  call('sim', 'run', 'world.json', '--ticks', '18', '--actions', 'actions.json', '--record', 'run.json', '--checkpoint-store', 'blocks');
  const results = call('sim', 'scrub', 'run.json', '--ticks', '18,4,11,4', '--checkpoint-every', '3', '--checkpoint-cache', '8',
    '--entity', 'crate', '--socket', 'top', '--checkpoint', 'picked.json');
  assert.deepEqual(results.frames.map(row => row.tick), [18, 4, 11, 4]);
  assert.equal(results.frames.at(-1).replayedTicks, 0);
  assert.deepEqual(results.frames[1].pose, results.frames.at(-1).pose);
  assert(results.storage.checkpoint.root);
  const selected = call('probe', 'run.json', '--ticks', '4', '--field', 'world/position', '--entity', 'crate');
  assert.deepEqual(selected, call('probe', 'picked.json', '--field', 'world/position', '--entity', 'crate'));
  call('sim', 'render', 'run.json', '--ticks', '4', '--out', 'earlier.png', '--w', '96', '--h', '64');
  call('sim', 'render', 'picked.json', '--out', 'checkpoint.png', '--w', '96', '--h', '64');
  assert.deepEqual(fs.readFileSync(file('earlier.png')), fs.readFileSync(file('checkpoint.png')));
  assert.equal(call('sim', 'scrub', 'run.json', '--t', '.3,.17').frames.at(-1).tick, 1);
  call('sim', 'take', 'run.json', '--from', '3', '--ticks', '10', '--every', '3', '--entity', 'crate', '--part', 'body', '--out', 'take.json');
  const saved = JSON.parse(fs.readFileSync(file('take.json')));
  const frame = call('timeline', 'take.json', '--at', '.3').frame;
  assert.deepEqual(frame.edits.map(row => row.path), [['poses', 'body', 'translation'], ['poses', 'body', 'orientation']]);
  near(frame.edits[0].value, saved.sequence.tracks[0].keys[1].value);
});

test('a captured take drives baked pose geometry through WebGL', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, simulation, (kit, fixture, backend) => {
    const { KIT: K } = kit, W = K.world;
    const take = W.scrub.create(fixture()).recordTake({ from: 0, to: 6, tracks: W.scrub.motionTracks('crate') });
    const world = K.diorama.build({ id: 'captured', camera: { target: [0, .6, 0], dist: 4, yaw: .3, pitch: .2 },
      solids: [{ kind: 'box', at: [0, .6, 0], half: [.3, .15, .18], part: 'crate', res: .08 }],
      parts: { crate: { joint: [0, .6, 0] } }, timeline: take.sequence });
    const draw = backend(96, 64, { raw: true });
    try {
      world.anim.update(0, 0);
      draw.draw(world, { time: 0 });
      const start = draw.image();
      world.anim.update(.05, .6);
      const changedRows = Array.from(world.anim.rows).flatMap((dirty, index) => dirty ? [index] : []);
      draw.draw(world, { time: .6, changedRows });
      return { changed: draw.image() !== start, point: world.lab.rig.at('crate', [0, .6, 0]) };
    } finally {
      draw.close();
    }
  });
  assert(result.changed);
  assert(result.point[0] > .5);
});
