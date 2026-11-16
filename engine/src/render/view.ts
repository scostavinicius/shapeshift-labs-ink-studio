// The camera and the art-pixel grid, worked out exactly as cli/render.js render() does, so the GPU renderer draws the same
// pixels the reference renderer does. Keep this in step with cli/render.js: it is the parity target.
import type { World } from '../../types/ink-studio';

export const FOV = (38 * Math.PI) / 180;

/** What to draw: the same options cli/render.js takes. Angles in radians. */
export interface ViewOptions {
  t?: number;
  yaw?: number;
  pitch?: number;
  zoom?: number;
  dist?: number;
  target?: [number, number, number];
  /** size of the stage in screen pixels; the art grid is this divided by the art-pixel size */
  w?: number;
  h?: number;
  /** force the art-pixel size */
  px?: number;
}

export interface View {
  t: number;
  yaw: number;
  pitch: number;
  /** distance of the eye, after the world's own camera punch */
  dist: number;
  target: [number, number, number];
  /** size of one art pixel in screen pixels, and the art grid it gives */
  px: number;
  W: number;
  H: number;
  /** column-major 4x4 view matrix (camera looks down -z) */
  V: number[];
  focal: number;
  near: number;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** The view matrix of cli/render.js viewMatrix(): an orbit about T. */
export function viewMatrix(yaw: number, pitch: number, dist: number, T: number[]): number[] {
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch),
    e = [T[0] + dist * cp * Math.sin(yaw), T[1] + dist * sp, T[2] + dist * cp * Math.cos(yaw)];
  let zx = e[0] - T[0],
    zy = e[1] - T[1],
    zz = e[2] - T[2];
  const zl = Math.hypot(zx, zy, zz);
  zx /= zl;
  zy /= zl;
  zz /= zl;
  let xx = zz,
    xz = -zx;
  const xy = 0,
    xl = Math.hypot(xx, xz);
  xx /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  return [
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]),
    -(yx * e[0] + yy * e[1] + yz * e[2]),
    -(zx * e[0] + zy * e[1] + zz * e[2]),
    1
  ];
}

/**
 * The same view on a grid twice as fine, as cli/render.js asks for the samples of its `colored` look:
 * render(world, { ...o, px: px / 2, w: W * px, h: H * px }).
 */
export function finer(v: View): View {
  const px = v.px / 2,
    W = Math.ceil((v.W * v.px) / px),
    H = Math.ceil((v.H * v.px) / px);
  return { ...v, px, W, H, focal: H / 2 / Math.tan(FOV / 2) };
}

/** Resolve options into the view cli/render.js would use for this world. */
export function makeView(world: World, o: ViewOptions = {}): View {
  const c = world.cam,
    an = (world.anim || {}) as { zoom?: number; kick?: number[] | null },
    t = o.t || 0,
    yaw = o.yaw === undefined ? c.yaw : o.yaw,
    pitch = o.pitch === undefined ? c.pitch : o.pitch,
    dist0 = o.dist || c.dist / (o.zoom || 1),
    // a diorama's own zoom (a camera punch) moves the eye, not the size of an art pixel
    dist = dist0 / (an.zoom || 1),
    T0 = o.target || c.target,
    T: [number, number, number] = an.kick ? [T0[0] + an.kick[0], T0[1] + an.kick[1], T0[2] + an.kick[2]] : [T0[0], T0[1], T0[2]],
    cw = o.w || 900,
    ch = o.h || 620,
    rel = c.dist / dist0,
    rho = world.detail * Math.pow(rel, rel > 1 ? 0.5 : 0.25),
    px = o.px || clamp(Math.round(ch / (2 * Math.tan(FOV / 2) * rho * dist0)), 1, 18),
    W = Math.ceil(cw / px),
    H = Math.ceil(ch / px);
  return {
    t,
    yaw,
    pitch,
    dist,
    target: T,
    px,
    W,
    H,
    V: viewMatrix(yaw, pitch, dist, T),
    focal: H / 2 / Math.tan(FOV / 2),
    near: Math.max(0.4, 0.15 * dist)
  };
}
