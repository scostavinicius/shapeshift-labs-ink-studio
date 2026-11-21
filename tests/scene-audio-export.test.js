const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const kit = ink.load(), K = kit.KIT;
const fps = { numerator: 30000, denominator: 1001 };
const sound = (samples, sampleRate = 8000, channels = 1) => ({ sampleRate, channels, samples });
const blank = { w: 2, h: 2, rgb: new Uint8Array(12) };
const config = settings => ({ format: 'ink-studio/scene-audio', version: 1, sampleRate: 8000, ...settings });
const directory = t => {
  const location = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-scene-audio-'));
  t.after(() => fs.rmSync(location, { recursive: true, force: true }));
  return location;
};
const at = (wave, n) => Array.from(wave.samples.slice(n * 2, n * 2 + 2));
const stem = (dir, manifest, name) => ink.readWav(path.join(dir, name === 'mix' ? manifest.audio.mix : manifest.audio.stems[name].file));

test('retimed timeline audio and rational picture duration share absolute sample boundaries', t => {
  const out = directory(t);
  const timeline = K.timeline.compile({
    duration: 1,
    sequences: { cue: { duration: .5, audio: [{ id: 'note', cue: 'note', time: .25, duration: .25, offset: 1 / 8000 }] } },
    clips: [{ id: 'half', sequence: 'cue', time: { numerator: 1001, denominator: 30000 }, duration: .25 }]
  }, { exact: true });
  const audio = ink.createSceneAudio(config({ spatial: { cues: { note: 'note' } } }),
    { kit, resolveAsset: () => sound([0, .125, 0, .25, 0, .375, 0, .5]) });
  let videoRequest;
  const { manifest } = ink.exportScene(() => ({ scene: 'trim', duration: 1, timeline, sample: () => blank }),
    { out, from: .1, to: .2, fps, kit, audio, formats: ['loop', 'replay'], width: 2, height: 2,
      mux(payload) {
        videoRequest = payload;
        return { extension: 'bin', bytes: Buffer.of(1, 2, 3) };
      } });
  assert.equal(manifest.sequence.frameCount, 3);
  assert.equal(manifest.sequence.duration, .1001);
  assert.deepEqual(manifest.sequence.frameRate, fps);
  assert.equal(manifest.audio.firstSample, 800);
  assert.equal(manifest.audio.endSample, 1600);
  const first = 1266 - 800;
  const track = stem(out, manifest, 'timeline');
  assert.deepEqual(at(track, first - 1), [0, 0]);
  assert.deepEqual([0, 1, 2, 3].map(i => at(track, first + i)[0]), [.125, .25, .375, .5]);
  for (const name of ['timeline', 'spatial', 'music', 'tracks', 'mix'])
    assert.equal(stem(out, manifest, name).samples.length, 1600);
  assert.deepEqual(videoRequest.fps, fps);
  assert.equal(videoRequest.frames.length, 3);
  assert.deepEqual(videoRequest.audio, fs.readFileSync(path.join(out, manifest.audio.mix)));
  const replay = ink.readSceneReplay(path.join(out, manifest.replay));
  assert.deepEqual(replay.frameRate, fps);
  const apng = fs.readFileSync(path.join(out, manifest.loop.file)), frame = apng.indexOf('fcTL');
  assert.deepEqual([apng.readUInt16BE(frame + 24), apng.readUInt16BE(frame + 26)], [1001, 30000]);
});

