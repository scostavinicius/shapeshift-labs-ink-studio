// A Cripta: a longer dungeon game, with goals in order. Three relics lie in the crypt's farthest rooms; each one taken
// wakes darters somewhere in the dark. With all three the seal over the way out (a great stone slab) bursts, and the
// Guardian who keeps it comes for you: at half health it calls ghouls to its side. Potions are hidden inside crates:
// smash the crate to drink. Beat the Guardian and step on the way out. Three lives.
//
// What it uses: makeDungeonScene (laid out from the seed, baked torches), placeAsset (the GLB crates), breakables (crates
// smashed by blows; relics, potions and the seal broken by the rules, never by a blow), hunter() (patrols, search, the
// Guardian's guard), triggers and props, camera shake and sound from where things happen.
import { defineGame, dungeonOf, DUNGEON_PALETTE, hunter, makeDungeonScene, placeAsset, type DungeonLayout } from '../../src/game/index';
import type { Actor, Brain, Game } from '../../src/game/types';
import { walker } from '../farol-walk/game';
import crate from '../../assets/crate.json';

const PALETTE = DUNGEON_PALETTE;
const LIVES = 3,
  HERO_HP = 6,
  GUARDIAN_HP = 10,
  RELICS = 3,
  CRATES = 5,
  /** crates with a potion inside: the first POTIONS of them */
  POTIONS = 3,
  HEAL = 3;

type Spot = [number, number];
const dist = (a: Spot, b: Spot) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Where everything goes: worked out from the layout alone, so the scene and the rules agree. */
export function plan(d: DungeonLayout) {
  // the relics: in the middles of the rooms farthest from the start, keeping off the way out
  const rooms = d.rooms.filter(r => dist(r.center, d.exit) > 4 && dist(r.center, d.start) > 4).sort((a, b) => dist(b.center, d.start) - dist(a.center, d.start));
  if (rooms.length < RELICS) throw new Error(`cripta: only ${rooms.length} rooms for ${RELICS} relics; another seed or a larger map`);
  const relics = rooms.slice(0, RELICS).map(r => r.center);
  // crates: open spots well inside a room (5 x 5 cells of floor round them, so never in a doorway or a corridor's
  // mouth), away from the start, the way out and the relics
  const cellOpen = (x: number, z: number) => d.rows[z]?.[x] === '.';
  const roomy = (cx: number, cz: number) => {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!cellOpen(cx + dx, cz + dz)) return false;
    return true;
  };
  const crates: Spot[] = [];
  for (let cz = 2; cz < d.height - 2 && crates.length < CRATES; cz++)
    for (let cx = 2; cx < d.width - 2 && crates.length < CRATES; cx++) {
      if (!roomy(cx, cz)) continue;
      const w: Spot = [(cx + 0.5 - d.width / 2) * d.cell, (cz + 0.5 - d.height / 2) * d.cell];
      if (dist(w, d.start) <= 3 || dist(w, d.exit) <= 3 || relics.some(r => dist(w, r) <= 2) || crates.some(c => dist(w, c) < 4)) continue;
      crates.push(w);
    }
  if (crates.length < CRATES) throw new Error(`cripta: only ${crates.length} places for ${CRATES} crates`);
  // where the dead rise: the open spots farthest from the start
  const dens = [...d.spots].filter(s => dist(s, d.exit) > 3).sort((a, b) => dist(b, d.start) - dist(a, d.start));
  return { relics, crates, dens, exit: d.exit, start: d.start };
}

