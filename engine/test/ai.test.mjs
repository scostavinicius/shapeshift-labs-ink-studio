// Stage 9: the layer for an AI. The validator finds the usual mistakes (each with where it is and what was probably
// meant), passes the three examples clean, and the command line answers in JSON, including for a game that is wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { flatScene, loadInk, loadTs, ROOT, REPO, sceneFn } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');
const codes = ps => ps.map(p => p.code);
const find = (ps, code) => ps.find(p => p.code === code);

test('the source: what breaks determinism is an error, with its line; comments and strings are not code', () => {
  const src = [
    "const sin = Math.sin; // kept when the module loads",
    'function step(g) {',
    '  const r = Math.random();',
    '  const t = Date.now();',
    '  const sq = r ** 2;',
    "  const s = 'Math.random() in a string is fine';",
    '  // Math.random() in a comment is fine, and so is 2 ** 3',
    '  setTimeout(() => {}, 10);',
    '}'
  ].join('\n');
  const ps = G.lintSource(src, 'game.ts');
  assert.deepEqual(
    ps.map(p => [p.code, p.where, p.level]),
    [
      ['math-random', 'game.ts:3', 'error'],
      ['clock', 'game.ts:4', 'error'],
      ['power-operator', 'game.ts:5', 'error'],
      ['captured-math', 'game.ts:1', 'warning'],
      ['async', 'game.ts:8', 'warning']
    ]
  );
  assert.match(find(ps, 'math-random').hint, /game\.rng\(\)/);
  assert.match(find(ps, 'power-operator').hint, /Math\.pow/);
});

test('the definition: degrees where radians go, missing parts, shapes of things', () => {
  const ps = G.checkDefinition({
    id: 'My Game',
    scene: 'x',
    init: () => ({}),
    actors: { a: { spec: { sculpt() {} } }, b: { spec: walker, max: 0 } },
    spawns: { s: [1, 2] },
    camera: { pitch: 35 },
    combat: { arc: 1.2 }
  });
  assert.deepEqual(codes(ps).sort(), ['actor-max', 'actor-pts', 'degrees', 'id', 'radians', 'spawn-shape'].sort());
  assert.match(find(ps, 'degrees').hint, /0\.611 \(35 degrees\)/);
  assert.match(find(ps, 'radians').hint, /did you mean 69 \(1\.2 radians\)/);
  assert.match(find(ps, 'actor-pts').hint, /walker/);
  assert.deepEqual(codes(G.checkDefinition({ id: 'x' })).sort(), ['init', 'scene']);
});

test('a run: spawn points off the ground or in a wall, things made too late, what init returns', () => {
  const ink = loadInk();
  // the flat scene: a floor 20 x 20 (top at 0), a block at (4, 0, 0), a pillar at (-4, 0, 0)
  const lateScene = kit => {
    const s = flatScene()(kit);
    return {
      ...s,
      build(seed) {
        const real = kit.makeBuilder;
        let B;
        const k2 = { ...kit, makeBuilder: (...a) => (B = real(...a)) };
        const W = flatScene()(k2).build(seed);
        kit.KIT.pool(B, 50); // after B.finish: these never reach the world
        return W;
      }
    };
  };
  const def = G.defineGame({
    id: 'bad',
    scene: 'x',
    actors: { hero: { spec: walker } },
    spawns: { off: [30, null, 0], wall: [4, 0, 0], high: [-7, 5, -7], ok: [-7, null, 7] },
    init: g => {
      g.spawnActor({ actor: 'hero', at: 'ok', brain: () => ({}) });
      return { f: () => 1 };
    }
  });
  const { problems } = G.checkRun(def, ink, lateScene, 0.5);
  const byWhere = Object.fromEntries(problems.map(p => [p.where + ' ' + p.code, p]));
  assert.ok(byWhere['spawns.off spawn-no-ground'], JSON.stringify(problems, null, 1));
  assert.match(byWhere['spawns.off spawn-no-ground'].hint, /nearest ground is at \[(9\.\d+|10), null, 0\]/);
  assert.ok(byWhere['spawns.wall spawn-in-wall'], Object.keys(byWhere).join(' | '));
  assert.ok(byWhere['spawns.high spawn-height'], Object.keys(byWhere).join(' | '));
  assert.ok(byWhere['scene after-finish'], 'the pool made after B.finish');
  assert.match(byWhere['scene after-finish'].problem, /50 splats were made after B\.finish/);
  assert.ok(byWhere['init state-not-data'], Object.keys(byWhere).join(' | '));
  assert.ok(byWhere['init no-player'], Object.keys(byWhere).join(' | '));
});

