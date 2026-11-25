// A body that follows (stages 29, 30 and 33): a serpent's length, a worm's segments, a tail; fins along a serpent, an
// octopus's arms. The actor itself stays an ordinary K.character (it walks, fights, has health; its sculpt is the head),
// and with it go chains of joints on Ink's XPBD solver (K.xpbd.sim, set up exactly as K.proceduralBody sets it up, the
// joints lying on the level's ground), each drawn as one thick curve of the kit's curve splats (K.curveSplats.bind),
// posed from the joints every step.
//
// A chain grows from the actor (pulled to a point of it that turns with its facing) or from a joint of another chain
// (a branch: it shares that joint, and is held at its angle there). All the chains of one actor are one solver, so a
// branch pulls on what it grows from. A chain's tip can sway: pulled softly toward a point swinging side to side, as the
// fins of the kit's procedural-body example are. `tail` is a body of one chain, growing behind the actor.
//
// The solver is held here rather than through K.proceduralBody so that a save can read its motion and put it back
// (stage 32): K.proceduralBody keeps its solver to itself.
//
// Thin strands (grass, hair, a rope) were measured first and dropped: at a game's art-pixel size (about 0.15 units) a
// blade is under a pixel wide, so a field of them turns to a flat carpet and a rope vanishes. A thick body is what reads.
// The chains are solid to other actors (unless they say not): they are pushed off their joints, so the player has to go
// round a serpent's coils.
import type { Builder, Kit, Vec3, World } from '../../types/ink-studio';
import type { BodyOptions, ChainOptions, Collision, TailOptions } from './types';

/** a chain's options, filled in */
export interface Chain0 {
  name: string;
  joints: number;
  length: number;
  width: number[];
  lift: number;
  color: string;
  pigment: [number, string][] | null;
  solid: boolean;
  /** the actor, or another chain's name and joint (a negative joint counts from its tip) */
  from: { actor: true; offset: Vec3 } | { chain: string; joint: number };
  /** degrees: which way it lies, turned from the way its root faces */
  dir: number;
  sway: { swing: number; rate: number; phase: number; stiffness: number } | null;
}

const DEG = Math.PI / 180;
/** cos and sin of whole degrees, exact at the quarter turns (so a tail lying straight behind is -cos, -sin of the facing) */
const cosd = (d: number) => (d % 360 === 0 ? 1 : (d - 180) % 360 === 0 ? -1 : (d - 90) % 180 === 0 ? 0 : Math.cos(d * DEG));
const sind = (d: number) => (d % 180 === 0 ? 0 : (d - 90) % 360 === 0 ? 1 : (d + 90) % 360 === 0 ? -1 : Math.sin(d * DEG));

export function tailOptions(o: TailOptions): Omit<Chain0, 'name' | 'from' | 'dir' | 'sway'> {
  const joints = Math.max(3, Math.min(24, Math.round(o.joints ?? 9)));
  const length = o.length ?? 2.4;
  const w = o.width ?? 0.36;
  // a number tapers from it at the neck to a fifth of it at the tip; a list is one width a joint
  const width = Array.isArray(w)
    ? Array.from({ length: joints }, (_, i) => w[Math.min(w.length - 1, Math.round((i / (joints - 1)) * (w.length - 1)))])
    : Array.from({ length: joints }, (_, i) => w * (1 - 0.8 * Math.pow(i / (joints - 1), 1.4)));
  return {
    joints,
    length,
    width,
    lift: o.lift ?? 0.3,
    color: o.color ?? '#5fc08a',
    pigment: o.pigment ? o.pigment.map(([t, c]) => [t, c] as [number, string]) : null,
    solid: o.solid ?? true
  };
}

/** 'spine.3' (or 'spine.-1', its tip) as a chain and a joint; 'spine' alone is its tip */
export function parseFrom(from: string): { chain: string; joint: number } {
  const m = /^(.+?)(?:\.(-?\d+))?$/.exec(from)!;
  return { chain: m[1], joint: m[2] === undefined ? -1 : +m[2] };
}

