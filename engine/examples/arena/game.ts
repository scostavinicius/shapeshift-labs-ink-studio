// The arena: the engine's demonstration game. A round stone arena ringed by a low wall and pillars, under a night sky.
// Three waves come at the player from the four gates in the ring:
//   1. three grunts (slow, heavy blows)
//   2. two grunts and three darters (quick, frail, in and out)
//   3. the warden: big, slow, a spinning blow that takes 2; at half health it calls two darters
// Victory: the warden falls. Defeat: the player falls three times. Between waves, a breath of 2.5 seconds, and the
// player gets 3 health back.
// The player's swing turns to the nearest foe (combat.assist), so a fight can be won with the keys alone, or by a script.
import { chaser, defineGame, type Actor, type Brain, type Game } from '../../src/game/index';
import { walker } from '../farol-walk/game';

const PALETTE = [
  0x07080f, // 0 night
  0x161a28, 0x262c40, 0x3c4460, 0x5e6886, 0x8f97b0, // 1-5 stone, dark to light
  0x2b2420, 0x463a30, 0x6a5846, 0x917a60, // 6-9 sand of the arena floor
  0x3b2a55, 0x5c4380, 0x8c6bb5, // 10-12 purples (grunts)
  0x4c1020, 0x8e2328, 0xc9433a, // 13-15 reds (the player: the walker's body)
  0xb7b2a6, 0xece4cc, // 16-17 whites (heads)
  0xffd77a, 0xff9f45, // 18-19 torch light
  0x1d4a3a, 0x2f7a5a, 0x5fc08a, // 20-22 greens (darters)
  0x3a1416, 0x6b1f22, 0xa8342c, 0xe0603a // 23-26 the warden's embers
];

/**
 * The arena: a sand disc 20 across with a stone rim, a ring wall with four gates, pillars and torches. `density` scales
 * how finely its surfaces are sampled (splats grow with its square): 1 is the game's own, ~2.8 makes ~300 000 splats
 * (engine/examples/arena-dense, for measuring). `adaptive` turns on the kit's adaptive sampling (docs/adaptive-sculpt-sampling.md):
 * broad faces sampled coarser, bevels and curves finer.
 */
export const makeArenaScene = (density = 1, adaptive: boolean | Record<string, unknown> = false) => (kit: any) => ({
  id: 'arena',
  name: 'The Arena',
  seed: 9,
  build(seed: number) {
    const K = kit.KIT;
    const B = kit.makeBuilder(seed, PALETTE);
    const S = K.sculpt(kit.makeSculpt(B));
    S.sun = B.norm([-0.3, 0.85, 0.4]);
    S.amb = 0.25;
    const stone = { r: [1, 2, 3, 4, 5] };
    // the floor: a disc of sand on a wider disc of stone
    S.lathe([0, -1.5, 0], 1.5, 11.5, stone, { res: 0.25 / density });
    S.lathe([0, -0.45, 0], 0.5, 9.8, { r: [6, 7, 8, 9] }, { res: 0.2 / density });
    // the ring wall: segments of a low wall between four gates (north, east, south, west)
    for (let k = 0; k < 24; k++) {
      const a = ((k + 0.5) / 24) * Math.PI * 2;
      if (k % 6 === 2 || k % 6 === 3) continue; // gates at 90° steps
      const x = Math.cos(a) * 10.6,
        z = Math.sin(a) * 10.6;
      S.ball([x, 0.5, z], [0.95, 0.55, 0.95], stone, { res: 0.16 / density });
    }
    // pillars either side of each gate, with torches
    for (let g = 0; g < 4; g++) {
      const a = (g / 4) * Math.PI * 2 + Math.PI / 4;
      for (const off of [-0.32, 0.32]) {
        const x = Math.cos(a + off) * 10.8,
          z = Math.sin(a + off) * 10.8;
        S.box([x, 1.6, z], [0.45, 1.6, 0.45], stone, { res: 0.14 / density });
        S.ball([x, 3.45, z], 0.32, { r: [18, 19], em: true }, { res: 0.08 / density, ghost: true });
      }
    }
    // a worn mark at the middle
    S.lathe([0, 0.02, 0], 0.03, 2.2, { r: [7, 8] }, { res: 0.2 / density });
    if (adaptive) S.adaptiveSampling = adaptive;
    S.bake();
    return B.finish({ cam: { target: [0, 0.5, 0], dist: 22, pitch: 0.82, yaw: 0.3 }, detail: 7, radius: 12, dither: 0.2 });
  }
});

