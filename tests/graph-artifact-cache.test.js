const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const link = (node, port = 'value') => ({ node, port });
const param = input => ({ input });
const project = body => ({ format: 'ink-studio/graph-project', version: 1, nodes: {}, outputs: {}, ...body });

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-graph-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = file => path.join(root, file);
  const json = (file, value) => fs.writeFileSync(at(file), JSON.stringify(value));
  const bin = at('cache/ink-graph-artifacts-v1');
  const environment = version => ({ cwd: root, env: { ...process.env, INK_TEST_GRAPH_CACHE_VERSION: version }, encoding: 'utf8' });
  function command(args, { version = '1', status = 0 } = {}) {
    const run = spawnSync(process.execPath, [cli, 'graph', ...args, '--cache', 'cache'], environment(version));
    assert.equal(run.status, status, run.stderr || run.stdout);
    return JSON.parse(run.stdout);
  }
  return { at, json, bin, environment, command };
}

test('independent runs replay artifacts and miss on input, asset and operation version edits', t => {
  const { at, json, command } = workspace(t);
  fs.writeFileSync(at('ink-studio.config.js'), `
const fs = require('node:fs');
const version = process.env.INK_TEST_GRAPH_CACHE_VERSION;
module.exports = { graphOperations: { probe: {
  ...(version !== 'unversioned' && { cacheVersion: version }),
  inputs: { value: 'number' }, outputs: { value: 'number' },
  run({ value }, { seed, time }) {
    fs.appendFileSync('evaluations.txt', 'ran\\n');
    return { value: value + seed + time };
  }
} } };
`);
  const paint = red => fs.writeFileSync(at('art.png'), PNG.encode(1, 1, Uint8Array.of(red, 47, 13), 3));
  paint(172);
  json('gain.json', { format: 'ink-studio/graph-group', version: 1, revision: 1,
    inputs: { value: 'number' }, nodes: { use: { op: 'probe', inputs: { value: param('value') } } },
    outputs: { value: link('use') } });
  json('shot.json', project({
    inputs: { input: { type: 'number', default: 2 } },
    assets: { art: { format: 'png', file: 'art.png' } },
    groups: { Gain: { file: 'gain.json' } },
    nodes: { probe: { op: 'Gain', inputs: { value: param('input') } }, image: { op: 'pngAsset', inputs: { name: 'art' } } },
    outputs: { number: link('probe'), color: link('image') },
    exports: { number: { output: 'number', format: 'json' }, color: { output: 'color', format: 'png' } }
  }));
  const invoke = (out, options, ...args) => command(['run', 'shot.json', '--out', out, ...args], options);
  const first = invoke('first'), second = invoke('second');
  assert.equal(first.artifactCache.status, 'miss');
  assert.equal(first.artifactCache.stored, true);
  assert.deepEqual(second.artifactCache, { status: 'hit', key: first.artifactCache.key });
  assert.equal(fs.readFileSync(at('evaluations.txt'), 'utf8'), 'ran\n');
  for (const file of first.artifacts.map(row => row.file))
    assert.deepEqual(fs.readFileSync(at('first/' + file)), fs.readFileSync(at('second/' + file)));
  assert.deepEqual(JSON.parse(fs.readFileSync(at('second/report.json'))), second);

  json('params.json', { input: 8 });
  const misses = [
    invoke('input', {}, '--inputs', 'params.json'),
    invoke('seed', {}, '--seed', '3'),
    invoke('at', {}, '--at', '1'),
    invoke('version', { version: '2' })
  ];
  paint(198);
  misses.push(invoke('new-asset'));
  const group = JSON.parse(fs.readFileSync(at('gain.json')));
  json('gain.json', { ...group, revision: 2 });
  misses.push(invoke('new-group'));
  assert(misses.every(row => row.artifactCache.status === 'miss' && row.artifactCache.stored));
  assert.equal(new Set([first, ...misses].map(row => row.artifactCache.key)).size, 7);
  assert.deepEqual([...PNG.raster(at('new-asset/artifacts/color.png')).data], [198, 47, 13, 255]);
  assert.deepEqual(invoke('no-cache', { version: 'unversioned' }).artifactCache,
    { status: 'bypass', reason: 'unversioned-operation', operations: ['probe'] });
});

