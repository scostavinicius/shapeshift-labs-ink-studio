// Enemy brains (stage 7). A brain is a function from the actor and the game to the same input the player gives
// (types.ts Brain): an enemy is a player with another hand on the stick. What a brain remembers between steps lives in
// self.data.brain (plain data: it goes into snapshots and the hash). Chance comes from game.rng() only.
import type { Actor, Brain, Game } from './types';
import type { StepInput } from '../core/input';
import { findPath, navGridFor } from './nav';

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

export interface SlitherOptions {
  /** how far either side of its way it swings, in degrees (default 40) */
  swing?: number;
  /** swings a second, each way and back (default 0.9) */
  rate?: number;
}

/**
 * A serpent's way of going (stages 29-30): another brain's walking, swung from side to side as it goes, so a trailing
 * body (actors.<name>.tail) lies in curves behind it. Swinging only bends where it walks; a swing at a foe, a turn to
 * face one, and standing still are left as they are. Its phase comes from the game's clock and the actor's id: no dice.
 */
export function slither(brain: Brain, o: SlitherOptions = {}): Brain {
  const swing = ((o.swing ?? 40) * Math.PI) / 180,
    rate = o.rate ?? 0.9;
  return (self, game, dt) => {
    const out = brain(self, game, dt);
    const x = out.move ?? 0,
      z = out.mz ?? 0;
    if (out.attack || (x === 0 && z === 0)) return out;
    const a = swing * Math.sin(2 * Math.PI * rate * game.t + self.id * 1.7),
      c = Math.cos(a),
      s = Math.sin(a);
    return { ...out, move: x * c - z * s, mz: x * s + z * c };
  };
}

/** A brain that does nothing: a training dummy. */
export const dummy: Brain = () => ({});

// ---------------------------------------------------------------------------------------------------------- hunter

export interface HunterOptions extends ChaserOptions {
  /** field of view in degrees (default 140): a foe behind it goes unseen unless it is already after that foe */
  fov?: number;
  /** a foe this close is noticed from any side and through walls: footsteps (default 2.5) */
  hearing?: number;
  /** seconds it keeps looking where it last saw its foe (default 5) */
  memory?: number;
  /** seconds between route plans while chasing (default 0.5) */
  replan?: number;
  /** where to walk while it has no one to hunt: world [x, z] points visited in turn, or 'spots' for the dungeon's
   *  open spots (world.dungeon, stage 17). Default: stand still */
  patrol?: [number, number][] | 'spots';
  /** stick length while patrolling or searching (default 0.45) */
  stroll?: number;
}

/** what a hunter remembers: plain data, in self.data.brain */
interface HunterMemory {
  mode: 'idle' | 'patrol' | 'chase' | 'search' | 'swing' | 'back';
  left: number;
  cool: number;
  foe: number;
  /** where and when (game.t) the foe was last seen or heard */
  seen: [number, number] | null;
  seenT: number;
  /** the walk it is on, the goal it was planned for and when */
  path: [number, number][];
  goal: [number, number] | null;
  planT: number;
  /** which patrol point is next */
  next: number;
}

/** route plans allowed per step across all hunters, so a crowd does not plan at once (the others plan next step) */
const PLANS_PER_STEP = 3;
const planned = new WeakMap<object, { step: number; used: number }>();

function mayPlan(game: Game<any>): boolean {
  let b = planned.get(game);
  if (!b || b.step !== game.steps) planned.set(game, (b = { step: game.steps, used: 0 }));
  if (b.used >= PLANS_PER_STEP) return false;
  b.used++;
  return true;
}

/**
 * Seeing and hearing: the nearest standing foe within `hearing` (any side), or within `sight` in front (inside `fov`)
 * with a clear line. The foe it is already after is kept in view from any side while it can be seen.
 */
export function perceive(self: Actor, game: Game<any>, o: { sight: number; fov: number; hearing: number; needsLine: boolean; current: number }): Actor | null {
  const half = ((o.fov * Math.PI) / 180) * 0.5,
    fx = Math.cos(self.face),
    fz = Math.sin(self.face);
  let best: Actor | null = null,
    bd = Infinity;
  for (const e of game.entities) {
    if (e.type !== 'actor' || !e.alive || e === self || e.team === self.team || e.deadFor >= 0) continue;
    const dx = e.pos[0] - self.pos[0],
      dz = e.pos[2] - self.pos[2],
      d = Math.hypot(dx, dz);
    if (d >= bd) continue;
    let noticed = d <= o.hearing;
    if (!noticed && d <= o.sight) {
      const inFront = e.id === o.current || (dx * fx + dz * fz) / (d || 1) >= Math.cos(half);
      noticed = inFront && (!o.needsLine || game.collision.clear([self.pos[0], self.pos[1] + 1, self.pos[2]], [e.pos[0], e.pos[1] + 1, e.pos[2]]));
    }
    if (noticed) {
      best = e;
      bd = d;
    }
  }
  return best;
}

/**
 * Hunt: like the chaser, but it sees only in front of it and hears close up; it walks routes round walls to its foe
 * (nav.ts); when it loses sight it goes to where it last saw it and looks about for a while; with no one to hunt it
 * patrols. Its route and memory are plain data in self.data.brain, so saves and the hash keep them.
 */
