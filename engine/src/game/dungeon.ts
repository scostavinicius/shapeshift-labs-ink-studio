// Procedural levels (stage 17): rooms and corridors, or caverns, laid out from the seed by the toolkit's layouts
// (KIT.procedural.layouts.bsp / .cave, src/kit/p53-room-and-cave-layouts.js) and built as blocks (S.vox). The floor
// and the walls come out of the sculpt like any other level, so collision needs nothing new.
//
//   scene: makeDungeonScene({ kind: 'rooms', width: 30, height: 22 })
//
// The build hangs what it laid out on the world as plain data, world.dungeon (DungeonLayout): the rooms, open spots
// spread over the floor, a start and an exit (the open place farthest from the start by walking). A game reads it in
// init (game.world.dungeon) to place its cast. The same seed gives the same level; a script's "seed" gives another.
import type { World } from '../../types/ink-studio';

/** A place on the floor: world [x, z]. */
export type Spot = [number, number];

export interface DungeonRoom {
  id: string;
  /** the room's middle, world [x, z] */
  center: Spot;
  /** its size in world units [x, z] */
  size: [number, number];
}

/** What the build laid out (on world.dungeon): plain data, for the game's init and rules. */
export interface DungeonLayout {
  kind: 'rooms' | 'cave';
  /** grid size in cells, and a cell's size in world units */
  width: number;
  height: number;
  cell: number;
  /** the grid, a row per string from the back (-z) to the front, '.' open and '#' wall */
  rows: string[];
  /** the rooms (only for kind 'rooms') */
  rooms: DungeonRoom[];
  /** open places with open cells all round them, about `spacing` apart, in a fixed order */
  spots: Spot[];
  start: Spot;
  /** the open spot farthest from the start by walking */
  exit: Spot;
  /** walking distance (cells) from start to exit */
  depth: number;
}

export interface DungeonOptions {
  /** 'rooms' (rectangular rooms and corridors) or 'cave' (caverns). Default 'rooms' */
  kind?: 'rooms' | 'cave';
  /** the grid in cells (default 28 x 20) and a cell's size in world units (default 1; keep it a multiple of 0.25) */
  width?: number;
  height?: number;
  cell?: number;
  /** wall height in world units (default 1.5: well above the 0.45 a walker steps up) */
  wallHeight?: number;
  /** palette (0xRRGGBB). Default DUNGEON_PALETTE; walkers use 13-17 */
  palette?: number[];
  /** ramps (palette indices, dark to light) for the floor, the walls and the walls' tops */
  floor?: number[];
  wall?: number[];
  /** ramp for the top layer of the walls (default stone and moss) */
  top?: number[];
  /** sampling spacing (default 0.2) and the kit's adaptive sampling (default on: docs/engine-performance.md section 7) */
  res?: number;
  adaptive?: boolean;
  /** bsp: smallest room side and corridor width, in cells */
  minRoom?: number;
  corridorWidth?: number;
  /** cave: how open the first random fill is (0..1, default 0.52) and smoothing steps */
  openChance?: number;
  steps?: number;
  /** spacing of spots, in cells (default 4) */
  spacing?: number;
  /** the scene's id and name */
  id?: string;
  name?: string;
  /** more to sculpt before the bake (torches, crates...): gets the sculpt, the kit and the layout */
  dress?: (S: any, K: any, layout: DungeonLayout, B: any) => void;
  /** B.finish options added to the defaults (detail, dither, cam...) */
  finish?: Record<string, unknown>;
}

