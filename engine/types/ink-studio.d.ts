// Types for the part of the ink-studio toolkit the engine uses. The toolkit itself stays plain JavaScript (src/, loaded as
// one classic script that sets window.INK); these declarations only describe it. Fields not listed here still exist:
// the open index signatures keep the rest of the kit reachable without pretending to type all of it.

/** A colour as the toolkit packs it into a float: r + g * 256 + b * 65536, each 0..255. */
export type PackedRGB = number;
export type Vec3 = [number, number, number];

/**
 * The finished world: every splat in one buffer, 16 floats each:
 *   [x, y, z, density] [c00, c01, c02, packedRGB] [c11, c12, c22, kind] [phase, speed, range, extra]
 * c.. is the symmetric 3x3 covariance (the splat's shape). kind % 16 is its motion; bit 512 is "born" (grows in at time
 * `extra`), bit 1024 is "wet". (kind / 16) carries flags: 1 does not write depth, 2 ignores fog, 16 is glass.
 */
export interface World {
  data: Float32Array;
  count: number;
  pal: number[];
  palName?: string;
  seed: number;
  cam: { target: Vec3; dist: number; pitch: number; yaw: number; sway?: number };
  /** pixels of art per world unit at the camera's own distance: sets how big an art pixel is */
  detail: number;
  dither: number;
  fog: { c: number; start: number; max: number };
  outline: { c: number; edge: number };
  /** rough size of the diorama, used for fog and depth ranges */
  radius: number;
  /** splats drawn behind everything else (a sky, stars) */
  back: Int32Array;
  moving: Int32Array;
  attr?: Float32Array;
  fine?: Float32Array;
  grow?: { rate?: number; loop?: number; fade?: number };
  refract?: number;
  ao?: { k?: number; range?: number };
  anim?: Anim;
  [key: string]: unknown;
}

/** What a living world exposes to a host: the clock it is driven by, and what changed since the last frame. */
export interface Anim {
  update(dt: number, t: number): boolean | void;
  /** one flag per block of 512 splats: set when that block was written and must be sent to the graphics card again */
  rows?: Uint8Array;
  /** true when the world must be walked forward in order (it remembers the past) */
  stateful?: boolean;
  /** a tap along a line from the eye */
  poke?(eye: Vec3, dir: Vec3, t?: number): unknown;
  /** a shake of the view */
  kick?: Vec3 | null;
  /** a camera punch: the eye moves in by this factor */
  zoom?: number;
  /** the palette regraded (3 floats per entry, 0..1), or null */
  grade?: Float32Array | number[] | null;
  /** 12 floats per bone when splats are carried by bones on the graphics card */
  bones?: Float32Array;
  [key: string]: unknown;
}

/** K.stage(world): the clock and systems of a world. It is also installed as world.anim. */
export interface Stage extends Anim {
  W: World;
  D: Float32Array;
  N: number;
  base: Float32Array;
  rows: Uint8Array;
  time: number;
  add<T extends object>(system: T): T;
  touch(i: number): void;
  repaint(i: number): void;
}

/** makeBuilder(seed, palette): seeded generation and the low-level splat writers. */
export interface Builder {
  count(): number;
  finish(meta: Partial<World> & { cam: World['cam']; detail: number }): World;
  R(): number;
  rr(a: number, b: number): number;
  /** splat i as [x, y, z, nx, ny, nz, density, ..., colour, palette index], or null if it has no normal (not lit by a bake) */
  dabAt(i: number, out?: number[]): number[] | null;
  P: number[][];
  TAU: number;
  [key: string]: any;
}

/** makeSculpt(B), usually passed through KIT.sculpt: distance-field solids baked into splats. */
export interface Sculpt {
  bake(): void;
  sdf(x: number, y: number, z: number): number;
  heightAt(x: number, z: number, y0?: number, depth?: number): number;
  [key: string]: any;
}

/** A scene as the toolkit describes one: build(seed) makes the world. */
export interface Scene {
  id: string;
  name: string;
  seed: number;
  blurb?: string;
  build(seed: number): World;
}

/** The toolkit namespace. Its many modules (K.particles, K.character, K.cloth ...) are reached through the index signature. */
export interface Kit {
  stage(world: World): Stage;
  sculpt(S: Sculpt): Sculpt;
  seed(n: number): void;
  rnd(): number;
  [module: string]: any;
}

export interface PixelLookApi {
  /** GLSL ES 3.00 helpers for the palette-aware pixel resolve (pixelResolve, pixelNearest ...) */
  glsl: string;
  nearest(c: number[], palette: number[][], solid: boolean): number;
  resolve(o: unknown): { w: number; h: number; rgb: Uint8Array; use: Uint32Array };
}

export interface Ink {
  SCENES: Scene[];
  /** scenes loaded from module files after the toolkit (see /scene/<path> on the dev server) */
  extra: Scene[];
  /** the functions of scene modules loaded in the page, by path ('showcase/farol.js'): a game builds them through its own kit */
  sceneFns?: Record<string, (kit: Ink) => Scene>;
  makeBuilder(seed: number, palette?: number[]): Builder;
  makeSculpt(B: Builder): Sculpt;
  KIT: Kit;
  PixelLook: PixelLookApi;
  PALETTES: unknown;
  PAL_HEX: number[];
}

declare global {
  interface Window {
    INK: Ink;
  }
}
