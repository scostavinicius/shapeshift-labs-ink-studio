// Legs (stage 34): a creature that walks on 2 to 8 feet, a spider, a crab, a warden on stilts. The actor itself stays an
// ordinary K.character (it moves, collides, fights; its sculpt is the trunk). Its feet are the kit's K.gait: each foot
// has a home under the body, and when the body has carried a home too far from where the foot stands, the foot steps up,
// over and down to where its home will be, landing on the level's ground. A planted foot does not move. Each leg is one
// thick curve of the kit's curve splats (hip, knee, foot), its knee from K.ik2, bending up and out.
//
// Two feet of one group never lift together, and a new step starts only with every foot down; neighbours along a side
// share a group, so up to half the feet step at once, as a tripod does, and a fast creature keeps up. The kit's motion
// matching (`matching: true`: one foot in the air at a time, its landing chosen from an index of poses for the speed and
// heading asked) is there too; measured on the arena's eight-legged warden, its one foot at a time took half the steps
// and left legs reaching 2.3 short of their feet (0.97 with groups), so it is not the default.
import type { Builder, Kit, Vec3, World } from '../../types/ink-studio';
import type { Collision, LegsOptions } from './types';

/** the options filled in */
export interface Legs0 {
  /** each foot's home, [ahead, left] in the actor's frame */
  feet: [number, number][];
  groups: number[];
  /** each hip, [ahead, up, left] in the actor's frame */
  hips: Vec3[];
  /** thigh and shin, each leg */
  bones: [number, number][];
  width: number[];
  color: string;
  pigment: [number, string][] | null;
  reach: number;
  time: number;
  lift: number;
  lead: number;
  matching: boolean;
}

export function legsOptions(o: LegsOptions): Legs0 {
  const feet = (o.feet || []).map(f => [f[0], f[1]] as [number, number]);
  if (feet.length < 2 || feet.length > 8) throw new Error(`legs need 2 to 8 feet, not ${feet.length}`);
  const hipY = o.hip ?? 0.6,
    spread = o.spread ?? 0.35;
  const hips = feet.map(([a, l]) => [a * spread, hipY, l * spread] as Vec3);
  // the legs are long enough to stay bent at rest and to reach a foot a stride away: thigh and shin together are half again hip to home
  const bones = feet.map(([a, l], i) => {
    const h = hips[i],
      d = Math.hypot(a - h[0], hipY, l - h[2]),
      sum = d * (o.stretch ?? 1.5);
    return [sum * 0.55, sum * 0.45] as [number, number];
  });
  // K.gait's groups: two feet of one group are never in the air together. Neighbours along a side share one (front to
  // back, in pairs), so a step lifts up to one foot of each pair: half the feet at once, as a tripod does
  const groups =
    o.groups ||
    feet.map(([a, l], i) => {
      const side = l >= 0 ? 0 : 1,
        rank = feet.filter(([a2, l2], j) => (l2 >= 0 ? 0 : 1) === side && (a2 > a || (a2 === a && j < i))).length;
      return side * 8 + Math.floor(rank / 2);
    });
  const w = o.width ?? 0.2;
  return {
    feet,
    groups,
    hips,
    bones,
    width: Array.isArray(w) ? w.slice(0, 3) : [w, w * 0.8, w * 0.5],
    color: o.color ?? '#3a3550',
    pigment: o.pigment ? o.pigment.map(([t, c]) => [t, c] as [number, string]) : null,
    reach: o.reach ?? 0.4,
    time: o.time ?? 0.2,
    lift: o.lift ?? 0.3,
    lead: o.lead ?? 0.5,
    matching: !!o.matching
  };
}

/** A foot in a save: where it stands, and its step if it is in the air (the basic gait; plain data). */
export interface FootState {
  p: Vec3;
  from: Vec3 | null;
  to: Vec3 | null;
  u: number;
  lift: number;
}

/** One actor's legs: their splats set aside at build time, their gait made each time the actor is spawned. */
export class Legs {
  readonly o: Legs0;
  at = 0;
  total = 0;
  private bindings: any[] = [];
  private gait: any = null;
  /** where the actor is and faces */
  private actorAt: Vec3 = [0, 0, 0];
  private face = 0;
  /** each leg's hip, knee and foot after the last step */
  legs: Vec3[][] = [];

  constructor(
    private K: Kit,
    B: Builder,
    o: LegsOptions,
    private collision: () => Collision
  ) {
    this.o = legsOptions(o);
    this.at = B.count();
    this.legs = this.o.feet.map(() => [
      [0, 0.6, 0],
      [0.3, 0.8, 0],
      [0.6, 0, 0]
    ]);
    this.bindings = this.o.feet.map((_, i) =>
      (K as any).curveSplats.bind(
        B,
        { kind: 'path', id: 'leg' + i, points: this.legs[i] },
        () => ({ points: this.legs[i].map(p => [p[0], p[1], p[2]]) }),
        {
          width: { samples: this.o.width },
          color: this.o.color,
          edge: 'hard',
          caps: 'blunt',
          ...(this.o.pigment && { along: { pigment: { keys: this.o.pigment } } })
        }
      )
    );
    this.total = B.count() - this.at;
  }

