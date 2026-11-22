// Routes for enemies (stage 18): where a body can stand, worked out from the level's own collision map, and the
// shortest walk between two places over it (A* on 8 neighbours, no cutting corners), smoothed into a few straight legs.
//
// Why not the toolkit's navigation tiles (src/kit/pu36-navigation-tiles.js): they belong to the toolkit's world runtime
// (its fields, queries and ticks), which the engine does not run. The engine's collision map already says where a
// walker can stand and what blocks it, so a grid over it is all a brain needs. Everything here is deterministic: plain
// arithmetic, ties broken by cell index, no clock, no chance.
import type { Collision } from './types';
import type { Vec3 } from '../../types/ink-studio';

/** A walk: world [x, z] corners, the first the start's cell, the last the goal. */
export type Path = [number, number][];

export interface NavGrid {
  /** grid cell size in world units, the world x and z of cell (0, 0)'s centre, and the grid's size */
  cell: number;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  /** per cell: the floor height there, or NaN where a body cannot stand */
  floor: Float32Array;
  /** the body this grid is for */
  radius: number;
  /** the collision version it was made from (Collision edits bump it: stage 19) */
  version: number;
}

const STEP_UP = 0.45; // a walker climbs steps up to about this (AGENTS.md section 4)
const SQRT2 = Math.SQRT2;

/** The collision version, if the map can change (stage 19); 0 otherwise. */
const versionOf = (c: Collision) => ((c as Collision & { version?: number }).version ?? 0);

/** Build the grid for a body of radius r and height h (cells of `cell`, default 0.5) over the whole collision map. */
export function buildNavGrid(col: Collision, r = 0.3, h = 1.0, cell = 0.5): NavGrid {
  const d = col.data,
    x0 = d.i0 * d.cell,
    z0 = d.k0 * d.cell,
    nx = Math.max(1, Math.floor(((d.nx - 1) * d.cell) / cell) + 1),
    nz = Math.max(1, Math.floor(((d.nz - 1) * d.cell) / cell) + 1),
    floor = new Float32Array(nx * nz).fill(NaN);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell,
        z = z0 + k * cell,
        y = col.ground(x, z);
      if (y < -1e8 || y > 1e8) continue;
      if (col.blocked([x, y + 0.05, z], r, h)) continue;
      floor[k * nx + i] = y;
    }
  return { cell, x0, z0, nx, nz, floor, radius: r, version: versionOf(col) };
}

const grids = new WeakMap<Collision, Map<string, NavGrid>>();

/** The grid for this map and body, made once and made again when the map changes. */
export function navGridFor(col: Collision, r = 0.3, h = 1.0): NavGrid {
  let byBody = grids.get(col);
  if (!byBody) grids.set(col, (byBody = new Map()));
  const key = r.toFixed(3) + ':' + h.toFixed(3);
  let g = byBody.get(key);
  if (!g || g.version !== versionOf(col)) byBody.set(key, (g = buildNavGrid(col, r, h)));
  return g;
}

/** The grid cell nearest a world point that a body can stand in (searching outwards a few cells), or -1. */
export function cellAt(g: NavGrid, x: number, z: number, search = 3): number {
  const ci = Math.round((x - g.x0) / g.cell),
    ck = Math.round((z - g.z0) / g.cell);
  let best = -1,
    bd = Infinity;
  for (let dk = -search; dk <= search; dk++)
    for (let di = -search; di <= search; di++) {
      const i = ci + di,
        k = ck + dk;
      if (i < 0 || k < 0 || i >= g.nx || k >= g.nz) continue;
      const c = k * g.nx + i;
      if (g.floor[c] !== g.floor[c]) continue;
      const dd = di * di + dk * dk;
      if (dd < bd || (dd === bd && c < best)) {
        bd = dd;
        best = c;
      }
    }
  return best;
}

const centre = (g: NavGrid, c: number): [number, number] => [g.x0 + (c % g.nx) * g.cell, g.z0 + Math.floor(c / g.nx) * g.cell];

/** Can a body step from cell a to its neighbour b (both standable, not too steep)? */
function step(g: NavGrid, a: number, b: number): boolean {
  const fb = g.floor[b];
  return fb === fb && Math.abs(fb - g.floor[a]) <= STEP_UP;
}

/**
 * The shortest walk from `from` to `to` (world points), or null if there is none within `maxVisits` cells looked at.
 * Diagonal moves need both side cells free, so a body never cuts a wall's corner.
 */
