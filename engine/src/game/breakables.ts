// Breakable things (stage 19): crates, pillars, walls a blow can smash. The scene sculpts them as usual with a tag
// (S.box(..., { tag: 'crate-1' })); the game lists the tags in def.breakables. The toolkit's K.destruction
// (src/kit/ks-destruction.js) takes their splats when they break and throws them about as debris or rubble; the
// engine counts the blows, opens their place in the collision map (so the way is clear and routes go through), and
// keeps each one as a prop entity whose data says whether it is broken, so a save brings it back broken.
//
//   breakables: [{ tag: 'crate-1', hits: 2 }, { tag: 'wall-3', hits: 4, mode: 'rubble' }]
//
// Events: 'hit-object' { tag, by, hits } on a blow that does not break it, 'break' { tag, by, at } when it goes.
import type { Kit, Vec3, World } from '../../types/ink-studio';
import type { Actor, Box, Collision, Game, Prop } from './types';

export interface BreakableDef {
  /** the sculpt tag of what breaks (S.box(..., { tag })): every solid with this tag breaks together */
  tag: string;
  /** blows it takes (default 1) */
  hits?: number;
  /** 'debris' (default): pieces that fly and fade; 'rubble': pieces that stay and can be knocked about */
  mode?: 'debris' | 'rubble';
  /** size of the pieces, world units (default 0.3) */
  pieces?: number;
  /** how hard the last blow throws the pieces (default 3) */
  push?: number;
  /** only actors of these teams can break it (default: anyone) */
  by?: string[];
  /** the prop's kind (default 'breakable') */
  kind?: string;
}

/** What a breakable's prop keeps in its data (plain, so saves and the hash keep it). */
export interface BreakableData {
  breakable: string;
  hits: number;
  broken: boolean;
  /** the direction it was thrown when it broke (for a save to break it the same way) */
  dir: [number, number] | null;
}

interface Bound {
  def: BreakableDef;
  box: Box;
  centre: Vec3;
  /** half its width on the ground */
  radius: number;
}

export class Breakables {
  private bound = new Map<string, Bound>();
  private binding: any;
  /** for each striking actor, the tags its current swing has already hit */
  private swing = new Map<number, Set<string>>();
  private cosArc = Math.cos((70 * Math.PI) / 180);

