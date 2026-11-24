// Saving a game (stage 8): the game's own state, as plain JSON. What is kept: game.state, and for each entity its place,
// facing, health, whether it is still on stage, and its data (a brain's memory). What is not: the world's moment (its
// particles, a fire on the ground, where the scene's own animation is), which comes back as a freshly built level would
// have it. Loading builds the level from scratch, runs init, then puts every entity where the save says.
//
// A save is restored deterministically: the same save and the same script afterwards give the same game, here or in
// any other JavaScript engine (it is applied inside the game's dice, like a step).
import type { Vec3 } from '../../types/ink-studio';
import type { RunningGame } from './game';
import type { Actor, Brain, Entity } from './types';
import type { TailMotion } from './tails';

export const SAVE_FORMAT = 'ink-engine-save';
export const SAVE_VERSION = 1;

export interface SavedEntity {
  id: number;
  type: Entity['type'];
  kind: string;
  tags: string[];
  pos: Vec3;
  alive: boolean;
  data: Record<string, unknown>;
  /** actors only */
  actor?: string;
  team?: string;
  face?: number;
  hp?: number;
  dead?: boolean;
  /** the trailing body's joints, as they were (stage 32) */
  tail?: TailMotion;
}

export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: number;
  game: string;
  seed: number;
  /** when in the game it was made (simulation time and step): for showing, not restored */
  t: number;
  steps: number;
  state: unknown;
  entities: SavedEntity[];
  /** the campaign's progress (def.story, stage 31) */
  story?: unknown;
  /** the id the next entity would have had (stage 32): what is spawned after a load is numbered as it would have been */
  next?: number;
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** The game as a save. */
export function saveGame(game: RunningGame<any>): SaveData {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    game: game.def.id,
    seed: game.snapshot().seed,
    t: game.t,
    steps: game.steps,
    state: clone(game.state ?? null),
    ...(game.story && { story: clone(game.story.progress) }),
    next: game.nextId(),
    entities: game.entities
      .filter(e => e.alive)
      .map(e => {
        const out: SavedEntity = { id: e.id, type: e.type, kind: e.kind, tags: [...e.tags], pos: [e.pos[0], e.pos[1], e.pos[2]], alive: true, data: clone(e.data) };
        if (e.type === 'actor') {
          out.actor = e.actor;
          out.team = e.team;
          out.face = e.ch.st.face;
          out.hp = e.ch.st.hp;
          out.dead = e.deadFor >= 0;
          const m = game.tailOf(e)?.motion();
          if (m) out.tail = m;
        }
        return out;
      })
  };
}

/** Why a save cannot be loaded into this game, or null if it can. */
export function saveProblem(game: RunningGame<any>, s: unknown): string | null {
  const d = s as Partial<SaveData> | null;
  if (!d || typeof d !== 'object' || d.format !== SAVE_FORMAT) return 'not a save of the engine';
  if (typeof d.version !== 'number' || d.version > SAVE_VERSION) return `a save of version ${d.version}; this engine reads up to ${SAVE_VERSION}`;
  if (d.game !== game.def.id) return `a save of "${d.game}", not of "${game.def.id}"`;
  if (!Array.isArray(d.entities)) return 'a save with no entities';
  return null;
}

/**
 * Put a freshly started game (built, init run, no step yet) where a save says. Entities the save does not have left the
 * stage before it was made; entities it has that init did not make (spawned later) are made again: actors on the player's
 * team take the gamepad, others need def.brains[kind]. Throws, saying why, if the save does not fit.
 */
export function loadSave(game: RunningGame<any>, s: SaveData): void {
  const brains: Record<string, Brain> = game.def.brains || {};
  const problem = saveProblem(game, s);
  if (problem) throw new Error(`${game.def.id}: cannot load this save: ${problem}`);
  game.withDice(() => {
    const byId = new Map(s.entities.map(e => [e.id, e]));
    // what init made and the save does not have: gone before the save was made
    for (const e of [...game.entities]) if (!byId.has(e.id)) game.remove(e);
    for (const saved of s.entities) {
      let e = game.entities.find(x => x.id === saved.id && x.alive);
      if (!e) {
        if (saved.type !== 'actor') continue; // a trigger or prop made later: the game's own rules make it again
        const brain: Actor['brain'] | undefined = saved.team === 'player' ? 'player' : brains[saved.kind];
        if (!brain) throw new Error(`${game.def.id}: the save has a ${saved.kind} made after the start; give def.brains.${saved.kind} to load it`);
        // it keeps its id (brains like slither read it)
        const next = game.nextId();
        game.nextId(saved.id);
        e = game.spawnActor({ actor: saved.actor!, kind: saved.kind, at: saved.pos, brain, tags: saved.tags, team: saved.team });
        game.nextId(Math.max(next, saved.id + 1));
      }
      e.tags = [...saved.tags];
      e.data = clone(saved.data);
      if (e.type === 'actor') {
        placeActor(e, saved);
        // its body lies as it lay, not stretched out behind it (stage 32)
        if (saved.tail && !saved.dead) game.tailOf(e)?.restore(saved.tail, game.world);
      }
      else e.pos = [saved.pos[0], saved.pos[1], saved.pos[2]];
    }
    if (typeof s.next === 'number') game.nextId(Math.max(game.nextId(), s.next));
    game.state = clone(s.state);
    if (game.story && s.story) game.story.progress = clone(s.story) as typeof game.story.progress;
    // what the save says was smashed is smashed again, the same way (stage 19)
    game.breakables?.sync(game);
    const p = game.player;
    if (p) {
      game.core.camera.follow(p.pos);
      game.core.camera.snap();
    }
  });
}

function placeActor(a: Actor, saved: SavedEntity): void {
  const st = a.ch.st;
  if (saved.dead) {
    // saved while down: it comes back standing at home, with full health (as the combat's respawn would have it)
    st.z = a.home[2];
    a.ch.respawn(a.home[0]);
    st.y = st.gh = a.home[1];
  } else {
    st.x = saved.pos[0];
    st.z = saved.pos[2];
    st.y = st.gh = saved.pos[1];
    st.hp = saved.hp ?? st.hp;
    if (saved.face !== undefined) st.face = saved.face;
  }
  st.vx = st.vy = st.vz = 0;
  st.ground = true;
  a.pos = [st.x, st.y, st.z];
  a.face = st.face;
  a.hp = st.hp;
  a.deadFor = -1;
  a.invuln = 0;
  if (saved.team) a.team = saved.team;
}

// ---------------------------------------------------------------------------------------------------------- where saves go

/** the browser's place for a game's save */
export const saveKey = (gameId: string) => 'ink-engine:save:' + gameId;

/** Keep a save in the browser (localStorage). False if the browser would not (private mode, full, blocked). */
export function storeLocal(s: SaveData): boolean {
  try {
    localStorage.setItem(saveKey(s.game), JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** The save the browser keeps for a game, or null. */
export function readLocal(gameId: string): SaveData | null {
  try {
    const raw = localStorage.getItem(saveKey(gameId));
    return raw ? (JSON.parse(raw) as SaveData) : null;
  } catch {
    return null;
  }
}

export function forgetLocal(gameId: string): void {
  try {
    localStorage.removeItem(saveKey(gameId));
  } catch {
    // nothing to forget
  }
}
