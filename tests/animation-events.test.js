const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const runWebGL = require('../cli/look-webgl.js');
const kit = studio.load(), K = kit.KIT, A = K.anim;
const near = (a, b) => assert(Math.abs(a - b) < 1e-9, a + ' differs from ' + b);

function definition() {
  return {
    clips: {
      ready: { dur: 1, loop: true, tracks: {
        'body.pos': [[0, [0, 0, 0], 'linear'], [1, [1, 0, 0]]],
        'arm.rot': [[0, [0, 170, 0]]]
      }, events: [{ name: 'start', time: 0 }, { name: 'land', time: .25, data: { surface: 'stone' } },
        { name: 'muted', time: .3 }] },
      move: { dur: 1, tracks: {
        'body.pos': [[0, [2, 0, 0], 'linear'], [1, [3, 0, 0]]],
        'arm.rot': [[0, [0, -170, 0]]]
      }, events: [{ name: 'arrive', time: 0 }, { name: 'lift', time: .1 }] },
      accent: { dur: 1, tracks: { 'arm.scale': [[0, 1.25]] }, events: [{ name: 'accent', time: .15 }] }
    },
    layers: [
      { id: 'body', entry: 'ready', states: [{ id: 'ready', clip: 'ready' }, { id: 'move', clip: 'move' }, { id: 'done' }],
        transitions: [{ id: 'landing', from: 'ready', to: 'move', duration: .4, easing: 'linear', on: 'land' },
          { id: 'finish', from: 'move', to: 'done', duration: 0, on: 'lift' }] },
      { id: 'arms', entry: 'accent', states: [{ id: 'accent', clip: 'accent' }] }
    ],
    eventBindings: {
      land: [{ type: 'contact', contact: 'left', action: 'plant' }, { type: 'sound', cue: 'step-stone', gain: .7 },
        { type: 'effect', effect: 'flash', settings: { duration: .3, color: [240, 150, 100] } }],
      lift: [{ type: 'contact', contact: 'left', action: 'release' }]
    }
  };
}

function contactFixture(kit) {
  const { KIT: K, makeBuilder } = kit, A = K.anim;
  const B = makeBuilder(1, [0x141820, 0xb34e59]);
  B.iso(0, .25, 0, .24, B.P[1], 3);
  const world = B.finish({ cam: { target: [0, .4, 0], yaw: .3, pitch: .2, dist: 4 } });
  const pivot = [0, .25, 0], puppet = K.puppet(world, { parts: { foot: { ids: [0], pivot } } });
  const clip = A.clip({ dur: 1, tracks: { 'foot.pos': [[0, [0, 0, 0], 'linear'], [1, [0, .7, 0]]] },
    events: [{ name: 'down', time: .25 }, { name: 'up', time: .6 }] });
  const machine = A.machine({ layers: [{ id: 'base', entry: 'moving', states: [{ id: 'moving', clip }] }],
    eventBindings: {
      down: [{ type: 'contact', contact: 'sole', action: 'plant' }, { type: 'sound', cue: 'boot' },
        { type: 'effect', effect: 'flash', settings: { duration: .3 } }],
      up: [{ type: 'contact', contact: 'sole', action: 'release' }]
    } });
  const sounds = [];
  const binding = machine.bind({ world, puppet, contacts: { sole: { part: 'foot', point: pivot, target: [.4, .25, 0] } },
    onSound: row => sounds.push(row) });
  return { world, puppet, pivot, binding, sounds };
}

