const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readGraphProject, findGraphGroupUsers, packProject, unpackProject } = require('..');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const project = body => ({ format: 'ink-studio/graph-project', version: 1, nodes: {}, outputs: {}, ...body });
const group = body => ({ format: 'ink-studio/graph-group', version: 1, nodes: {}, outputs: {}, ...body });
const link = (node, port = 'value') => ({ node, port });
const gain = (revision, factor) => group({ revision, inputs: { level: { type: 'number', default: 2 } },
  nodes: { scaled: { op: 'multiply', inputs: { a: { input: 'level' }, b: factor } } },
  outputs: { brightness: link('scaled') } });
const referenceProject = (groups, name) => project({ groups,
  ...(name && { nodes: { lamp: { op: name, inputs: { level: 3 } } }, outputs: { result: link('lamp', 'brightness') } })
});

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-group-refs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const at = file => path.join(root, file);
  const save = (file, document) => {
    const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
    fs.mkdirSync(path.dirname(at(file)), { recursive: true });
    fs.writeFileSync(at(file), bytes);
    return createHash('sha256').update(bytes).digest('hex');
  };
  const command = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'graph', ...args],
    { cwd: root, encoding: 'utf8' }));
  return { root, at, save, command };
}

test('referenced groups have typed named sockets, isolated dependencies and portable plans', t => {
  const { at, save, command } = workspace(t);
  const sha256 = save('shared/gain.json', gain(2, 5));
  save('shared/modules/lantern.json', group({ revision: 4,
    groups: { Gain: { file: '../gain.json', revision: 2, sha256 } },
    inputs: { level: 'number' },
    nodes: { inner: { op: 'Gain', inputs: { level: { input: 'level' } } } },
    outputs: { brightness: link('inner', 'brightness') } }));
  const unrelated = gain(1, 99), { format, version, revision, ...gainBody } = unrelated;
  save('shots/market.json', referenceProject({ Lantern: { file: '../shared/modules/lantern.json', revision: 4 },
    Gain: gainBody }, 'Lantern'));
  const graph = readGraphProject(at('shots/market.json'));
  const plan = graph.plan();
  assert.equal(plan.groups.Lantern.inputs.level.type, 'number');
  assert.equal(plan.groups['Lantern/Gain'].inputs.level.default, 2);
  assert.equal(graph.inspect({ node: 'lamp/inner/scaled' }).value, 15);
  assert.equal(graph.run().outputs.result, 15);
  assert.deepEqual(graph.sourceFiles().map(file => path.relative(at('.'), file)),
    ['shots/market.json', 'shared/modules/lantern.json', 'shared/gain.json']);
  assert.deepEqual(plan.groupDependencies, graph.dependencies().groups);
  assert.deepEqual(command('dependencies', 'shots/market.json', '--json'), graph.dependencies());
  assert.deepEqual(graph.dependencies().groups[1], { group: 'Lantern/Gain', file: '../shared/gain.json',
    version: 1, revision: 2, sha256, used: true, expectedRevision: 2, expectedSha256: sha256 });
});

