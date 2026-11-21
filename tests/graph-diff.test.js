const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createGraphProject, readGraphProject, diffGraphs } = require('..');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const project = body => ({ format: 'ink-studio/graph-project', version: 1, nodes: {}, outputs: {}, ...body });
const link = (node, port = 'value') => ({ node, port });
const param = input => ({ input });
const outputs = report => Object.fromEntries(report.affectedOutputs.map(row => [row.name, row.causes]));

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-graph-diff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = file => path.join(root, file);
  const json = (file, body) => fs.writeFileSync(at(file), JSON.stringify(body));
  const cmd = (...args) => execFileSync(process.execPath, [cli, 'graph', ...args], { cwd: root, encoding: 'utf8' });
  return { root, at, json, cmd };
}

test('seed, camera, palette and image changes follow their own outputs', t => {
  const { root, at, json, cmd } = workspace(t);
  const paint = color => fs.writeFileSync(at('art.png'), PNG.encode(2, 1, Uint8Array.of(...color, ...color), 3));
  paint([181, 76, 28]);
  const graph = project({
    inputs: { camera: { type: 'record', default: { yaw: 0, dist: 3 } },
      palette: { type: 'record', default: { palette: ['#0b1529', '#fac572'] } } },
    assets: { art: { format: 'png', file: 'art.png' }, extra: { format: 'png', file: 'extra.png' } },
    nodes: {
      field: { op: 'sdf.shape', inputs: { kind: 'sphere' } },
      frame: { op: 'sdf.render', inputs: { source: link('field'), camera: param('camera'), options: { width: 16, height: 16 } } },
      art: { op: 'pngAsset', inputs: { name: 'art' } },
      grade: { op: 'palette.resolve', inputs: { source: link('art'), policy: param('palette') } },
      weather: { op: 'proc.rain', inputs: { options: { seed: 6 } } },
      dice: { op: 'random' }
    },
    outputs: { portrait: link('frame'), ink: link('grade'), source: link('art'),
      rain: link('weather'), number: link('dice'), unused: 11 }
  });
  fs.copyFileSync(at('art.png'), at('extra.png'));
  json('scene.json', graph);
  const base = readGraphProject(at('scene.json')), before = base.snapshot();
  assert.deepEqual(outputs(diffGraphs(base, base.snapshot({ seed: 4 }))), { number: ['/settings/seed'] });
  assert.deepEqual(outputs(diffGraphs(base, base.snapshot({ inputs: { camera: { yaw: .4, dist: 3 } } }))),
    { portrait: ['/graph/inputs/camera'] });
  assert.deepEqual(outputs(diffGraphs(base, base.snapshot({ inputs: { palette: { palette: ['#0b1529', '#e41987'] } } }))),
    { ink: ['/graph/inputs/palette'] });
  assert.deepEqual(base.run().outputs.source.data, Uint8Array.of(181, 76, 28, 255, 181, 76, 28, 255));

  json('before.json', before);
  paint([230, 145, 60]);
  json('inputs.json', { camera: { yaw: .4, dist: 3 }, palette: { palette: ['#0b1529', '#e41987'] } });
  fs.writeFileSync(at('after.json'), cmd('snapshot', 'scene.json', '--inputs', 'inputs.json', '--seed', '4'));
  const report = JSON.parse(cmd('diff', 'before.json', 'after.json', '--json'));
  assert.deepEqual(outputs(report), { ink: ['/assets/art', '/graph/inputs/palette'], number: ['/settings/seed'],
    portrait: ['/graph/inputs/camera'], source: ['/assets/art'] });
  assert.notEqual(report.changes.find(row => row.path === '/assets/art').before.sha256,
    report.changes.find(row => row.path === '/assets/art').after.sha256);
  assert.deepEqual(outputs(diffGraphs(before, readGraphProject(at('scene.json')))), { ink: ['/assets/art'], source: ['/assets/art'] });
  assert.deepEqual(outputs(diffGraphs(before, createGraphProject(graph, { baseDir: root }))), { ink: ['/assets/art'], source: ['/assets/art'] });
});