export function hunter(o: HunterOptions = {}): Brain {
  const sight = o.sight ?? 10,
    fov = o.fov ?? 140,
    hearing = o.hearing ?? 2.5,
    needsLine = o.needsLine ?? true,
    speed = o.speed ?? 0.8,
    stroll = o.stroll ?? 0.45,
    cooldown = o.cooldown ?? 1.1,
    retreat = o.retreat ?? 0.45,
    memory = o.memory ?? 5,
    replan = o.replan ?? 0.5;
  return (self, game, dt) => {
    const m = ((self.data.brain as HunterMemory) ||= {
      mode: 'idle',
      left: 0,
      cool: 0,
      foe: 0,
      seen: null,
      seenT: -1e9,
      path: [],
      goal: null,
      planT: -1e9,
      next: 0
    });
    m.cool = Math.max(0, m.cool - dt);
    m.left = Math.max(0, m.left - dt);
    if (self.deadFor >= 0) return {};
    const grid = navGridFor(game.collision, self.radius, 1.0);
    // walk the route to `goal`, planning again when the goal moved or the plan is old (within the step's budget)
    const walkTo = (goal: [number, number], stick: number, fresh: boolean): Partial<StepInput> | null => {
      const moved = !m.goal || Math.hypot(goal[0] - m.goal[0], goal[1] - m.goal[1]) > 0.75;
      if ((moved || (fresh && game.t - m.planT >= replan) || !m.path.length) && mayPlan(game)) {
        m.path = findPath(grid, self.pos, goal) || [];
        m.goal = [goal[0], goal[1]];
        m.planT = game.t;
      }
      while (m.path.length && Math.hypot(m.path[0][0] - self.pos[0], m.path[0][1] - self.pos[2]) < 0.35) m.path.shift();
      const to = m.path[0];
      if (!to) return null;
      const dx = to[0] - self.pos[0],
        dz = to[1] - self.pos[2],
        d = Math.hypot(dx, dz) || 1;
      return { move: (dx / d) * stick, mz: (dz / d) * stick };
    };
    const current = game.entities.find(e => e.id === m.foe && e.type === 'actor' && e.alive && (e as Actor).deadFor < 0) as Actor | undefined;
    const foe = perceive(self, game, { sight, fov, hearing, needsLine, current: current ? current.id : 0 });
    if (foe) {
      m.foe = foe.id;
      m.seen = [foe.pos[0], foe.pos[2]];
      m.seenT = game.t;
    }
    // swinging and backing off play out as the chaser's do
    if (m.mode === 'swing') {
      if (m.left > 0) return foe ? { face: Math.atan2(foe.pos[2] - self.pos[2], foe.pos[0] - self.pos[0]) } : {};
      m.mode = retreat > 0 ? 'back' : 'chase';
      m.left = retreat;
    }
    if (m.mode === 'back' && foe) {
      const dx = foe.pos[0] - self.pos[0],
        dz = foe.pos[2] - self.pos[2],
        d = Math.hypot(dx, dz) || 1;
      if (m.left > 0) return { move: (-dx / d) * 0.6, mz: (-dz / d) * 0.6, face: Math.atan2(dz, dx) };
    }
    if (foe) {
      m.mode = 'chase';
      const dx = foe.pos[0] - self.pos[0],
        dz = foe.pos[2] - self.pos[2],
        d = Math.hypot(dx, dz) || 1,
        face = Math.atan2(dz, dx),
        range = o.range ?? (self.ch.reach as number) * 0.9;
      if (d <= range + foe.radius && m.cool <= 0) {
        m.mode = 'swing';
        m.left = 0.3;
        m.cool = cooldown * (0.75 + 0.5 * game.rng());
        m.path = [];
        return { attack: true, face };
      }
      if (d <= range * 0.8 + foe.radius) return { face };
      // in the open and close: straight at it; otherwise the route
      if (d < 3 && game.collision.clear([self.pos[0], self.pos[1] + 0.5, self.pos[2]], [foe.pos[0], foe.pos[1] + 0.5, foe.pos[2]]))
        return { move: (dx / d) * speed, mz: (dz / d) * speed };
      return walkTo([foe.pos[0], foe.pos[2]], speed, true) || { move: (dx / d) * speed, mz: (dz / d) * speed };
    }
    // lost it: go where it was last seen, then look about until memory runs out
    if (m.seen && game.t - m.seenT < memory) {
      m.mode = 'search';
      const step = walkTo(m.seen, stroll + 0.2, false);
      if (step) return step;
      return { face: self.face + dt * 2.2 }; // there: turn on the spot, looking
    }
    m.seen = null;
    m.foe = 0;
    // patrol
    const dungeon = (game.world as { dungeon?: { spots: [number, number][] } }).dungeon;
    const points = o.patrol === 'spots' ? dungeon?.spots ?? [] : o.patrol ?? [];
    if (!points.length) {
      m.mode = 'idle';
      return {};
    }
    m.mode = 'patrol';
    const target = points[m.next % points.length];
    if (Math.hypot(target[0] - self.pos[0], target[1] - self.pos[2]) < 0.6) {
      m.next = (m.next + 1) % points.length;
      m.path = [];
      m.goal = null;
      return {};
    }
    return walkTo(target, stroll, false) || {};
  };
}
