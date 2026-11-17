// Stage 6, the contract: what a game is, as its author (a person or an AI) writes it and as the engine runs it.
// Declarations only: docs/engine-stage6-design.md says why each thing is the way it is, and what implements it.
//
// The shape of it:
//   a GameDef   = an ink-studio scene (unchanged) + the actors to make room for + init() + step()
//   a Game      = that definition running: the world, its collision map, entities, the seeded dice, the clock
//   an Entity   = anything with a place that the game steps: an actor (a K.character with a brain), a trigger, a prop
//   a Script    = input as data: what was pressed when. The same seed and the same script give the same game, every time.
import type { Builder, Kit, Scene, Sculpt, Vec3, World, Ink } from '../../types/ink-studio';
import type { CameraOptions } from '../core/camera';
import type { Core } from '../core/core';
import type { Action, StepInput } from '../core/input';

// ---------------------------------------------------------------------------------------------------------- the level

/**
 * A scene as ink-studio's own modules export one: module.exports = kit => ({ id, name, seed, build }). A game is handed
 * the kit through a facade that notes the builder and the sculpt the scene makes, so any existing scene is a level as
 * it stands. A string is a path from the repository root ('showcase/farol.js'): the host loads it (require in Node, a
 * script tag in the page).
 */
export type SceneSource = string | ((kit: Ink) => Scene);

/** An axis-aligned box in world space. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface CollisionOptions {
  /** size of a column of the map, in world units (default 0.25) */
  cell?: number;
  /**
   * which of the scene's bakes are ground and walls: 'all' (default) or their numbers in order (0 is the first S.bake()).
   * What a scene bakes late into moving parts usually should not be: leave those out here.
   */
  bakes?: 'all' | number[];
  /** solid whatever the scene says (an invisible wall, a fence round the arena) */
  block?: Box[];
  /** empty whatever the scene says (a bush that should not stop anyone) */
  open?: Box[];
  /** where to look for solids (default x and z -64..64, y -32..64: room for any diorama of the kit) */
  region?: Box;
}

/**
 * The baked map: for each column of the grid, the solid stretches of it (bottom, top), highest first. Plain numbers in
 * typed arrays, so it can be copied to a worker or saved. Columns are centred on (i * cell, k * cell).
 */
export interface CollisionData {
  cell: number;
  /** the grid's first column and its size, in columns */
  i0: number;
  k0: number;
  nx: number;
  nz: number;
  /** nx * nz + 1 offsets into spans (in spans, not floats): column c has spans start[c] .. start[c + 1] */
  start: Uint32Array;
  /** [bottom, top] pairs */
  spans: Float32Array;
}

export interface Collision {
  readonly data: CollisionData;
  /**
   * What K.character asks of its world, with the meaning of the sculpt's own S.heightAt(x, z, y): the first surface at
   * or below y (looking down at most 6 units); 1e9 if (x, y, z) is inside something; -1e9 if there is nothing below
   * (off the edge of the world: K.character will not walk there).
   */
  height(x: number, z: number, y: number): number;
  /** the highest ground at (x, z), from above everything; -1e9 if none. For putting things down. */
  ground(x: number, z: number): number;
  /** true if a body of radius r and height h standing at p overlaps something solid (a spawn point, a teleport) */
  blocked(p: Vec3, r: number, h: number): boolean;
  /** true if nothing solid lies on the straight line a -> b (line of sight for an enemy; a projectile's path) */
  clear(a: Vec3, b: Vec3): boolean;
}

// ---------------------------------------------------------------------------------------------------------- actors

/**
 * A kind of character the level makes room for. K.character writes its own splats, and those must exist before the
 * world is finished: so every actor that will ever be on screen is declared here, `max` of each, and spawned from that
 * pool while the game runs.
 */
export interface ActorDef {
  /** the K.character spec (pts, height, sculpt, speed, atk, gait ...). `world` is filled in by the engine. */
  spec: Record<string, unknown>;
  /** how many can be alive at once (default 1) */
  max?: number;
  /** body radius for actors pushing each other apart (default 0.3) */
  radius?: number;
  hp?: number;
}

/**
 * What decides an actor's input each step. The player's brain is the gamepad; an enemy's is a function that returns
 * the same StepInput: an enemy is a player with a different hand on the stick. Must be deterministic: only game.rng()
 * for chance, never Math.random or the clock.
 */
export type Brain = (self: Actor, game: Game, dt: number) => Partial<StepInput>;

// ---------------------------------------------------------------------------------------------------------- entities

export interface EntityBase {
  /** given in order of spawning: entities are stepped in this order, always */
  readonly id: number;
  /** the author's name for what it is ('player', 'grunt', 'door') */
  kind: string;
  tags: string[];
  pos: Vec3;
  alive: boolean;
  /** anything the game wants to keep on it: plain data only (it goes into snapshots) */
  data: Record<string, unknown>;
}

export interface Actor extends EntityBase {
  type: 'actor';
  /** the ActorDef it was taken from */
  actor: string;
  /** the K.character itself: ch.st is its whole state, ch.hurt / ch.respawn / ch.striking / ch.play are the kit's */
  ch: any;
  /** 'player' reads the gamepad; a function is asked every step */
  brain: 'player' | Brain;
  /** the way it faces (radians, as K.character's st.face) */
  face: number;
  radius: number;
  hp: number;
  /** the input it was given this step (for tests and for other brains to read) */
  input: StepInput;
}

