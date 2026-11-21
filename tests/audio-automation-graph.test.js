const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { deflateSync } = require('node:zlib');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const WAV = require('../cli/wav.js');
const PNG = require('../cli/png.js');
const M = ink.load().KIT.procedural.mediaGraph;
const near = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) <= epsilon, a + ' ~= ' + b);
const project = fields => ({ format: 'ink-studio/graph-project', version: 1, nodes: {}, outputs: {}, ...fields });
const node = (node, port) => ({ node, ...(port ? { port } : {}) });
const dir = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-media-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};
const request = fields => ({ format: 'ink-studio/host-request', version: 1, ...fields });

function tone(sampleRate = 8192, count = 3072) {
  return { sampleRate, channels: 2, samples: Float64Array.from({ length: count * 2 }, (_, i) => {
    const n = Math.floor(i / 2);
    return i % 2 ? Math.sin(Math.PI * 2 * n * 1024 / sampleRate) * .25 : Math.sin(Math.PI * 2 * n * 128 / sampleRate) * .75;
  }) };
}

test('native WAV round-trips PCM widths, IEEE floats and extensible multichannel audio', () => {
  for (const channels of [1, 2, 6]) for (const encoding of WAV.encodings) {
    const source = { sampleRate: 11025, channels, samples: Array.from({ length: channels * 5 }, (_, i) => [-1, -.35, 0, .45, 1][i % 5]) };
    const bytes = ink.encodeWav(source, { encoding });
    const out = ink.decodeWav(bytes);
    assert.equal(out.sampleRate, source.sampleRate);
    assert.equal(out.channels, channels);
    const eps = encoding.startsWith('pcm') ? 2 ** (1 - Number(encoding.slice(3))) : encoding === 'float32' ? 1e-7 : 1e-12;
    source.samples.forEach((n, i) => near(out.samples[i], n, eps));
    assert.throws(() => ink.decodeWav(bytes.subarray(0, bytes.length - 1)), /Truncated/);
  }
  assert.throws(() => ink.encodeWav({ sampleRate: 44100, channels: 2, samples: [0] }), /interleaved/);
  assert.throws(() => ink.encodeWav({ sampleRate: 44100, channels: 1, samples: [NaN] }), /normalized/);
  const broken = WAV.encode({ sampleRate: 8000, channels: 1, samples: [0] });
  broken.writeUInt16LE(6, 20);
  assert.throws(() => WAV.decode(broken), /Unsupported WAV format/);
  const oddChunk = Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 77, 0]);
  const good = WAV.encode({ sampleRate: 8000, channels: 1, samples: [0, .5] });
  const extra = Buffer.concat([good.subarray(0, 12), oddChunk, good.subarray(12)]);
  extra.writeUInt32LE(extra.length - 8, 4);
  assert.deepEqual([...WAV.decode(extra).samples], [0, .5]);
});

test('fractional video boundaries partition sample frames exactly and support padding', () => {
  const fps = { numerator: 30000, denominator: 1001 }, source = { sampleRate: 48000, channels: 1, samples: [] };
  const series = M.series(source, { fps, first: 200, count: 100 });
  for (const [i, row] of series.entries()) {
    assert.equal(row.firstSample, Math.floor((200 + i) * 48000 * 1001 / 30000));
    if (i) assert.equal(series[i - 1].endSample, row.firstSample);
  }
  const shot = { sampleRate: 8, channels: 2, samples: [-.5, .5, -.75, .75, -1, 1] };
  const { value, report } = M.audioWindow(shot, { fps: 2, frame: 1, offset: .75, channel: 1 });
  assert.equal(report.firstSample, -2);
  assert.deepEqual([...value.samples], [0, 0, .5, .75]);
  assert.deepEqual([...M.audioWindow(shot, { fps: 2, frame: 1, offset: .75, channel: 1, padding: 'trim' }).value.samples],
    [.5, .75]);
  assert.deepEqual([...M.audioWindow(shot, { fps: 2, frame: 0, channel: 'mix' }).value.samples], [0, 0, 0, 0]);
  assert.equal(M.analyze(shot, { fps: 2, frame: -1 }).rms, 0);
});

