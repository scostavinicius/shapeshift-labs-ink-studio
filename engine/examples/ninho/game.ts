// The nest: a serpent in the arena (stages 29-30). Its head is an ordinary actor (a K.character: it chases, bites, has
// health); its length is a trailing body: a chain of joints lying on the sand, drawn as one thick curve, that the player
// cannot walk through. The serpent's body has branches (stage 33, actors.<name>.body): two pairs of fins growing from its
// spine, swaying as it goes. The hatchlings have a plain tail (actors.<name>.tail). Tufts of grass grow on the sand
// (stage 35), but not in the nest.
//
// The campaign is data (stage 31): mission.json, in the kit's story format, says what is to be done (kill the serpent,
// then the brood that hatches where it fell, then stand in the nest) and what loses (falling three times); the actions
// below say what its events do. There is no step(): no rule of this game is code.
import { chaser, defineGame, slither, tufts } from '../../src/game/index';
import { makeArenaScene } from '../arena/game';
import { walker } from '../farol-walk/game';
import mission from './mission.json';
import type { ChainOptions } from '../../src/game/types';

/** a fin of the serpent's: a short chain from a joint of its spine, its tip swaying, not in anyone's way */
function fin(name: string, from: string, dir: number, phase: number, size = 1): Record<string, ChainOptions> {
  return {
    [name]: {
      from,
      dir,
      joints: 4,
      length: 1.1 * size,
      width: [0.4, 0.34, 0.24, 0.16].map(w => w * size),
      color: '#e2a46b',
      pigment: [[0, '#b8734a'], [1, '#f0c27a']],
      solid: false,
      sway: { swing: 28, rate: 1.1, phase }
    }
  };
}

const serpent = {
  id: 'serpent',
  height: 0.7,
  atk: 'peck',
  speed: 1.1,
  pts: { hip: [0, 0.3, 0], chest: [0, 0.4, 0], hem: [0, 0.2, 0], neck: [0, 0.5, 0] },
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0.05, 0.32, 0], [0.36, 0.26, 0.3], { r: [20, 21, 22] }, T('root'));
    S.ball([0.18, 0.42, 0.1], 0.06, { r: [18, 19], em: true }, T('head'));
    S.ball([0.18, 0.42, -0.1], 0.06, { r: [18, 19], em: true }, T('head'));
  }
};

/** a hatchling: a small serpent, quicker and frailer */
const hatchling = {
  ...serpent,
  id: 'hatchling',
  height: 0.5,
  speed: 1.3,
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0.04, 0.24, 0], [0.24, 0.18, 0.2], { r: [20, 21, 22] }, T('root'));
    S.ball([0.12, 0.31, 0.07], 0.045, { r: [18, 19], em: true }, T('head'));
    S.ball([0.12, 0.31, -0.07], 0.045, { r: [18, 19], em: true }, T('head'));
  }
};

/** they chase, swinging side to side as they go */
const serpentBrain = slither(chaser({ sight: 30, needsLine: false, speed: 0.8, cooldown: 1.1, retreat: 0.6 }), { swing: 55, rate: 1.1 });
const hatchlingBrain = slither(chaser({ sight: 30, needsLine: false, speed: 0.9, cooldown: 0.9, retreat: 0.5 }), { swing: 50, rate: 1.6 });

export interface NestState {
  won: boolean;
  lost: boolean;
}

export default defineGame<NestState>({
  id: 'ninho',
  name: 'The Nest',
  scene: makeArenaScene(1),
  build: ctx => tufts(ctx, { count: 130, area: { center: [0, 0], radius: 8.4, inner: 1 }, skip: (x, z) => Math.hypot(x + 6, z) < 1.6 }),
  actors: {
    hero: { spec: walker, hp: 6 },
    serpent: {
      spec: serpent,
      hp: 6,
      radius: 0.32,
      body: {
        chains: {
          spine: { joints: 12, length: 4.2, width: 0.62, color: '#2f7a5a', pigment: [[0, '#2f7a5a'], [0.6, '#1d4a3a'], [1, '#5fc08a']] },
          // fins: from the spine, sideways and a little back, the two of a pair swinging opposite, the back pair later
          ...fin('fore-left', 'spine.3', 115, 0, 1.4),
          ...fin('fore-right', 'spine.3', -115, 0.5, 1.4),
          ...fin('hind-left', 'spine.7', 120, 0.25, 1.1),
          ...fin('hind-right', 'spine.7', -120, 0.75, 1.1)
        }
      }
    },
    hatchling: {
      spec: hatchling,
      max: 2,
      hp: 2,
      radius: 0.24,
      tail: { joints: 7, length: 1.8, width: 0.4, color: '#2f7a5a', pigment: [[0, '#2f7a5a'], [1, '#5fc08a']] }
    }
  },
  spawns: { start: [3, null, 3], nest: [-6, null, 0] },
  brains: { serpent: serpentBrain, hatchling: hatchlingBrain },
  combat: { invuln: 0.45, respawn: 1.5, assist: 180 },
  effects: { fx: 300, debris: 600 },
  camera: { stiffness: 5 },
  sounds: { won: 'confirm', lost: 'warning' },
  story: {
    document: mission,
    actions: {
      // the serpent comes out of its nest when the hunt begins
      wake: {
        on: { kind: 'story-stage-entered', where: { path: '/stage', value: 'serpent' } },
        actions: [
          { action: 'game/spawn', args: { actor: 'serpent', at: 'nest', face: Math.PI / 2 } },
          { action: 'game/say', args: { text: 'THE SERPENT WAKES' } }
        ]
      },
      // where it falls, its brood hatches
      hatch: {
        on: { kind: 'death', where: { path: '/kind', value: 'serpent' } },
        limit: 1,
        actions: [
          { action: 'game/spawn', args: { actor: 'hatchling', at: [0, 0, 0], count: 2 }, bindings: { '/at': '/at' } },
          { action: 'game/say', args: { text: 'THE BROOD HATCHES' } },
          { action: 'game/sound', args: { name: 'warning' } }
        ]
      },
      home: {
        on: { kind: 'story-stage-entered', where: { path: '/stage', value: 'nest' } },
        actions: [{ action: 'game/say', args: { text: 'STAND IN THE NEST' } }]
      },
      won: {
        on: { kind: 'story-transition', where: { all: [{ path: '/story', value: 'hunt' }, { path: '/to', value: 'completed' }] } },
        actions: [{ action: 'game/win' }, { action: 'game/say', args: { text: 'THE NEST IS YOURS' } }]
      },
      lost: {
        on: { kind: 'story-transition', where: { all: [{ path: '/story', value: 'falls' }, { path: '/to', value: 'failed' }] } },
        actions: [{ action: 'game/lose' }, { action: 'game/say', args: { text: 'THE NEST WINS' } }]
      }
    }
  },
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    return { won: false, lost: false };
  }
});
