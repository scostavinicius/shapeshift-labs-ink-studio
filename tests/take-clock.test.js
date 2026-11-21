const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const kit = ink.load(), K = kit.KIT, media = K.procedural.mediaGraph;
const fraction = (numerator, denominator) => ({ numerator, denominator });
const picture = fraction(30000, 1001), simulationRate = fraction(60000, 1001);
const specification = { fps: picture, simulationRate, sampleRate: 48000, cuts: [{ frame: 10, id: 'lantern-close' }] };
const boundary = fraction(1001, 3000);
const recording = { initial: { 'desk:fader': 0 }, events: [
  { time: boundary, channel: 'desk:fader', value: .75 },
  { time: boundary, channel: 'desk:cue', kind: 'pulse', value: 'ignite' }
] };
const manifest = { id: 'take-lantern', dt: 1001 / 60000,
  entities: { lantern: { position: [0, 0, 0], visual: { half: [.2, .35, .2], ramp: [19, 20, 22, 23] } } },
  timeline: {
    tracks: [{ target: '/camera/target', keys: [
      { time: 0, value: [0, 0, 0], ease: 'step' }, { time: boundary, value: [.5, .25, 0] }
    ] }],
    sequences: {
      reach: {
        duration: 1,
        audio: [
          { id: 'wind', cue: 'wind.wav', time: .25, duration: .5 },
          { id: 'lantern', cue: 'lantern.wav', time: .75, duration: .25, offset: .1 }
        ],
        markers: [{ id: 'grip', time: .75 }],
        events: [{ id: 'light', kind: 'ignite', time: .75 }]
      },
      gesture: { duration: .625, clips: [{ id: 'speedup', sequence: 'reach', time: .125, in: .25, duration: .375 }] }
    },
    clips: [{ id: 'cutaway', sequence: 'gesture', time: fraction(1001, 6000), in: .125, duration: fraction(1001, 3000) }]
  }
};
const sound = { sampleRate: 48000, channels: 1, samples: Array.from({ length: 20000 }, (_, i) => i === 16016 ? .5 : 0) };

function graphDefinition() {
  return {
    format: 'ink-studio/graph-project', version: 1,
    nodes: {
      audio: { op: 'audio.buffer', params: sound },
      controls: { op: 'input.recording', params: recording },
      window: { op: 'audio.window', inputs: { source: { node: 'audio' } } },
      analyze: { op: 'audio.analyze', inputs: { source: { node: 'audio' } } },
      replay: { op: 'input.replay', inputs: { source: { node: 'controls' } } },
      motion: { op: 'sim.define', params: {
        kind: 'particles', settings: { width: 16, height: 16, emitters: [{ at: [5, 5], rate: 12 }] },
        clock: { dt: manifest.dt }
      } },
      physics: { op: 'sim.run', inputs: { recipe: { node: 'motion' } } }
    },
    outputs: {
      audio: { node: 'window' },
      window: { node: 'window', port: 'report' },
      peak: { node: 'analyze', port: 'peak' },
      state: { node: 'replay' },
      pulses: { node: 'replay', port: 'pulses' },
      rasterState: { node: 'physics', port: 'checkpoint' }
    },
    exports: { impression: { output: 'audio', format: 'wav' } }
  };
}
const json = value => JSON.parse(JSON.stringify(value));

test('rational positions keep adjacent 29.97 fps frame, tick and audio boundaries contiguous', () => {
  const clock = K.timeDomains.take(specification), f = clock.at(719280);
  assert.equal(f.tick, 1438560);
  assert.equal(f.firstSample, Number(719280n * 1001n * 48000n / 30000n));
  assert.equal(f.endSample, clock.at(f.frame + 1).firstSample);
  assert.equal(f.endTick, clock.at(f.frame + 1).tick);
  assert.deepEqual(clock.locate(boundary), { frame: 10, tick: 20, cueTick: 20, sample: 16016 });
  assert.deepEqual(clock.locate(fraction(1001001, 3000000)), { frame: 10, tick: 20, cueTick: 21, sample: 16016 });
  const shifted = media.audioWindow(sound, { take: clock.at(10), offset: fraction(1, 96000) });
  assert.equal(shifted.report.firstSample, 16015);
  assert.equal(shifted.value.samples[1], .5);
  assert.throws(() => clock.at(1.5), /frame index/);
  assert.throws(() => K.timeDomains.take({ cuts: [{ frame: 1, id: 'a' }, { frame: 1, id: 'b' }] }), /distinct/);
});

test('time domains consume the take tick budget without advancing past an exact frame', () => {
  const clock = K.timeDomains.take(specification), frame = clock.at(10);
  const domains = K.timeDomains.create({ domains: {
    simulation: { step: clock.dt, maxSteps: 8 },
    animation: { fps: 12 }
  } });
  domains.advanceTake(frame);
  assert.equal(domains.read('simulation').tick, 8);
  domains.advanceTake(frame).advanceTake(frame);
  const render = domains.frame({ take: frame });
  assert.equal(domains.read('simulation').tick, 20);
  assert.equal(render.time, 1 / 3);
  assert.equal(render.cameraTime, frame.start);
  assert.equal(render.interfaceTime, frame.start);
  assert.equal(render.resetRenderHistory, true);
  const restored = K.timeDomains.restore(json(domains.snapshot()));
  for (let n = 11; n <= 30; n++) restored.advanceTake(clock.at(n));
  assert.equal(restored.read('simulation').tick, 60);
  assert.throws(() => restored.advanceTake(frame), /restore time domains/);
});

