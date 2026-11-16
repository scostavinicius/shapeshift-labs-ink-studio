// From a point on the picture to a line into the world: the inverse of the projection the splat shader does
// (shaders.ts: sx = focal * x / -z + W / 2, sy likewise, y up), so a click lands on what was drawn under the cursor.
// The canvas holds the art grid (W x H) and the page stretches it over the whole element, so u, v (0..1 over the element,
// v from the top) cover the grid exactly.
import type { Vec3 } from '../../types/ink-studio';
import type { View } from '../render/view';

export interface Ray {
  eye: Vec3;
  /** unit length */
  dir: Vec3;
}

/** The eye of a view: V is world -> camera (rotation R, then move t), so the eye is -R^T t. */
export function eyeOf(view: View): Vec3 {
  const V = view.V;
  return [
    -(V[0] * V[12] + V[1] * V[13] + V[2] * V[14]),
    -(V[4] * V[12] + V[5] * V[13] + V[6] * V[14]),
    -(V[8] * V[12] + V[9] * V[13] + V[10] * V[14])
  ];
}

/** The line from the eye through the point (u, v) of the picture: u from the left, v from the top, both 0..1. */
export function rayThrough(view: View, u: number, v: number): Ray {
  const V = view.V,
    // in camera space, at depth 1 in front of the eye (the camera looks down -z)
    cx = (u * view.W - 0.5 * view.W) / view.focal,
    cy = ((1 - v) * view.H - 0.5 * view.H) / view.focal,
    cz = -1;
  // back to world space: R^T times the camera-space direction (R's rows are the camera's axes)
  let dx = V[0] * cx + V[1] * cy + V[2] * cz,
    dy = V[4] * cx + V[5] * cy + V[6] * cz,
    dz = V[8] * cx + V[9] * cy + V[10] * cz;
  const l = Math.hypot(dx, dy, dz);
  dx /= l;
  dy /= l;
  dz /= l;
  return { eye: eyeOf(view), dir: [dx, dy, dz] };
}

/** Where a world point is drawn: u, v as rayThrough takes them, or null behind the eye. (The shader's own projection.) */
export function project(view: View, p: Vec3): { u: number; v: number } | null {
  const V = view.V,
    x = V[0] * p[0] + V[4] * p[1] + V[8] * p[2] + V[12],
    y = V[1] * p[0] + V[5] * p[1] + V[9] * p[2] + V[13],
    z = V[2] * p[0] + V[6] * p[1] + V[10] * p[2] + V[14];
  if (z >= 0) return null;
  const sx = (view.focal * x) / -z + 0.5 * view.W,
    sy = (view.focal * y) / -z + 0.5 * view.H;
  return { u: sx / view.W, v: 1 - sy / view.H };
}