/** A body's chains, filled in and in the order they can be built (a branch after what it grows from). Throws, saying why. */
export function bodyChains(o: { tail?: TailOptions; body?: BodyOptions }): Chain0[] {
  const raw: [string, ChainOptions][] = o.body ? Object.entries(o.body.chains || {}) : o.tail ? [['tail', { ...o.tail }]] : [];
  if (!raw.length) throw new Error('a body with no chains');
  const out: Chain0[] = [],
    done = new Set<string>(),
    left = new Map(raw);
  while (left.size) {
    let moved = false;
    for (const [name, c] of [...left]) {
      const f = c.from === undefined || c.from === 'actor' ? null : parseFrom(c.from);
      if (f && !done.has(f.chain)) {
        if (!left.has(f.chain)) throw new Error(`chain ${name} grows from "${c.from}": no chain "${f.chain}"`);
        continue;
      }
      const base = tailOptions(c);
      let from: Chain0['from'];
      if (f) {
        const parent = out.find(p => p.name === f.chain)!,
          joint = f.joint < 0 ? parent.joints + f.joint : f.joint;
        if (!(joint >= 0 && joint < parent.joints)) throw new Error(`chain ${name} grows from joint ${f.joint} of ${f.chain}, which has ${parent.joints}`);
        from = { chain: f.chain, joint };
      } else {
        const off = c.offset;
        from = { actor: true, offset: off ? [off[0], off[1], off[2]] : [0, base.lift, 0] };
      }
      const s = c.sway;
      out.push({
        ...base,
        name,
        from,
        dir: c.dir ?? (f ? 90 : 180),
        sway: s ? { swing: (s.swing ?? 30) * DEG, rate: s.rate ?? 1, phase: s.phase ?? 0, stiffness: s.stiffness ?? 0.004 } : null
      });
      done.add(name);
      left.delete(name);
      moved = true;
    }
    if (!moved) throw new Error(`chains growing from each other in a ring: ${[...left.keys()].join(', ')}`);
  }
  return out;
}

/** the chain's clock, as K.proceduralBody's default */
const HZ = 120;

/** A body's motion in a save (stage 32): every joint's place and velocity, and where the chain's clock is. */
export interface TailMotion {
  positions: number[];
  velocities: number[];
  ticks: number;
  seconds: number;
}

/** one chain as built: its points in the solver (a branch's first is its parent's joint) and its curve */
interface Built {
  c: Chain0;
  /** solver indices along the curve, root to tip */
  idx: number[];
  /** the solver indices this chain owns (a branch does not own its root) */
  own: number[];
  binding: any;
  points: Vec3[];
}

/** One actor's body: its splats set aside at build time, its chains made each time the actor is spawned. */
export class Tail {
  readonly chains: Chain0[];
  /** its splats: all its curves, one range */
  at = 0;
  total = 0;
  private built: Built[];
  /** the solver: the kit's XPBD, set up as K.proceduralBody sets it up, but held here so a save can read its motion */
  private body: any = null;
  /** the solver's own clock (K.proceduralBody's): whole 1/HZ ticks run so far, and the seconds given to it */
  private ticks = 0;
  private seconds = 0;
  /** where the actor is and faces (the roots growing from it are pulled to points of it) */
  private actorAt: Vec3 = [0, 0, 0];
  private face = 0;
  /** every point's radius, by solver index */
  private radii: number[] = [];

  constructor(
    private K: Kit,
    B: Builder,
    o: { tail?: TailOptions; body?: BodyOptions },
    private collision: () => Collision
  ) {
    this.chains = bodyChains(o);
    this.at = B.count();
    this.built = this.chains.map(c => {
      const gap = c.length / (c.joints - 1);
      // the curve is made at rest along -x from the origin; every pose moves all of it, so where it rests does not matter
      const rest: Vec3[] = Array.from({ length: c.joints }, (_, i) => [-i * gap, c.lift, 0]);
      const b: Built = { c, idx: [], own: [], binding: null, points: rest.map(p => [p[0], p[1], p[2]]) };
      b.binding = (K as any).curveSplats.bind(
        B,
        { kind: 'path', id: c.name, points: rest },
        () => ({ points: b.points.map(p => [p[0], p[1], p[2]]) }),
        {
          width: { samples: c.width },
          color: c.color,
          edge: 'hard',
          caps: 'blunt',
          ...(c.pigment && { along: { pigment: { keys: c.pigment } } })
        }
      );
      return b;
    });
    this.total = B.count() - this.at;
  }

  /** the first chain's joints after the last step (the one a `tail` is) */
  get points(): Vec3[] {
    return this.built[0].points;
  }

  /** a chain's joints after the last step, root to tip */
  chainPoints(name: string): Vec3[] | undefined {
    return this.built.find(b => b.c.name === name)?.points;
  }