test('world ticks trigger spatial panning and adaptive score changes between picture frames', t => {
  const out = directory(t);
  const world = { id: 'sound-world', dt: .05,
    systems: { score: { kind: 'adaptive-music', config: {
      entry: 'calm', emotions: { tension: {} },
      sections: { calm: { resource: 'quiet' }, busy: { resource: 'struck', layers: { bell: .5 } } },
      cues: { chime: { resource: 'chime' } },
      transitions: [{ id: 'rise', from: 'calm', to: 'busy', quantize: 'none', cue: 'chime',
        when: { path: '/emotions/tension', op: 'gte', value: .5 } }]
    } } },
    commands: [
      { tick: 2, action: 'world/event', args: { kind: 'audio-cue', cue: 'step', at: [1, 0, 0] } },
      { tick: 3, action: 'world/input', args: { port: 'score/emotion.tension', value: 1 } }
    ]
  };
  const samples = { foot: sound([.5, .25]), quiet: sound([.125]), struck: sound([.25]), bell: sound([.25]), chime: sound([.125]) };
  const audio = ink.createSceneAudio(config({
    spatial: { cues: { step: 'foot' } }, music: { system: 'score', fade: 0, layers: { struck: { bell: 'bell' } } }
  }), { kit, resolveAsset: id => samples[id] });
  const { manifest } = ink.exportScene(() => ({ scene: world.id, sample: () => blank,
    runtime: () => K.world.runtime.create(world) }),
  { out, kit, audio, formats: ['loop'], fps: 4, width: 2, height: 2, to: .5 });
  const effect = stem(out, manifest, 'spatial'), music = stem(out, manifest, 'music'), mix = stem(out, manifest, 'mix');
  assert.deepEqual(at(effect, 799), [0, 0]);
  assert.deepEqual(at(effect, 800), [0, .5]);
  assert.deepEqual(at(music, 1199), [.125, .125]);
  assert.deepEqual(at(music, 1200), [.5, .5]);
  assert.deepEqual(at(music, 1201), [.375, .375]);
  assert.deepEqual(at(mix, 800), [.125, .625]);
});

test('CLI renders a take world, publishes a graph WAV stem, and calls the registered mux adapter', t => {
  const out = directory(t), save = (file, data) => fs.writeFileSync(path.join(out, file), JSON.stringify(data));
  save('world.json', { format: 'ink-studio/world', id: 'export-audio', dt: 1 / 60,
    entities: { bell: { position: [0, 0, 0], visual: { half: [.2, .3, .2], ramp: [1, 2, 3] } } },
    timeline: { duration: 1, audio: [{ id: 'tap', cue: 'graph', time: { numerator: 1001, denominator: 30000 } }] } });
  save('take.json', { format: 'ink-studio/take', version: 1, world: 'world.json', clock: { fps } });
  save('tone.json', { format: 'ink-studio/graph-project', version: 1,
    nodes: { tone: { op: 'audio.buffer', params: sound([.25, .5]) } }, outputs: { stem: { node: 'tone' } } });
  save('sound.json', { ...config({ tracks: [{ asset: 'graph', time: 0 }] }),
    assets: { graph: { graph: 'tone.json', output: 'stem' } } });
  fs.writeFileSync(path.join(out, 'host.cjs'), `module.exports = { codecs:{ review:{ mux({ frames, fps, audio, sampleRate }) {
    if (frames.length !== 2 || fps.numerator !== 30000 || audio.toString('ascii', 0, 4) !== 'RIFF' || sampleRate !== 8000)
      throw Error('incorrect mux input');
    return { extension: 'capture', bytes: Buffer.from('verified') };
  } } } };`);
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  execFileSync(process.execPath, [cli, 'export-scene', 'take.json', '--audio', 'sound.json', '--mux', 'review', '--adapters', 'host.cjs',
    '--w', '24', '--h', '16', '--to', '0.06', '--formats', 'loop', '--out', 'published'], { cwd: out });
  const folder = path.join(out, 'published'), manifest = JSON.parse(fs.readFileSync(path.join(folder, 'export.json')));
  assert.deepEqual(at(stem(folder, manifest, 'tracks'), 0), [.25, .25]);
  assert.deepEqual(at(stem(folder, manifest, 'timeline'), 266), [.25, .25]);
  assert.equal(fs.readFileSync(path.join(folder, manifest.video.file), 'utf8'), 'verified');
});

test('looping tracks cover the entire range and stems share safe gain even when their peaks cancel', t => {
  const out = directory(t);
  const audio = ink.createSceneAudio(config({
    tracks: [{ asset: 'pulse', gain: 2, loop: true }],
    spatial: { cues: { inverse: { asset: 'inverse', gain: 2 } }, emitters: { inversion: { cue: 'inverse' } } }
  }), { kit, resolveAsset: id => sound([id === 'pulse' ? .75 : -.75]) });
  const { manifest } = ink.exportScene(() => ({ scene: 'headroom', sample: () => blank }),
    { out, kit, audio, formats: ['loop'], width: 2, height: 2, fps: 4, to: .25 });
  const last = manifest.audio.frames - 1;
  assert.equal(manifest.audio.headroom, 2 / 3);
  assert(at(stem(out, manifest, 'tracks'), last).every(value => value > .9999));
  assert.deepEqual(at(stem(out, manifest, 'spatial'), last), [-1, -1]);
  assert.deepEqual(at(stem(out, manifest, 'mix'), last), [0, 0]);
});
