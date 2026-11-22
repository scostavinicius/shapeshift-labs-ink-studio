// The crypt's robot, in the order the game asks: the relics (nearest by route first), fighting what comes close on the
// way; a crate smashed and its potion drunk when health runs low; the Guardian fought as the arena's robot fights the
// warden (out of its reach, in right after it swings); then the way out. Recorded with:
//   node engine/cli.js record cripta --bot engine/examples/cripta/bot.ts --until won --t 240 --out engine/examples/cripta/win.json
import type { BotApi } from '../../src/game/bot';
import { dungeonOf, findPath, navGridFor } from '../../src/game/index';
import type { Actor } from '../../src/game/types';
import { plan, type CriptaState } from './game';

type Spot = [number, number];
const hyp = (x: number, z: number) => Math.hypot(x, z);

export default function criptaBot(api: BotApi): void {
  const { game } = api;
  const s = game.state as CriptaState;
  const p = game.player;
  if (s.won || s.lost) return api.stop();
  if (!p || p.deadFor >= 0) return api.stand();
  const pl = plan(dungeonOf(game.world)),
    grid = navGridFor(game.collision, p.radius, 1),
    br = game.breakables!;
  /** run the route to a place, stopping within `near` */
  const go = (q: Spot, near = 0.2) => {
    if (hyp(q[0] - p.pos[0], q[1] - p.pos[2]) < near) return api.stand();
    const route = findPath(grid, p.pos, q);
    if (!route) return api.walkTo([q[0], 0, q[1]], near, true);
    let next = route[0];
    if (route.length > 1 && hyp(next[0] - p.pos[0], next[1] - p.pos[2]) < 0.4) next = route[1];
    api.walkTo([next[0], 0, next[1]], 0.1, true);
  };
  const foes = (game.byTag('enemy') as Actor[]).filter(f => f.deadFor < 0).map(f => ({ f, d: hyp(f.pos[0] - p.pos[0], f.pos[2] - p.pos[2]) }));
  foes.sort((a, b) => a.d - b.d);
  const guardian = foes.find(x => x.f.actor === 'guardian');
  // the Guardian, once awake and close: keep out of its reach, go in when it has just swung
  if (guardian && s.sealOpen && guardian.d < 7) {
    const f = guardian.f,
      theirs = (f.ch.reach as number) + p.radius + f.radius,
      mine = (p.ch.reach as number) + f.radius,
      opening = f.ch.st.atk >= 0 || ((f.data.brain as { cool?: number } | undefined)?.cool ?? 0) > 0.6;
    // its helpers first, when one is in reach
    const helper = foes.find(x => x.f !== f && x.d < 1.5);
    if (helper) {
      api.walkTo(helper.f.pos, 0.9);
      if (helper.d < 1.3) api.tap('attack');
      return;
    }
    if (opening) {
      if (guardian.d > mine * 0.85) api.walkTo(f.pos, 0, true);
      else api.stand();
      if (guardian.d <= mine) api.tap('attack');
    } else if (guardian.d < theirs + 0.6) api.walkAway(f.pos, true);
    else api.stand();
    return;
  }
  // anything else close: turn on it and strike
  const near = foes.find(x => x.f.actor !== 'guardian');
  if (near && near.d < 1.7) {
    api.walkTo(near.f.pos, 0.9);
    if (near.d < 1.3) api.tap('attack');
    return;
  }
  // low on health: the nearest crate with a potion still in it; smash it, then step on it
  if (p.hp <= 2) {
    const potions = pl.crates.map((q, i) => ({ q, i })).filter(({ i }) => i < 3 && !s.drank.includes(i));
    potions.sort((a, b) => hyp(a.q[0] - p.pos[0], a.q[1] - p.pos[2]) - hyp(b.q[0] - p.pos[0], b.q[1] - p.pos[2]));
    const c = potions[0];
    if (c) {
      const d = hyp(c.q[0] - p.pos[0], c.q[1] - p.pos[2]);
      if (br.intact('crate-' + c.i)) {
        if (d > 1.1) return go(c.q, 1.0);
        api.walkTo([c.q[0], 0, c.q[1]], 0.95);
        return api.tap('attack');
      }
      return go(c.q, 0.3);
    }
  }
  // the relics, nearest first; then the way out
  const left = pl.relics.map((q, i) => ({ q, i })).filter(({ i }) => !s.took.includes(i));
  if (left.length) {
    left.sort((a, b) => hyp(a.q[0] - p.pos[0], a.q[1] - p.pos[2]) - hyp(b.q[0] - p.pos[0], b.q[1] - p.pos[2]));
    return go(left[0].q, 0.3);
  }
  go(pl.exit, 0.2);
}
