// The smallest game: one character walking about the farol's floating island. The scene is showcase/farol.js as it stands;
// the island, the lighthouse and the cottage are ground and walls because the engine samples them after each bake.
import { defineGame } from '../../src/game/index';

/** A small round walker (the shape of the toolkit's own character test, in the farol's reds and whites). */
export const walker = {
  id: 'walker',
  height: 1.2,
  pts: { hip: [0, 0.5, 0], chest: [0, 0.7, 0], hem: [0, 0.3, 0], neck: [0, 0.95, 0] },
  sculpt(S: any, T: (bone: string) => unknown) {
    S.ball([0, 0.5, 0], [0.32, 0.4, 0.32], { r: [13, 14, 15] }, T('root'));
    S.ball([0, 1.0, 0], 0.22, { r: [16, 17, 17] }, T('head'));
  }
};

export default defineGame({
  id: 'farol-walk',
  name: 'A walk on the farol',
  scene: 'showcase/farol.js',
  actors: { walker: { spec: walker, max: 1, radius: 0.3 } },
  spawns: { start: [3, null, 2] },
  camera: { stiffness: 5 },
  init(game) {
    game.spawnActor({ actor: 'walker', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    return { steps: 0 };
  },
  step(game) {
    (game.state as { steps: number }).steps++;
  }
});
