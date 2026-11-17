// Beacons: a grass plateau with a ruined shrine in the middle and three cold beacons at its edges.
//   - walk up to a beacon to light it (a trigger); each one lit wakes a moth-grunt from the shrine (a spawner prop,
//     so def.brains is set for the save)
//   - two grunts already guard the field and chase you
//   - light all three beacons to win; fall three times and you lose
// Play: node engine/cli.js play beacons. Check: node engine/cli.js check beacons.
import { chaser, defineGame, type Game } from '../../src/game/index';
import { walker } from '../farol-walk/game';

const PALETTE = [
  0x090b16, // 0 sky
  0x1e2230, 0x343a4f, 0x565e78, 0x8790a8, // 1-4 stone
  0x1f3a24, 0x2f5e35, 0x4d8c45, 0x86c05a, // 5-8 grass
  0x23402f, 0x3e6b45, 0x6fa35a, 0xb6d77a, // 9-12 greens (the grunts)
  0x10284c, 0x23528e, 0x3a8cc9, // 13-15 blues (the hero's body: the walker uses 13-15)
  0xb7b2a6, 0xece4cc, // 16-17 whites (heads)
  0xffd77a, // 18 warm light (sparks)
  0x3a2010, 0x8a4a1a, 0xf0a040 // 19-21 the beacons' embers
];

const BEACONS: [number, number][] = [
  [-6.5, -6.5],
  [6.5, -6.5],
  [0, 7.5]
];

const beaconScene = (kit: any) => ({
  id: 'beacons',
  name: 'Beacons',
  seed: 3,
  build(seed: number) {
    const K = kit.KIT;
    const B = kit.makeBuilder(seed, PALETTE);
    const S = K.sculpt(kit.makeSculpt(B));
    S.sun = B.norm([-0.4, 0.8, 0.5]);
    const stone = { r: [1, 2, 3, 4] };
    // the plateau: 20 x 20 of grass, top at y = 0, on a thick stone base
    S.box([0, -0.5, 0], [10, 0.5, 10], { r: [5, 6, 7, 8] }, { res: 0.2 });
    S.box([0, -2, 0], [9.6, 1.2, 9.6], stone, { res: 0.25 });
    // the shrine ruin in the middle: four broken columns round a low dais
    S.box([0, 0.1, 0], [1.6, 0.1, 1.6], stone, { res: 0.15 });
    for (const [x, z, h] of [[-1.4, -1.4, 1.2], [1.4, -1.4, 0.7], [-1.4, 1.4, 0.5], [1.4, 1.4, 1.0]]) S.box([x, h, z], [0.3, h, 0.3], stone, { res: 0.12 });
    // scattered boulders
    for (const [x, z, r] of [[-4, 2, 0.7], [4.5, 3, 0.9], [-7.5, 3.5, 0.6], [3, -4, 0.6]]) S.ball([x, r * 0.5, z], r, stone, { res: 0.12 });
    // the beacons: a stone post each
    for (const [x, z] of BEACONS) S.box([x, 0.9, z], [0.35, 0.9, 0.35], stone, { res: 0.1 });
    S.bake();
    // the embers on top of each post: drawn, not ground
    for (const [x, z] of BEACONS) S.ball([x, 2.0, z], 0.3, { r: [19, 20, 21], em: true }, { res: 0.08, ghost: true });
    S.bake();
    return B.finish({ cam: { target: [0, 0.5, 0], dist: 26, pitch: 0.8, yaw: 0.4 }, detail: 6, radius: 12, dither: 0.2 });
  }
});

const grunt = {
  ...walker,
  id: 'grunt',
  atk: 'peck',
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0, 0.45, 0], [0.32, 0.36, 0.32], { r: [9, 10, 11] }, T('root'));
    S.ball([0, 0.95, 0], 0.22, { r: [10, 11, 12] }, T('head'));
  }
};

const gruntBrain = chaser({ sight: 7, needsLine: false });

export interface BeaconState {
  lit: number[];
  falls: number;
  woken: number;
  won: boolean;
  lost: boolean;
}

const LIVES = 3;

export default defineGame<BeaconState>({
  id: 'beacons',
  name: 'Beacons',
  scene: beaconScene,
  actors: {
    hero: { spec: walker, hp: 5 },
    grunt: { spec: grunt, max: 5, hp: 2, radius: 0.32 }
  },
  spawns: {
    start: [0, null, 3.5],
    shrine: [0, null, -2.6],
    west: [-5, null, -2],
    east: [5, null, 0]
  },
  brains: { grunt: gruntBrain },
  effects: { fx: 300, debris: 600 },
  combat: { invuln: 0.6 },
  camera: { stiffness: 4 },
  hud: {
    lines: game => {
      const s = game.state;
      if (s.won) return ['THE BEACONS BURN. YOU WIN'];
      if (s.lost) return ['THE DARK TAKES YOU'];
      return [`BEACONS ${s.lit.length}/${BEACONS.length}`, `LIVES ${LIVES - s.falls}`];
    },
    message: e => (e.name === 'lit' ? 'A BEACON IS LIT' : e.name === 'woken' ? 'SOMETHING STIRS' : undefined)
  },
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    game.spawnActor({ actor: 'grunt', at: 'west', brain: gruntBrain, tags: ['enemy'] });
    game.spawnActor({ actor: 'grunt', at: 'east', brain: gruntBrain, tags: ['enemy'] });
    BEACONS.forEach(([x, z], i) => {
      game.spawnTrigger({
        kind: 'beacon',
        at: [x, 0, z],
        shape: { r: 1.3 },
        watch: ['player'],
        onEnter(_who, g) {
          const s = (g as Game<BeaconState>).state;
          if (s.won || s.lost || s.lit.includes(i)) return;
          s.lit.push(i);
          g.emit('lit', { i });
          g.effects?.fx.ring(x, 2.0, z, 21, 0.2, 2.0, 0.8, 24);
          g.effects?.fx.sparks(x, 2.0, z, 18, 30, 3);
          if (s.lit.length >= BEACONS.length) s.won = true;
        }
      });
    });
    // the shrine wakes one grunt for each beacon lit (but not after the last)
    game.spawnProp({
      kind: 'shrine',
      at: 'shrine',
      update(self, g: Game<BeaconState>) {
        const s = g.state;
        if (s.won || s.lost || s.woken >= s.lit.length) return;
        s.woken++;
        g.spawnActor({ actor: 'grunt', at: self.pos, brain: gruntBrain, tags: ['enemy'] });
        g.emit('woken', { n: s.woken });
      }
    });
    return { lit: [], falls: 0, woken: 0, won: false, lost: false };
  },
  step(game) {
    for (const e of game.events) {
      if (e.name !== 'death') continue;
      const d = e.data as { team: string };
      if (d.team === 'player' && !game.state.won) {
        game.state.falls++;
        if (game.state.falls >= LIVES) game.state.lost = true;
      }
    }
  }
});