test('retimed cut owns the input, WAV onset and world event once through seek and checkpoint restore', () => {
  const open = checkpoint => ink.createTake({ clock: specification, world: manifest, graph: ink.createGraphProject(graphDefinition()) },
    { checkpoint });
  const take = open();
  const before = take.seek(9), saved = json(take.checkpoint());
  const cut = take.seek(10), after = take.seek(11);
  assert.equal(before.frame.end, cut.frame.start);
  assert.equal(before.graph.outputs.window.endSample, cut.graph.outputs.window.firstSample);
  assert.equal(before.graph.outputs.peak, 0);
  assert.deepEqual(before.graph.outputs.pulses, []);
  assert.deepEqual(before.world.history, []);
  assert.equal(cut.frame.cut, true);
  assert.equal(cut.frame.shot, 'lantern-close');
  assert.equal(cut.render.resetRenderHistory, true);
  assert.equal(after.render.resetRenderHistory, false);
  assert.equal(cut.graph.outputs.audio.samples[0], .5);
  assert.equal(cut.graph.outputs.peak, .5);
  assert.equal(cut.graph.outputs.rasterState.tick, 20);
  assert.equal(cut.graph.outputs.state['desk:fader'], .75);
  assert.deepEqual(cut.graph.outputs.pulses.map(row => row.value), ['ignite']);
  assert.deepEqual(cut.timeline.cues.map(row => [row.id, row.phase ?? row.type, row.frame, row.cueTick, row.sample]), [
    ['wind', 'end', 10, 20, 16016], ['grip', 'marker', 10, 20, 16016],
    ['lantern', 'start', 10, 20, 16016], ['light', 'event', 10, 20, 16016]
  ]);
  assert.deepEqual(cut.timeline.audio.map(row => [row.id, row.position]), [['lantern', .1]]);
  assert.deepEqual(cut.events.map(row => [row.kind, row.tick, row.timeline.path]), [['ignite', 20, ['cutaway', 'speedup']]]);
  assert.equal(after.world.history.length, 1);
  assert.deepEqual(after.graph.outputs.pulses, []);
  const frameBefore = K.world.visual(kit, before.world, before.query, { take: before.frame });
  const frameCut = K.world.visual(kit, cut.world, cut.query, { take: cut.frame });
  assert.deepEqual(frameBefore.cam.target, [0, 0, 0]);
  assert.deepEqual(frameCut.cam.target, [.5, .25, 0]);
  const render = (sample, world) => ink.render(world, { ...sample.render, w: 64, h: 48, px: 1, raw: true }).rgb;
  assert.notDeepEqual(render(cut, frameCut), render(before, frameBefore));

  function equalTake(other) {
    assert.deepEqual(other.frame, cut.frame);
    assert.deepEqual(other.timeline, cut.timeline);
    assert.deepEqual(other.world.history, cut.world.history);
    assert.deepEqual(other.graph.outputs, cut.graph.outputs);
    assert.equal(other.graph.artifacts[0].sha256, cut.graph.artifacts[0].sha256);
  }
  equalTake(open(saved).seek(10));
  equalTake(open().seek(10));
  assert.equal(take.seek(9).render.resetRenderHistory, true);
  equalTake(take.seek(10));
  const native = json(take.checkpoint().world);
  assert.equal(K.world.runtime.create(native.world, { checkpoint: native }).advance(25).history.length, 1);
  assert.throws(() => open({ ...saved, frame: 10 }), /simulation tick/);
});

test('take CLI resumes a graph with captured controls and WAV file beside the native world', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-exact-take-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const graph = graphDefinition();
  graph.assets = { cue: { format: 'wav', file: 'cue.wav' }, controls: { format: 'inputs', file: 'controls.json' } };
  graph.nodes.audio = { op: 'audioAsset', params: { name: 'cue' } };
  graph.nodes.controls = { op: 'inputAsset', params: { name: 'controls' } };
  fs.writeFileSync(path.join(dir, 'cue.wav'), ink.encodeWav(sound));
  write('controls.json', media.recording(recording));
  write('graph.json', graph);
  write('world.json', manifest);
  write('take.json', { format: 'ink-studio/take', version: 1, clock: specification, world: 'world.json', graph: 'graph.json' });
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const run = (...args) => JSON.parse(execFileSync(process.execPath,
    [cli, 'take', 'sample', 'take.json', ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }));
  const first = run('--frame', '9', '--checkpoint', 'before.json');
  const resumed = run('--frame', '10', '--resume', 'before.json');
  const direct = run('--frame', '10');
  assert.equal(first.world.events.length, 0);
  assert.equal(resumed.frame.firstSample, 16016);
  assert.equal(resumed.world.events[0].kind, 'ignite');
  assert.deepEqual(resumed, direct);
  assert.throws(() => run('--frame', '10', '--out', 'controls.json'), /separate files/);
});