test('a run: an actor that falls off the world, and a game that is not the same twice', () => {
  const ink = loadInk();
  // standing on the very edge of the floor (x = 9.9): it falls off as soon as it moves outwards
  let n = 0;
  const leaky = G.defineGame({
    id: 'leaky',
    scene: 'x',
    actors: { hero: { spec: walker } },
    init: g => {
      g.spawnActor({ actor: 'hero', at: [9.95, 0, 0], brain: () => ({ move: 1 }), tags: ['player'] });
      return { runs: ++n }; // a module-level counter: each run starts different
    }
  });
  const { problems } = G.checkRun(leaky, ink, flatScene(), 2);
  const run = find(problems, 'run') || find(problems, 'not-deterministic');
  assert.ok(run, JSON.stringify(problems));
  const twice = G.defineGame({ id: 'twice', scene: 'x', actors: { hero: { spec: walker } }, init: g => (g.spawnActor({ actor: 'hero', at: [0, 0, 0] }), { runs: ++n }) });
  assert.ok(find(G.checkRun(twice, ink, flatScene(), 0.2).problems, 'not-deterministic'));
});

for (const name of ['farol-walk', 'farol-fight', 'yard', 'beacons', 'arena', 'masmorra'])
  test(`the example ${name} passes the validator with no errors and no warnings`, async () => {
    const mod = await loadTs(`examples/${name}/game.ts`);
    const def = mod.default;
    const scene = typeof def.scene === 'string' ? sceneFn(def.scene) : def.scene;
    const text = fs.readFileSync(path.join(ROOT, 'examples', name, 'game.ts'), 'utf8');
    const { problems, stats } = G.validateGame(def, loadInk(), scene, { sources: [{ file: 'game.ts', text }], seconds: 1 });
    // slow-build and slow-step measure the machine as much as the game: with every test file running at once they can
    // trip on a busy computer, so they are left to `check` itself
    assert.deepEqual(problems.filter(p => !p.code.startsWith('slow-')), []);
    assert.ok(stats.groundColumns > 1000);
  });

test('the command line: new makes a game that checks clean; check on a broken game says why, in JSON, and fails', () => {
  const cli = path.join(ROOT, 'cli.js');
  const name = 'tmp-ai-test-' + process.pid;
  const dir = path.join(ROOT, 'examples', name);
  try {
    const made = JSON.parse(execFileSync(process.execPath, [cli, 'new', name], { cwd: REPO, encoding: 'utf8' }).trim().split('\n').pop());
    assert.equal(made.ok, true);
    const ok = JSON.parse(execFileSync(process.execPath, [cli, 'check', name, '--seconds', '0.5'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n').pop());
    assert.equal(ok.ok, true, JSON.stringify(ok));
    // break it: a spawn point off the floor, and Math.random in a rule
    const file = path.join(dir, 'game.ts');
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace('start: [0, null, 3]', 'start: [40, null, 3]')
        .replace('step(game) {', 'step(game) {\n    if (Math.random() < 0.01) game.emit("x");')
    );
    const r = spawnSync(process.execPath, [cli, 'check', name, '--seconds', '0.5'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 1);
    const bad = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.errors.map(e => e.code).sort(), ['init-failed', 'math-random', 'spawn-no-ground']);
    assert.ok(bad.errors.some(e => e.code === 'math-random' && /game\.ts:\d+/.test(e.where)));
    assert.ok(bad.errors.some(e => /has no ground under it/.test(e.problem)), JSON.stringify(bad.errors));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
