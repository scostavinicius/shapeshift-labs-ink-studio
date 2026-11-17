// Building a level (docs/engine-stage6-design.md §2.1): an ink-studio scene, unchanged, handed a facade of the kit that
// notes the builder and the sculpt it makes. After every bake the collision map is sampled; just before the world is
// finished the actors the game declared are made (K.character must reserve its splats then) and the game's own build()
// runs; just after, they are bound to the world and hidden until spawned.
import type { Builder, Ink, Scene, Sculpt, World } from '../../types/ink-studio';
import { CollisionBuilder, makeCollision, splatBox, type BakeStats } from './collision';
import type { Collision, GameDef } from './types';
import { effectOptions, GameEffects, reservePools, type EffectPools } from './effects';

/** One character of an actor pool, made at build time. */
export interface Slot {
  actor: string;
  ch: any;
  /** its first splat and how many it has */
  at: number;
  total: number;
  used: boolean;
}

export interface Level {
  world: World;
  B: Builder;
  S: Sculpt | null;
  collision: Collision;
  bakes: BakeStats[];
  slots: Slot[];
  /** splats set aside by def.build through ctx.reserve: their rows are marked every step */
  reserved: { at: number; total: number }[];
  /** what def.build returned */
  built: Record<string, unknown>;
  /** the effect pools def.effects asked for, set aside before B.finish and bound after */
  pools: EffectPools | null;
  /** time spent building, and the part of it spent sampling collision */
  ms: number;
}

/** what a scene module exports: module.exports = kit => ({ id, name, seed, build }) */
export type SceneFn = (kit: Ink) => Scene;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Hide a character: its splats go to y = -99, where K.pick and the renderers leave them alone. */
export function hideSlot(world: World, s: Slot): void {
  const D = world.data,
    rows = world.anim && world.anim.rows;
  for (let i = s.at; i < s.at + s.total; i++) D[i * 16 + 1] = -99;
  markSlot(rows, s);
}

/** Mark the rows of a character's splats as changed (K.character writes them without saying so). */
export function markSlot(rows: Uint8Array | undefined, s: Slot): void {
  if (!rows) return;
  for (let r = s.at >> 9, e = (s.at + s.total - 1) >> 9; r <= e; r++) rows[r] = 1;
}

/** Build the scene of a game as its level. Call inside the game's dice (dice.during), so every roll is the game's. */
export function buildLevel(def: GameDef<any>, ink: Ink, sceneFn: SceneFn, seed: number | undefined): Level {
  const t0 = now(),
    K = ink.KIT,
    cb = new CollisionBuilder(def.collision);
  let B: Builder | null = null,
    S: Sculpt | null = null,
    collision: Collision | null = null;
  const slots: Slot[] = [];
  const reserved: { at: number; total: number }[] = [];
  let built: Record<string, unknown> = {};
  let pools: EffectPools | null = null;

  const facade: Ink = {
    ...ink,
    makeBuilder(...args: Parameters<Ink['makeBuilder']>) {
      if (B) throw new Error(`${def.id}: the scene made a second builder; a level is one builder and one world`);
      const b = ink.makeBuilder(...args);
      B = b;
      const finish = b.finish;
      b.finish = (meta: Parameters<Builder['finish']>[0]) => {
        // all the bakes are done: the collision map is complete, so the actors can stand on it
        collision = makeCollision(cb.finish());
        const world = { height: (x: number, z: number, y: number) => collision!.height(x, z, y) };
        for (const [name, a] of Object.entries(def.actors || {})) {
          const max = a.max ?? 1;
          for (let n = 0; n < max; n++) {
            const at = b.count(),
              spec = { ...a.spec, world, ...(a.hp !== undefined ? { hp: a.hp } : {}) };
            const ch = K.character(b, spec, 0);
            const total = b.count() - at;
            if (total !== ch.total) throw new Error(`${def.id}: actor ${name} made ${total} splats but says ${ch.total}`);
            slots.push({ actor: name, ch, at, total, used: false });
          }
        }
        const eo = effectOptions(def.effects);
        if (eo) {
          pools = reservePools(K, b, eo);
          reserved.push(...GameEffects.ranges(pools));
        }
        const toBind: { thing: { bind(world: World, at: number): void }; at: number }[] = [];
        built =
          def.build?.({
            B: b,
            S: S!,
            K,
            seed: seed ?? 0,
            reserve(make) {
              const at = b.count();
              const thing = make();
              const n = b.count() - at;
              if (n > 0) reserved.push({ at, total: n });
              toBind.push({ thing, at });
              return thing;
            }
          }) || {};
        const w = finish.call(b, meta);
        for (const s of slots) s.ch.bind(w, s.at);
        for (const r of toBind) r.thing.bind(w, r.at);
        if (pools) GameEffects.bind(pools, w);
        return w;
      };
      return b;
    },
    makeSculpt(b: Builder) {
      const s = ink.makeSculpt(b);
      S = s;
      for (const name of ['bake', 'freeze'] as const) {
        const real = s[name];
        if (typeof real !== 'function') continue;
        s[name] = (...args: unknown[]) => {
          const before = b.count();
          const r = real.apply(s, args);
          if (cb.wants()) cb.sample(s, { near: name === 'bake' ? splatBox(b, before, b.count()) : null });
          return r;
        };
      }
      return s;
    }
  };

  const scene = sceneFn(facade);
  const world = scene.build(seed ?? scene.seed);
  if (!B) throw new Error(`${def.id}: the scene did not use makeBuilder`);
  if (!collision) throw new Error(`${def.id}: the scene's world was not made by B.finish`);
  // the engine marks rows and runs systems: a world with no stage gets one
  if (!world.anim) K.stage(world);
  for (const s of slots) hideSlot(world, s);
  return { world, B, S, collision, bakes: cb.stats, slots, reserved, built, pools, ms: now() - t0 };
}