/** Stone and moss, then the walker's colours at 13-17, then torchlight. */
export const DUNGEON_PALETTE = [
  0x07080c, // 0 the dark
  0x15151d, 0x24232e, 0x37343f, 0x4f4a55, 0x6c6570, // 1-5 wall stone
  0x1d1a17, 0x2d2822, 0x433b30, 0x5d5141, 0x7a6a52, // 6-10 floor flags
  0x2b3a2a, 0x46603d, // 11-12 moss
  0x6e2a22, 0xa8432c, 0xd8743c, // 13-15 walker's body
  0xe2c6a4, 0xf6e7cf, // 16-17 walker's head
  0x7a3b14, 0xc9752a, 0xf2b14a, 0xfff0b0, // 18-21 torchlight
  0x2a3d5c, 0x4d6c94, 0x8fb4d8 // 22-24 cold accents (water, crystals)
];

const SPAN = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Lay out a dungeon (pure: the same options and seed give the same layout). Exported for tests and tools. */
export function layDungeon(K: any, o: DungeonOptions, seed: number): DungeonLayout {
  const kind = o.kind ?? 'rooms',
    width = o.width ?? 28,
    height = o.height ?? 20,
    cell = o.cell ?? 1,
    L = K.procedural.layouts,
    s = seed >>> 0;
  const map =
    kind === 'cave'
      ? L.cave({ width, height, seed: s, steps: o.steps ?? 4, openChance: o.openChance ?? 0.52, minArea: 6, corridorWidth: o.corridorWidth ?? 2 })
      : L.bsp({ width, height, seed: s, minRoom: o.minRoom ?? 4, corridorWidth: o.corridorWidth ?? 2 });
  const open = (x: number, z: number) => x >= 0 && z >= 0 && x < width && z < height && map.cells[z * width + x] === 1;
  const toWorld = (x: number, z: number): Spot => [(x + 0.5 - width / 2) * cell, (z + 0.5 - height / 2) * cell];
  const rows = Array.from({ length: height }, (_, z) => Array.from({ length: width }, (_, x) => (open(x, z) ? '.' : '#')).join(''));
  const rooms: DungeonRoom[] = (map.rooms || []).map((r: any) => {
    const [x0, z0] = r.bounds.min,
      [x1, z1] = r.bounds.max;
    const c = toWorld((x0 + x1) / 2, (z0 + z1) / 2);
    return { id: r.id, center: c, size: [(x1 - x0 + 1) * cell, (z1 - z0 + 1) * cell] as [number, number] };
  });
  // spots: open cells with all eight neighbours open, no closer than `spacing` cells to an earlier one (raster order)
  const spacing = o.spacing ?? 4,
    picked: [number, number][] = [];
  for (let z = 1; z < height - 1; z++)
    for (let x = 1; x < width - 1; x++) {
      let roomy = true;
      for (let dz = -1; dz <= 1 && roomy; dz++) for (let dx = -1; dx <= 1; dx++) if (!open(x + dx, z + dz)) roomy = false;
      if (roomy && picked.every(([px, pz]) => Math.max(Math.abs(px - x), Math.abs(pz - z)) >= spacing)) picked.push([x, z]);
    }
  if (!picked.length) throw new Error('dungeon: no open place to stand (try another seed, or a larger or more open map)');
  // the start: the first room's middle if it is roomy, else the first spot; the exit: the spot farthest by walking
  const cellOf = (p: Spot): [number, number] => [Math.floor(p[0] / cell + width / 2), Math.floor(p[1] / cell + height / 2)];
  const firstRoom = rooms.find(r => {
    const [x, z] = cellOf(r.center);
    return open(x, z);
  });
  const startCell: [number, number] = firstRoom ? cellOf(firstRoom.center) : picked[0];
  const dist = new Int32Array(width * height).fill(-1),
    queue = [startCell[1] * width + startCell[0]];
  dist[queue[0]] = 0;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h],
      x = i % width,
      z = (i - x) / width;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx,
        nz = z + dz,
        j = nz * width + nx;
      if (open(nx, nz) && dist[j] < 0) {
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  let exitCell = picked[0],
    depth = -1;
  for (const p of picked) {
    const d = dist[p[1] * width + p[0]];
    if (d > depth) {
      depth = d;
      exitCell = p;
    }
  }
  // only spots the start can walk to
  const reach = picked.filter(p => dist[p[1] * width + p[0]] >= 0);
  return {
    kind,
    width,
    height,
    cell,
    rows,
    rooms,
    spots: reach.map(p => toWorld(p[0], p[1])),
    start: toWorld(startCell[0], startCell[1]),
    exit: toWorld(exitCell[0], exitCell[1]),
    depth
  };
}

