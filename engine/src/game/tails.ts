// A body that follows (stages 29 and 30): a serpent's length, a worm's segments, a tail. The actor itself stays an
// ordinary K.character (it walks, fights, has health; its sculpt is the head), and behind it trails a chain of joints
// on Ink's XPBD solver (K.xpbd.sim, set up exactly as K.proceduralBody sets it up, the joints lying on the level's
// ground), drawn as one thick curve of the kit's curve splats (K.curveSplats.bind), posed from the joints every step.
// The chain is held here rather than through K.proceduralBody so that a save can read its motion and put it back
// (stage 32): K.proceduralBody keeps its solver to itself.
//
// Thin strands (grass, hair, a rope) were measured first and dropped: at a game's art-pixel size (about 0.15 units) a
// blade is under a pixel wide, so a field of them turns to a flat carpet and a rope vanishes. A thick body is what reads.
// The chain is solid to other actors: they are pushed off its joints, so the player has to go round a serpent's coils.
import type { Builder, Kit, Vec3, World } from '../../types/ink-studio';
import type { Collision, TailOptions } from './types';

/** the options filled in */
interface Tail0 {
  joints: number;
  length: number;
  width: number[];
  lift: number;
  color: string;
  pigment: [number, string][] | null;
  solid: boolean;
}

export function tailOptions(o: TailOptions): Tail0 {
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

const ids = (n: number) => Array.from({ length: n }, (_, i) => 'j' + i);

/** the chain's clock, as K.proceduralBody's default */
const HZ = 120;

/** A body's motion in a save (stage 32): every joint's place and velocity, and where the chain's clock is. */
export interface TailMotion {
  positions: number[];
  velocities: number[];
  ticks: number;
  seconds: number;
}

/** One actor's body: its splats set aside at build time, its chain made each time the actor is spawned. */
export class Tail {
  readonly o: Tail0;
  /** its splats: the curve's whole range */
  at = 0;
  total = 0;
  private binding: any;
  /** the chain: the kit's XPBD solver, set up as K.proceduralBody sets it up, but held here so a save can read its motion */
  private body: any = null;
  /** the chain's own clock (K.proceduralBody's): whole 1/HZ ticks run so far, and the seconds given to it */
  private ticks = 0;
  private seconds = 0;
  /** where the head joint is pulled to: the actor, a little above its feet */
  private anchor: Vec3 = [0, 0, 0];
  private names: string[];
  /** the joints' places after the last step (the sampler and the pushing read it) */
  points: Vec3[] = [];

  constructor(
    private K: Kit,
    B: Builder,
    o: TailOptions,
    private collision: () => Collision
  ) {
    this.o = tailOptions(o);
    this.names = ids(this.o.joints);
    const n = this.o.joints,
      gap = this.o.length / (n - 1);
    // the curve is made at rest along -x from the origin; every pose moves all of it, so where it rests does not matter
    const rest: Vec3[] = Array.from({ length: n }, (_, i) => [-i * gap, this.o.lift, 0]);
    this.points = rest.map(p => [p[0], p[1], p[2]]);
    this.at = B.count();
    this.binding = (K as any).curveSplats.bind(
      B,
      { kind: 'path', id: 'tail', points: rest },
      () => ({ points: this.points.map(p => [p[0], p[1], p[2]]) }),
      {
        width: { samples: this.o.width },
        color: this.o.color,
        edge: 'hard',
        caps: 'blunt',
        ...(this.o.pigment && { along: { pigment: { keys: this.o.pigment } } })
      }
    );
    this.total = B.count() - this.at;
  }

  /** the joints' radii: half the curve's width there, never under a hand's breadth */
  private radius(i: number) {
    return Math.max(0.06, this.o.width[i] / 2);
  }

  /** a fresh chain lying behind the actor at p, facing `face` (radians, as K.character's st.face: facing (cos, sin) in x, z) */
  spawn(p: Vec3, face: number): void {
    const K = this.K as any,
      n = this.o.joints,
      gap = this.o.length / (n - 1),
      bx = -Math.cos(face),
      bz = -Math.sin(face),
      col = this.collision();
    this.anchor = [p[0], p[1] + this.o.lift, p[2]];
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
    for (let i = 0; i < n; i++) {
      const x = p[0] + bx * gap * i,
        z = p[2] + bz * gap * i,
        g = col.height(x, z, p[1] + 0.5),
        y = (g > -1e8 && g < 1e8 ? g : p[1]) + this.radius(i);
      sim.point(i ? [x, y, z] : this.anchor.slice(), 1 / (i ? 0.8 : 1.5), this.radius(i));
    }
    // the head is pulled to the actor
    sim.tie(0, () => this.anchor, 0.00002);
    for (let i = 1; i < n; i++) sim.link(i - 1, i, 0);
    // keep it a body, not a rope: each joint holds its two neighbours a little apart
    for (let i = 2; i < n; i++) sim.link(i - 2, i, 0.004);
    this.body = sim;
    this.ticks = this.seconds = 0;
    this.read();
  }

  /** one step: the head joint goes where the actor is, the chain follows, the curve is posed from it */
  step(dt: number, p: Vec3, world: World): void {
    if (!this.body) return;
    this.anchor = [p[0], p[1] + this.o.lift, p[2]];
    // whole ticks of the chain's own clock (as K.proceduralBody steps it)
    const elapsed = this.seconds + dt,
      next = Math.floor(elapsed * HZ + 1e-8);
    for (let tick = this.ticks + 1; tick <= next; tick++) this.body.step(1 / HZ, tick / HZ);
    this.ticks = next;
    this.seconds = elapsed;
    this.read();
    this.pose(world);
  }

  /** where the chain is and how it moves (for a save, stage 32), or null when it is not on stage */
  motion(): TailMotion | null {
    if (!this.body) return null;
    const m = this.body.motion();
    return { positions: m.positions, velocities: m.velocities, ticks: this.ticks, seconds: this.seconds };
  }

  /** put the chain back as a save had it, and pose the curve there (the actor must have been spawned already) */
  restore(m: TailMotion, world: World): void {
    if (!this.body) return;
    const n = this.o.joints * 3;
    if (!(m && Array.isArray(m.positions) && m.positions.length === n && Array.isArray(m.velocities) && m.velocities.length === n))
      throw new Error(`a saved body of ${m?.positions?.length / 3} joints, not ${this.o.joints}`);
    this.body.restoreMotion({ positions: m.positions, velocities: m.velocities, broken: this.body.motion().broken });
    this.ticks = m.ticks;
    this.seconds = m.seconds;
    this.read();
    this.pose(world);
  }

  /** write the curve's splats where the chain is */
  pose(world: World): void {
    const rows = world.anim && (world.anim as any).rows;
    this.binding.pose(world, { rows });
    if (rows) for (let r = this.at >> 9, e = (this.at + this.total - 1) >> 9; r <= e; r++) rows[r] = 1;
  }

  private read() {
    const X = this.body.X as Float64Array;
    this.points = this.names.map((_, i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]] as Vec3);
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
   * Push a body of radius r standing at p off the chain (not off the head joint: that is the actor itself). Returns
   * where it should go, or null if it touches nothing.
   */
  pushOut(p: Vec3, r: number): [number, number] | null {
    if (!this.body || !this.o.solid) return null;
    let x = p[0],
      z = p[2],
      moved = false;
    for (let i = 1; i < this.points.length; i++) {
      const q = this.points[i];
      if (Math.abs(q[1] - p[1]) > 1.2) continue;
      const min = r + this.radius(i),
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
    return moved ? [x, z] : null;
  }
}
