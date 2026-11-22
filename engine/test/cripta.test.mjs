// A Cripta: the recorded robot gathers the three relics, breaks the seal, fells the Guardian and gets out; the layout
// keeps crates off the ways (every relic and the way out stay reachable); and route goals land on the walker's own
// floor (a pedestal's top, a wall's top are not where it is going).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadInk, loadTs, ROOT } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const H = await loadTs('src/headless/run.ts');
const mod = await loadTs('examples/cripta/game.ts');
const cripta = mod.default;
const win = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'cripta', 'win.json'), 'utf8'));

function play(script, seconds) {
  const { game } = H.runHeadless(cripta, loadInk(), cripta.scene, script, 0);
  const player = new G.ScriptPlayer(script),
    log = [];
  while (game.steps < seconds * 60 && !game.state.won && !game.state.lost) {
    game.core.shown = game.core.view(900, 620);
    game.runSteps(1, k => player.apply(k, game.core.input));
    for (const e of game.takeEvents()) log.push(e);
  }
  return { game, log };
}

test('the winning script: three relics, the seal, the Guardian, the way out', () => {
  const { game, log } = play(win, 120);
  const story = log.filter(e => ['relic', 'seal', 'call', 'won'].includes(e.name)).map(e => e.name);
  assert.deepEqual(story, ['relic', 'relic', 'relic', 'seal', 'call', 'won']);
  assert.equal(game.state.won, true);
  assert.equal(game.state.guardian, 0);
  assert.equal(game.breakables.intact('seal'), false);
});

test('every relic and the way out can be walked to from the start, crates and pedestals in place', () => {
  const { game } = play({ events: [] }, 0.1);
  const d = G.dungeonOf(game.world),
    p = mod.plan(d),
    grid = G.navGridFor(game.collision, 0.3, 1),
    from = [d.start[0], 0.03, d.start[1]];
  for (const q of [...p.relics, p.exit.map(v => v + 1.2)]) assert.ok(G.findPath(grid, from, q), `no way to ${q}`);
  // a pedestal's top is standable, but a route to the relic ends on the floor beside it
  const route = G.findPath(grid, from, p.relics[0]);
  assert.ok(Math.hypot(route[route.length - 1][0] - p.relics[0][0], route[route.length - 1][1] - p.relics[0][1]) < 1e-9);
  assert.equal(p.crates.length, 5);
});