  /** where a root growing from the actor is pulled to: its offset [ahead, up, left], turned with the actor's facing */
  private anchorOf(off: Vec3): Vec3 {
    const c = Math.cos(this.face),
      s = Math.sin(this.face),
      p = this.actorAt;
    // ahead is (cos, sin); left is the heading turned a quarter the way face grows: (-sin, cos)
    return [p[0] + c * off[0] - s * off[2], p[1] + off[1], p[2] + s * off[0] + c * off[2]];
  }

  /** the heading (radians) a chain's root faces: the actor's, or along its parent toward the head at that joint */
  private rootHeading(b: Built, X: ArrayLike<number>): number {
    const f = b.c.from;
    if ('actor' in f) return this.face;
    const parent = this.built.find(p => p.c.name === f.chain)!,
      k = f.joint,
      a = parent.idx[k],
      n = k > 0 ? parent.idx[k - 1] : parent.idx[1],
      sgn = k > 0 ? 1 : -1;
    return Math.atan2((X[n * 3 + 2] - X[a * 3 + 2]) * sgn, (X[n * 3] - X[a * 3]) * sgn);
  }

  /** fresh chains lying around the actor at p, facing `face` (radians, as K.character's st.face: facing (cos, sin) in x, z) */
  spawn(p: Vec3, face: number): void {
    const K = this.K as any,
      col = this.collision();
    this.actorAt = [p[0], p[1], p[2]];
    this.face = face;
    // the ground as a signed distance: what the joints lie on
    const field = K.xpbd.contactField(
      (x: number, y: number, z: number) => {
        const g = col.height(x, z, y + 0.4);
        if (g > 1e8) return -0.2;
        if (g < -1e8) return 1;
        return y - g;
      },
      { friction: 0.9, tolerance: 0.02, fallback: [0, 1, 0] }
    );
    const sim = K.xpbd.sim({ gravity: [0, -6, 0], damp: 4, substeps: 6, project: field.project, fixedStep: true, substepPins: true });
    const X = () => sim.X as ArrayLike<number>;
    const radius = (c: Chain0, i: number) => Math.max(0.06, c.width[i] / 2);
    this.radii = [];
    // 1. the points, chain after chain (a branch after what it grows from)
    for (const b of this.built) {
      const c = b.c,
        gap = c.length / (c.joints - 1);
      b.idx = [];
      b.own = [];
      let root: Vec3;
      if ('actor' in c.from) root = this.anchorOf(c.from.offset);
      else {
        const pi = this.built.find(q => q.c.name === (c.from as { chain: string }).chain)!.idx[c.from.joint];
        root = [X()[pi * 3], X()[pi * 3 + 1], X()[pi * 3 + 2]];
        b.idx.push(pi);
      }
      const h = this.rootHeading(b, X()),
        hc = Math.cos(h),
        hs = Math.sin(h),
        dc = cosd(c.dir),
        ds = sind(c.dir),
        hx = hc * dc - hs * ds,
        hz = hs * dc + hc * ds,
        // the height the ground is looked for from, and the one used where there is none: the actor's feet, or the root
        foot = 'actor' in c.from ? this.actorAt[1] : root[1];
      for (let i = b.idx.length; i < c.joints; i++) {
        const x = root[0] + hx * gap * i,
          z = root[2] + hz * gap * i,
          g = col.height(x, z, foot + 0.5),
          y = (g > -1e8 && g < 1e8 ? g : foot) + radius(c, i),
          at: Vec3 = i ? [x, y, z] : [root[0], root[1], root[2]];
        const k = sim.point(at, 1 / (i ? 0.8 : 1.5), radius(c, i));
        this.radii[k] = radius(c, i);
        b.idx.push(k);
        b.own.push(k);
      }
    }
    // 2. the roots growing from the actor are pulled to it
    for (const b of this.built) {
      const f = b.c.from;
      if ('actor' in f) {
        const off = f.offset;
        sim.tie(b.idx[0], () => this.anchorOf(off), 0.00002);
      }
    }
    // 3. each joint to the next
    for (const b of this.built) for (let i = 1; i < b.idx.length; i++) sim.link(b.idx[i - 1], b.idx[i], 0);
    // 4. keep it a body, not a rope: each joint holds its two neighbours a little apart; a branch is held at its angle
    for (const b of this.built) {
      for (let i = 2; i < b.idx.length; i++) sim.link(b.idx[i - 2], b.idx[i], 0.004);
      const f = b.c.from;
      if (!('actor' in f)) {
        const parent = this.built.find(p => p.c.name === f.chain)!;
        for (const k of [f.joint - 1, f.joint + 1]) if (k >= 0 && k < parent.idx.length) sim.link(parent.idx[k], b.idx[1], 0.004);
      }
    }
    // 5. swaying tips: pulled softly toward a point swinging about the way the chain lies
    for (const b of this.built) {
      const s = b.c.sway;
      if (!s) continue;
      const c = b.c,
        tip = b.idx[b.idx.length - 1],
        r = b.idx[0];
      sim.tie(
        tip,
        (time: number) => {
          const x = X(),
            h = this.rootHeading(b, x) + c.dir * DEG + s.swing * Math.sin(2 * Math.PI * (s.rate * time + s.phase));
          return [x[r * 3] + Math.cos(h) * c.length, x[r * 3 + 1], x[r * 3 + 2] + Math.sin(h) * c.length];
        },
        s.stiffness
      );
    }
    this.body = sim;
    this.ticks = this.seconds = 0;
    this.read();
  }

