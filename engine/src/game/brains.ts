// Enemy brains (stage 7). A brain is a function from the actor and the game to the same input the player gives
// (types.ts Brain): an enemy is a player with another hand on the stick. What a brain remembers between steps lives in
// self.data.brain (plain data: it goes into snapshots and the hash). Chance comes from game.rng() only.
import type { Actor, Brain, Game } from './types';

export interface ChaserOptions {
  /** how far it notices a foe (default 9) */
  sight?: number;
  /** needs a clear line to notice (default true): walls hide the player */
  needsLine?: boolean;
  /** how close it gets before it swings (default its own reach, 0.9 of it) */
  range?: number;
  /** stick length while chasing, 0..1 (default 0.75: a little slower than a player) */
  speed?: number;
  /** seconds between swings, give or take a quarter (default 1.1) */
  cooldown?: number;
  /** seconds it backs off after a swing (default 0.45; 0 for never) */
  retreat?: number;
}

/** what a chaser remembers */
interface ChaserMemory {
  mode: 'idle' | 'chase' | 'swing' | 'back';
  /** seconds left in the current mode (swing, back) */
  left: number;
  /** seconds until it may swing again */
  cool: number;
  /** id of the foe it is after */
  foe: number;
}

/** the nearest standing actor of another team that it can see, or null */
export function nearestFoe(self: Actor, game: Game<any>, sight: number, needsLine: boolean): Actor | null {
  let best: Actor | null = null,
    bd = Infinity;
  for (const e of game.entities) {
    if (e.type !== 'actor' || !e.alive || e === self || e.team === self.team || e.deadFor >= 0) continue;
    const d = Math.hypot(e.pos[0] - self.pos[0], e.pos[2] - self.pos[2]);
    if (d > sight || d >= bd) continue;
    if (needsLine && !game.collision.clear([self.pos[0], self.pos[1] + 1, self.pos[2]], [e.pos[0], e.pos[1] + 1, e.pos[2]])) continue;
    best = e;
    bd = d;
  }
  return best;
}

/**
 * Chase, swing, back off: walks at the nearest foe it can see; within range and cooled down, it turns to face it and
 * swings; then it steps back for a moment before coming on again. Idle when it sees no one.
 */
export function chaser(o: ChaserOptions = {}): Brain {
  const sight = o.sight ?? 9,
    needsLine = o.needsLine ?? true,
    speed = o.speed ?? 0.75,
    cooldown = o.cooldown ?? 1.1,
    retreat = o.retreat ?? 0.45;
  return (self, game, dt) => {
    const m = ((self.data.brain as ChaserMemory) ||= { mode: 'idle', left: 0, cool: 0, foe: 0 });
    m.cool = Math.max(0, m.cool - dt);
    m.left = Math.max(0, m.left - dt);
    if (self.deadFor >= 0) return {};
    // keep after the foe it has while it stands; otherwise look for one
    let foe = game.entities.find(e => e.id === m.foe && e.type === 'actor' && e.alive && (e as Actor).deadFor < 0) as Actor | undefined;
    if (!foe || Math.hypot(foe.pos[0] - self.pos[0], foe.pos[2] - self.pos[2]) > sight * 1.5) foe = nearestFoe(self, game, sight, needsLine) || undefined;
    if (!foe) {
      m.mode = 'idle';
      m.foe = 0;
      return {};
    }
    m.foe = foe.id;
    const dx = foe.pos[0] - self.pos[0],
      dz = foe.pos[2] - self.pos[2],
      d = Math.hypot(dx, dz) || 1,
      ux = dx / d,
      uz = dz / d,
      face = Math.atan2(uz, ux),
      range = o.range ?? (self.ch.reach as number) * 0.9;
    if (m.mode === 'swing') {
      // the swing plays out (K.character is busy); then back off
      if (m.left > 0) return { face };
      m.mode = retreat > 0 ? 'back' : 'chase';
      m.left = retreat;
    }
    if (m.mode === 'back') {
      if (m.left > 0) return { move: -ux * 0.6, mz: -uz * 0.6, face };
      m.mode = 'chase';
    }
    m.mode = 'chase';
    if (d <= range + foe.radius && m.cool <= 0) {
      m.mode = 'swing';
      m.left = 0.3;
      m.cool = cooldown * (0.75 + 0.5 * game.rng());
      return { attack: true, face };
    }
    // close in, but not into it: stop at the edge of reach
    if (d <= range * 0.8 + foe.radius) return { face };
    return { move: ux * speed, mz: uz * speed };
  };
}

/** A brain that does nothing: a training dummy. */
export const dummy: Brain = () => ({});
