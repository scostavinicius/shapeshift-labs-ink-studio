// A fight on the farol's island: the walker against two grunts that chase, swing and back off. A grunt that dies goes to
// pieces and leaves the ground round it scorched, and the scorch stays. The player has 5 health and stands up again at the
// start 1.5 s after dying. state: kills, deaths, and whether every grunt is down.
import { chaser, defineGame } from '../../src/game/index';
import { walker } from '../farol-walk/game';

/** a grunt: the walker's shape, broader, in the farol's purples, with a heavier blow */
export const grunt = {
  ...walker,
  id: 'grunt',
  height: 1.1,
  atk: 'pound',
  sculpt(S: any, T: (bone: string) => unknown) {
    S.ball([0, 0.48, 0], [0.38, 0.4, 0.38], { r: [25, 26, 27] }, T('root'));
    S.ball([0, 0.95, 0], 0.2, { r: [5, 4, 5] }, T('head'));
  }
};

export interface FightState {
  kills: number;
  deaths: number;
  won: boolean;
}

export default defineGame<FightState>({
  id: 'farol-fight',
  name: 'A fight on the farol',
  scene: 'showcase/farol.js',
  actors: {
    hero: { spec: { ...walker, atk: 'slash' }, max: 1, hp: 5 },
    grunt: { spec: grunt, max: 2, hp: 3, radius: 0.34 }
  },
  spawns: { start: [3, null, 2], east: [5.5, null, -0.5], south: [1, null, 4.5] },
  // a damp night: a grunt's fall scorches the grass round it, and the fire does not take the whole island
  effects: { weather: { rain: 0.6 } },
  combat: { invuln: 0.5, respawn: 1.5 },
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    game.spawnActor({ actor: 'grunt', at: 'east', brain: chaser({ sight: 7 }), tags: ['enemy'] });
    game.spawnActor({ actor: 'grunt', at: 'south', brain: chaser({ sight: 7, cooldown: 1.4 }), tags: ['enemy'] });
    return { kills: 0, deaths: 0, won: false };
  },
  step(game) {
    const s = game.state;
    for (const e of game.events) {
      if (e.name !== 'death') continue;
      const d = e.data as { team: string; at: [number, number, number] };
      if (d.team === 'enemy') {
        s.kills++;
        game.effects?.ignite(d.at[0], d.at[2], 1.2);
      } else s.deaths++;
    }
    s.won = game.byTag('enemy').length === 0;
  }
});
