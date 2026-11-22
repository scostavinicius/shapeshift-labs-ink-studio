// Stage 25: the masmorra, the game that puts stages 17-24 together. Its recorded robot (win.json) reaches the way out;
// the run is the same every time; the level has what the game promises (crates, torches, a mimic among the crates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadInk, loadTs, ROOT } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const H = await loadTs('src/headless/run.ts');
const masmorra = (await loadTs('examples/masmorra/game.ts')).default;
const win = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'masmorra', 'win.json'), 'utf8'));

function play(script, seconds) {
  const { game } = H.runHeadless(masmorra, loadInk(), masmorra.scene, script, 0);
  const player = new G.ScriptPlayer(script),
    log = [];
  while (game.steps < seconds * 60 && !game.state.won && !game.state.lost) {
    game.core.shown = game.core.view(900, 620);
    game.runSteps(1, k => player.apply(k, game.core.input));
    for (const e of game.takeEvents()) log.push(e);
  }
  return { game, log };
}

test('the winning script finds the way out', () => {
  const { game, log } = play(win, 60);
  assert.equal(game.state.won, true, JSON.stringify(game.state));
  assert.equal(game.state.lost, false);
  assert.ok(log.some(e => e.name === 'won'));
  assert.ok(game.state.kills >= 1, 'the robot fights on the way');
});

test('the level has its crates, torches and the mimic, and two runs are one game', () => {
  const a = play(win, 4).game,
    b = play(win, 4).game;
  assert.equal(a.hash(), b.hash());
  const d = G.dungeonOf(a.world);
  assert.equal(d.torches.length, 8);
  for (let i = 0; i < 6; i++) assert.ok(a.breakables.intact('crate-' + i) !== undefined);
  assert.ok(a.entities.some(e => e.kind === 'mimic'));
});