test('named events share source timing across one-shot, looped, retimed and reverse playback', () => {
  const original = { id: 'take', dur: 1, loop: true, events: [
    { id: 'first', name: 'begin', time: 0 }, { name: 'push', time: .25, data: { power: 2 } },
    { id: 'last', name: 'end', time: 1 }
  ], cues: [[.6, 'legacy']] };
  const clip = A.clip(original);
  original.events[1].data.power = 4;
  const simplify = rows => rows.map(e => [e.name, e.time, e.cycle]);
  assert.deepEqual(simplify(clip.eventsBetween(-1, 1)), [
    ['begin', 0, 0], ['push', .25, 0], ['legacy', .6, 0], ['end', 1, 0], ['begin', 1, 1]
  ]);
  assert.deepEqual(clip.eventsBetween(1, 1), []);
  assert.deepEqual(simplify(clip.eventsBetween(-1, .5, { playback: 'once', speed: -2 })), [
    ['end', 0, 0], ['legacy', .2, 0], ['push', .375, 0], ['begin', .5, 0]
  ]);
  assert.equal(clip.eventsBetween(0, .25)[0].data.power, 2);
  const sequence = A.sequence.create({ clips: { take: clip }, steps: [
    { id: 'trim', clip: 'take', in: .125, out: .625, duration: 1 }
  ] });
  const placed = sequence.eventsBetween(0, .25)[0];
  assert.deepEqual([placed.name, placed.time, placed.sourceTime, placed.data.power], ['push', .25, .25, 2]);
  assert.throws(() => A.clip({ dur: 1, events: [{ name: 'late', time: 2 }] }), /within their clip/);
});

test('named events dispatch sound, contacts and FX while transitioning at the marker and blending live clips', () => {
  const graph = A.animationGraph.create(definition());
  let frame = graph.advance(.29);
  assert.equal(graph.state('body'), 'move');
  assert.deepEqual(frame.contacts, ['left']);
  const land = frame.events.filter(row => row.time === .25).map(row => row.type);
  assert.deepEqual(land, ['animation', 'contact', 'sound', 'effect', 'transition', 'state', 'animation']);
  assert.equal(frame.events.find(row => row.name === 'land').data.surface, 'stone');
  assert.equal(frame.events.find(row => row.type === 'sound').gain, .7);
  assert(frame.presentation.overlays[0].opacity > 0);
  frame = graph.advance(.16);
  assert.deepEqual(frame.contacts, []);
  assert.equal(frame.events.find(row => row.name === 'lift').time, .35);
  assert(!frame.events.some(row => row.name === 'muted'));
  near(graph.pose().body.pos[0], 1.325);
  near(graph.pose().arm.rot[1], 180);
  assert.equal(graph.pose().arm.scale, 1.25);
  frame = graph.advance(.35);
  assert.equal(graph.state('body'), 'done');
  near(frame.events.find(row => row.transition === 'finish').time, .65);
  assert.deepEqual(frame.presentation.overlays, []);
  assert.deepEqual(graph.advance(0).events, []);
});

test('coarse and subdivided advances agree across loops, queued transitions, and timed exit conditions', () => {
  const source = definition();
  source.layers[0].states.push({ id: 'recover', clip: 'ready' });
  source.layers[0].transitions.push({ id: 'recovery', from: 'done', to: 'recover', exitTime: .2, duration: 0 });
  const run = ends => {
    const graph = A.animationGraph.create(source), rows = [];
    let clock = 0, frame;
    for (const end of ends) {
      frame = graph.advance(end - clock);
      rows.push(...frame.events.map(row => [row.type, row.layer, row.name ?? row.event ?? row.transition, +row.time.toFixed(9)]));
      clock = end;
    }
    return { rows, pose: graph.pose(), states: frame.layers.map(row => row.state) };
  };
  assert.deepEqual(run([2.6]), run([0, .15, .25, .34, .35, .4, .65, .74, .9, 1.85, 2.6]));
  assert.deepEqual(run([2.6]).rows.filter(row => row[2] === 'recovery').map(row => row[3]), [.85]);
});

