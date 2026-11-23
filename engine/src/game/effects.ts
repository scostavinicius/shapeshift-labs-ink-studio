// The kit's gameplay effects, made for a game (stage 7): K.play.fx (sparks, rings), K.play.debris (pieces that fly and
// land) and K.play.eco (what the ground remembers). fx and debris set splats aside at build time (level.ts makes them just
// before the world is finished); eco keeps its memory in a texture made for the original game's shader, which this
// engine's renderer does not read, so here the ground's own splats are repainted from it through a painter of the stage.
import type { Kit, World } from '../../types/ink-studio';
import type { Actor, Collision, Effects, EffectsOptions } from './types';

/** made at build time, before B.finish: the pools, and where their splats start */
export interface EffectPools {
  fx: { thing: any; at: number; total: number } | null;
  debris: { thing: any; at: number; total: number } | null;
  eco: any | null;
}

export function effectOptions(o: EffectsOptions | true | undefined): Required<EffectsOptions> | null {
  if (!o) return null;
  const e = o === true ? {} : o;
  return { fx: e.fx ?? 400, debris: e.debris ?? 800, eco: e.eco ?? true, marks: e.marks ?? true, fuel: e.fuel ?? 0.5, weather: e.weather ?? {} };
}

/** Set the pools aside in the builder (before B.finish). */
export function reservePools(K: Kit, B: { count(): number; P: number[][] }, o: Required<EffectsOptions>): EffectPools {
  const pool = (n: number, make: () => any) => {
    if (!n) return null;
    const at = B.count(),
      thing = make();
    return { thing, at, total: B.count() - at };
  };
  return {
    fx: pool(o.fx, () => K.play.fx(B, o.fx)),
    debris: pool(o.debris, () => K.play.debris(B, o.debris)),
    eco: o.eco ? K.play.eco() : null
  };
}

// K.play.eco's grid (kg-play.js): cells of one unit, N x NZ of them, cell (0, 0) at x = -OFF, z = -OFZ
const ECO_N = 160,
  ECO_NZ = 288,
  ECO_OFF = 80,
  ECO_OFZ = 208;
const ecoCell = (x: number, z: number) => {
  const ix = Math.floor(x) + ECO_OFF,
    iz = Math.floor(z) + ECO_OFZ;
  return ix < 0 || iz < 0 || ix >= ECO_N || iz >= ECO_NZ ? -1 : iz * ECO_N + ix;
};

// the cells marks look splats up in (stage 28): any size of level, keyed by integer cell
const MARK_CELL = 0.5;
const markKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const markCell = (x: number, z: number) => markKey(Math.floor(x / MARK_CELL), Math.floor(z / MARK_CELL));
/** what a blow's mark darkens the ground toward: soot, a little warm */
const SCUFF = [0.12, 0.1, 0.09];

const CHAR = [0.1, 0.075, 0.07],
  EMBER = [0.95, 0.42, 0.12],
  ICE = [0.78, 0.9, 1.0];

/** The pools bound to the finished world, the ground's memory painted onto its splats, and what the game calls. */
export class GameEffects implements Effects {
  fx: any;
  debris: any;
  eco: any;
  /** for each eco cell, the ground splats in it */
  private cells = new Map<number, number[]>();
  private seen: Uint8Array | null = null;
  private ground: Uint8Array;

  private env: { rain: number; winter: number };

  constructor(
    o: Required<EffectsOptions>,
    pools: EffectPools,
    private world: World,
    private collision: Collision,
    /** where an actor's splats are */
    private splatsOf: (a: Actor) => { at: number; total: number } | undefined
  ) {
    this.fx = pools.fx ? pools.fx.thing : null;
    this.debris = pools.debris ? pools.debris.thing : null;
    this.eco = pools.eco;
    this.ground = new Uint8Array(world.count);
    this.env = { rain: o.weather.rain ?? 0, winter: o.weather.winter ?? 0 };
    const st = world.anim as any;
    if ((this.eco || o.marks) && st && st.repaint && st.base) {
      // what can burn: the level's ground
      if (this.eco) this.eco.reset({ fuel: (x: number, z: number) => (collision.ground(x, z) > -1e8 ? o.fuel : 0) });
      // the ground's splats: the ones lying on the surface the collision map found
      const D = world.data;
      for (let i = 0; i < world.count; i++) {
        const o = i * 16,
          y = D[o + 1];
        if (D[o + 3] <= 0 || y < -40) continue;
        const g = collision.ground(D[o], D[o + 2]);
        if (g < -1e8 || Math.abs(y - g) > 0.35) continue;
        this.ground[i] = 1;
        const m = markCell(D[o], D[o + 2]),
          ml = this.markCells.get(m);
        if (ml) ml.push(i);
        else this.markCells.set(m, [i]);
        const c = ecoCell(D[o], D[o + 2]);
        if (c < 0) continue;
        const l = this.cells.get(c);
        if (l) l.push(i);
        else this.cells.set(c, [i]);
      }
      if (o.marks) this.scuff = new Float32Array(world.count);
      if (this.eco) this.seen = new Uint8Array(this.eco.tex);
      const tex = this.eco ? (this.eco.tex as Uint8Array) : null,
        ground = this.ground,
        scuff = this.scuff;
      st.add({
        paint(i: number, rgba: number[]) {
          if (!ground[i]) return;
          // a blow's mark (stage 28): the ground darkened toward soot, before the ground's memory paints over it
          if (scuff && scuff[i] > 0) for (let a = 0; a < 3; a++) rgba[a] += (SCUFF[a] - rgba[a]) * scuff[i];
          if (!tex) return;
          const D2 = st.base as Float32Array,
            c = ecoCell(D2[i * 16], D2[i * 16 + 2]);
          if (c < 0) return;
          const burn = tex[c * 4] / 255,
            heat = tex[c * 4 + 1] / 255,
            ice = tex[c * 4 + 2] / 255;
          const mix = (to: number[], k: number) => {
            for (let a = 0; a < 3; a++) rgba[a] += (to[a] - rgba[a]) * k;
          };
          if (burn > 0) mix(CHAR, 0.85 * burn);
          if (heat > 0.5) mix(EMBER, 0.55 * (heat - 0.5) * 2);
          if (ice > 0) mix(ICE, 0.7 * ice);
        }
      });
    }
  }

