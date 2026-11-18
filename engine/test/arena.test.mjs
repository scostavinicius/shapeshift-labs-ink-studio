// Stage 10: the arena, the demonstration game. Its winning script (recorded by its bot) wins it, without a browser, every
// time: three waves, the warden's call for help, victory. Left alone, the player loses. And the aim assist does its job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { flatScene, loadInk, loadTs, ROOT } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const H = await loadTs('src/headless/run.ts');
const arena = (await loadTs('examples/arena/game.ts')).default;
const { walker } = await loadTs('examples/farol-walk/game.ts');
const win = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'arena', 'win.json'), 'utf8'));

/** play a script to the end of the game (won or lost) or `seconds`, keeping the events with when they came */
function play(script, seconds) {
  const { game } = H.runHeadless(arena, loadInk(), arena.scene, script, 0);
  const player = new G.ScriptPlayer(script),
    log = [];
  while (game.steps < seconds * 60 && !game.state.won && !game.state.lost) {
    game.core.shown = game.core.view(900, 620);
    game.runSteps(1, k => player.apply(k, game.core.input));
    for (const e of game.takeEvents()) log.push(e);
  }
  return { game, log };
}

test('the winning script wins the arena: three waves, the warden calls for help, victory', tc => {
  const { game, log } = play(win, 90);
  const story = log.filter(e => ['wave', 'call', 'won', 'lost'].includes(e.name)).map(e => `${e.name}${e.data && e.data.n ? ' ' + e.data.n : ''} @ ${e.t.toFixed(1)}`);
  tc.diagnostic(story.join(', ') + ` · kills ${game.state.kills}, falls ${game.state.falls}, player hp ${game.player.hp}`);
  assert.deepEqual(
    story.map(s => s.split(' @')[0]),
    ['wave 1', 'wave 2', 'wave 3', 'call', 'won']
  );
  assert.equal(game.state.won, true);
  assert.equal(game.state.lost, false);
  assert.equal(game.state.kills, 3 + 5 + 1 + 2, 'every grunt, darter and the warden, and the two it called');
  assert.ok(game.state.falls < 3);
  assert.equal(game.byTag('enemy').length, 0);
  assert.ok(game.t < 70, 'won in ' + game.t.toFixed(1) + ' s');
});

test('the same script, twice: the same victory, step for step', () => {
  const a = H.runHeadless(arena, loadInk(), arena.scene, win, 8, { hashEachStep: true }).hashes,
    b = H.runHeadless(arena, loadInk(), arena.scene, win, 8, { hashEachStep: true }).hashes;
  assert.deepEqual(a, b);
});

test('left alone, the player loses: three falls, defeat, and the arena empties', () => {
  const { game, log } = play({ events: [] }, 200);
  assert.equal(game.state.lost, true);
  assert.equal(game.state.won, false);
  assert.equal(game.state.falls, 3);
  assert.ok(log.some(e => e.name === 'lost'));
  assert.equal(game.byTag('enemy').length, 0, 'everyone else leaves');
});

test('the aim assist turns the player to a foe beside it when it swings, and not without it', () => {
  const run = assist => {
    const game = G.createGame(
      G.defineGame({
        id: 'aim',
        scene: 'x',
        actors: { hero: { spec: walker }, dummy: { spec: walker, hp: 3 } },
        combat: assist ? { assist } : {},
        init: g => {
          g.spawnActor({ actor: 'hero', at: [0, 0, 3], brain: 'player' });
          g.spawnActor({ actor: 'dummy', at: [0, 0, 4.1], brain: G.dummy }); // straight "behind" if it faces +x
          return {};
        }
      }),
      loadInk(),
      { scene: flatScene(), bones: 'cpu' }
    );
    game.run(0.8);
    game.player.ch.st.face = 0; // facing +x; the dummy is at +z
    game.core.input.press('attack');
    game.runSteps(1);
    game.core.input.release('attack');
    game.run(0.4);
    return game.entities[1].hp;
  };
  assert.equal(run(0), 3, 'without assist the swing goes the way it faces and misses');
  assert.equal(run(180), 2, 'with assist it turns and hits');
});