// ---------------------------------------------------------------------------------------------------------- the cast

const grunt = {
  ...walker,
  id: 'grunt',
  atk: 'pound',
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0, 0.5, 0], [0.38, 0.42, 0.38], { r: [10, 11, 12] }, T('root'));
    S.ball([0, 1.0, 0], 0.21, { r: [16, 17, 17] }, T('head'));
  }
};

const darter = {
  ...walker,
  id: 'darter',
  height: 1.0,
  atk: 'peck',
  speed: 1.25,
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0, 0.45, 0], [0.26, 0.32, 0.3], { r: [20, 21, 22] }, T('root'));
    S.ball([0, 0.85, 0], 0.17, { r: [21, 22, 22] }, T('head'));
  }
};

const warden = {
  id: 'warden',
  height: 2.2,
  atk: 'spin',
  reach: 1.9,
  speed: 0.8,
  pts: { hip: [0, 0.9, 0], chest: [0, 1.3, 0], hem: [0, 0.55, 0], neck: [0, 1.75, 0] },
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0, 0.95, 0], [0.75, 0.85, 0.7], { r: [23, 24, 25] }, T('root'));
    S.ball([0, 1.95, 0], 0.4, { r: [24, 25, 26] }, T('head'));
  }
};

// ---------------------------------------------------------------------------------------------------------- brains

const gruntBrain = chaser({ sight: 30, needsLine: false, speed: 0.7, cooldown: 1.3 });
const darterBrain = chaser({ sight: 30, needsLine: false, speed: 1, cooldown: 0.8, retreat: 0.7 });
const wardenChase = chaser({ sight: 30, needsLine: false, speed: 0.55, cooldown: 2.2, retreat: 0.5 });
const wardenRage = chaser({ sight: 30, needsLine: false, speed: 0.75, cooldown: 1.6, retreat: 0.4 });

/** the warden: chases slowly; at half health, once, it calls two darters and gets angrier */
const wardenBrain: Brain = (self, game, dt) => {
  const g = game as Game<ArenaState>;
  if (!self.data.called && self.hp <= WARDEN_HP / 2 && self.deadFor < 0) {
    self.data.called = true;
    for (const gate of ['east', 'west']) g.spawnActor({ actor: 'darter', at: gate, brain: darterBrain, tags: ['enemy'] });
    g.emit('call');
  }
  return (self.data.called ? wardenRage : wardenChase)(self, game, dt);
};

// ---------------------------------------------------------------------------------------------------------- the rules

const WARDEN_HP = 8,
  LIVES = 3,
  BREATH = 2.5,
  /** health the player gets back when a wave is cleared */
  HEAL = 3,
  HERO_HP = 6;

/** what each wave sends, from which gates */
const WAVES: { actor: string; gate: string }[][] = [
  [
    { actor: 'grunt', gate: 'north' },
    { actor: 'grunt', gate: 'east' },
    { actor: 'grunt', gate: 'west' }
  ],
  [
    { actor: 'grunt', gate: 'north' },
    { actor: 'grunt', gate: 'south' },
    { actor: 'darter', gate: 'east' },
    { actor: 'darter', gate: 'west' },
    { actor: 'darter', gate: 'north' }
  ],
  [{ actor: 'warden', gate: 'north' }]
];

const BRAINS: Record<string, Brain> = { grunt: gruntBrain, darter: darterBrain, warden: wardenBrain };

export interface ArenaState {
  /** the wave being fought (1..3), 0 before the first */
  wave: number;
  /** seconds until the next wave comes in, while the arena is clear */
  breath: number;
  kills: number;
  falls: number;
  /** the warden's health, while it is on stage */
  warden: number | null;
  won: boolean;
  lost: boolean;
}