test('event transitions respect input and exit guards and zero-time cycles roll back', () => {
  const clip = A.clip({ dur: 1, events: [{ name: 'step', time: .15 }, { name: 'step', time: .4 }] });
  const ready = A.machine({ inputs: [{ id: 'armed', type: 'boolean', value: false }],
    layers: [{ id: 'guard', entry: 'idle', states: [{ id: 'idle', clip }, { id: 'next' }], transitions: [
      { from: 'idle', to: 'next', duration: 0, exitTime: .25, on: 'step',
        conditions: [{ input: 'armed', op: 'eq', value: true }] }
    ] }] });
  ready.set('armed', true);
  assert.equal(ready.advance(.16).layers[0].state, 'idle');
  assert.equal(ready.advance(.25).layers[0].state, 'next');
  const zero = A.clip({ dur: 1, events: [{ name: 'again', time: 0 }] });
  const cycle = A.machine({ layers: [{ id: 'loop', entry: 'a', states: [{ id: 'a', clip: zero }, { id: 'b', clip: zero }],
    transitions: [{ from: 'a', to: 'b', on: 'again', duration: 0 }, { from: 'b', to: 'a', on: 'again', duration: 0 }] }] });
  const before = cycle.frame();
  assert.throws(() => cycle.advance(.1), /budget/);
  assert.deepEqual(cycle.frame(), before);
});

test('a puppet applies event contacts and presentation through its normal animation update', () => {
  const { world, puppet, pivot, binding, sounds } = contactFixture(kit);
  world.anim.update(0, .35);
  assert.deepEqual(binding.frame().constraints.map(x => x.id), ['sole']);
  near(puppet.point('foot', pivot)[0], .4);
  near(puppet.point('foot', pivot)[1], .25);
  assert(world.anim.grade);
  world.anim.update(0, .35);
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].time, .25);
  world.anim.update(.01, .7);
  assert.deepEqual(binding.frame().contacts, []);
  near(puppet.point('foot', pivot)[1], .74);
  assert.equal(world.anim.grade, null);
  binding.reset();
  world.anim.update(0, .4);
  assert.equal(sounds.length, 2);
});

test('CLI opens a portable graph and exports ordered named responses with the final blended pose', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-animation-graph-'));
  t.after(() => fs.rmSync(tmp, { force: true, recursive: true }));
  const spec = definition();
  spec.inputs = [{ id: 'armed', type: 'boolean', value: false }];
  spec.layers[0].transitions[0].conditions = [{ input: 'armed', op: 'eq', value: true }];
  fs.writeFileSync(path.join(tmp, 'graph.json'), JSON.stringify(spec));
  fs.writeFileSync(path.join(tmp, 'inputs.json'), JSON.stringify([{ time: .1, set: { armed: true } }]));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  execFileSync(process.execPath, [cli, 'animation-graph', 'graph.json', '--at', '.45', '--inputs', 'inputs.json', '--out', 'report.json'],
    { cwd: tmp, stdio: 'pipe' });
  const output = JSON.parse(fs.readFileSync(path.join(tmp, 'report.json')));
  assert.equal(output.layers[0].state, 'move');
  assert.deepEqual(output.layers[0].samples.map(row => row.clip), ['ready', 'move']);
  assert.equal(output.events.find(row => row.type === 'sound').cue, 'step-stone');
  near(output.pose.body.pos[0], 1.325);
});

test('WebGL renders a graph-driven contact and event presentation', { skip: !process.env.INK_TEST_CHROME }, () => {
  const result = runWebGL({}, contactFixture, (kit, fixture, backend) => {
    const { world, puppet, pivot, sounds } = fixture(kit);
    const draw = backend(96, 64, {});
    try {
      world.anim.update(0, 0);
      draw.draw(world, { time: 0 });
      const before = draw.image();
      world.anim.update(.05, .35);
      draw.draw(world, { time: .35 });
      return { changed: before !== draw.image(), contact: puppet.point('foot', pivot)[0], sounds: sounds.length };
    } finally {
      draw.close();
    }
  });
  assert(result.changed);
  near(result.contact, .4);
  assert.equal(result.sounds, 1);
});
