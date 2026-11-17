// A game running (docs/engine-stage6-design.md §2 and §3): the level, its entities, the game's dice, on the stage 5 core.
// Everything the simulation does happens inside a step, in a fixed order, with the game's own dice in place of Math.random
// and K.rnd: the same seed and the same input give the same game.
import type { Ink, Kit, Vec3, World } from '../../types/ink-studio';
import { Core } from '../core/core';
import type { InputState, Sample, StepInput } from '../core/input';
import { buildLevel, hideSlot, markSlot, type Level, type SceneFn, type Slot } from './level';
import { Dice } from './rng';
import { Combat } from './combat';
import { effectOptions, GameEffects } from './effects';
import type { Actor, Brain, Collision, Entity, Game, GameDef, Prop, Snapshot, Trigger } from './types';

/** A game definition, typed. (Nothing more: it is there so an editor knows what goes where.) */
export function defineGame<State>(def: GameDef<State>): GameDef<State> {
  return def;
}

export interface CreateOptions {
  /** the scene module's function (the host loads def.scene: require in Node, a script tag in the page) */
  scene: SceneFn;
  /** overrides the game's seed */
  seed?: number;
  /** the input the player's actor reads (the page passes its DomInput's state) */
  input?: InputState;
  /** 'gpu' leaves splats carried by bones at rest for the engine's renderer (the page); 'cpu' poses them (headless) */
  bones?: 'gpu' | 'cpu';
}

/** A Game, plus what the host drives it with. */
export interface RunningGame<State = unknown> extends Game<State> {
  readonly level: Level;
  /** let real seconds pass (the page, every frame): runs the fixed steps that fit */
  advance(real: number, beforeStep?: (dt: number) => void): number;
  /** run every step of the next `seconds`, with no frame cap (tests, headless) */
  run(seconds: number): void;
  /** run exactly n steps */
  runSteps(n: number, beforeStep?: (step: number) => void): void;
  /** the dice's states (for tests) */
  diceState(): [number, number, number];
}

const NO_INPUT: StepInput = { move: 0, mz: 0, run: false, jump: false, jumpHeld: false, dash: false, attack: false, cast: false, crouch: false };

