// The yard: a level written from nothing (its scene is right here), and the parts the other examples do not show.
//   - a spawner (a prop) that sends in a grunt every few seconds, three in all: actors made during play, so the save
//     needs def.brains to bring them back
//   - a gate (a trigger) at the far end: walk into it with every grunt down to win
//   - where a grunt falls the ground freezes for a while (the ground's memory, frost instead of fire)
// Play: node engine/cli.js play yard. Check: node engine/cli.js check yard.
import { chaser, defineGame, type Game } from '../../src/game/index';
import { walker } from '../farol-walk/game';

const PALETTE = [
  0x0a0c14, // 0 sky
  0x1c2030, 0x2f3548, 0x4c5470, 0x7d86a0, // 1-4 stone
  0x3a2c22, 0x5a4532, 0x806447, 0xa98a62, // 5-8 packed earth
  0x3b2a55, 0x5c4380, 0x8c6bb5, 0xb7a6d9, // 9-12 purples (grunts)
  0x4c1020, 0x8e2328, 0xc9433a, // 13-15 reds (the walker)
  0xb7b2a6, 0xece4cc, // 16-17 whites
  0xffd77a, // 18 warm light
  0x2a5a6a, 0x4a9cbc, 0xc6eef6 // 19-21 the gate's glow
];

/** the yard: earth 16 x 20 with a stone wall round it, pillars, and a glowing gate at the north end */
const yardScene = (kit: any) => ({
  id: 'yard',
  name: 'The Yard',
  seed: 5,
  build(seed: number) {
    const K = kit.KIT;
    const B = kit.makeBuilder(seed, PALETTE);
    const S = K.sculpt(kit.makeSculpt(B));
    S.sun = B.norm([-0.35, 0.8, 0.45]);
    const stone = { r: [1, 2, 3, 4] };
    S.box([0, -0.5, 0], [8, 0.5, 10], { r: [5, 6, 7, 8] }, { res: 0.2 });
    // the wall: four low runs, a gap left in the north one for the gate
    S.box([-8.3, 0.6, 0], [0.3, 0.6, 10.3], stone, { res: 0.18 });
    S.box([8.3, 0.6, 0], [0.3, 0.6, 10.3], stone, { res: 0.18 });
    S.box([0, 0.6, 10.3], [8.6, 0.6, 0.3], stone, { res: 0.18 });
    S.box([-5, 0.6, -10.3], [3.6, 0.6, 0.3], stone, { res: 0.18 });
    S.box([5, 0.6, -10.3], [3.6, 0.6, 0.3], stone, { res: 0.18 });
    // pillars to get round
    for (const [x, z] of [[-3, -2], [3, 1], [-2, 4], [4, -5]]) S.box([x, 1, z], [0.5, 1, 0.5], stone, { res: 0.14 });
    S.bake();
    // the gate: two posts and a glowing lintel, drawn but not in the way (ghost: no shadow, not ground)
    S.box([-1.4, 1.4, -10.3], [0.25, 1.4, 0.25], stone, { res: 0.12 });
    S.box([1.4, 1.4, -10.3], [0.25, 1.4, 0.25], stone, { res: 0.12 });
    S.box([0, 2.9, -10.3], [1.7, 0.15, 0.2], { r: [19, 20, 21], em: true }, { res: 0.1, ghost: true });
    S.bake();
    return B.finish({ cam: { target: [0, 0.5, 0], dist: 24, pitch: 0.75, yaw: 0.25 }, detail: 6, radius: 12, dither: 0.2 });
  }
});

const grunt = {
  ...walker,
  id: 'grunt',
  atk: 'pound',
  sculpt(S: any, T: (b: string) => unknown) {
    S.ball([0, 0.5, 0], [0.34, 0.4, 0.34], { r: [9, 10, 11] }, T('root'));
    S.ball([0, 1.0, 0], 0.2, { r: [16, 17, 17] }, T('head'));
  }
};

const gruntBrain = chaser({ sight: 12, needsLine: false });

export interface YardState {
  sent: number;
  kills: number;
  won: boolean;
}

/** how many grunts the spawner sends in all, and how often */
const WAVE = 3,
  EVERY = 4;

export default defineGame<YardState>({
  id: 'yard',
  name: 'The Yard',
  scene: yardScene,
  actors: {
    hero: { spec: walker, hp: 5 },
    grunt: { spec: grunt, max: WAVE, hp: 2, radius: 0.34 }
  },
  spawns: { start: [0, null, 7], pen: [6, null, 8], gate: [0, null, -9.5] },
  brains: { grunt: gruntBrain },
  effects: { fx: 300, debris: 600, weather: { rain: 0.4 } },
  combat: { invuln: 0.5 },
  camera: { stiffness: 4 },
  hud: {
    lines: game => {
      const s = game.state;
      if (s.won) return ['YOU MADE IT OUT'];
      if (s.kills >= WAVE) return ['GO TO THE GATE'];
      return [`GRUNTS ${s.kills}/${WAVE}`];
    },
    message: e => (e.name === 'sent' ? 'HERE THEY COME' : e.name === 'locked' ? 'THE GATE IS SHUT' : undefined)
  },
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    // the spawner: a grunt at the pen every EVERY seconds until WAVE have come
    game.spawnProp({
      kind: 'spawner',
      at: 'pen',
      update(self, g: Game<YardState>) {
        const left = (self.data.left as number | undefined) ?? 1;
        self.data.left = left - 1 / 60;
        if (left > 0 || g.state.sent >= WAVE) return;
        self.data.left = EVERY;
        g.spawnActor({ actor: 'grunt', at: self.pos, brain: gruntBrain, tags: ['enemy'] });
        g.state.sent++;
        g.emit('sent', { n: g.state.sent });
      }
    });
    // the gate: open once every grunt is down
    game.spawnTrigger({
      kind: 'gate',
      at: 'gate',
      shape: { half: [1.4, 2, 0.8] },
      onEnter(_who, g) {
        const s = (g as Game<YardState>).state;
        if (s.kills >= WAVE) s.won = true;
        else g.emit('locked');
      }
    });
    return { sent: 0, kills: 0, won: false };
  },
  step(game) {
    for (const e of game.events) {
      if (e.name !== 'death') continue;
      const d = e.data as { team: string; at: [number, number, number] };
      if (d.team !== 'enemy') continue;
      game.state.kills++;
      game.effects?.freeze(d.at[0], d.at[2], 1.5, 12);
    }
  }
});
