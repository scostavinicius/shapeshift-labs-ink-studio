// A Masmorra (stage 25): a dungeon laid out from the seed (stage 17), lit by torches (21), with rain leaking into the
// first room (22), crates made from a textured GLB that a blow smashes (19, 24), ghouls that hear, see in front, walk
// round walls and search where they lost you (18), a mimic that waits as a crate and carries one as its body (24), the
// picture jolting on hits (20) and every sound from its place (23). Find the way out before you fall three times.
import { defineGame, dungeonOf, DUNGEON_PALETTE, hunter, makeDungeonScene, placeAsset, placePart, type DungeonLayout } from '../../src/game/index';
import type { Actor } from '../../src/game/types';
import { walker } from '../farol-walk/game';
import crate from '../../assets/crate.json';

const PALETTE = DUNGEON_PALETTE;
const LIVES = 3;
const CRATES = 6;
const HERO_HP = 5;

/** Where the crates go: spots away from the start and the exit, a little off their middle (never blocking a way). */
export function crateSpots(d: DungeonLayout): [number, number][] {
  const far = (p: [number, number], q: [number, number], r: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) > r;
  const out = d.spots.filter(s => far(s, d.start, 3) && far(s, d.exit, 2)).slice(0, CRATES);
  if (out.length < CRATES) throw new Error(`masmorra: only ${out.length} places for ${CRATES} crates; another seed or a larger map`);
  return out.map(([x, z]) => [x + 0.55, z + 0.45]);
}

/** Where the ghouls start: the spots farthest from the start, in order. */
function lairs(d: DungeonLayout): [number, number][] {
  return [...d.spots].sort((a, b) => Math.hypot(b[0] - d.start[0], b[1] - d.start[1]) - Math.hypot(a[0] - d.start[0], a[1] - d.start[1]));
}

const scene = makeDungeonScene({
  id: 'masmorra',
  name: 'A Masmorra',
  kind: 'rooms',
  width: 30,
  height: 20,
  torches: 8,
  dress(S, K, d, B) {
    crateSpots(d).forEach(([x, z], i) => placeAsset(K, S, crate, { at: [x, 0, z], size: 0.8, turn: i * 0.7, palette: PALETTE, tag: 'crate-' + i, cells: 20, res: 0.06 }));
    // the way out: a glowing ring on the floor
    S.ball([d.exit[0], 0.02, d.exit[1]], [0.55, 0.03, 0.55], { r: [19, 20, 21], em: true }, { res: 0.05, ghost: true });
    // rain leaking through the ceiling of the first room
    K.weather.fall(B, { kind: 'rain', box: [d.start[0] - 2, d.start[0] + 2, d.start[1] - 2, d.start[1] + 2], top: 3.5, n: 220, cols: [22, 23, 24], ground: () => 0, wind: [0.6, 0.3] });
  }
});

// the cast: a ghoul of stone and moss, and the mimic, whose body is a crate (the GLB, as a rigid part on its root bone)
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
const mimic = {
  ...walker,
  id: 'mimic',
  atk: 'peck',
  speed: 1.15,
  sculpt(S: any, T: (b: string) => unknown) {
    placePart(S, crate, { at: [0, 0.12, 0], size: 0.7, palette: PALETTE, bone: T('root') });
    S.ball([0.18, 0.62, 0], [0.12, 0.05, 0.2], { r: [13, 14, 15] }, T('head')); // a tongue between the lid and the box
  }
};

const ghoulBrain = hunter({ sight: 9, fov: 140, hearing: 2.5, patrol: 'spots', speed: 0.8, cooldown: 1.2 });
const mimicBrain = hunter({ sight: 3, fov: 360, hearing: 2, needsLine: false, speed: 1, cooldown: 0.9, memory: 3 });

interface MasmorraState {
  exit: [number, number];
  kills: number;
  falls: number;
  crates: number;
  won: boolean;
  lost: boolean;
}

export default defineGame<MasmorraState>({
  id: 'masmorra',
  name: 'A Masmorra',
  scene,
  actors: {
    hero: { spec: walker, hp: HERO_HP },
    ghoul: { spec: ghoul, max: 5, hp: 2, radius: 0.34 },
    mimic: { spec: mimic, max: 1, hp: 3, radius: 0.36 }
  },
  breakables: Array.from({ length: CRATES }, (_, i) => ({ tag: 'crate-' + i, hits: 2 })),
  brains: { ghoul: ghoulBrain, mimic: mimicBrain },
  combat: { invuln: 0.5, respawn: 1.5, assist: 120 },
  effects: { fx: 300, debris: 600 },
  camera: { stiffness: 6, shake: 1 },
  hud: {
    lines(game) {
      const s = game.state;
      if (s.won) return ['YOU FOUND THE WAY OUT', `KILLS ${s.kills}  CRATES ${s.crates}`];
      if (s.lost) return ['THE DUNGEON KEEPS YOU', 'RELOAD WITH &FRESH=1'];
      return ['FIND THE WAY OUT', `LIVES ${LIVES - s.falls}  KILLS ${s.kills}`];
    },
    message(e) {
      if (e.name === 'won') return 'FREEDOM';
      if (e.name === 'lost') return 'DEFEAT';
      if (e.name === 'break') return 'SMASH';
      if (e.name === 'wake') return 'A CRATE MOVES';
      return undefined;
    }
  },
  sounds: { won: 'respawn', wake: 'blip' },
  init(game) {
    const d = dungeonOf(game.world);
    game.spawnActor({ actor: 'hero', kind: 'player', at: [d.start[0], null as unknown as number, d.start[1]], brain: 'player', tags: ['player'] });
    const dens = lairs(d);
    for (let i = 0; i < 5 && i < dens.length; i++)
      game.spawnActor({ actor: 'ghoul', kind: 'ghoul', at: [dens[i][0], null as unknown as number, dens[i][1]], brain: ghoulBrain, tags: ['enemy'] });
    // the mimic waits among the crates: next to the last one
    const [mx, mz] = crateSpots(d)[CRATES - 1];
    game.spawnActor({ actor: 'mimic', kind: 'mimic', at: [mx - 0.9, null as unknown as number, mz], brain: mimicBrain, tags: ['enemy'] });
    game.spawnTrigger({
      at: [d.exit[0], null as unknown as number, d.exit[1]],
      shape: { r: 0.8 },
      onEnter(_who, g) {
        const s = g.state as MasmorraState;
        if (s.won || s.lost) return;
        s.won = true;
        g.emit('won');
      }
    });
    return { exit: d.exit, kills: 0, falls: 0, crates: 0, won: false, lost: false };
  },
  step(game) {
    const s = game.state;
    if (s.won || s.lost) return;
    for (const e of game.events) {
      if (e.name === 'break') s.crates++;
      if (e.name === 'hit') {
        const t = game.entities.find(x => x.id === (e.data as { target: number }).target) as Actor | undefined;
        if (t && t.actor === 'mimic' && !t.data.awake) {
          t.data.awake = true;
          game.emit('wake');
        }
      }
      if (e.name !== 'death') continue;
      const d = e.data as { team: string };
      if (d.team === 'player') {
        s.falls++;
        if (s.falls >= LIVES) {
          s.lost = true;
          game.emit('lost');
        }
      } else s.kills++;
    }
  }
});
