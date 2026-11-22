// The masmorra's robot: it runs the route to the way out (the same routes the ghouls walk, nav.ts) and fights what
// comes within reach on the way. Recorded with:
//   node engine/cli.js record masmorra --bot engine/examples/masmorra/bot.ts --until won --t 150 --out engine/examples/masmorra/win.json
import type { BotApi } from '../../src/game/bot';
import { findPath, navGridFor } from '../../src/game/index';
import type { Actor } from '../../src/game/types';

export default function (api: BotApi) {
  const { game } = api;
  const s = game.state as { exit: [number, number]; won: boolean; lost: boolean };
  const p = game.player;
  if (s.won || s.lost) return api.stop();
  if (!p || p.deadFor >= 0) return api.stand();
  // a foe close by: turn on it and strike
  const foes = (game.byTag('enemy') as Actor[]).filter(f => f.deadFor < 0).map(f => ({ f, d: Math.hypot(f.pos[0] - p.pos[0], f.pos[2] - p.pos[2]) }));
  foes.sort((a, b) => a.d - b.d);
  const near = foes[0];
  if (near && near.d < 1.6) {
    api.walkTo(near.f.pos, 0.9);
    if (near.d < 1.3) api.tap('attack');
    return;
  }
  // otherwise the route out, at a run
  const route = findPath(navGridFor(game.collision, p.radius, 1), p.pos, s.exit);
  if (!route) return api.walkTo([s.exit[0], 0, s.exit[1]], 0.3, true);
  let next = route[0];
  if (route.length > 1 && Math.hypot(next[0] - p.pos[0], next[1] - p.pos[2]) < 0.4) next = route[1];
  api.walkTo([next[0], 0, next[1]], 0.15, true);
}
