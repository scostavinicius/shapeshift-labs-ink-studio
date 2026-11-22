// Stage 17: procedural levels (src/game/dungeon.ts). The seed decides the layout and the same seed gives the same one;
// every spot, the start and the exit can be walked to; the walls are walls to a walker and the floor is at y = 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadInk, loadTs } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');
const K = loadInk().KIT;

test('the same seed lays out the same dungeon; another seed another one; rooms and caves', () => {
  for (const kind of ['rooms', 'cave']) {
    const a = G.layDungeon(K, { kind }, 7),
      b = G.layDungeon(K, { kind }, 7),
      c = G.layDungeon(K, { kind }, 8);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.rows, c.rows);
    assert.equal(a.rows.length, a.height);
    assert.ok(a.spots.length >= 3, `${kind}: ${a.spots.length} spots`);
    assert.ok(a.depth > 10, `${kind}: exit only ${a.depth} cells away`);
    if (kind === 'rooms') assert.ok(a.rooms.length >= 4);
  }
});

/** walking distance on the grid from the start, -1 where it cannot reach */
function reach(d) {
  const { width: W, height: H, rows, cell } = d,
    cellOf = p => [Math.floor(p[0] / cell + W / 2), Math.floor(p[1] / cell + H / 2)],
    dist = new Int32Array(W * H).fill(-1),
    [sx, sz] = cellOf(d.start),
    q = [sz * W + sx];
  dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h],
      x = i % W,
      z = (i - x) / W;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx,
        nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < W && nz < H && rows[nz][nx] === '.' && dist[nz * W + nx] < 0) {
        dist[nz * W + nx] = dist[i] + 1;
        q.push(nz * W + nx);
      }
    }
  }
  return p => {
    const [x, z] = cellOf(p);
    return dist[z * W + x];
  };
}

test('start, exit and every spot can be walked to', () => {
  for (const kind of ['rooms', 'cave'])
    for (const seed of [1, 2, 3]) {
      const d = G.layDungeon(K, { kind }, seed),
        at = reach(d);
      assert.equal(at(d.start), 0);
      assert.equal(at(d.exit), d.depth);
      for (const s of d.spots) assert.ok(at(s) >= 0, `${kind} seed ${seed}: spot ${s} cut off`);
    }
});

test('a game on a dungeon: floor at 0, walls block, a walker pushed into a wall stays out of it', () => {
  const def = G.defineGame({
    id: 'dungeon-test',
    scene: G.makeDungeonScene({ kind: 'rooms' }),
    actors: { hero: { spec: walker, hp: 5 } },
    init(game) {
      const d = G.dungeonOf(game.world);
      game.spawnActor({ actor: 'hero', kind: 'player', at: [d.start[0], null, d.start[1]], brain: 'player', tags: ['player'] });
      return {};
    }
  });
  const game = G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
  const d = G.dungeonOf(game.world),
    col = game.collision;
  assert.ok(Math.abs(col.ground(d.start[0], d.start[1])) < 0.1, `floor at ${col.ground(d.start[0], d.start[1])}`);
  // a wall cell: blocked for a body standing on the floor next to it
  const wz = d.rows.findIndex(r => r.includes('#.')),
    wx = d.rows[wz].indexOf('#.');
  const wallAt = [(wx + 0.5 - d.width / 2) * d.cell, 0, (wz + 0.5 - d.height / 2) * d.cell];
  assert.ok(col.blocked(wallAt, 0.3, 1.2), 'a wall cell is not blocked');
  // walk west (world -x) for 6 s from the start: the start is in a room, so a wall comes first
  const yaw = game.core.camera.view().yaw,
    wxd = -1,
    wzd = 0;
  game.core.input.stick(wxd * Math.cos(yaw) - wzd * Math.sin(yaw), -wxd * Math.sin(yaw) - wzd * Math.cos(yaw));
  game.run(6);
  const p = game.player.pos,
    [cx, cz] = [Math.floor(p[0] / d.cell + d.width / 2), Math.floor(p[2] / d.cell + d.height / 2)];
  assert.equal(d.rows[cz][cx], '.', `the walker ended in a wall cell at ${p}`);
  assert.ok(p[0] < d.start[0] - 0.5, 'the walker did not move');
});

test('torches hang on wall faces, looking into the open; their light is baked (stage 21)', () => {
  for (const kind of ['rooms', 'cave']) {
    const d = G.layDungeon(K, { kind }, 5);
    assert.ok(d.torches.length >= 3 && d.torches.length <= 8, `${kind}: ${d.torches.length} torches`);
    for (const t of d.torches) {
      const cellOf = (x, z) => [Math.floor(x / d.cell + d.width / 2), Math.floor(z / d.cell + d.height / 2)];
      const [fx, fz] = cellOf(t.at[0] + t.normal[0] * 0.25, t.at[1] + t.normal[1] * 0.25),
        [bx, bz] = cellOf(t.at[0] - t.normal[0] * 0.25, t.at[1] - t.normal[1] * 0.25);
      assert.equal(d.rows[fz][fx], '.', `${kind}: a torch faces a wall`);
      assert.equal(d.rows[bz][bx], '#', `${kind}: a torch hangs in the air`);
    }
  }
  assert.equal(G.layDungeon(K, { torches: 0 }, 5).torches.length, 0);
});

test('rain falls over the level, the same every time, and leaves the game alone (stage 22)', () => {
  const def = rain => G.defineGame({
    id: 'wet',
    scene: G.makeDungeonScene({ kind: 'rooms', torches: 0 }),
    actors: { hero: { spec: walker, hp: 5 } },
    ...(rain && { weather: { kind: 'rain', rad: 5, n: 300, cols: [23, 24] } }),
    init(game) {
      const d = G.dungeonOf(game.world);
      game.spawnActor({ actor: 'hero', kind: 'player', at: [d.start[0], null, d.start[1]], brain: 'player', tags: ['player'] });
      return {};
    }
  });
  const make = rain => G.createGame(def(rain), loadInk(), { scene: def(rain).scene, bones: 'cpu' });
  const dry = make(false),
    wet = make(true),
    wet2 = make(true);
  assert.ok(wet.world.count > dry.world.count + 100, `rain added ${wet.world.count - dry.world.count} splats`);
  wet.run(2);
  wet2.run(2);
  assert.equal(wet.hash(), wet2.hash());
  dry.run(2);
  assert.deepEqual(wet.player.pos, dry.player.pos);
});
