// The level's collision map (docs/engine-stage6-design.md §4): for each column of an XZ grid, the solid stretches of it,
// sampled from the sculpt's distance field right after each bake (the field only knows the solids of the bake it has just
// done). Queries answer what K.character asks of its world, with the meaning of the sculpt's own S.heightAt.
import type { Vec3 } from '../../types/ink-studio';
import type { Box, Collision, CollisionData, CollisionOptions } from './types';

/** the surface is where the field crosses this (the same as S.heightAt's test) */
const ISO = 0.02;
/** how far down height() looks for ground, as S.heightAt's default depth */
const DEPTH = 6;
const BIG = 1e9;
const DEFAULT_REGION: Box = { min: [-64, -32, -64], max: [64, 64, 64] };

/** anything with a distance field: the sculpt (S.sdf) after a bake */
export interface Field {
  sdf(x: number, y: number, z: number): number;
}

export interface BakeStats {
  bake: number;
  /** field evaluations, columns that got at least one span, and the time it took */
  evals: number;
  columns: number;
  spans: number;
  ms: number;
}

const key = (i: number, k: number) => (i + 32768) * 65536 + (k + 32768);
const unkey = (c: number): [number, number] => [Math.floor(c / 65536) - 32768, (c % 65536) - 32768];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The box of splats first .. last - 1 of a builder (B.dabAt gives the place of each lit splat), padded by `pad`; null if
 * none of them has a place (nothing was drawn).
 */
export function splatBox(B: { dabAt(i: number, out?: number[]): number[] | null }, first: number, last: number, pad = 1): Box | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity],
    hi: Vec3 = [-Infinity, -Infinity, -Infinity],
    tmp = new Array(10);
  let any = false;
  for (let i = first; i < last; i++) {
    const d = B.dabAt(i, tmp);
    if (!d) continue;
    any = true;
    for (let a = 0; a < 3; a++) {
      if (d[a] < lo[a]) lo[a] = d[a];
      if (d[a] > hi[a]) hi[a] = d[a];
    }
  }
  return any ? { min: [lo[0] - pad, lo[1] - pad, lo[2] - pad], max: [hi[0] + pad, hi[1] + pad, hi[2] + pad] } : null;
}

/** Gathers spans over the bakes of a build, then makes the finished map. */
export class CollisionBuilder {
  readonly cell: number;
  readonly region: Box;
  readonly stats: BakeStats[] = [];
  private cols = new Map<number, number[]>();
  private bakes = 0;

  constructor(private o: CollisionOptions = {}) {
    this.cell = o.cell ?? 0.25;
    this.region = o.region ?? DEFAULT_REGION;
  }

  /** Whether the bake that has just happened counts (collision.bakes). Counts it either way. */
  wants(): boolean {
    const n = this.bakes++;
    const b = this.o.bakes ?? 'all';
    return b === 'all' || b.includes(n);
  }

  /**
   * Sample the field into columns, within `near` (the box of the splats the bake has just made, padded: the surfaces of
   * the solids are where their splats are) cut to the region; without `near`, the whole region (slow: for checking).
   *
   * The sculpt's field is not a distance far from things: it is capped at 1 (sculpt.js MARG), so empty space cannot be
   * found by asking it. The splats are the cheap, exact answer to "where is there anything".
   */
  sample(F: Field, o: { near?: Box | null } = {}): BakeStats {
    const t0 = now(),
      cell = this.cell,
      R = this.region,
      min: Vec3 = o.near ? [0, 1, 2].map(a => Math.max(R.min[a], o.near!.min[a])) as Vec3 : R.min,
      max: Vec3 = o.near ? [0, 1, 2].map(a => Math.min(R.max[a], o.near!.max[a])) as Vec3 : R.max;
    let evals = 0;
    const sdf = (x: number, y: number, z: number) => (evals++, F.sdf(x, y, z));
    let columns = 0,
      spans = 0;
    if (min[0] <= max[0] && min[1] <= max[1] && min[2] <= max[2])
      for (let i = Math.ceil(min[0] / cell); i * cell <= max[0]; i++)
        for (let k = Math.ceil(min[2] / cell); k * cell <= max[2]; k++) {
          const found: number[] = [];
          marchColumn(sdf, i * cell, k * cell, max[1], min[1], found);
          if (!found.length) continue;
          columns++;
          spans += found.length / 2;
          const c = key(i, k),
            had = this.cols.get(c);
          this.cols.set(c, had ? had.concat(found) : found);
        }
    const s = { bake: this.bakes - 1, evals, columns, spans, ms: Math.round(now() - t0) };
    this.stats.push(s);
    return s;
  }

