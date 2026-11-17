// The game's dice. Three sources of chance, all from the game's seed, all owned by the game (docs/engine-stage6-design.md §3):
//   game.rng()     the game's own: the only chance a game's code may use
//   K.rnd()        the kit's repeatable chance: its state is global to the kit and cannot be read, so while the game builds or
//                  steps, K.rnd and K.seed are swapped for a generator of the game's (the same xorshift32 as the kit's)
//   Math.random    used by K.play.* (kg-play.js) and as a fallback in ks-xpbd.js: swapped the same way
// The swap is synchronous and always undone (try / finally), so two games stepping in turn never see each other's dice.
import type { Kit } from '../../types/ink-studio';

/** xorshift32, the kit's own generator (k0-math.js K.rnd), with its state in the open so it can be saved and hashed. */
export class XorShift {
  s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** start again from a seed, as K.seed does (0 becomes the kit's default seed) */
  seed(n: number): void {
    this.s = n >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let s = this.s;
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    this.s = s;
    return s / 4294967296;
  }
}

export class Dice {
  readonly game: XorShift;
  readonly kit: XorShift;
  readonly math: XorShift;
  private depth = 0;

  constructor(seed: number) {
    this.game = new XorShift(seed);
    this.kit = new XorShift(seed ^ 0x51ed270b);
    this.math = new XorShift(seed ^ 0x2545f491);
  }

  /** The three states, for a snapshot or a hash. */
  state(): [number, number, number] {
    return [this.game.s, this.kit.s, this.math.s];
  }

  /**
   * Run fn with Math.random, K.rnd and K.seed being this game's, and put the originals back afterwards, even if fn throws.
   * Nested calls (a step inside a build) leave the outer swap in place.
   */
  during<T>(K: Kit, fn: () => T): T {
    if (this.depth > 0) return fn();
    const mr = Math.random,
      kr = K.rnd,
      ks = K.seed;
    Math.random = () => this.math.next();
    K.rnd = () => this.kit.next();
    K.seed = (n: number) => this.kit.seed(n);
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
      Math.random = mr;
      K.rnd = kr;
      K.seed = ks;
    }
  }
}
