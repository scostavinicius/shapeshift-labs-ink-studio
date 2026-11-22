// Textured 3D models (stage 24). A GLB is turned once, offline, into a small JSON recipe (geometry, UVs, its texture
// fitted to at most 64 pixels): `node engine/cli.js asset model.glb --size 1 --out engine/examples/<game>/assets/x.json`.
// A scene places the recipe before its bake as an ordinary sculpted solid (K.mesh: a distance field from the triangles),
// so it casts and takes shadows, stands in the collision map, can carry a tag (and so break: def.breakables), and is
// splatted like everything else, the same in Node and in the page. Its colour comes from its texture: at each surface
// point the nearest triangle is found, the texture sampled there (KIT.authoring.assetMeshes.colorSampler), brightened
// or darkened by the light the sculpt works out, and matched to the nearest colour of the scene's palette.
//
// (The toolkit's own textured "UV stamps", assetSurfaces.splat, were tried first: they draw in the terminal renderer
// but need the browser renderer's per-pixel material path to show their texture, which the engine's games do not use.)
import type { Vec3 } from '../../types/ink-studio';
import type { Box } from './types';

export interface PlaceAssetOptions {
  /** where its base goes, world [x, y, z] */
  at: Vec3;
  /** its longest side in world units (default 1) */
  size?: number;
  /** turn about y, radians */
  turn?: number;
  /** the scene's palette (0xRRGGBB, as given to makeBuilder): texture colours are matched to it */
  palette: number[];
  /** sampling spacing (default 0.05: a model is small) */
  res?: number;
  /** a sculpt tag: def.breakables can then smash it */
  tag?: string;
  /** distance-field cells along its longest side (default 40) */
  cells?: number;
  /** more options for the solid (S.mesh): a character's bone binding, T('chest'), goes here (see placePart) */
  with?: Record<string, unknown>;
}

/**
 * The kit of the level being built (set by buildLevel): what placePart uses inside an actor's sculpt. Kept on a global
 * slot, not in this module: a game module is bundled apart from the engine (the page's /game/<name>.js, the tests'
 * loadTs), so each has its own copy of this file, and only a global is seen by both.
 */
const SLOT = Symbol.for('ink-engine.asset-kit');
export function setAssetKit(K: any): void {
  (globalThis as any)[SLOT] = K;
}

/** Place a model recipe in a scene being built, before S.bake(). K: kit.KIT; S: the sculpt. Returns its box. */
export function placeAsset(K: any, S: any, recipe: any, o: PlaceAssetOptions): { box: Box } {
  const P: number[] = recipe.positions,
    tris: number[] = recipe.triangles;
  if (!P || !tris || !P.length) throw new Error('placeAsset: not a model recipe (make one with: node engine/cli.js asset model.glb --out x.json)');
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], P[i + a]);
      hi[a] = Math.max(hi[a], P[i + a]);
    }
  const k = (o.size ?? 1) / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]),
    c = Math.cos(o.turn ?? 0),
    s = Math.sin(o.turn ?? 0),
    [ax, ay, az] = o.at;
  // recipe coordinates <-> world: scaled, its base on at.y, turned about y, moved to at
  const toWorld = (x: number, y: number, z: number): Vec3 => [ax + c * x * k + s * z * k, ay + (y - lo[1]) * k, az - s * x * k + c * z * k];
  const toAsset = (x: number, y: number, z: number): Vec3 => {
    const dx = x - ax,
      dz = z - az;
    return [(c * dx - s * dz) / k, (y - ay) / k + lo[1], (s * dx + c * dz) / k];
  };
  const wp: number[] = [];
  for (let i = 0; i < P.length; i += 3) wp.push(...toWorld(P[i], P[i + 1], P[i + 2]));
  const mesh = K.mesh.make(wp, tris);
  const field = K.mesh.field(mesh, { cells: o.cells ?? 40 });
  const sample = K.authoring.assetMeshes.colorSampler(recipe);
  const pal = o.palette.map(h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]);
  const nearest = (r: number, g: number, b: number) => {
    let best = 1,
      bd = Infinity;
    for (let i = 1; i < pal.length; i++) {
      const d = (pal[i][0] - r) * (pal[i][0] - r) + (pal[i][1] - g) * (pal[i][1] - g) + (pal[i][2] - b) * (pal[i][2] - b);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const mat = {
    r: [1, 2, 3],
    // t: how lit the point is on the sculpt's own scale (about 0 in shadow to 1 in full light)
    tex: (x: number, y: number, z: number, _ny: number, t: number) => {
      const a = toAsset(x, y, z),
        rgb = sample.atPoint(field.tri(x, y, z), a[0], a[1], a[2]),
        L = Math.min(1.35, Math.max(0.25, 0.3 + t));
      return nearest(rgb[0] * L, rgb[1] * L, rgb[2] * L);
    }
  };
  K.mesh.solid(S, mesh, mat, { res: o.res ?? 0.05, ...(o.tag && { tag: o.tag }), ...o.with });
  const box: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < wp.length; i += 3)
    for (let a = 0; a < 3; a++) {
      box.min[a] = Math.min(box.min[a], wp[i + a]);
      box.max[a] = Math.max(box.max[a], wp[i + a]);
    }
  return { box };
}

/**
 * A model as a rigid part of a character, inside its spec's sculpt(S, T): it is carried by the bone T(name) gives, so
 * it swings and turns with it (no skin: each part stays rigid, like a jointed doll).
 *   sculpt(S, T) { placePart(S, helmet, { at: [0, 1.0, 0], size: 0.45, palette: PALETTE, bone: T('head') }) }
 * `at` is where it sits on the character standing at rest, feet at the origin, facing +x.
 */
export function placePart(S: any, recipe: any, o: Omit<PlaceAssetOptions, 'with' | 'tag'> & { bone: unknown }): { box: Box } {
  const activeKit = (globalThis as any)[SLOT];
  if (!activeKit) throw new Error("placePart: no level is being built (use it inside an actor spec's sculpt)");
  const { bone, ...rest } = o;
  return placeAsset(activeKit, S, recipe, { res: 0.04, cells: 32, ...rest, with: bone as Record<string, unknown> });
}