export function createGame<State>(def: GameDef<State>, ink: Ink, o: CreateOptions): RunningGame<State> {
  const K: Kit = ink.KIT;
  const sceneOf = o.scene(ink);
  const seed = (o.seed ?? def.seed ?? sceneOf.seed) >>> 0;
  const dice = new Dice(seed);
  const level = dice.during(K, () => buildLevel(def, ink, o.scene, seed));
  const world: World = level.world;
  const collision: Collision = level.collision;
  const combat = def.combat === false ? null : new Combat(def.combat || {});

  const entities: Entity[] = [];
  let nextId = 1;
  let events: { name: string; data?: unknown }[] = [];
  let player: Actor | null = null;
  const slotOf = new Map<number, Slot>();
  let state = undefined as unknown as State;
  let stepping = false;

  const posOf = (at: Vec3 | string): Vec3 => (typeof at === 'string' ? game.place(at) : [at[0], at[1], at[2]]);
  const base = (kind: string, at: Vec3 | string, tags: string[] | undefined) => ({
    id: nextId++,
    kind,
    tags: tags ? [...tags] : [],
    pos: posOf(at),
    alive: true,
    data: {} as Record<string, unknown>
  });

  const core: Core = dice.during(
    K,
    () =>
      new Core(world, K, {
        input: o.input,
        bones: o.bones || 'gpu',
        camera: def.camera,
        onStep: (dt, t, s) => step(dt, t, s)
      })
  );

  const effects = level.pools ? new GameEffects(effectOptions(def.effects)!, level.pools, world, collision, a => slotOf.get(a.id)) : null;

  const game: RunningGame<State> = {
    def,
    world,
    K,
    core,
    collision,
    level,
    built: level.built,
    effects,
    get entities() {
      return entities;
    },
    get state() {
      return state;
    },
    set state(v: State) {
      state = v;
    },
    get t() {
      return core.t;
    },
    get steps() {
      return core.loop.steps;
    },
    get player() {
      return player && player.alive ? player : null;
    },
    rng: () => dice.game.next(),
    place(name: string): Vec3 {
      const p = def.spawns && def.spawns[name];
      if (!p) throw new Error(`${def.id}: no spawn point "${name}"; known: ${Object.keys(def.spawns || {}).join(', ') || 'none'}`);
      const y = p[1] === null ? collision.ground(p[0], p[2]) : p[1];
      if (y <= -1e8) throw new Error(`${def.id}: spawn point "${name}" (${p[0]}, ${p[2]}) has no ground under it`);
      return [p[0], y, p[2]];
    },
    spawnActor(a) {
      const def0 = def.actors && def.actors[a.actor];
      if (!def0) throw new Error(`${def.id}: no actor "${a.actor}"; known: ${Object.keys(def.actors || {}).join(', ') || 'none'}`);
      const slot = level.slots.find(s => s.actor === a.actor && !s.used);
      if (!slot) throw new Error(`${def.id}: ${a.actor}: max is ${def0.max ?? 1}, all in use; raise actors.${a.actor}.max`);
      slot.used = true;
      const e = base(a.kind || a.actor, a.at, a.tags);
      const ch = slot.ch;
      ch.st.z = e.pos[2];
      ch.respawn(e.pos[0]);
      // (respawn looks for ground only 6 units below y = 7: stand it where the spawn point says the ground is)
      ch.st.y = ch.st.gh = e.pos[1];
      ch.st.ground = true;
      if (a.face !== undefined) ch.st.face = a.face;
      const actor: Actor = {
        ...e,
        type: 'actor',
        actor: a.actor,
        ch,
        brain: a.brain || 'player',
        face: ch.st.face,
        radius: def0.radius ?? 0.3,
        hp: ch.st.hp,
        team: a.team || ((a.brain || 'player') === 'player' ? 'player' : 'enemy'),
        damage: def0.damage ?? 1,
        invuln: 0,
        deadFor: -1,
        home: [ch.st.x, ch.st.y, ch.st.z],
        input: { ...NO_INPUT }
      };
      actor.pos = [ch.st.x, ch.st.y, ch.st.z];
      slotOf.set(actor.id, slot);
      markSlot(world.anim && world.anim.rows, slot);
      entities.push(actor);
      if (actor.brain === 'player' && !player) {
        player = actor;
        core.camera.follow(actor.pos);
        if (!stepping) core.camera.snap();
      }
      return actor;
    },
    spawnTrigger(a) {
      const tr: Trigger = {
        ...base(a.kind || 'trigger', a.at, undefined),
        type: 'trigger',
        shape: a.shape,
        watch: a.watch ? [...a.watch] : ['player'],
        onEnter: a.onEnter,
        onLeave: a.onLeave,
        inside: []
      };
      entities.push(tr);
      return tr;
    },
    spawnProp(a) {
      const p: Prop = { ...base(a.kind, a.at, a.tags), type: 'prop', update: a.update };
      entities.push(p);
      return p;
    },
    remove(e: Entity) {
      e.alive = false;
      if (!stepping) sweep();
    },
    byTag(tag: string) {
      return entities.filter(e => e.alive && e.tags.includes(tag));
    },
    get events() {
      return events;
    },
    emit(name: string, data?: unknown) {
      events.push(data === undefined ? { name } : { name, data });
    },
    snapshot(): Snapshot<State> {
      return {
        game: def.id,
        seed,
        t: core.t,
        steps: core.loop.steps,
        state: JSON.parse(JSON.stringify(state ?? null)),
        entities: entities.map(e => {
          const out: Snapshot['entities'][number] = {
            id: e.id,
            type: e.type,
            kind: e.kind,
            tags: [...e.tags],
            pos: [e.pos[0], e.pos[1], e.pos[2]],
            alive: e.alive,
            data: JSON.parse(JSON.stringify(e.data))
          };
          if (e.type === 'actor') {
            out.team = e.team;
            out.invuln = e.invuln;
            out.hp = e.ch.st.hp;
            out.face = e.ch.st.face;
            out.ground = !!e.ch.st.ground;
            out.dead = e.ch.st.dead >= 0;
          }
          return out;
        }),
        events: events.map(v => ({ ...v })),
        hash: game.hash()
      };
    },
    hash() {
      return hashGame(world, entities, state, dice.state());
    },
    advance(real, beforeStep) {
      return dice.during(K, () => core.advance(real, beforeStep));
    },
    run(seconds) {
      dice.during(K, () => core.run(seconds));
    },
    runSteps(n, beforeStep) {
      dice.during(K, () => {
        for (let k = 0; k < n; k++) {
          beforeStep?.(core.loop.steps);
          core.advance(core.loop.step);
        }
      });
    },
    diceState: () => dice.state()
  };

  /** take removed entities off the list, and put removed actors back in their pool */
  function sweep() {
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.alive) continue;
      entities.splice(i, 1);
      if (e.type === 'actor') {
        const s = slotOf.get(e.id)!;
        s.used = false;
        slotOf.delete(e.id);
        hideSlot(world, s);
        if (player === e) player = null;
      }
    }
  }

  const wall = (x: number, z: number, y: number) => {
    const h = collision.height(x, z, y + 1.5);
    return h > 1e8 || h < -1e8 || h > y + 0.45;
  };
  const tagged = (e: Entity, watch: string[]) => e.tags.some(t => watch.includes(t));
  const isIn = (tr: Trigger, p: Vec3) => {
    const d = [p[0] - tr.pos[0], p[1] - tr.pos[1], p[2] - tr.pos[2]];
    return 'r' in tr.shape ? Math.hypot(d[0], d[1], d[2]) <= tr.shape.r : d.every((v, k) => Math.abs(v) <= (tr.shape as { half: Vec3 }).half[k]);
  };

  /** One fixed step of the game, inside the core's step (input sampled, camera turned, clicks applied). */
  function step(dt: number, t: number, s: Sample) {
    stepping = true;
    events = [];
    try {
      const now = entities.slice(); // what is spawned during the step starts next step
      const actors = now.filter((e): e is Actor => e.type === 'actor' && e.alive);
      // 1. brains
      for (const a of actors) a.input = a.brain === 'player' ? { ...s.act } : { ...NO_INPUT, ...(a.brain as Brain)(a, game, dt) };
      // 2. movement
      for (const a of actors) {
        a.ch.update(dt, a.input, t);
        a.pos = [a.ch.st.x, a.ch.st.y, a.ch.st.z];
        a.face = a.ch.st.face;
        a.hp = a.ch.st.hp;
      }
      // 3. actors push each other apart (half each), never into a wall
      const standing = actors.filter(a => a.deadFor < 0);
      for (let i = 0; i < standing.length; i++)
        for (let j = i + 1; j < standing.length; j++) {
          const a = standing[i],
            b = standing[j],
            dx = b.pos[0] - a.pos[0],
            dz = b.pos[2] - a.pos[2],
            min = a.radius + b.radius;
          let d = Math.hypot(dx, dz);
          if (d >= min || Math.abs(b.pos[1] - a.pos[1]) > 1.5) continue;
          const ux = d > 1e-6 ? dx / d : 1,
            uz = d > 1e-6 ? dz / d : 0;
          d = Math.max(d, 0);
          const push = (min - d) / 2;
          for (const [e, sgn] of [[a, -1], [b, 1]] as [Actor, number][]) {
            const nx = e.pos[0] + ux * push * sgn,
              nz = e.pos[2] + uz * push * sgn;
            if (wall(nx, nz, e.pos[1])) continue;
            e.ch.st.x = e.pos[0] = nx;
            e.ch.st.z = e.pos[2] = nz;
          }
        }
      // 3b. blows land, the dead fall, the player comes back
      combat?.step(game, actors, dt, effects);
      // 4. triggers
      for (const tr of now) {
        if (tr.type !== 'trigger' || !tr.alive) continue;
        const was = new Set(tr.inside),
          inside: number[] = [];
        for (const e of now) if (e !== tr && e.alive && tagged(e, tr.watch) && isIn(tr, e.pos)) inside.push(e.id);
        tr.inside = inside;
        for (const id of inside) if (!was.has(id)) tr.onEnter?.(entities.find(e => e.id === id)!, game);
        for (const id of was)
          if (!inside.includes(id)) {
            const who = entities.find(e => e.id === id);
            if (who) tr.onLeave?.(who, game);
          }
      }
      // 5. props
      for (const p of now) if (p.type === 'prop' && p.alive) p.update?.(p, game, dt);
      // 6. the rules
      def.step?.(game, dt);
      // 6b. the effects move on
      effects?.step(dt);
      // 7. what the characters wrote this step goes to the graphics card
      const rows = world.anim && world.anim.rows;
      for (const e of entities) if (e.type === 'actor' && e.alive) markSlot(rows, slotOf.get(e.id)!);
      for (const r of level.reserved) markSlot(rows, r as Slot);
      // 8. the camera follows the player
      const pl = game.player;
      if (pl) core.camera.follow(pl.pos);
    } finally {
      stepping = false;
      sweep();
    }
  }

  // the world is ready: put the cast on stage
  dice.during(K, () => {
    state = def.init(game);
  });
  return game;
}

