// A player for the nest, for `node engine/cli.js record ninho --bot engine/examples/ninho/bot.ts --until won`: it reads
// the campaign (game.story) the way a player reads the HUD. While there is something to fight, it fights it: it waits out
// of reach until the serpent has just bitten, then steps in and swings (the aim assist turns the swing), and backs off.
// When nothing is left, it walks into the nest. The recorder keeps what it pressed (win.json): that, not the bot, is
// what the tests replay.
import type { Actor } from '../../src/game/types';
import type { BotApi } from '../../src/game/bot';

const hyp = (x: number, z: number) => Math.hypot(x, z);

export default function nestBot(api: BotApi): void {
  const { game } = api;
  const p = game.player;
  const s = game.state as { won: boolean; lost: boolean };
  if (!p || p.deadFor >= 0 || s.won || s.lost) return api.stop();
  const foes = game.entities.filter(e => e.type === 'actor' && e.alive && (e as Actor).team !== 'player' && (e as Actor).deadFor < 0) as Actor[];
  if (!foes.length) {
    // the campaign says where to go: the nest, once the stage asks for it
    if (game.story?.of('hunt')?.stage === 'nest') return api.walkTo([-6, 0, 0], 0.3, true);
    return api.stand();
  }
  let f = foes[0];
  for (const e of foes) if (hyp(e.pos[0] - p.pos[0], e.pos[2] - p.pos[2]) < hyp(f.pos[0] - p.pos[0], f.pos[2] - p.pos[2])) f = e;
  const d = hyp(f.pos[0] - p.pos[0], f.pos[2] - p.pos[2]),
    mine = (p.ch.reach as number) + f.radius,
    theirs = (f.ch.reach as number) + p.radius + f.radius,
    mem = f.data.brain as { mode?: string; cool?: number } | undefined,
    // it has just bitten, or is backing off: the moment to go in
    opening = f.ch.st.atk >= 0 || mem?.mode === 'back' || (mem?.cool ?? 0) > 0.45;
  if (opening || p.hp >= 5) {
    if (d > mine * 0.8) api.walkTo(f.pos, 0, d > 3);
    else api.stand();
    if (d <= mine + 0.2) api.tap('attack');
  } else if (d < theirs + 0.5) api.walkAway(f.pos, true);
  else api.stand();
}