/** A scene module for a procedural dungeon: kit => ({ id, name, seed, build(seed) }). */
export const makeDungeonScene =
  (o: DungeonOptions = {}) =>
  (kit: any) => ({
    id: o.id ?? 'dungeon',
    name: o.name ?? 'Dungeon',
    seed: 1,
    build(seed: number): World {
      const K = kit.KIT;
      const layout = layDungeon(K, o, seed);
      const B = kit.makeBuilder(seed, o.palette ?? DUNGEON_PALETTE);
      const S = K.sculpt(kit.makeSculpt(B));
      S.sun = B.norm([-0.35, 0.9, 0.3]);
      S.amb = 0.3;
      const layer = 0.25,
        wallLayers = Math.max(2, Math.round((o.wallHeight ?? 1.5) / layer)),
        { width, height, cell, rows } = layout;
      // the slab under everything: flags where one can walk, stone under the walls; then the walls, layer on layer
      const slab = rows.map(r => r.replace(/\./g, 'f').replace(/#/g, 's'));
      const walls = rows.map(r => r.replace(/#/g, 'w')),
        tops = rows.map(r => r.replace(/#/g, 't'));
      const floor = o.floor ?? SPAN(6, 10),
        wall = o.wall ?? SPAN(1, 5),
        top = o.top ?? [3, 11, 4, 12, 5];
      if (o.adaptive !== false) S.adaptiveSampling = true;
      const T = K.tex,
        cave = layout.kind === 'cave';
      // flagstones each a shade of their own, walls laid in courses, moss and grit on the tops (K.tex: src/kit/kr-tex.js)
      const floorMat = { r: floor, mod: T.range(T.voronoi(0.8, { out: 'id', seed: seed % 97 }), 0, 1, -0.35, 0.3) },
        wallMat = cave
          ? { r: wall, mod: T.range(T.noise(0.9, 3), 0.2, 0.8, -0.4, 0.3) }
          : { r: wall, mod: T.range(T.brick(0.6, 0.25, { dir: 'x' }), 0, 1, -0.45, 0.15) },
        topMat = { r: top, mod: T.range(T.noise(1.6, 3), 0.25, 0.75, -0.5, 0.5) };
      S.vox(
        {
          cell: [cell, layer, cell],
          // rooms keep square blocks; caverns melt into one rounded mass
          hard: !cave,
          key: { f: floorMat, s: wallMat, w: wallMat, t: topMat },
          layers: [slab, [walls, wallLayers - 1], tops]
        },
        { at: [0, -layer, 0], anchor: 'base', res: o.res ?? 0.2, round: 0.06 }
      );
      if (o.dress) o.dress(S, K, layout, B);
      S.bake();
      const world = B.finish({
        cam: { target: [layout.start[0], 0.5, layout.start[1]], dist: 14, pitch: 0.95, yaw: 0.25 },
        detail: 8,
        radius: Math.max(width, height) * cell * 0.6,
        dither: 0.2,
        ...o.finish
      });
      (world as World & { dungeon?: DungeonLayout }).dungeon = layout;
      return world;
    }
  });

/** The layout a dungeon scene hung on the world (throws if the world was not made by makeDungeonScene). */
export function dungeonOf(world: World): DungeonLayout {
  const d = (world as World & { dungeon?: DungeonLayout }).dungeon;
  if (!d) throw new Error('this world has no dungeon layout: its scene was not made by makeDungeonScene');
  return d;
}
