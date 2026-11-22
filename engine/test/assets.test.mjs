// Stage 24: textured 3D models (src/game/assets.ts). The sample GLB (scripts/make-crate-glb.cjs) becomes a recipe; a
// scene places it as a sculpted solid that stands in the collision map, takes its texture's colours and can break; a
// character carries a model part on a bone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadInk, loadTs } from './load.mjs';

const require = createRequire(import.meta.url);
const G = await loadTs('src/game/index.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');
const crate = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'crate.json'), 'utf8'));
const PALETTE = [0x07080b, 0x2a2a2e, 0x4a4a52, 0x6a6a74, 0x8c8c96, 0x3b2414, 0x5e3a1e, 0x8a5a2e, 0xb98040, 0xd8a868, 0x1d1a17, 0x2d2822, 0x433b30, 0x6e2a22, 0xa8432c, 0xd8743c, 0xe2c6a4, 0xf6e7cf];

test('the sample GLB reads as a textured recipe', async () => {
  const studio = require(path.join(ROOT, '..', 'index.js'));
  const r = await studio.readAsset(path.join(ROOT, 'assets', 'crate.glb'), { size: 1 });
  assert.equal(r.triangles.length, 36);
  assert.equal(r.texture.images[0].width, 16);
});

const def = G.defineGame({
  id: 'asset-test',
  scene: kit => ({
    id: 'asset-yard', name: 'Asset yard', seed: 2,
    build(seed) {
      const K = kit.KIT, B = kit.makeBuilder(seed, PALETTE), S = K.sculpt(kit.makeSculpt(B));
      S.box([0, -0.5, 0], [5, 0.5, 5], { r: [1, 2, 3, 4] }, { res: 0.2 });
      G.placeAsset(K, S, crate, { at: [1.5, 0, 0], size: 1, turn: 0.4, palette: PALETTE, tag: 'crate' });
      S.bake();
      return B.finish({ cam: { target: [0.8, 0.4, 0.4], dist: 9, pitch: 0.7, yaw: 0.35 }, detail: 10 });
    }
  }),
  breakables: [{ tag: 'crate' }],
  actors: {
    hero: { spec: walker, hp: 5 },
    boxman: { spec: { ...walker, id: 'boxman', sculpt(S, T) {
      G.placePart(S, crate, { at: [0, 0.25, 0], size: 0.5, palette: PALETTE, bone: T('root') });
      S.ball([0, 0.78, 0], 0.17, { r: [16, 17, 17] }, T('head'));
    } } }
  },
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: [0.4, null, 0], brain: 'player', tags: ['player'] });
    game.spawnActor({ actor: 'boxman', kind: 'boxman', at: [-1, null, -2], brain: () => ({ move: 0.7 }), team: 'player' });
    return {};
  }
});

test('a placed model stands in the collision map, is splatted above the floor, and can break', () => {
  const g = G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
  assert.ok(g.collision.blocked([1.5, 0.05, 0], 0.2, 0.8));
  assert.ok(!g.collision.blocked([-2, 0.05, 1.5], 0.2, 0.8));
  // its surfaces are splatted where it stands
  const box = g.breakables.boxOf('crate');
  const counts = new Map();
  const d = g.world.data;
  for (let i = 0; i < g.world.count; i++) {
    const x = d[i * 16], y = d[i * 16 + 1], z = d[i * 16 + 2];
    if (x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2] || y < 0.15) continue;
    counts.set('n', (counts.get('n') || 0) + 1);
  }
  assert.ok(counts.get('n') > 200, `model splats ${counts.get('n')}`);
  g.player.ch.st.face = 0;
  g.core.input.press('attack');
  g.runSteps(1);
  g.core.input.release('attack');
  g.run(0.5);
  assert.equal(g.breakables.intact('crate'), false);
});

test('a character carries a model part on its bone', () => {
  const g = G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
  const man = g.entities.find(e => e.kind === 'boxman'),
    slot = g.level.slots.find(s => s.actor === 'boxman');
  const centre = () => {
    const d = g.world.data;
    let n = 0, cx = 0, cz = 0;
    for (let i = slot.at; i < slot.at + slot.total; i++) if (d[i * 16 + 3] > 0.01) (n++, (cx += d[i * 16]), (cz += d[i * 16 + 2]));
    return [cx / n, cz / n];
  };
  g.run(1);
  const a = centre();
  assert.ok(Math.hypot(a[0] - man.pos[0], a[1] - man.pos[2]) < 0.2, `body ${a} vs actor ${man.pos}`);
  g.run(1);
  const b = centre();
  assert.ok(b[0] > a[0] + 0.5, 'the body should walk with the actor');
});