  constructor(
    readonly defs: BreakableDef[],
    world: World,
    K: Kit,
    selectors: { index(w: World): { row(i: number): { object?: string } } },
    private collision: Collision
  ) {
    const index = selectors.index(world),
      boxes = new Map<string, Box>();
    for (const d of defs) {
      if (!d.tag) throw new Error('breakables: every entry needs the tag its solids were sculpted with');
      if (boxes.has(d.tag)) throw new Error(`breakables: "${d.tag}" is listed twice`);
      boxes.set(d.tag, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    }
    // where each one's splats are: its box (for the collision map, and for blows to find it)
    const data = world.data;
    for (let i = 0; i < world.count; i++) {
      const o = index.row(i).object;
      const b = o === undefined ? undefined : boxes.get(o);
      if (!b) continue;
      for (let a = 0; a < 3; a++) {
        const v = data[i * 16 + a];
        if (v < b.min[a]) b.min[a] = v;
        if (v > b.max[a]) b.max[a] = v;
      }
    }
    for (const d of defs) {
      const b = boxes.get(d.tag)!;
      if (!(b.min[0] <= b.max[0])) throw new Error(`breakables: nothing in the scene has tag "${d.tag}" (S.box(..., { tag: '${d.tag}' }))`);
      const centre: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      this.bound.set(d.tag, { def: d, box: b, centre, radius: Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2 });
    }
    const stage = (world as World & { anim: any }).anim;
    this.binding = stage.add(
      (K as any).destruction(stage, {
        groups: defs.map(d => ({ id: d.tag, selector: { object: d.tag }, mode: d.mode ?? 'debris', fragmentSize: d.pieces ?? 0.3, static: true })),
        maxPieces: Math.min(512, 48 * defs.length)
      })
    );
  }

  /** The props, one per breakable, made when the game starts (before init, in the order listed). */
  spawn(game: Game<any>): void {
    for (const d of this.defs) {
      const b = this.bound.get(d.tag)!;
      const p = game.spawnProp({ kind: d.kind ?? 'breakable', at: [b.centre[0], b.box.min[1], b.centre[2]], tags: ['breakable', d.tag] });
      const data: BreakableData = { breakable: d.tag, hits: 0, broken: false, dir: null };
      p.data = data as unknown as Record<string, unknown>;
    }
  }

  private propOf(game: Game<any>, tag: string): Prop | undefined {
    return game.entities.find(e => e.type === 'prop' && e.alive && (e.data as Partial<BreakableData>).breakable === tag) as Prop | undefined;
  }

  /** Is it still standing? */
  intact(tag: string): boolean {
    return !!this.binding.intact(tag);
  }

  /** Where it is: its box. */
  boxOf(tag: string): Box | undefined {
    return this.bound.get(tag)?.box;
  }

  /** Blows that land this step: each swing hits each breakable in reach and in front once. Called in the game's step. */
  strike(game: Game<any>, actors: Actor[]): void {
    for (const a of actors) {
      if (!a.alive || a.deadFor >= 0 || !a.ch.striking()) {
        this.swing.delete(a.id);
        continue;
      }
      const done = this.swing.get(a.id) ?? new Set<string>();
      this.swing.set(a.id, done);
      const reach: number = a.ch.reach,
        fx = Math.cos(a.ch.st.face),
        fz = Math.sin(a.ch.st.face);
      for (const [tag, b] of this.bound) {
        if (done.has(tag) || !this.intact(tag)) continue;
        if (b.def.by && !b.def.by.includes(a.team)) continue;
        const dx = b.centre[0] - a.pos[0],
          dz = b.centre[2] - a.pos[2],
          d = Math.hypot(dx, dz);
        if (d > reach + b.radius || a.pos[1] > b.box.max[1] + 0.5 || a.pos[1] + 1.6 < b.box.min[1]) continue;
        if (d > 0.05 && (dx * fx + dz * fz) / d < this.cosArc) continue;
        done.add(tag);
        const p = this.propOf(game, tag);
        if (!p) continue;
        const bd = p.data as unknown as BreakableData;
        bd.hits++;
        const dir: [number, number] = d > 0.05 ? [dx / d, dz / d] : [fx, fz];
        if (bd.hits >= (b.def.hits ?? 1)) {
          this.breakIt(game, tag, dir);
          game.emit('break', { tag, by: a.id, at: [b.centre[0], b.centre[1], b.centre[2]] });
        } else game.emit('hit-object', { tag, by: a.id, hits: bd.hits });
      }
    }
  }

  /** Break it now (a rule, an explosion): pieces thrown along dir ([x, z]), its place opened. Emits nothing. */
  breakIt(game: Game<any>, tag: string, dir: [number, number] = [0, 0]): void {
    const b = this.bound.get(tag);
    if (!b) throw new Error(`breakables: no "${tag}"`);
    if (!this.intact(tag)) return;
    const push = b.def.push ?? 3;
    this.binding.release(tag, { impulse: [dir[0] * push, push * 0.5, dir[1] * push], p: b.centre, scatter: 1.2 });
    // its place in the collision map: what stood above the floor goes (the floor under it stays)
    this.collision.openBox({ min: [b.box.min[0] - 0.05, b.box.min[1] + 0.02, b.box.min[2] - 0.05], max: [b.box.max[0] + 0.05, b.box.max[1] + 0.1, b.box.max[2] + 0.05] });
    const p = this.propOf(game, tag);
    if (p) {
      const bd = p.data as unknown as BreakableData;
      bd.broken = true;
      bd.dir = [dir[0], dir[1]];
    }
  }

  /** After a save is loaded: break again, the same way, what the save says was broken. */
  sync(game: Game<any>): void {
    for (const e of game.entities) {
      const bd = e.data as Partial<BreakableData>;
      if (e.type !== 'prop' || !bd.breakable || !bd.broken || !this.intact(bd.breakable)) continue;
      this.breakIt(game, bd.breakable, bd.dir ?? [0, 0]);
    }
  }
}
