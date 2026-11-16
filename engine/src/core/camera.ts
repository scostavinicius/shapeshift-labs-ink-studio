// The game camera: an orbit (yaw, pitch, distance) about a point it follows on a spring. Turning is immediate (the
// player's hand is on it); the followed point and the zoom are eased, so the view glides after a moving target instead
// of being nailed to it. Updated once a fixed step, like the rest of the game, so it moves the same at any frame rate.
// view() gives the options makeView() takes.
import type { Vec3, World } from '../../types/ink-studio';
import type { LookInput } from './input';

export interface CameraOptions {
  target?: Vec3;
  yaw?: number;
  pitch?: number;
  dist?: number;
  /** how quickly it catches up with what it follows, per second: about 4 / this is the time to settle (default 6) */
  stiffness?: number;
  /** the same for the zoom (default 12) */
  zoomStiffness?: number;
  minPitch?: number;
  maxPitch?: number;
  minDist?: number;
  maxDist?: number;
  /** the followed point is kept inside this box */
  bounds?: { min: Vec3; max: Vec3 };
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/**
 * One step of a critically damped spring (the fastest that never overshoots), exact for any dt: x moves toward goal
 * with velocity v, at rate w. Returns the new [x, v].
 */
export function springStep(x: number, v: number, goal: number, w: number, dt: number): [number, number] {
  const d = x - goal,
    k = (v + w * d) * dt,
    e = Math.exp(-w * dt);
  return [goal + (d + k) * e, (v - w * k) * e];
}

export class FollowCamera {
  yaw: number;
  pitch: number;
  /** the distance now, and the one it eases toward */
  dist: number;
  goalDist: number;
  /** where it looks now, how fast that is moving, and the point it is following */
  target: Vec3;
  vel: Vec3 = [0, 0, 0];
  goal: Vec3;
  private distVel = 0;
  stiffness: number;
  zoomStiffness: number;
  minPitch: number;
  maxPitch: number;
  minDist: number;
  maxDist: number;
  bounds: { min: Vec3; max: Vec3 } | null;

  constructor(o: CameraOptions = {}) {
    this.target = [...(o.target || [0, 0, 0])] as Vec3;
    this.goal = [...this.target] as Vec3;
    this.yaw = o.yaw ?? 0;
    this.minPitch = o.minPitch ?? -1.2;
    this.maxPitch = o.maxPitch ?? 1.4;
    this.pitch = clamp(o.pitch ?? 0.5, this.minPitch, this.maxPitch);
    this.minDist = o.minDist ?? 1;
    this.maxDist = o.maxDist ?? 1000;
    this.dist = this.goalDist = clamp(o.dist ?? 10, this.minDist, this.maxDist);
    this.stiffness = o.stiffness ?? 6;
    this.zoomStiffness = o.zoomStiffness ?? 12;
    this.bounds = o.bounds || null;
  }

  /** A camera starting where the world's own camera is, zooming from 0.4x to 6x of its distance. */
  static fromWorld(world: World, o: CameraOptions = {}): FollowCamera {
    const c = world.cam;
    return new FollowCamera({
      target: c.target,
      yaw: c.yaw,
      pitch: c.pitch,
      dist: c.dist,
      minDist: c.dist / 6,
      maxDist: c.dist / 0.4,
      ...o
    });
  }

  /** Follow this point (call every step with where the thing it follows is now). */
  follow(p: Vec3): void {
    const g = this.goal;
    g[0] = p[0];
    g[1] = p[1];
    g[2] = p[2];
    if (this.bounds) for (let k = 0; k < 3; k++) g[k] = clamp(g[k], this.bounds.min[k], this.bounds.max[k]);
  }

  /** Jump straight to the followed point and zoom, with no easing (a cut, a respawn). */
  snap(): void {
    this.target = [...this.goal] as Vec3;
    this.vel = [0, 0, 0];
    this.dist = this.goalDist;
    this.distVel = 0;
  }

  /** The player turning and zooming: turns are applied at once, a zoom sets where the distance eases to. */
  look(l: LookInput): void {
    this.yaw += l.yaw;
    this.pitch = clamp(this.pitch + l.pitch, this.minPitch, this.maxPitch);
    if (l.zoom !== 1 && l.zoom > 0) this.goalDist = clamp(this.goalDist / l.zoom, this.minDist, this.maxDist);
  }

  update(dt: number): void {
    for (let k = 0; k < 3; k++) [this.target[k], this.vel[k]] = springStep(this.target[k], this.vel[k], this.goal[k], this.stiffness, dt);
    [this.dist, this.distVel] = springStep(this.dist, this.distVel, this.goalDist, this.zoomStiffness, dt);
  }

  /** Where the eye is (the same orbit as view.ts viewMatrix). */
  eye(): Vec3 {
    const cp = Math.cos(this.pitch),
      T = this.target;
    return [T[0] + this.dist * cp * Math.sin(this.yaw), T[1] + this.dist * Math.sin(this.pitch), T[2] + this.dist * cp * Math.cos(this.yaw)];
  }

  /** The options makeView() takes for this camera now. */
  view(): { yaw: number; pitch: number; dist: number; target: Vec3 } {
    return { yaw: this.yaw, pitch: this.pitch, dist: this.dist, target: [this.target[0], this.target[1], this.target[2]] };
  }
}