// ------------------------------------------------------------------------------------------------- hash

/** FNV-1a, 32 bits, two lanes (different offsets) for 64 bits in all, over bytes. */
class Fnv {
  a = 0x811c9dc5;
  b = 0xcbf29ce4;
  byte(v: number) {
    this.a = Math.imul(this.a ^ v, 0x01000193) >>> 0;
    this.b = Math.imul(this.b ^ v, 0x01000193) >>> 0;
  }
  bytes(u8: Uint8Array) {
    let a = this.a,
      b = this.b;
    for (let i = 0; i < u8.length; i++) {
      a = Math.imul(a ^ u8[i], 0x01000193) >>> 0;
      b = Math.imul(b ^ u8[i], 0x01000193) >>> 0;
    }
    this.a = a;
    this.b = b;
  }
  text(s: string) {
    this.bytes(new TextEncoder().encode(s));
  }
  hex() {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
  }
}

function hashGame(world: World, entities: readonly Entity[], state: unknown, dice: number[]): string {
  const h = new Fnv();
  const data = ((world as { rest?: Float32Array }).rest || world.data) as Float32Array;
  h.bytes(new Uint8Array(data.buffer, data.byteOffset, world.count * 16 * 4));
  h.text(
    JSON.stringify({
      state: state ?? null,
      dice,
      e: entities.map(e => [e.id, e.type, e.kind, e.alive, e.pos, e.data, e.type === 'actor' ? [e.ch.st.hp, e.ch.st.face, e.ch.st.vx, e.ch.st.vy, e.ch.st.vz, e.invuln, e.deadFor, e.team] : 0])
    })
  );
  return h.hex();
}