  /** The finished map: spans of each column merged (across bakes), sorted highest first; block and open applied. */
  finish(): CollisionData {
    const cell = this.cell;
    const inBox = (b: Box, x: number, z: number) => x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2];
    for (const b of this.o.block || [])
      for (let i = Math.ceil(b.min[0] / cell); i * cell <= b.max[0]; i++)
        for (let k = Math.ceil(b.min[2] / cell); k * cell <= b.max[2]; k++) {
          const c = key(i, k);
          this.cols.set(c, (this.cols.get(c) || []).concat([b.min[1], b.max[1]]));
        }
    let i0 = Infinity,
      i1 = -Infinity,
      k0 = Infinity,
      k1 = -Infinity;
    const merged = new Map<number, number[]>();
    for (const [c, raw] of this.cols) {
      const [i, k] = unkey(c);
      let list = mergeSpans(raw);
      for (const b of this.o.open || []) if (inBox(b, i * cell, k * cell)) list = cut(list, b.min[1], b.max[1]);
      if (!list.length) continue;
      merged.set(c, list);
      i0 = Math.min(i0, i);
      i1 = Math.max(i1, i);
      k0 = Math.min(k0, k);
      k1 = Math.max(k1, k);
    }
    if (!merged.size) return { cell, i0: 0, k0: 0, nx: 0, nz: 0, start: new Uint32Array(1), spans: new Float32Array(0) };
    const nx = i1 - i0 + 1,
      nz = k1 - k0 + 1,
      start = new Uint32Array(nx * nz + 1);
    let total = 0;
    for (const l of merged.values()) total += l.length / 2;
    const spans = new Float32Array(total * 2);
    let at = 0;
    for (let a = 0; a < nx; a++)
      for (let b = 0; b < nz; b++) {
        const idx = a * nz + b;
        start[idx] = at;
        const l = merged.get(key(i0 + a, k0 + b));
        if (l) {
          spans.set(l, at * 2);
          at += l.length / 2;
        }
      }
    start[nx * nz] = at;
    return { cell, i0, k0, nx, nz, start, spans };
  }
}

/**
 * Walk down one column from y = top to y = bottom, adding [bottom, top] of each solid stretch met (top first). In the air
 * the step is what the field says is free (never more than 0.45, never less than 0.02); each crossing is then found to
 * within 0.005 by halving.
 */
function marchColumn(sdf: (x: number, y: number, z: number) => number, x: number, z: number, top: number, bottom: number, out: number[]): void {
  let y = top,
    d = sdf(x, y, z),
    inside = d < ISO,
    spanTop = inside ? y : 0;
  const crossing = (yAbove: number, yBelow: number) => {
    // the field is outside at yAbove when going in (inside when coming out); halve until the gap is small
    const outsideAbove = !inside;
    let a = yAbove,
      b = yBelow;
    while (a - b > 0.005) {
      const m = (a + b) / 2,
        isIn = sdf(x, m, z) < ISO;
      if (isIn === outsideAbove) b = m;
      else a = m;
    }
    return outsideAbove ? b : a;
  };
  while (y > bottom) {
    const step = Math.min(Math.max(Math.abs(d - ISO) * 0.9, 0.02), 0.45),
      ny = Math.max(y - step, bottom);
    const nd = sdf(x, ny, z),
      nIn = nd < ISO;
    if (nIn !== inside) {
      const c = crossing(y, ny);
      if (nIn) spanTop = c;
      else out.push(c, spanTop);
      inside = nIn;
    }
    y = ny;
    d = nd;
    if (ny === bottom) break;
  }
  if (inside) out.push(bottom, spanTop);
}