test('FFT resolves independent stereo tones and reuses the same frame clock for batch features', () => {
  const source = tone(), options = { fps: 8, size: 1024, window: 'hann', bands: { low: [80, 200], high: [950, 1100] } };
  const scan = M.fft(source, { ...options, time: .16 });
  assert.equal(scan.value.frame, 1);
  assert.equal(scan.spectrum.width, 513);
  assert.equal(scan.spectrum.height, 2);
  assert.deepEqual(scan.value.channels.map(row => row.dominantHz), [128, 1024]);
  near(scan.value.channels[0].bands.low, .75);
  near(scan.value.channels[1].bands.high, .25);
  near(scan.value.channels[0].bands.high, 0);
  near(scan.value.channels[1].bands.low, 0);
  near(M.analyze(source, options).rms, Math.sqrt((.75 ** 2 + .25 ** 2) / 4));
  const rows = M.series(source, { fps: 8, first: 1, count: 1, fft: { ...options } });
  assert.deepEqual(rows[0].bands, scan.bands);
  assert.throws(() => M.fft(source, { size: 2000 }), /Invalid FFT/);
});

test('recorded controls preserve same-time order, pulses and stateless seeking', async () => {
  const first = { time: .2, channel: 'gamepad:stick', value: .21 };
  const take = await ink.recordInputEvents([first, { ...first, value: .8 },
    { time: .3, channel: 'keyboard:tap', kind: 'pulse', value: { accent: true } },
    { time: .4, channel: 'gamepad:stick', value: -.5 }], { initial: { 'gamepad:stick': 0 } });
  const replay = M.inputReplay(JSON.parse(JSON.stringify(take)));
  assert.equal(replay.sample({ time: .6 }).value['gamepad:stick'], -.5);
  const previous = replay.sample({ frame: 0, origin: .2, fps: 10 });
  assert.equal(previous.value['gamepad:stick'], .8);
  assert.equal(previous.events.length, 2);
  assert.deepEqual(replay.sample({ frame: 1, origin: .2, fps: 10 }).pulses.map(p => p.value), [{ accent: true }]);
  assert.equal(replay.sample({ from: .2, time: .3 }).events.length, 1);
  assert.equal(M.actions(previous.value, { desk: { orbit: [{ input: 'gamepad:stick', deadZone: .2 }] } }, 'desk').orbit,
    (.8 - .2) / .8);
  assert.throws(() => M.recording({ events: [{ time: 1, channel: '__proto__', value: 7 }] }), /named channel/);
});

test('network adapters only run during explicit exchange and can read and write typed JSON over HTTP', async t => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') res.end(JSON.stringify({ frames: 17 }));
    else {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => res.end(JSON.stringify({ received: JSON.parse(Buffer.concat(chunks)) })));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const adapter = ink.httpJsonAdapter('http://127.0.0.1:' + server.address().port);
  const host = ink.createGraphHost({ network: { local: adapter } });
  const options = { kind: 'network', adapter: 'local', type: 'json' };
  assert.equal(calls, 0);
  assert.deepEqual(await host.exchange(request(options)), { frames: 17 });
  assert.deepEqual(await host.exchange(request({ ...options, direction: 'write', file: 'payload.json' }), { value: { v: 4 } }),
    { received: { v: 4 } });
  assert.equal(calls, 2);
  await assert.rejects(() => host.exchange(request({ ...options, adapter: 'missing' })), /Missing network adapter/);
  assert.equal(calls, 2);
});

function pxc(preview, extra = {}) {
  const header = Buffer.alloc(8);
  header.write('PXCX');
  header.writeUInt32LE(8, 4);
  return Buffer.concat([header, deflateSync(JSON.stringify({ version: 11, versions: 'fixture', preview: JSON.stringify(preview), ...extra }) + '\0')]);
}

test('PXC preview import emits a runnable raster and a registered translator can return editable Ink nodes', async () => {
  const pixels = [255, 180, 5, 255, 0, 0, 0, 0];
  const raw = pxc({ width: 2, height: 1, format: 6, buffer: deflateSync(Buffer.from(pixels)).toString('base64') }, { strength: .65 });
  assert.equal(ink.inspectPxc(raw).report.saveVersion, 11);
  const preview = await ink.createGraphHost().importPxc(raw);
  assert.equal(preview.report.mode, 'preview');
  assert.deepEqual(ink.createGraphProject(preview.project).run().outputs.image.data, pixels);
  const host = ink.createGraphHost({ pxc: { controls: { import({ inspect }) {
    const { project: source } = inspect();
    return { project: project({ nodes: { gain: { op: 'data.typed', type: 'number', inputs: { value: source.strength } } },
      outputs: { gain: node('gain') } }), report: { parameter: 'strength' } };
  } } } });
  const translated = await host.importPxc(raw, { using: 'controls' });
  assert.equal(translated.report.mode, 'adapter');
  assert.equal(ink.createGraphProject(translated.project).run().outputs.gain, .65);
  assert.throws(() => ink.inspectPxc(raw.subarray(0, 7)), /PXCX/);
  const invalid = Buffer.from(raw);
  invalid.writeUInt32LE(5, 4);
  assert.throws(() => ink.inspectPxc(invalid), /offset/);
});