  /** one step: the roots go where the actor is, the chains follow, the curves are posed from them */
  step(dt: number, p: Vec3, world: World, face = this.face): void {
    if (!this.body) return;
    this.actorAt = [p[0], p[1], p[2]];
    this.face = face;
    // whole ticks of the solver's own clock (as K.proceduralBody steps it)
    const elapsed = this.seconds + dt,
      next = Math.floor(elapsed * HZ + 1e-8);
    for (let tick = this.ticks + 1; tick <= next; tick++) this.body.step(1 / HZ, tick / HZ);
    this.ticks = next;
    this.seconds = elapsed;
    this.read();
    this.pose(world);
  }

  /** where the chains are and how they move (for a save, stage 32), or null when the body is not on stage */
  motion(): TailMotion | null {
    if (!this.body) return null;
    const m = this.body.motion();
    return { positions: m.positions, velocities: m.velocities, ticks: this.ticks, seconds: this.seconds };
  }

  /** put the chains back as a save had them, and pose the curves there (the actor must have been spawned already) */
  restore(m: TailMotion, world: World): void {
    if (!this.body) return;
    const n = this.body.n * 3;
    if (!(m && Array.isArray(m.positions) && m.positions.length === n && Array.isArray(m.velocities) && m.velocities.length === n))
      throw new Error(`a saved body of ${m?.positions?.length / 3} joints, not ${n / 3}`);
    this.body.restoreMotion({ positions: m.positions, velocities: m.velocities, broken: this.body.motion().broken });
    this.ticks = m.ticks;
    this.seconds = m.seconds;
    this.read();
    this.pose(world);
  }

  /** write the curves' splats where the chains are */
  pose(world: World): void {
    const rows = world.anim && (world.anim as any).rows;
    for (const b of this.built) b.binding.pose(world, { rows });
    if (rows) for (let r = this.at >> 9, e = (this.at + this.total - 1) >> 9; r <= e; r++) rows[r] = 1;
  }

  private read() {
    const X = this.body.X as ArrayLike<number>;
    for (const b of this.built) b.points = b.idx.map(i => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]] as Vec3);
  }

  /** gone with its actor: the splats go to y = -99, as a hidden character's do */
  hide(world: World): void {
    this.body = null;
    const D = world.data,
      rows = world.anim && (world.anim as any).rows;
    for (let i = this.at; i < this.at + this.total; i++) D[i * 16 + 1] = -99;
    if (rows) for (let r = this.at >> 9, e = (this.at + this.total - 1) >> 9; r <= e; r++) rows[r] = 1;
  }

  get live(): boolean {
    return !!this.body;
  }

  /**
   * Push a body of radius r standing at p off the solid chains (not off a root pulled to the actor: that is the actor
   * itself). Returns where it should go, or null if it touches nothing.
   */
  pushOut(p: Vec3, r: number): [number, number] | null {
    if (!this.body) return null;
    let x = p[0],
      z = p[2],
      moved = false;
    for (const b of this.built) {
      if (!b.c.solid) continue;
      for (let i = 1; i < b.idx.length; i++) {
        const q = b.points[i];
        if (Math.abs(q[1] - p[1]) > 1.2) continue;
        const min = r + this.radii[b.idx[i]],
          dx = x - q[0],
          dz = z - q[2],
          d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const ux = d > 1e-6 ? dx / d : 1,
          uz = d > 1e-6 ? dz / d : 0;
        x = q[0] + ux * min;
        z = q[2] + uz * min;
        moved = true;
      }
    }
    return moved ? [x, z] : null;
  }
}
