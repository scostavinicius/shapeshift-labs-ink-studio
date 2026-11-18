// The arena with its surfaces sampled 2.8 times finer: about 300 000 splats instead of 50 000, the same game otherwise.
// For measuring (stage 11: "the arena keeps 60 fps with 300 000 splats"). Play: node engine/cli.js play arena-dense.
import { defineGame } from '../../src/game/index';
import arena, { makeArenaScene } from '../arena/game';

export default defineGame({ ...arena, id: 'arena-dense', name: 'The Arena (dense)', scene: makeArenaScene(2.8) });