test('CLI captures a device take, uses WAV and hosted codecs, and imports PXC art', t => {
  const folder = dir(t), cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const write = (name, data) => fs.writeFileSync(path.join(folder, name), JSON.stringify(data));
  const run = (args, code = 0) => {
    const result = spawnSync(process.execPath, [cli, 'graph', ...args], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, code, result.stderr || result.stdout);
    return result;
  };
  fs.writeFileSync(path.join(folder, 'devices.cjs'), `
    module.exports={
      devices:{keys:{read:async()=>({initial:{'dial':0},events:[{time:.125,channel:'dial',value:.67}]})}},
      codecs:{linear:{decode({bytes,options}){return {sampleRate:options.rate,channels:1,samples:[...bytes].map(x=>x/255)};},
        encode({value}){return {extension:'linear',bytes:Buffer.from(Array.from(value.samples,x=>Math.round(x*255)))};}}}
    };`);
  write('capture.json', request({ kind: 'device', adapter: 'keys', type: 'inputs' }));
  run(['capture', 'capture.json', '--adapters', 'devices.cjs', '--out', 'take.json']);
  fs.writeFileSync(path.join(folder, 'song.wav'), WAV.encode(tone()));
  fs.writeFileSync(path.join(folder, 'clip.linear'), Buffer.of(51, 102, 204));
  write('source.json', project({
    time: .14, assets: { sound: { format: 'wav', file: 'song.wav' }, take: { format: 'inputs', file: 'take.json' },
      other: { format: 'codec', file: 'clip.linear', codec: 'linear', type: 'audio', options: { rate: 16 } } },
    nodes: {
      wav: { op: 'audioAsset', inputs: { name: 'sound' } },
      take: { op: 'inputAsset', inputs: { name: 'take' } },
      other: { op: 'audioAsset', inputs: { name: 'other' } },
      slice: { op: 'audio.window', inputs: { source: node('wav'), options: { fps: 8 } } },
      replay: { op: 'input.replay', inputs: { source: node('take') } }
    }, outputs: { slice: node('slice'), controls: node('replay'), other: node('other') },
    exports: { slice: { output: 'slice', format: 'wav', encoding: 'pcm24' },
      other: { output: 'other', format: 'codec', codec: 'linear', type: 'audio' } },
    assertions: [{ id: 'dial', output: 'controls', path: ['dial'], op: 'eq', value: .67 }]
  }));
  run(['validate', 'source.json'], 1);
  run(['run', 'source.json', '--adapters', 'devices.cjs', '--out', 'graph']);
  assert.equal(ink.readWav(path.join(folder, 'graph/artifacts/slice.wav')).samples.length, 2048);
  assert.deepEqual([...fs.readFileSync(path.join(folder, 'graph/artifacts/other.linear'))], [51, 102, 204]);
  run(['inspect', 'source.json', '--adapters', 'devices.cjs', '--output', 'slice', '--out', 'inspect']);
  assert.ok(fs.existsSync(path.join(folder, 'inspect/artifacts/preview.wav')));
  fs.writeFileSync(path.join(folder, 'stamp.pxc'), pxc({ width: 1, height: 1, format: 6,
    buffer: deflateSync(Buffer.of(255, 33, 10, 255)).toString('base64') }));
  run(['import-pxc', 'stamp.pxc', '--out', 'imported.json']);
  run(['run', 'imported.json', '--out', 'imported']);
  assert.deepEqual([...PNG.raster(path.join(folder, 'imported/artifacts/image.png')).data], [255, 33, 10, 255]);
  run(['import-pxc', 'stamp.pxc', '--out', 'stamp.pxc'], 1);
});