  /** for each cell of MARK_CELL units, the ground splats in it (for marks) */
  private markCells = new Map<number, number[]>();
  /** how dark each ground splat's mark is, 0..1 (null when marks are off) */
  private scuff: Float32Array | null = null;

  /**
   * Mark the ground at (x, z), radius r, strength k (0..1): a broken patch of darker ground splats, darkest in the
   * middle, that stays (stage 28). Which splats take the mark comes from a hash of the splat and the place, never from
   * the game's dice, so a mark changes no game; the same blow always marks the same splats.
   */
  mark(x: number, z: number, r: number, k = 0.6): void {
    const scuff = this.scuff,
      st = this.world.anim as any;
    if (!scuff || !(r > 0) || !(k > 0)) return;
    const D = st.base as Float32Array,
      changed: number[] = [],
      salt = (Math.floor(x * 64) * 73856093) ^ (Math.floor(z * 64) * 19349663);
    const lo = (v: number) => Math.floor((v - r) / MARK_CELL),
      hi = (v: number) => Math.floor((v + r) / MARK_CELL);
    for (let cx = lo(x); cx <= hi(x); cx++)
      for (let cz = lo(z); cz <= hi(z); cz++) {
        const list = this.markCells.get(markKey(cx, cz));
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(D[i * 16] - x, D[i * 16 + 2] - z);
          if (d >= r) continue;
          const near = 1 - d / r,
            // a speckle: each splat a coin of its own, more of them taking the mark toward the middle
            coin = (Math.imul(i ^ salt, 2654435761) >>> 0) / 4294967296;
          if (coin > near * 1.3) continue;
          const v = Math.min(0.8, k * (0.45 + 0.55 * near));
          if (v <= scuff[i]) continue;
          scuff[i] = v;
          changed.push(i);
        }
      }
    if (changed.length) st.repaintAll(changed);
  }

  /** bind the pools to the world (once, right after B.finish) */
  static bind(pools: EffectPools, world: World): void {
    if (pools.fx) pools.fx.thing.bind(world, pools.fx.at);
    if (pools.debris) pools.debris.thing.bind(world, pools.debris.at);
  }

  /** one step: the pools move, the ground's memory goes on, and the ground splats whose cell changed are repainted */
  step(dt: number): void {
    if (this.fx) this.fx.update(dt);
    if (this.debris) this.debris.update(dt);
    if (this.eco) {
      this.eco.update(dt, this.env);
      this.repaintChanged();
    }
  }

  private repaintChanged() {
    if (!this.seen || !this.eco.dirty) return;
    this.eco.dirty = false;
    const tex = this.eco.tex as Uint8Array,
      seen = this.seen,
      st = this.world.anim as any;
    for (let c = 0; c < ECO_N * ECO_NZ; c++) {
      const o = c * 4;
      if (tex[o] === seen[o] && tex[o + 1] === seen[o + 1] && tex[o + 2] === seen[o + 2]) continue;
      seen[o] = tex[o];
      seen[o + 1] = tex[o + 1];
      seen[o + 2] = tex[o + 2];
      const l = this.cells.get(c);
      if (l) st.repaintAll(l);
    }
  }

  ignite(x: number, z: number, r: number): void {
    if (!this.eco) return;
    this.eco.ignite(x, z, r, this.env.rain);
    this.repaintChanged();
  }

  freeze(x: number, z: number, r: number, dur: number): void {
    if (!this.eco) return;
    this.eco.freeze(x, z, r, dur);
    this.repaintChanged();
  }

  shatter(a: Actor, power = 4): void {
    if (!this.debris) return;
    const D = this.world.data,
      list: Float32Array[] = [];
    const slot = this.splatsOf(a);
    if (!slot) return;
    for (let i = slot.at; i < slot.at + slot.total; i++) if (D[i * 16 + 1] > -40 && D[i * 16 + 3] > 0) list.push(D.subarray(i * 16, i * 16 + 16));
    const g = this.collision.ground(a.pos[0], a.pos[2]);
    this.debris.burst(list, [a.pos[0], a.pos[1] + 0.5, a.pos[2]], power, g > -1e8 ? g : a.pos[1]);
  }

  /** splats of the pools, for marking rows each step */
  static ranges(pools: EffectPools): { at: number; total: number }[] {
    return [pools.fx, pools.debris].filter(Boolean).map(p => ({ at: p!.at, total: p!.total }));
  }
}
