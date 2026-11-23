const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'cli', 'ink-studio.js');
const run = (args, cwd = root) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const command = (...args) => run([cli, 'graph', ...args]);

test('catalog membership, actual socket defaults and examples agree with the runner', () => {
  const kit = ink.load();
  const { toolkit, stock } = require('../cli/graph-project.js').operationRegistry(kit);
  const catalog = JSON.parse(JSON.stringify(ink.listGraphNodes({ kit })));
  assert.deepEqual(catalog.nodes.map(row => row.id), Object.keys({ ...toolkit, ...stock }).sort());
  assert.equal(catalog.count, catalog.nodes.length);
  for (const row of catalog.nodes) {
    assert(row.example, row.id);
    if (row.example.kind === 'node') {
      const child = run(['-e', row.example.source]);
      assert.equal(child.status, 0, row.id + ' ' + child.stderr);
      assert(child.stdout.trim());
      continue;
    }
    const graph = ink.createGraphProject(row.example.project, { kit });
    const sockets = graph.sockets('example');
    for (const [name, port] of Object.entries(row.inputs)) {
      assert.equal(port.type, sockets.inputs[name].type, row.id + '.' + name);
      assert.equal(port.required, !Object.hasOwn(sockets.inputs[name], 'default'));
      assert.deepEqual(port.default, sockets.inputs[name].default);
    }
    assert.deepEqual(Object.fromEntries(Object.entries(row.outputs).map(([key, port]) => [key, port.type])),
      Object.fromEntries(Object.entries(sockets.outputs).map(([key, port]) => [key, port.type])));
    assert(Object.hasOwn(graph.run().outputs, 'value'), row.id);
    graph.clear();
  }
});

test('CLI lists operations, describes typed and specialized ports, and runs a copied example', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-catalog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const list = command('nodes');
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /raster.resize.*source raster/);
  const file = path.join(directory, 'resize.json'), example = command('describe', 'raster.resize', '--example');
  assert.equal(example.status, 0, example.stderr);
  fs.writeFileSync(file, example.stdout);
  const rendered = JSON.parse(command('run', file).stdout);
  assert.equal(rendered.outputs.value.width, 8);
  const describe = command('describe', 'raster.resize');
  assert.match(describe.stdout, /"unit":"pixels"/);
  assert.match(describe.stdout, /Runnable example/);
  const detail = JSON.parse(command('describe', 'array.map', '--json').stdout);
  assert.equal(detail.specialization.field, 'group');
  assert.equal(detail.inputs.items.type, 'array<number>');
  assert.equal(detail.outputs.value.type, 'array<number>');
  const catalog = command('nodes', '--json');
  assert.equal(catalog.status, 0, catalog.stderr);
  assert.equal(JSON.parse(catalog.stdout).format, 'ink-studio/graph-node-catalog');
  assert.match(command('describe', 'not.registered').stderr, /Unknown graph operation not.registered/);
});

test('configured host nodes keep their metadata and can be described without instantiation', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-catalog-host-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'ink-studio.config.js'), `
    module.exports = { graphOperations: { 'host.gain': {
      description: 'A host gain', inputs: { gain: { type: 'number', default: .5, unit: 'ratio',
        constraints: { min: 0, max: 1 } } }, outputs: { value: 'number' },
      instantiate() {
        require('node:fs').writeFileSync(require('node:path').join(__dirname, 'instantiated'), 'yes');
        return ({ gain }) => ({ value: gain });
      },
      example: { kind: 'graph', project: {
        format: 'ink-studio/graph-project', version: 1, nodes: { source: { op: 'host.gain' } },
        outputs: { value: { node: 'source' } }
      } }
    } } };
  `);
  const child = run([cli, 'graph', 'describe', 'host.gain', '--json'], directory);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.origin, 'host');
  assert.equal(result.inputs.gain.default, .5);
  assert.equal(result.inputs.gain.unit, 'ratio');
  assert.deepEqual(result.inputs.gain.constraints, { finite: true, min: 0, max: 1 });
  assert.equal(result.example.project.nodes.source.op, 'host.gain');
  assert(!fs.existsSync(path.join(directory, 'instantiated')));
});
