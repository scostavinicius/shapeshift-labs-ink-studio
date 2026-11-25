// Strands that show at a game's pixel size (stage 35). Measured first (docs/engine-plan.md, stage 35): a blade or a lock
// thinner than an art pixel (about 0.15 units) is lost, and the renderer's analytic curve pass is no answer (13 fps with
// a field of grass, its tile budget overflowed by two dozen locks of hair). What shows is a strand at least a pixel wide:
//   - grass as tufts: a few short, thick, tapering blades from one spot, in a few greens (this file);
//   - capes and hair as a few wide ribbons hanging from the actor: chains of actors.<name>.body growing from the actor
//     (from: 'actor', offset), on the same XPBD as a serpent's body (tails.ts).
// A curve of the kit's curve splats costs splats by its profile samples (profileSamples), 96 by default whatever its length: a blade half a
// unit tall looks the same with 12, so tufts are drawn with 12: about 25 splats a blade (the ends add some), a quarter.
import type { BuildContext } from './types';
import { XorShift } from './rng';

export interface TuftOptions {
  /** how many tufts (default 120) */
  count?: number;
  /** where: a ring { center: [x, z], radius, inner? } or a box { min: [x, z], max: [x, z] } */
  area: { center: [number, number]; radius: number; inner?: number } | { min: [number, number]; max: [number, number] };
  /** blades in a tuft, [fewest, most] (default [3, 5]) */
  blades?: [number, number];
  /** a blade's height, [lowest, tallest] (default [0.32, 0.62]) */
  height?: [number, number];
  /** a blade's width at its foot (default 0.2: an art pixel or more, or it is lost); it tapers to a quarter */
  width?: number;
  /** how far a blade's tip leans out, [least, most] (default [0.12, 0.24]) */
  lean?: [number, number];
  /** its greens, '#rrggbb' (default four of them) */
  colors?: string[];
  /** samples along a blade (default 12: about 25 splats a blade; the kit's default 96 makes about 96) */
  samples?: number;
  /** a spot to leave bare (a path, the nest) */
  skip?: (x: number, z: number) => boolean;
  /** varies the field (default 1) */
  seed?: number;
}

/** a deterministic hash in 0..1, of whole numbers (no Math.sin: the same everywhere) */
function hash(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Grass as tufts, standing on the level's ground, made in def.build(ctx) (before B.finish). Spots with no ground under
 * them, or that `skip` says to leave, stay bare. Returns how many tufts and blades were made.
 *
 * Drawing curve splats rolls the kit's dice (K.rnd); the tufts roll their own, from `seed`, and put the kit's back, so
 * that grass never changes how a game plays (what K.character and the effects roll afterwards stays the same).
 */
export function tufts(ctx: BuildContext, o: TuftOptions): { tufts: number; blades: number } {
  const K = ctx.K as any,
    count = o.count ?? 120,
    [b0, b1] = o.blades ?? [3, 5],
    [h0, h1] = o.height ?? [0.32, 0.62],
    [l0, l1] = o.lean ?? [0.12, 0.24],
    w = o.width ?? 0.2,
    colors = o.colors ?? ['#4d8c45', '#86c05a', '#2f5e35', '#6aa64e'],
    samples = o.samples ?? 12,
    seed = o.seed ?? 1;
  let made = 0,
    blades = 0;
  const kitRnd = K.rnd,
    own = new XorShift(Math.imul(seed, 0x9e3779b1) ^ 0x7f4a7c15);
  K.rnd = () => own.next();
  try {
    for (let i = 0; i < count; i++) {
      let x: number, z: number;
      if ('radius' in o.area) {
        const inner = o.area.inner ?? 0,
          r = Math.sqrt(inner * inner + (o.area.radius * o.area.radius - inner * inner) * hash(seed, i, 1)),
          a = hash(seed, i, 2) * Math.PI * 2;
        x = o.area.center[0] + Math.cos(a) * r;
        z = o.area.center[1] + Math.sin(a) * r;
      } else {
        x = o.area.min[0] + (o.area.max[0] - o.area.min[0]) * hash(seed, i, 1);
        z = o.area.min[1] + (o.area.max[1] - o.area.min[1]) * hash(seed, i, 2);
      }
      const y = ctx.collision.ground(x, z);
      if (y < -1e8 || y > 1e8 || (o.skip && o.skip(x, z))) continue;
      const n = b0 + Math.floor(hash(seed, i, 3) * (b1 - b0 + 1));
      for (let b = 0; b < n; b++) {
        const turn = hash(seed, i * 8 + b, 4) * Math.PI * 2,
          tall = h0 + (h1 - h0) * hash(seed, i * 8 + b, 5),
          out = l0 + (l1 - l0) * hash(seed, i * 8 + b, 6),
          cx = Math.cos(turn),
          cz = Math.sin(turn);
        K.curveSplats.draw(
          ctx.B,
          {
            id: `tuft-${seed}-${i}-${b}`,
            points: [
              [x + cx * 0.03, y + 0.02, z + cz * 0.03],
              [x + cx * out * 0.4, y + tall * 0.5, z + cz * out * 0.4],
              [x + cx * out, y + tall, z + cz * out]
            ]
          },
          {
            width: { samples: [w, w * 0.75, w * 0.25] },
            color: colors[(i + b) % colors.length],
            edge: 'hard',
            caps: 'blunt',
            profileSamples: samples
          }
        );
        blades++;
      }
      made++;
    }
  } finally {
    K.rnd = kitRnd;
  }
  return { tufts: made, blades };
}