const scene = makeDungeonScene({
  id: 'cripta',
  name: 'A Cripta',
  kind: 'rooms',
  width: 34,
  height: 24,
  torches: 10,
  // a big map: uniform sampling builds a second faster than adaptive here (more splats, but the GPU has room)
  adaptive: false,
  dress(S, K, d) {
    const p = plan(d);
    // relics: a pedestal (stays) and a glowing gem on it (tag relic-i: the rules break it when it is taken)
    p.relics.forEach(([x, z], i) => {
      S.tube([[x, 0, z], [x, 0.55, z]], 0.22, 0.18, { r: [2, 3, 4, 5] }, { res: 0.05 });
      S.ball([x, 0.78, z], [0.13, 0.19, 0.13], { r: [22, 23, 24], em: true }, { res: 0.03, tag: 'relic-' + i });
    });
    // crates, and inside the first ones a red potion (tag potion-i: seen only when its crate is gone)
    p.crates.forEach(([x, z], i) => {
      placeAsset(K, S, crate, { at: [x, 0, z], size: 0.85, turn: i * 0.9, palette: PALETTE, tag: 'crate-' + i, cells: 20, res: 0.06 });
      if (i < POTIONS) S.ball([x, 0.2, z], [0.1, 0.16, 0.1], { r: [13, 14, 15], em: true }, { res: 0.03, ghost: true, tag: 'potion-' + i });
    });
    // the seal: a slab of mossy stone over the way out, with a glow under it
    const [ex, ez] = d.exit;
    S.ball([ex, 0.02, ez], [0.55, 0.03, 0.55], { r: [19, 20, 21], em: true }, { res: 0.05, ghost: true });
    S.box([ex, 0.55, ez], [0.75, 0.55, 0.75], { r: [1, 11, 12, 4] }, { res: 0.07, tag: 'seal' });
  }
});

// ---------------------------------------------------------------------------------------------------------- the cast

const ghoul = {
  ...walker,
  id: 'ghoul',
  atk: 'pound',
  speed: 0.95,
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0, 0.5, 0], [0.34, 0.42, 0.34], { r: [1, 11, 12] }, T('root'));
    S.ball([0, 0.98, 0], 0.2, { r: [3, 4, 5] }, T('head'));
  }
};
const darter = {
  ...walker,
  id: 'darter',
  height: 1.0,
  atk: 'peck',
  speed: 1.3,
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0, 0.45, 0], [0.25, 0.3, 0.29], { r: [22, 23, 24] }, T('root'));
    S.ball([0, 0.85, 0], 0.16, { r: [23, 24, 24] }, T('head'));
  }
};
const guardian = {
  id: 'guardian',
  height: 2.2,
  atk: 'spin',
  reach: 1.8,
  speed: 0.8,
  pts: { hip: [0, 0.9, 0], chest: [0, 1.3, 0], hem: [0, 0.55, 0], neck: [0, 1.75, 0] },
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0, 0.95, 0], [0.7, 0.85, 0.66], { r: [1, 2, 3, 4] }, T('root'));
    S.ball([0, 1.92, 0], 0.38, { r: [3, 4, 5] }, T('head'));
    S.ball([0.3, 1.98, 0.12], 0.06, { r: [19, 20, 21], em: true }, T('head'));
    S.ball([0.3, 1.98, -0.12], 0.06, { r: [19, 20, 21], em: true }, T('head'));
  }
};

const ghoulBrain = hunter({ sight: 9, fov: 140, hearing: 2.5, patrol: 'spots', speed: 0.8, cooldown: 1.2 });
const darterBrain = hunter({ sight: 30, fov: 360, needsLine: false, hearing: 30, speed: 1, cooldown: 0.8, retreat: 0.7 });
// the Guardian keeps by the seal until it bursts; then it hunts, slowly, and swings wide
const guardianHunt = hunter({ sight: 30, fov: 360, needsLine: false, hearing: 30, speed: 0.6, cooldown: 2.1, retreat: 0.5 });
const guardianRage = hunter({ sight: 30, fov: 360, needsLine: false, hearing: 30, speed: 0.78, cooldown: 1.6, retreat: 0.4 });
const guardianBrain: Brain = (self, game, dt) => {
  const g = game as Game<CriptaState>;
  if (!g.state.sealOpen) return {};
  if (!self.data.called && self.hp <= GUARDIAN_HP / 2 && self.deadFor < 0) {
    self.data.called = true;
    const p = plan(dungeonOf(g.world));
    for (const s of p.dens.slice(0, 2)) g.spawnActor({ actor: 'ghoul', kind: 'ghoul', at: [s[0], null as unknown as number, s[1]], brain: ghoulBrain, tags: ['enemy'] });
    g.emit('call');
  }
  return (self.data.called ? guardianRage : guardianHunt)(self, game, dt);
};

