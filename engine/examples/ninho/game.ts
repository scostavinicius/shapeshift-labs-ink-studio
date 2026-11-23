// The nest: a serpent in the arena (stages 29-30). Its head is an ordinary actor (a K.character: it chases, bites, has
// health); its length is a trailing body (actors.<name>.tail): a chain of the kit's procedural body lying on the sand,
// drawn as one thick curve, that the player cannot walk through. Kill the serpent to win.
import { chaser, defineGame, slither } from '../../src/game/index';
import { makeArenaScene } from '../arena/game';
import { walker } from '../farol-walk/game';

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

/** it chases, swinging side to side as it goes */
const serpentBrain = slither(chaser({ sight: 30, needsLine: false, speed: 0.8, cooldown: 1.1, retreat: 0.6 }), { swing: 55, rate: 1.1 });

export interface NestState {
  won: boolean;
}

export default defineGame<NestState>({
  id: 'ninho',
  name: 'The Nest',
  scene: makeArenaScene(1),
  actors: {
    hero: { spec: walker, hp: 6 },
    serpent: {
      spec: serpent,
      hp: 6,
      radius: 0.32,
      tail: { joints: 12, length: 4.2, width: 0.62, color: '#2f7a5a', pigment: [[0, '#2f7a5a'], [0.6, '#1d4a3a'], [1, '#5fc08a']] }
    }
  },
  spawns: { start: [3, null, 3], nest: [-6, null, 0] },
  brains: { serpent: serpentBrain },
  combat: { invuln: 0.45, respawn: 1.5, assist: 180 },
  effects: { fx: 300, debris: 600 },
  camera: { stiffness: 5 },
  hud: {
    lines: game => (game.state.won ? ['THE SERPENT IS DEAD'] : ['KILL THE SERPENT'])
  },
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    game.spawnActor({ actor: 'serpent', at: 'nest', face: Math.PI / 2, brain: serpentBrain, tags: ['enemy'] });
    return { won: false };
  },
  step(game) {
    for (const e of game.events) if (e.name === 'death' && (e.data as { kind: string }).kind === 'serpent' && !game.state.won) {
      game.state.won = true;
      game.emit('won');
    }
  }
});