test('batch assertions, inspect previews and clips replay completed artifacts', t => {
  const { at, json, command } = workspace(t);
  json('drawing.json', project({
    inputs: { width: { type: 'number', default: 4 } },
    nodes: { pixels: { op: 'raster.canvas', inputs: { width: param('width'), height: 3, color: [195, 101, 40] } } },
    outputs: { drawing: link('pixels') },
    exports: { painting: { output: 'drawing', format: 'png' } },
    assertions: [{ id: 'wide', output: 'drawing', path: ['width'], op: 'min', value: 4 }]
  }));
  json('cases.json', [{ id: 'first' }, { id: 'short', inputs: { width: 2 } }]);
  const batch = out => command(['batch', 'drawing.json', 'cases.json', '--out', out], { status: 2 });
  assert.equal(batch('batch-1').artifactCache.stored, true);
  const replay = batch('batch-2');
  assert.equal(replay.artifactCache.status, 'hit');
  assert.equal(replay.cases[1].passed, false);
  assert.equal(PNG.raster(at('batch-2/cases/short/artifacts/painting.png')).w, 2);

  const inspect = out => command(['inspect', 'drawing.json', '--output', 'drawing', '--out', out]);
  assert.equal(inspect('inspect-1').artifactCache.stored, true);
  const preview = inspect('inspect-2');
  assert.equal(preview.artifactCache.status, 'hit');
  assert.equal(PNG.raster(at('inspect-2/' + preview.artifacts[0].file)).w, 4);

  const clip = (out, warmup) => command(['clip', 'drawing.json', '--output', 'drawing', '--out', out,
    '--from', '1', '--to', '4', '--warmup', String(warmup), '--cuts', '2', '--format', 'both']);
  const first = clip('clip-1', 1), second = clip('clip-2', 1);
  assert.equal(first.artifactCache.stored, true);
  assert.equal(second.artifactCache.status, 'hit');
  assert.deepEqual(second.cuts, [{ frame: 2, id: 'cut-2' }]);
  for (const file of [first.animation.file, ...first.frames.map(frame => frame.file)])
    assert.deepEqual(fs.readFileSync(at('clip-1/' + file)), fs.readFileSync(at('clip-2/' + file)));
  assert.equal(clip('clip-3', 0).artifactCache.status, 'miss');
});

test('corrupt entries rebuild and the oldest cold entries leave within both budgets', t => {
  const { at, json, bin, command } = workspace(t);
  json('clock.json', project({ nodes: { clock: { op: 'time' } }, outputs: { time: link('clock') },
    exports: { time: { output: 'time', format: 'json' } } }));
  const run = (time, ...extra) => command(['run', 'clock.json', '--at', String(time), '--cache-entries', '2', ...extra]);
  const a = run(1), b = run(2);
  const entry = report => path.join(bin, report.artifactCache.key + '.bin');
  assert.equal(run(1).artifactCache.status, 'hit');
  run(3);
  assert.equal(fs.existsSync(entry(a)), true);
  assert.equal(fs.existsSync(entry(b)), false);
  fs.writeFileSync(entry(a), Buffer.alloc(48, 1));
  assert.equal(run(1).artifactCache.status, 'miss');
  assert.equal(run(1).artifactCache.status, 'hit');
  const small = run(4, '--cache-bytes', '1', '--out', 'small');
  assert.equal(small.artifactCache.stored, false);
  assert.equal(small.artifactCache.reason, 'oversize');
  assert.equal(JSON.parse(fs.readFileSync(at('small/artifacts/time.json'))), 4);
  assert.equal(fs.readdirSync(bin).filter(name => name.endsWith('.bin')).length, 0);
});

test('concurrent publishers leave complete entries and honor the shared limit', async t => {
  const { json, bin, command, environment } = workspace(t);
  json('picture.json', project({ nodes: { raster: { op: 'raster.canvas', inputs: { width: 8, height: 8 } } },
    outputs: { raster: link('raster') }, exports: { image: { output: 'raster', format: 'png' } } }));
  const args = time => ['run', 'picture.json', '--at', String(time), '--cache-entries', '2'];
  const publishers = await Promise.all([1, 2, 3, 3, 4].map(time => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'graph', ...args(time), '--cache', 'cache'], environment('1'));
    let error = '', stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ time, report: JSON.parse(stdout) }) : reject(new Error(error)));
  })));
  const files = fs.readdirSync(bin);
  assert(files.length > 0 && files.length <= 2);
  for (const file of files) {
    const publisher = publishers.find(({ report }) => report.artifactCache.key + '.bin' === file);
    assert(publisher, 'expected a cache entry from one of the publishers');
    assert.equal(command(args(publisher.time)).artifactCache.status, 'hit');
  }
});
