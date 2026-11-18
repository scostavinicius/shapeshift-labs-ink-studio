// A player for the arena, for `node engine/cli.js record arena --bot engine/examples/arena/bot.ts`: it looks at the game
// between steps and presses what a player would, and the recorder keeps what it pressed as a script (win.json). The
// script, not the bot, is what tests replay: plain data, the same game every time.
//
// How it fights: grunts and darters, it walks up to and swings at (the aim assist turns the swing); the warden reaches
// further than it does, so it keeps out of the warden's reach, steps in right after the warden swings, hits, and backs off.
import type { Actor } from '../../src/game/types';
import type { BotApi } from '../../src/game/bot';

const hyp = (x: number, z: number) => Math.hypot(x, z);

export default function arenaBot(api: BotApi): void {
  const { game, input } = api;
  const p = game.player;
  const s = game.state as { won: boolean; lost: boolean };
  if (!p || p.deadFor >= 0 || s.won || s.lost) return api.stop();
  const foes = game.entities.filter(e => e.type === 'actor' && e.alive && (e as Actor).team !== 'player' && (e as Actor).deadFor < 0) as Actor[];
  if (!foes.length) return api.walkTo([0, 0, 1.5], 0.5);
  // the nearest foe
  let f = foes[0];
  for (const e of foes) if (hyp(e.pos[0] - p.pos[0], e.pos[2] - p.pos[2]) < hyp(f.pos[0] - p.pos[0], f.pos[2] - p.pos[2])) f = e;
  const dx = f.pos[0] - p.pos[0],
    dz = f.pos[2] - p.pos[2],
    d = hyp(dx, dz);
  if (f.actor === 'warden') {
    const theirReach = (f.ch.reach as number) + p.radius + f.radius,
      mine = (p.ch.reach as number) + f.radius,
      st = f.ch.st,
      // it has just swung (or is swinging): the moment to go in
      opening = st.atk >= 0 || ((f.data.brain as { cool?: number } | undefined)?.cool ?? 0) > 0.6;
    if (opening) {
      if (d > mine * 0.85) api.walkTo(f.pos, 0, true);
      else api.stand();
      if (d <= mine) api.tap('attack');
    } else if (d < theirReach + 0.6) api.walkAway(f.pos, true);
    else api.stand();
    return;
  }
  // a grunt or a darter: close in and swing; low on health, keep moving away while swinging
  const mine = (p.ch.reach as number) + f.radius;
  if (p.hp <= 2 && d < 2.5) api.walkAway(f.pos, true);
  else if (d > mine * 0.8) api.walkTo(f.pos, 0, d > 4);
  else api.stand();
  if (d <= mine + 0.2) api.tap('attack');
  void input;
}