export interface Trigger extends EntityBase {
  type: 'trigger';
  /** a ball (r) or a box (half-sizes) about pos */
  shape: { r: number } | { half: Vec3 };
  /** entities with one of these tags set it off (default ['player']) */
  watch: string[];
  onEnter?(who: Entity, game: Game): void;
  onLeave?(who: Entity, game: Game): void;
  /** ids of the entities inside it now */
  inside: number[];
}

/** Something with a place and its own step, and nothing else promised: a pickup, a door, a spawner. */
export interface Prop extends EntityBase {
  type: 'prop';
  update?(self: Prop, game: Game, dt: number): void;
}

export type Entity = Actor | Trigger | Prop;

// ---------------------------------------------------------------------------------------------------------- the game

/** While the scene is being built, before the world is finished: the last moment splats can be reserved. */
export interface BuildContext {
  B: Builder;
  S: Sculpt;
  K: Kit;
  seed: number;
  /**
   * Make something of the kit that sets splats aside and is bound to the world afterwards (K.play.fx(B, n),
   * K.play.debris(B, n) ...): its splats are noted, bind(world, at) is called once the world is finished, and its rows are
   * marked as changed every step (these write their splats without saying so).
   */
  reserve<T extends { bind(world: World, at: number): void }>(make: () => T): T;
}

export interface GameDef<State = unknown> {
  id: string;
  name?: string;
  /** default: the scene's own seed. The same seed and the same script give the same game. */
  seed?: number;
  scene: SceneSource;
  collision?: CollisionOptions;
  actors?: Record<string, ActorDef>;
  /** named places. Give y as null to stand it on the ground there. */
  spawns?: Record<string, [number, number | null, number]>;
  camera?: CameraOptions;
  /**
   * more splats to reserve before the world is finished (K.play.fx, K.pool ...): what it returns is game.built, for
   * init() and step() to use (the effects pool, say)
   */
  build?(ctx: BuildContext): Record<string, unknown> | void;
  /** once, when the world is ready: spawn what starts on stage; what it returns is game.state (plain data) */
  init(game: Game<State>): State;
  /** every step, after every entity has moved: rules, scores, winning and losing */
  step?(game: Game<State>, dt: number): void;
}

export interface Game<State = unknown> {
  readonly def: GameDef<State>;
  readonly world: World;
  readonly K: Kit;
  /** the clock, the input and the camera (stage 5) */
  readonly core: Core;
  readonly collision: Collision;
  /** every entity, in id order */
  readonly entities: readonly Entity[];
  state: State;
  /** what def.build() returned (objects of the kit: not part of snapshots) */
  readonly built: Record<string, unknown>;
  /** simulation time in seconds, and steps run */
  readonly t: number;
  readonly steps: number;
  /** the game's own dice, 0..1, from the seed. The only chance a game may use. */
  rng(): number;
  /** a named spawn point, with y resolved */
  place(name: string): Vec3;
  spawnActor(o: { actor: string; kind?: string; at: Vec3 | string; brain?: 'player' | Brain; tags?: string[]; face?: number }): Actor;
  spawnTrigger(o: { kind?: string; at: Vec3 | string; shape: Trigger['shape']; watch?: string[]; onEnter?: Trigger['onEnter']; onLeave?: Trigger['onLeave'] }): Trigger;
  spawnProp(o: { kind: string; at: Vec3 | string; tags?: string[]; update?: Prop['update'] }): Prop;
  /** takes it off stage (an actor goes back to its pool, hidden) */
  remove(e: Entity): void;
  byTag(tag: string): Entity[];
  /** the first actor whose brain is 'player', if any: the camera follows it */
  readonly player: Actor | null;
  /** an event for whoever is listening (the HUD, the sound, a test): events are also kept in the snapshot of the step */
  emit(name: string, data?: unknown): void;
  /** the game as plain data: what a test asserts on, what `shot --state` writes */
  snapshot(): Snapshot<State>;
  /** a number that changes if anything in the simulation does: the splats, the entities, the dice */
  hash(): string;
}

export interface Snapshot<State = unknown> {
  game: string;
  seed: number;
  t: number;
  steps: number;
  state: State;
  entities: {
    id: number;
    type: Entity['type'];
    kind: string;
    tags: string[];
    pos: Vec3;
    alive: boolean;
    data: Record<string, unknown>;
    /** actors only */
    hp?: number;
    face?: number;
    ground?: boolean;
    dead?: boolean;
  }[];
  /** what was emitted during the last step */
  events: { name: string; data?: unknown }[];
  hash: string;
}

// ---------------------------------------------------------------------------------------------------------- scripts

/**
 * Input as data. Times are in steps (a step is 1/60 s): an event at step n is in place when step n runs (the first
 * step is 0). `t` in seconds may be given instead and is rounded to the nearest step.
 */
export type ScriptEvent = ({ step: number } | { t: number }) &
  (
    | { press: Action }
    | { release: Action }
    /** press now, release after this many steps (default 1) */
    | { tap: Action; for?: number }
    /** the analogue stick, x right, y up (away from the camera) */
    | { stick: [number, number] }
    /** turn the camera (radians) and zoom it (a factor) */
    | { turn: [number, number]; zoom?: number }
    /** a click on the picture, u from the left, v from the top, 0..1 */
    | { click: [number, number] }
  );

export interface Script {
  /** overrides the game's seed */
  seed?: number;
  /** the size of the stage the player is looking at, in screen pixels: clicks are worked out through it (default 900 x 620) */
  view?: { w: number; h: number };
  events: ScriptEvent[];
}