export default defineGame<ArenaState>({
  id: 'arena',
  name: 'The Arena',
  scene: makeArenaScene(1),
  actors: {
    hero: { spec: walker, hp: HERO_HP },
    grunt: { spec: grunt, max: 3, hp: 3, radius: 0.36 },
    darter: { spec: darter, max: 5, hp: 1, radius: 0.28 },
    warden: { spec: warden, max: 1, hp: WARDEN_HP, radius: 0.7, damage: 2 }
  },
  spawns: {
    start: [0, null, 3],
    // the four gates, just inside the ring
    north: [0, null, -8.6],
    east: [8.6, null, 0],
    south: [0, null, 8.6],
    west: [-8.6, null, 0]
  },
  brains: { grunt: gruntBrain, darter: darterBrain, warden: wardenBrain },
  combat: { invuln: 0.45, respawn: 1.5, assist: 180 },
  effects: { fx: 400, debris: 900, weather: { rain: 0.65 } },
  camera: { stiffness: 5, bounds: { min: [-6, 0, -6], max: [6, 2, 6] } },
  hud: {
    lines(game) {
      const s = game.state;
      if (s.won) return ['THE WARDEN HAS FALLEN', `KILLS ${s.kills}`];
      if (s.lost) return ['THE ARENA WINS', 'RELOAD WITH &FRESH=1'];
      const out = [`WAVE ${Math.max(1, s.wave)}/3`, `LIVES ${LIVES - s.falls}`];
      if (s.warden !== null) out.push(`WARDEN ${'#'.repeat(Math.max(0, s.warden))}`);
      return out;
    },
    message(e, game) {
      if (e.name === 'wave') return (e.data as { n: number }).n === 3 ? 'THE WARDEN COMES' : `WAVE ${(e.data as { n: number }).n}`;
      if (e.name === 'call') return 'IT CALLS FOR HELP';
      if (e.name === 'won') return 'VICTORY';
      if (e.name === 'heal') return `+${(e.data as { hp: number }).hp} HEALTH`;
      if (e.name === 'lost') return 'DEFEAT';
      if (e.name === 'death' && (e.data as { kind: string }).kind === 'warden') return null;
      return undefined;
    }
  },
  sounds: { wave: 'blip', call: 'blip', won: 'respawn', heal: 'save' },
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    return { wave: 0, breath: 1.5, kills: 0, falls: 0, warden: null, won: false, lost: false };
  },
  step(game, dt) {
    const s = game.state;
    if (s.won || s.lost) return;
    for (const e of game.events) {
      if (e.name !== 'death') continue;
      const d = e.data as { team: string; kind: string; at: [number, number, number] };
      if (d.team === 'player') {
        s.falls++;
        if (s.falls >= LIVES) {
          s.lost = true;
          // the arena wins: everyone else leaves
          for (const x of game.byTag('enemy')) game.remove(x);
          game.emit('lost');
        }
        continue;
      }
      s.kills++;
      if (d.kind === 'warden') {
        s.won = true;
        s.warden = 0;
        game.effects?.ignite(d.at[0], d.at[2], 2.5);
        game.emit('won');
      } else game.effects?.ignite(d.at[0], d.at[2], 0.8);
    }
    if (s.won || s.lost) return;
    const warden = game.entities.find(e => e.type === 'actor' && (e as Actor).actor === 'warden' && e.alive) as Actor | undefined;
    s.warden = warden ? Math.max(0, warden.hp) : s.wave === 3 ? 0 : null;
    // the arena is clear: breathe (and heal, once), then the next wave
    if (game.byTag('enemy').length === 0 && s.wave < WAVES.length) {
      const p = game.player;
      if (s.wave > 0 && s.breath === BREATH && p && p.deadFor < 0) {
        const before = p.ch.st.hp;
        p.ch.st.hp = p.hp = Math.min(HERO_HP, before + HEAL);
        if (p.hp > before) game.emit('heal', { hp: p.hp - before });
      }
      s.breath -= dt;
      if (s.breath <= 0) {
        s.wave++;
        s.breath = BREATH;
        for (const w of WAVES[s.wave - 1]) game.spawnActor({ actor: w.actor, at: w.gate, brain: BRAINS[w.actor], tags: ['enemy'] });
        game.emit('wave', { n: s.wave });
      }
    }
  }
});