// ---------------------------------------------------------------------------------------------------------- the rules

export interface CriptaState {
  relics: number;
  /** which relics and potions are taken (by number) */
  took: number[];
  drank: number[];
  sealOpen: boolean;
  /** the Guardian's health while it stands (null before the seal bursts, 0 when it has fallen) */
  guardian: number | null;
  exit: Spot;
  kills: number;
  falls: number;
  won: boolean;
  lost: boolean;
}

/** the props that are taken by walking up to them: relics and potions */
function pickups(game: Game<CriptaState>) {
  const s = game.state,
    p = game.player,
    pl = plan(dungeonOf(game.world)),
    br = game.breakables!;
  if (!p || p.deadFor >= 0) return;
  const near = (q: Spot, r: number) => Math.hypot(q[0] - p.pos[0], q[1] - p.pos[2]) < r;
  pl.relics.forEach((q, i) => {
    if (s.took.includes(i) || !near(q, 0.9)) return;
    s.took.push(i);
    s.relics++;
    br.breakIt(game, 'relic-' + i, [0, 0]);
    game.emit('relic', { n: s.relics, at: [q[0], 0.8, q[1]] });
    // the crypt answers: a darter rises in the dark for each relic, two for the last
    for (const d of pl.dens.slice(s.relics - 1, s.relics === RELICS ? s.relics + 1 : s.relics)) game.spawnActor({ actor: 'darter', kind: 'darter', at: [d[0], null as unknown as number, d[1]], brain: darterBrain, tags: ['enemy'] });
    if (s.relics === RELICS) {
      s.sealOpen = true;
      br.breakIt(game, 'seal', [0, 0]);
      game.emit('seal', { at: [pl.exit[0], 0.5, pl.exit[1]] });
    }
  });
  pl.crates.forEach((q, i) => {
    if (i >= POTIONS || s.drank.includes(i) || br.intact('crate-' + i) || !near(q, 0.8) || p.hp >= HERO_HP) return;
    s.drank.push(i);
    br.breakIt(game, 'potion-' + i, [0, 0]);
    const before = p.ch.st.hp;
    p.ch.st.hp = p.hp = Math.min(HERO_HP, before + HEAL);
    game.emit('heal', { hp: p.hp - before, at: [q[0], 0.3, q[1]] });
  });
}