  /** the gait's yaw for a K.character facing: the gait's forward is (sin yaw, cos yaw), the character's (cos face, sin face) */
  private yaw() {
    return Math.PI / 2 - this.face;
  }

  /** a point of the actor's frame, [ahead, up, left], in the world */
  private local(q: Vec3): Vec3 {
    const c = Math.cos(this.face),
      s = Math.sin(this.face),
      p = this.actorAt;
    return [p[0] + c * q[0] - s * q[2], p[1] + q[1], p[2] + s * q[0] + c * q[2]];
  }

  private ground(x: number, z: number): number {
    const g = this.collision().height(x, z, this.actorAt[1] + 0.5);
    return g > -1e8 && g < 1e8 ? g : this.actorAt[1];
  }

  /** feet fresh under the actor at p, facing `face` */
  spawn(p: Vec3, face: number): void {
    const K = this.K as any,
      o = this.o;
    this.actorAt = [p[0], p[1], p[2]];
    this.face = face;
    // the kit's home is [x, z] with z ahead and x to the right
    const feet = o.feet.map(([a, l], i) => ({ home: [-l, a], group: o.groups[i] }));
    const def = { feet, reach: o.reach, time: o.time, lift: o.lift, lead: o.lead, ground: (x: number, z: number) => this.ground(x, z) };
    this.gait = K.gait(o.matching ? { ...def, motionMatching: true } : def);
    this.gait.update(0, this.body([0, 0]));
    this.solve();
  }

  private body(v: [number, number]) {
    return { p: this.actorAt.slice(), yaw: this.yaw(), v };
  }

  /** one step: the feet decide whether to step, the legs reach for them, the curves are posed */
  step(dt: number, p: Vec3, face: number, v: [number, number], world: World): void {
    if (!this.gait) return;
    this.actorAt = [p[0], p[1], p[2]];
    this.face = face;
    this.gait.update(dt, this.body(v));
    this.solve();
    this.pose(world);
  }

  /** each leg: hip on the actor, foot where the gait put it, knee bent up and out */
  private solve() {
    const K = this.K as any,
      feet = this.gait.feet;
    this.legs = this.o.hips.map((h, i) => {
      const hip = this.local(h),
        foot = feet[i].p as Vec3,
        out = [foot[0] - hip[0], 0, foot[2] - hip[2]],
        n = Math.hypot(out[0], out[2]) || 1,
        pole = [(out[0] / n) * 0.6, 1, (out[2] / n) * 0.6];
      const { mid, tip } = K.ik2(hip, foot, this.o.bones[i][0], this.o.bones[i][1], pole);
      return [hip, mid as Vec3, tip as Vec3];
    });
  }

  /** the feet, where they are (planted or in the air) */
  get feet(): { p: Vec3; u: number; lift: number }[] {
    return this.gait ? this.gait.feet.map((f: any) => ({ p: f.p.slice(), u: f.u, lift: f.lift })) : [];
  }

  /** how many steps the feet have taken */
  get steps(): number {
    return this.gait ? this.gait.steps : 0;
  }

  /** the feet for a save */
  state(): FootState[] | null {
    if (!this.gait) return null;
    return this.gait.feet.map((f: any) => ({
      p: f.p.slice(),
      from: f.from ? f.from.slice() : null,
      to: f.to ? f.to.slice() : null,
      u: f.u,
      lift: f.lift
    }));
  }

  /** put the feet back as a save had them (motion matching keeps its step to itself: its feet come back planted) */
  restore(s: FootState[], world: World, p: Vec3, face: number): void {
    if (!this.gait || !Array.isArray(s) || s.length !== this.gait.feet.length) return;
    // the hips go where the actor came back to
    this.actorAt = [p[0], p[1], p[2]];
    this.face = face;
    s.forEach((x, i) => {
      const f = this.gait.feet[i];
      if (this.o.matching) {
        f.p = (x.u < 1 && x.to ? x.to : x.p).slice();
        return;
      }
      f.p = x.p.slice();
      f.from = x.from && x.from.slice();
      f.to = x.to && x.to.slice();
      f.u = x.u;
      f.lift = x.lift;
    });
    this.solve();
    this.pose(world);
  }

  pose(world: World): void {
    const rows = world.anim && (world.anim as any).rows;
    for (const b of this.bindings) b.pose(world, { rows });
    if (rows) for (let r = this.at >> 9, e = (this.at + this.total - 1) >> 9; r <= e; r++) rows[r] = 1;
  }

  hide(world: World): void {
    this.gait = null;
    const D = world.data,
      rows = world.anim && (world.anim as any).rows;
    for (let i = this.at; i < this.at + this.total; i++) D[i * 16 + 1] = -99;
    if (rows) for (let r = this.at >> 9, e = (this.at + this.total - 1) >> 9; r <= e; r++) rows[r] = 1;
  }

  get live(): boolean {
    return !!this.gait;
  }
}