test('impact identifies live, pinned, unused and transitive references through an update', t => {
  const { root, at, save, command } = workspace(t);
  const sha256 = save('shared/gain.json', gain(1, 5));
  save('shared/modules/lantern.json', group({ groups: { Gain: '../gain.json' }, inputs: { level: 'number' },
    nodes: { inner: { op: 'Gain', inputs: { level: { input: 'level' } } } },
    outputs: { brightness: link('inner', 'brightness') } }));
  save('shots/legacy.json', referenceProject({ Gain: '../shared/gain.json' }, 'Gain'));
  save('shots/live.json', referenceProject({ Lantern: { file: '../shared/modules/lantern.json' } }, 'Lantern'));
  save('shots/pinned.json', referenceProject({ Gain: { file: '../shared/gain.json', revision: 1 } }, 'Gain'));
  save('shots/locked.json', referenceProject({ Gain: { file: '../shared/gain.json', sha256 } }, 'Gain'));
  save('shots/unused.json', referenceProject({ Gain: { file: '../shared/gain.json' } }));
  save('shots/other.json', project({}));
  const current = findGraphGroupUsers(at('shared/gain.json'), { root });
  assert.deepEqual(current.projects.map(row => [row.project, row.effect]), [
    ['shots/legacy.json', 'updates'], ['shots/live.json', 'updates'], ['shots/locked.json', 'requires-reference-update'],
    ['shots/pinned.json', 'requires-reference-update'], ['shots/unused.json', 'declared-only']
  ]);
  assert.equal(current.projects[1].references[0].group, 'Lantern/Gain');
  const open = readGraphProject(at('shots/live.json'));
  const oldHash = open.plan().projectHash;
  assert.equal(open.run().outputs.result, 15);

  save('shared/gain.json', gain(2, 7));
  assert.equal(open.run().outputs.result, 15);
  const refreshed = readGraphProject(at('shots/live.json'));
  assert.notEqual(refreshed.plan().projectHash, oldHash);
  assert.equal(refreshed.run().outputs.result, 21);
  assert.throws(() => readGraphProject(at('shots/pinned.json')), /expected revision 1, found 2/);
  assert.throws(() => readGraphProject(at('shots/locked.json')), /expected SHA-256/);
  const updated = command('impact', 'shared/gain.json', '--root', root, '--json');
  assert.deepEqual(updated, findGraphGroupUsers(at('shared/gain.json'), { root }));
  assert.equal(updated.revision, 2);
  assert.match(updated.projects[3].references[0].issues[0], /expected revision 1, found 2/);
  assert.deepEqual(updated.errors, []);
});

test('take bundles include nested versioned groups and replay after their sources change', t => {
  const { root, at, save, command } = workspace(t);
  const sha256 = save('shared/gain.json', gain(2, 5));
  save('shared/lantern.json', group({ revision: 3, groups: { Gain: { file: 'gain.json', revision: 2, sha256 } },
    inputs: { level: 'number' }, nodes: { inner: { op: 'Gain', inputs: { level: { input: 'level' } } } },
    outputs: { brightness: link('inner', 'brightness') } }));
  save('shots/market.json', referenceProject({ Lantern: { file: '../shared/lantern.json', revision: 3 } }, 'Lantern'));
  save('takes/market.json', { format: 'ink-studio/take', version: 1, id: 'market', graph: '../shots/market.json' });
  const bundle = at('review.json'), source = readGraphProject(at('shots/market.json'));
  const { project } = packProject(at('takes/market.json'), { out: bundle, root });
  assert.deepEqual(project.files(), ['shared/gain.json', 'shared/lantern.json', 'shots/market.json', 'takes/market.json']);

  save('shared/gain.json', gain(3, 8));
  assert.throws(() => packProject(at('takes/market.json'), { out: at('changed.json'), root }),
    /expected revision 2, found 3/);
  const mounted = readGraphProject(bundle);
  assert.deepEqual(mounted.dependencies(), source.dependencies());
  assert.equal(mounted.run().outputs.result, 15);
  const { directory } = unpackProject(bundle, { out: at('moved') });
  const graph = readGraphProject(path.join(directory, 'shots/market.json'));
  assert.equal(graph.run().outputs.result, 15);
  assert.deepEqual(command('dependencies', 'review.json'), graph.dependencies());
});

test('file cycles and invalid references fail with actionable diagnostics', t => {
  const { at, save } = workspace(t);
  save('groups/a.json', group({ groups: { B: 'b.json' } }));
  save('groups/b.json', group({ groups: { A: 'a.json' } }));
  save('project.json', project({ groups: { A: { file: 'groups/a.json' } } }));
  assert.throws(() => readGraphProject(at('project.json')), /Graph group file cycle at A\/B\/A/);
  save('project.json', project({ groups: { A: { file: 'groups/a.json', revision: 0 } } }));
  assert.throws(() => readGraphProject(at('project.json')), /optional positive revision/);
});