export default defineGame<CriptaState>({
  id: 'cripta',
  name: 'A Cripta',
  scene,
  actors: {
    hero: { spec: walker, hp: HERO_HP },
    ghoul: { spec: ghoul, max: 6, hp: 2, radius: 0.34 },
    darter: { spec: darter, max: 4, hp: 1, radius: 0.28 },
    guardian: { spec: guardian, max: 1, hp: GUARDIAN_HP, radius: 0.68, damage: 2 }
  },
  breakables: [
    ...Array.from({ length: CRATES }, (_, i) => ({ tag: 'crate-' + i, hits: 2 })),
    ...Array.from({ length: RELICS }, (_, i) => ({ tag: 'relic-' + i, by: ['nobody'] as string[], pieces: 0.08, push: 1.5 })),
    ...Array.from({ length: POTIONS }, (_, i) => ({ tag: 'potion-' + i, by: ['nobody'] as string[], pieces: 0.08, push: 1 })),
    { tag: 'seal', by: ['nobody'], mode: 'rubble' as const, pieces: 0.35, push: 5 }
  ],
  brains: { ghoul: ghoulBrain, darter: darterBrain, guardian: guardianBrain },
  combat: { invuln: 0.5, respawn: 1.5, assist: 120 },
  effects: { fx: 400, debris: 900 },
  camera: { stiffness: 6, shake: 1 },
  hud: {
    lines(game) {
      const s = game.state;
      if (s.won) return ['THE CRYPT IS BEHIND YOU', `KILLS ${s.kills}  FALLS ${s.falls}`];
      if (s.lost) return ['THE CRYPT KEEPS YOU', 'RELOAD WITH &FRESH=1'];
      const out = [s.sealOpen ? 'BEAT THE GUARDIAN, GET OUT' : `RELICS ${s.relics}/${RELICS}`, `LIVES ${LIVES - s.falls}  KILLS ${s.kills}`];
      if (s.guardian !== null && s.guardian > 0) out.push(`GUARDIAN ${'#'.repeat(s.guardian)}`);
      return out;
    },
    message(e) {
      if (e.name === 'relic') return `RELIC ${(e.data as { n: number }).n}/${RELICS}: THE DEAD STIR`;
      if (e.name === 'seal') return 'THE SEAL BREAKS';
      if (e.name === 'call') return 'THE GUARDIAN CALLS';
      if (e.name === 'heal') return `+${(e.data as { hp: number }).hp} HEALTH`;
      if (e.name === 'locked') return 'THE GUARDIAN STILL STANDS';
      if (e.name === 'won') return 'FREEDOM';
      if (e.name === 'lost') return 'DEFEAT';
      if (e.name === 'break') return null;
      return undefined;
    }
  },
  sounds: { relic: 'respawn', seal: 'crash', call: 'blip', heal: 'save', won: 'respawn', locked: 'blip' },
  init(game) {
    const d = dungeonOf(game.world),
      p = plan(d);
    game.spawnActor({ actor: 'hero', kind: 'player', at: [d.start[0], null as unknown as number, d.start[1]], brain: 'player', tags: ['player'] });
    // ghouls patrol from the far dens; the Guardian stands beside the seal
    for (const s of p.dens.slice(6, 10)) game.spawnActor({ actor: 'ghoul', kind: 'ghoul', at: [s[0], null as unknown as number, s[1]], brain: ghoulBrain, tags: ['enemy'] });
    game.spawnActor({ actor: 'guardian', kind: 'guardian', at: [d.exit[0] + 1.6, null as unknown as number, d.exit[1]], brain: guardianBrain, tags: ['enemy'] });
    game.spawnTrigger({
      at: [d.exit[0], null as unknown as number, d.exit[1]],
      shape: { r: 0.7 },
      onEnter(_who, g) {
        // only says why the way is shut; the way out itself is checked every step (below), since a player may already
        // stand on it when the Guardian falls
        const s = g.state as CriptaState;
        if (!s.won && !s.lost && s.sealOpen && s.guardian !== 0) g.emit('locked');
      }
    });
    return { relics: 0, took: [], drank: [], sealOpen: false, guardian: null, exit: d.exit, kills: 0, falls: 0, won: false, lost: false };
  },
  step(game) {
    const s = game.state;
    if (s.won || s.lost) return;
    pickups(game);
    for (const e of game.events) {
      if (e.name !== 'death') continue;
      const d = e.data as { team: string; kind: string; at: [number, number, number] };
      if (d.team === 'player') {
        s.falls++;
        if (s.falls >= LIVES) {
          s.lost = true;
          game.emit('lost');
        }
      } else {
        s.kills++;
        if (d.kind === 'guardian') {
          s.guardian = 0;
          game.effects?.ignite(d.at[0], d.at[2], 1.5);
        }
      }
    }
    const g = game.entities.find(e => e.type === 'actor' && (e as Actor).actor === 'guardian' && e.alive) as Actor | undefined;
    if (s.guardian !== 0) s.guardian = s.sealOpen && g ? Math.max(0, g.hp) : null;
    // the way out: open, its keeper fallen, and the player standing on it
    const p = game.player;
    if (s.sealOpen && s.guardian === 0 && p && p.deadFor < 0 && Math.hypot(p.pos[0] - s.exit[0], p.pos[2] - s.exit[1]) < 0.7) {
      s.won = true;
      game.emit('won');
    }
  }
});