/** [bottom, top] pairs, merged where they touch or overlap, sorted highest first. */
function mergeSpans(raw: number[]): number[] {
  const p: [number, number][] = [];
  for (let s = 0; s < raw.length; s += 2) p.push([raw[s], raw[s + 1]]);
  p.sort((a, b) => b[1] - a[1]);
  const out: [number, number][] = [];
  for (const s of p) {
    const last = out[out.length - 1];
    if (last && s[1] >= last[0] - ISO) last[0] = Math.min(last[0], s[0]);
    else out.push([s[0], s[1]]);
  }
  return out.flat();
}

/** Take [lo, hi] out of a sorted span list. */
function cut(list: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < list.length; s += 2) {
    const b = list[s],
      t = list[s + 1];
    if (t <= lo || b >= hi) out.push(b, t);
    else {
      if (t > hi) out.push(hi, t);
      if (b < lo) out.push(b, lo);
    }
  }
  return out;
}

/** The queries over a finished map. */
export function makeCollision(data: CollisionData): Collision {
  const { cell, i0, k0, nx, nz, start, spans } = data;
  const col = (i: number, k: number) => {
    const a = i - i0,
      b = k - k0;
    return a < 0 || b < 0 || a >= nx || b >= nz ? -1 : a * nz + b;
  };
  /** the first surface at or below y in column c, down to y - depth; 1e9 inside; -1e9 none */
  const heightCol = (c: number, y: number, depth: number) => {
    if (c < 0) return -BIG;
    for (let s = start[c]; s < start[c + 1]; s++) {
      const b = spans[s * 2],
        t = spans[s * 2 + 1];
      if (t <= y) return t >= y - depth ? t : -BIG;
      if (b < y) return BIG;
    }
    return -BIG;
  };
  const insideCol = (c: number, y: number) => {
    if (c < 0) return false;
    for (let s = start[c]; s < start[c + 1]; s++) if (spans[s * 2] < y && y < spans[s * 2 + 1]) return true;
    return false;
  };
  const near = (x: number, z: number) => col(Math.round(x / cell), Math.round(z / cell));

  const height = (x: number, z: number, y: number, depth = DEPTH) => {
    const h = heightCol(near(x, z), y, depth);
    if (h >= BIG || h <= -BIG) return h;
    // a ramp is smooth: if the four columns round the point all have ground within half a unit of the nearest's, blend
    const fx = x / cell,
      fz = z / cell,
      ia = Math.floor(fx),
      ka = Math.floor(fz),
      tx = fx - ia,
      tz = fz - ka;
    const h00 = heightCol(col(ia, ka), y, depth),
      h10 = heightCol(col(ia + 1, ka), y, depth),
      h01 = heightCol(col(ia, ka + 1), y, depth),
      h11 = heightCol(col(ia + 1, ka + 1), y, depth);
    for (const v of [h00, h10, h01, h11]) if (!(Math.abs(v - h) < 0.5)) return h;
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };

  return {
    data,
    height: (x, z, y) => height(x, z, y),
    ground: (x, z) => heightCol(near(x, z), BIG / 2, BIG),
    blocked(p: Vec3, r: number, h: number) {
      for (const y of [p[1] + 0.3, p[1] + h])
        for (let a = -1; a < 8; a++) {
          const x = a < 0 ? p[0] : p[0] + r * Math.cos((a * Math.PI) / 4),
            z = a < 0 ? p[2] : p[2] + r * Math.sin((a * Math.PI) / 4);
          if (insideCol(near(x, z), y)) return true;
        }
      return false;
    },
    clear(a: Vec3, b: Vec3) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
        n = Math.max(1, Math.ceil(L / (cell / 2)));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        if (insideCol(near(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t), a[1] + (b[1] - a[1]) * t)) return false;
      }
      return true;
    }
  };
}