export function findPath(g: NavGrid, from: Vec3 | [number, number], to: Vec3 | [number, number], maxVisits = 6000): Path | null {
  const fx = from[0],
    fz = from.length === 3 ? (from as Vec3)[2] : from[1],
    tx = to[0],
    tz = to.length === 3 ? (to as Vec3)[2] : to[1];
  const s = cellAt(g, fx, fz),
    t = cellAt(g, tx, tz);
  if (s < 0 || t < 0) return null;
  if (s === t) return [[tx, tz]];
  const N = g.nx * g.nz,
    gs = new Float64Array(N).fill(Infinity),
    came = new Int32Array(N).fill(-1),
    closed = new Uint8Array(N);
  const ti = t % g.nx,
    tk = Math.floor(t / g.nx);
  const hOf = (c: number) => {
    const dx = Math.abs((c % g.nx) - ti),
      dz = Math.abs(Math.floor(c / g.nx) - tk);
    return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * g.cell;
  };
  // a binary heap of (f, cell), ties broken by cell index: the same order on every engine
  const hf: number[] = [],
    hc: number[] = [];
  const less = (a: number, b: number) => hf[a] < hf[b] || (hf[a] === hf[b] && hc[a] < hc[b]);
  const swap = (a: number, b: number) => {
    const f = hf[a],
      c = hc[a];
    hf[a] = hf[b];
    hc[a] = hc[b];
    hf[b] = f;
    hc[b] = c;
  };
  const push = (f: number, c: number) => {
    hf.push(f);
    hc.push(c);
    for (let i = hf.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      swap(i, p);
      i = p;
    }
  };
  const pop = (): number => {
    const top = hc[0],
      lf = hf.pop()!,
      lc = hc.pop()!;
    if (hf.length) {
      hf[0] = lf;
      hc[0] = lc;
      for (let i = 0; ; ) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < hf.length && less(l, m)) m = l;
        if (r < hf.length && less(r, m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    return top;
  };
  gs[s] = 0;
  push(hOf(s), s);
  let visits = 0;
  while (hf.length) {
    const c = pop();
    if (closed[c]) continue;
    if (c === t) break;
    closed[c] = 1;
    if (++visits > maxVisits) return null;
    const ci = c % g.nx,
      ck = Math.floor(c / g.nx);
    for (let dk = -1; dk <= 1; dk++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dk) continue;
        const i = ci + di,
          k = ck + dk;
        if (i < 0 || k < 0 || i >= g.nx || k >= g.nz) continue;
        const n = k * g.nx + i;
        if (closed[n] || !step(g, c, n)) continue;
        if (di && dk && !(step(g, c, ck * g.nx + i) && step(g, c, k * g.nx + ci))) continue;
        const ng = gs[c] + (di && dk ? SQRT2 : 1) * g.cell;
        if (ng < gs[n]) {
          gs[n] = ng;
          came[n] = c;
          push(ng + hOf(n), n);
        }
      }
  }
  if (came[t] < 0) return null;
  const cells: number[] = [];
  for (let c = t; c !== s; c = came[c]) cells.push(c);
  cells.push(s);
  cells.reverse();
  return smooth(g, cells, [tx, tz]);
}

/** Can a body walk the straight line between two cell centres (every cell under it standable, no steep steps)? */
function walkable(g: NavGrid, a: number, b: number): boolean {
  const [ax, az] = centre(g, a),
    [bx, bz] = centre(g, b),
    n = Math.ceil((Math.hypot(bx - ax, bz - az) / g.cell) * 2);
  let prev = a;
  for (let s = 1; s <= n; s++) {
    const x = ax + ((bx - ax) * s) / n,
      z = az + ((bz - az) * s) / n;
    // the cells either side of the line too, for the body's width
    for (const [ox, oz] of [[0, 0], [g.cell * 0.45, 0], [-g.cell * 0.45, 0], [0, g.cell * 0.45], [0, -g.cell * 0.45]]) {
      const i = Math.round((x + ox - g.x0) / g.cell),
        k = Math.round((z + oz - g.z0) / g.cell);
      if (i < 0 || k < 0 || i >= g.nx || k >= g.nz) return false;
      const c = k * g.nx + i;
      if (!step(g, prev, c)) return false;
    }
    const c = Math.round((z - g.z0) / g.cell) * g.nx + Math.round((x - g.x0) / g.cell);
    prev = c;
  }
  return true;
}

/** A cell path made into a few straight legs (string pulling), ending exactly at the goal. */
function smooth(g: NavGrid, cells: number[], goal: [number, number]): Path {
  const out: Path = [];
  let a = 0;
  while (a < cells.length - 1) {
    let b = cells.length - 1;
    while (b > a + 1 && !walkable(g, cells[a], cells[b])) b--;
    out.push(centre(g, cells[b]));
    a = b;
  }
  if (out.length) out[out.length - 1] = goal;
  else out.push(goal);
  return out;
}
