// Fighting (stage 7). The kit's K.character knows how to swing (ch.striking() is true in the moment a blow can land) and
// how to be hit (ch.hurt(kx, kz): thrown back, a flash, a point of health off), but not who hits whom: that is here.
//   - a blow lands on actors of another team, in reach (the attacker's spec.reach, plus the target's body) and within
//     `arc` degrees of where the attacker faces; one swing lands once on each target (st.connected, which the kit leaves
//     for the game to set)
//   - a hit actor cannot be hit again for `invuln` seconds (the kit's ch.hurt does not check)
//   - at 0 health an actor dies (whether or not its spec says mortal): an enemy goes to pieces and leaves the stage, the
//     player stands up again at its spawn after `respawn` seconds
// Everything here runs inside the game's step, in id order: it is as deterministic as the rest.
import type { Effects, Actor, CombatOptions, Game } from './types';

/** a palette entry for an effect: the one asked for, or the last there is (palettes differ in size from scene to scene) */
const colour = (game: Game<any>, i: number) => Math.min(i, game.world.pal.length - 1);

export class Combat {
  readonly invuln: number;
  readonly cosArc: number;
  readonly respawn: number | false;
  readonly respawnAt: string | undefined;
  readonly knock: number;

  constructor(o: CombatOptions = {}) {
    this.invuln = o.invuln ?? 0.6;
    this.cosArc = Math.cos(((o.arc ?? 70) * Math.PI) / 180);
    this.respawn = o.respawn === undefined ? 1.5 : o.respawn;
    this.respawnAt = o.respawnAt;
    this.knock = o.knock ?? 1;
  }

  /**
   * One step, after the actors have moved: timers run down, blows land, the dead are dealt with. `actors` are those alive
   * at the start of the step, in id order.
   */
  step(game: Game<any>, actors: Actor[], dt: number, fx: Effects | null): void {
    for (const a of actors) if (a.invuln > 0) a.invuln = Math.max(0, a.invuln - dt);

    // blows
    for (const a of actors) {
      if (!a.alive || a.deadFor >= 0 || !a.ch.striking()) continue;
      const reach: number = a.ch.reach,
        fx0 = Math.cos(a.ch.st.face),
        fz0 = Math.sin(a.ch.st.face);
      let landed = false;
      for (const b of actors) {
        if (b === a || !b.alive || b.deadFor >= 0 || b.team === a.team || b.invuln > 0) continue;
        const dx = b.pos[0] - a.pos[0],
          dz = b.pos[2] - a.pos[2],
          d = Math.hypot(dx, dz);
        if (d > reach + b.radius || Math.abs(b.pos[1] - a.pos[1]) > 1.5) continue;
        // in front: within the arc of where it faces (right on top of it counts)
        if (d > 0.05 && (dx * fx0 + dz * fz0) / d < this.cosArc) continue;
        const kx = d > 0.05 ? dx / d : fx0,
          kz = d > 0.05 ? dz / d : fz0;
        this.hit(game, a, b, kx, kz, fx);
        landed = true;
      }
      if (landed) a.ch.st.connected = true;
    }

    // the dead
    for (const a of actors) {
      if (!a.alive) continue;
      if (a.deadFor < 0 && a.ch.st.dead >= 0) a.deadFor = 0; // died some other way (a fall the kit counts, a rule)
      if (a.deadFor < 0) continue;
      a.deadFor += dt;
      if (a.brain === 'player') {
        if (this.respawn !== false && a.deadFor >= this.respawn) this.revive(game, a);
      } else if (a.deadFor >= 0) {
        // an enemy goes to pieces at once and leaves the stage
        fx?.shatter(a, 4);
        game.remove(a);
      }
    }
  }

  /** a blow from a on b, thrown along (kx, kz) */
  hit(game: Game<any>, a: Actor | null, b: Actor, kx: number, kz: number, fx: Effects | null): void {
    const st = b.ch.st,
      dmg = a ? a.damage : 1;
    b.ch.hurt(kx * this.knock, kz * this.knock); // a point off, thrown back, a flash
    if (dmg > 1) st.hp -= dmg - 1;
    if (this.knock !== 1) {
      st.vx = kx * 4.5 * this.knock;
      st.vz = kz * 4.5 * this.knock;
    }
    b.hp = st.hp;
    b.invuln = this.invuln;
    game.emit('hit', { by: a ? a.id : null, target: b.id, damage: dmg, hp: b.hp });
    if (fx && fx.fx) fx.fx.sparks(b.pos[0] - kx * 0.25, b.pos[1] + 0.6, b.pos[2] - kz * 0.25, colour(game, 18), 10, 4, kx, kz);
    if (b.hp <= 0 && b.deadFor < 0) {
      st.dead = 0;
      st.vx = st.vz = 0;
      b.deadFor = 0;
      game.emit('death', { id: b.id, kind: b.kind, team: b.team, by: a ? a.id : null, at: [b.pos[0], b.pos[1], b.pos[2]] });
      if (fx && fx.fx) fx.fx.ring(b.pos[0], b.pos[1] + 0.1, b.pos[2], colour(game, 17), 0.2, 1.4, 0.45, 24);
    }
  }

  /** the player back on its feet at home, full health, briefly unhittable */
  revive(game: Game<any>, a: Actor): void {
    const at = this.respawnAt ? game.place(this.respawnAt) : a.home;
    const ch = a.ch;
    ch.st.z = at[2];
    ch.respawn(at[0]);
    ch.st.y = ch.st.gh = at[1];
    ch.st.ground = true;
    a.pos = [ch.st.x, ch.st.y, ch.st.z];
    a.hp = ch.st.hp;
    a.deadFor = -1;
    a.invuln = Math.max(this.invuln, 1);
    game.emit('respawn', { id: a.id });
  }
}