test('group changes stay on the used output port, including a nested referenced group', t => {
  const { at, json, cmd } = workspace(t);
  const gain = amount => ({ format: 'ink-studio/graph-group', version: 1,
    inputs: { meter: 'number', tint: 'number' },
    nodes: { mix: { op: 'multiply', inputs: { a: param('tint'), b: amount } } },
    outputs: { value: link('mix'), meter: param('meter') } });
  json('gain.json', gain(4));
  const unit = { groups: { Gain: { file: 'gain.json' } }, inputs: { tint: 'number', meter: 'number' },
    nodes: { control: { op: 'Gain', inputs: { tint: param('tint'), meter: param('meter') } } },
    outputs: { color: link('control'), meter: link('control', 'meter') } };
  const graph = project({ groups: { Unit: unit },
    nodes: { main: { op: 'Unit', inputs: { tint: 8, meter: 2 } } },
    outputs: { poster: link('main', 'color'), scale: link('main', 'meter') } });
  json('project.json', graph);
  json('before.json', readGraphProject(at('project.json')).snapshot());
  json('gain.json', gain(7));
  const report = JSON.parse(cmd('diff', 'before.json', 'project.json'));
  const port = '/groups/Unit~1Gain/nodes/mix/inputs/b';
  assert.deepEqual(outputs(report), { poster: [port] });
  const change = report.changes.find(row => row.path === port);
  assert.equal(change.before.source.value, 4);
  assert.equal(change.after.source.value, 7);
  assert.deepEqual(readGraphProject(at('project.json')).run().outputs, { poster: 56, scale: 2 });
});

test('node, socket and output edits are distinct and capture animation without executing it', () => {
  let executed = 0;
  const options = { operations: { probe: { inputs: { value: 'number' }, outputs: { value: 'number', diagnostic: 'number' },
    instantiate() { executed++; return () => ({ value: 1, diagnostic: 2 }); } } } };
  const make = end => createGraphProject(project({
    nodes: {
      probe: { op: 'probe', inputs: { value: { keys: [{ time: 0, value: 1 }, { time: 1, value: end }] } } },
      ...(end === 2 && { dead: { op: 'add', inputs: { a: 1, b: 2 } } })
    },
    outputs: { value: link('probe'), ...(end === 2 ? { removed: 5 } : { added: link('probe', 'diagnostic') }) }
  }), options);
  const before = make(2), after = make(3);
  const report = diffGraphs(before, after);
  assert.equal(executed, 0);
  assert(report.changes.some(row => row.kind === 'node' && row.status === 'removed' && row.path === '/graph/nodes/dead'));
  assert.deepEqual(report.affectedOutputs, [
    { name: 'added', status: 'added', causes: ['/graph/nodes/probe/inputs/value', '/graph/outputs/added'] },
    { name: 'removed', status: 'removed', causes: ['/graph/outputs/removed'] },
    { name: 'value', status: 'affected', causes: ['/graph/nodes/probe/inputs/value'] }
  ]);
  assert.deepEqual(outputs(diffGraphs(after.snapshot({ time: 1 }), after.snapshot({ time: 2 }))),
    { added: ['/settings/time'], value: ['/settings/time'] });
  assert.deepEqual(diffGraphs(after, after).changes, []);
  const schema = type => createGraphProject(project({ nodes: { probe: { op: 'probe', inputs: { value: 1 } } },
    outputs: { value: link('probe'), diagnostic: link('probe', 'diagnostic') } }),
  { operations: { probe: { inputs: { value: 'number' }, outputs: { value: 'number', diagnostic: type }, run() {} } } });
  assert.deepEqual(outputs(diffGraphs(schema('number'), schema('string'))),
    { diagnostic: ['/graph/nodes/probe/outputs/diagnostic', '/graph/outputs/diagnostic'] });
});
