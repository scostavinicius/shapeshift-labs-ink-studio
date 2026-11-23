// Stage 8: the HUD, the sound and saves, in Node. The HUD's model follows the game step by step through a scripted fight;
// the fight's events make the right sounds; a save puts a fresh game back where it was, and the same save and script give
// the same game twice. (The page itself, the drawing and the reload, are checked by `npm run live`.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadInk, loadTs, ROOT, sceneFn } from './load.mjs';

const G = await loadTs('src/game/index.ts');
const H = await loadTs('src/headless/run.ts');
const UI = await loadTs('src/ui/hud.ts');
const FONT = await loadTs('src/ui/font.ts');
const AUDIO = await loadTs('src/ui/audio.ts');
const fight = (await loadTs('test/fixtures/fight/game.ts')).default;
const fightScript = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'fight', 'fight.json'), 'utf8'));
const farol = sceneFn('showcase/farol.js');

test('the pixel font writes what it is given and reads back the same', () => {
  const s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 .,:!?-+=/()<>%#*';
  const m = FONT.rasterize(s);
  assert.equal(m.w, s.length * 6 - 1);
  assert.equal(m.h, 7);
  assert.equal(FONT.readMask(m), s);
  assert.equal(FONT.readMask(FONT.rasterize('Grunt down')), 'GRUNT DOWN', 'lower case drawn as capitals');
});

test('the HUD follows the game through a fight: health, messages, the ability bar', () => {
  const { game } = H.runHeadless(fight, loadInk(), farol, fightScript, 0);
  const player = new G.ScriptPlayer(fightScript),
    feed = new UI.HudFeed();
  const said = [];
  let mismatches = 0,
    sawHitBusy = false;
  for (let n = 0; n < 12 * 60; n++) {
    game.runSteps(1, k => player.apply(k, game.core.input));
    const now = game.t; // page time, here the game's
    feed.feed(game.takeEvents(), game, now);
    const m = UI.hudModel(game, feed, now);
    if (m.hp !== Math.max(0, game.player.hp)) mismatches++;
    if (m.abilities[0].ready === 0) sawHitBusy = true;
    for (const x of m.messages) if (x.age === 0) said.push([+now.toFixed(2), x.text]);
  }
  assert.equal(mismatches, 0, 'the hearts are the health, every step');
  assert.equal(UI.hudModel(game, feed, game.t).maxHp, 5);
  assert.ok(sawHitBusy, 'the hit slot empties while a swing plays');
  const texts = said.map(s => s[1]);
  assert.deepEqual(texts, ['YOU FELL', 'BACK ON YOUR FEET', 'GRUNT DOWN', 'GRUNT DOWN'], JSON.stringify(said));
  // the game's own line
  assert.deepEqual(UI.hudModel(game, feed, game.t).lines, ['KILLS 2/2', 'ALL CLEAR']);
});

test("the fight's events make its sounds", () => {
  const { game } = H.runHeadless(fight, loadInk(), farol, fightScript, 12);
  const sounds = AUDIO.soundsFor(game.takeEvents()).map(s => s.sound);
  const count = n => sounds.filter(s => s === n).length;
  assert.ok(count('swing') >= 20, 'swings: ' + count('swing'));
  assert.equal(count('hit'), 11);
  assert.equal(count('death'), 3);
  assert.equal(count('respawn'), 1);
  // a game can add its own
  assert.deepEqual(
    AUDIO.soundsFor([{ name: 'coin', t: 0, step: 0 }], { coin: 'blip' }).map(s => s.sound),
    ['blip']
  );
});

test("stage 27: every recipe sound is the kit's sound recipe, in distinct takes; an unknown sound is flagged", () => {
  const SR = loadInk().KIT.procedural.mediaGraph.soundRecipe;
  for (const name of Object.keys(AUDIO.RECIPES)) {
    const takes = AUDIO.recipeTakes(SR, name, 48000).map(r => SR.render(r).value);
    assert.equal(takes.length, AUDIO.TAKES, name);
    for (const t of takes) {
      assert.equal(t.sampleRate, 48000);
      assert.ok(t.samples.length > 48000 * 0.1 && t.samples.length < 48000 * 2, `${name}: ${t.samples.length} samples`);
      assert.ok(t.samples.some(v => Math.abs(v) > 0.1), `${name}: silent`);
    }
    const sums = takes.map(t => t.samples.reduce((s, v) => s + Math.abs(v), 0).toFixed(3));
    assert.equal(new Set(sums).size, takes.length, `${name}: the takes differ`);
    // seeded: the same takes every time
    assert.deepEqual(AUDIO.recipeTakes(SR, name, 48000), AUDIO.recipeTakes(SR, name, 48000));
  }
  for (const n of AUDIO.RECIPE_SOUNDS) assert.ok(AUDIO.SOUND_NAMES.includes(n));
  const V = G.checkDefinition({ ...fight, sounds: { coin: 'pickup', door: 'creak' } });
  assert.deepEqual(V.filter(p => p.code === 'sound').map(p => p.where), ['sounds.door']);
});

test('a save puts a fresh game back where it was; the same save and script give the same game', () => {
  const at4 = H.runHeadless(fight, loadInk(), farol, fightScript, 4).game;
  const save = JSON.parse(JSON.stringify(G.saveGame(at4))); // through JSON, as it is kept
  const loaded = H.runHeadless(fight, loadInk(), farol, { events: [] }, 0, { load: save }).game;
  const view = g =>
    g.entities.map(e => [e.id, e.kind, e.alive, e.pos.map(v => +v.toFixed(6)), e.type === 'actor' ? [e.hp, +e.ch.st.face.toFixed(6)] : null]);
  assert.deepEqual(view(loaded), view(at4));
  assert.deepEqual(loaded.state, at4.state);
  // from the save, a script plays out the same way twice
  const go = { events: [{ step: 0, stick: [1, 0] }, { t: 0.5, tap: 'attack' }] };
  const a = H.runHeadless(fight, loadInk(), farol, go, 3, { load: save, hashEachStep: true }).hashes,
    b = H.runHeadless(fight, loadInk(), farol, go, 3, { load: save, hashEachStep: true }).hashes;
  assert.deepEqual(a, b);
});

test('a save knows its game, and a player saved while down comes back standing at home', () => {
  const game = H.runHeadless(fight, loadInk(), farol, fightScript, 6).game; // the player fell at 5.58 s
  assert.ok(game.player.deadFor >= 0, 'down at 6 s');
  const save = G.saveGame(game);
  const fresh = G.createGame(fight, loadInk(), { scene: farol, bones: 'cpu' });
  G.loadSave(fresh, save);
  const p = fresh.player;
  assert.equal(p.deadFor, -1);
  assert.equal(p.hp, 5);
  assert.ok(Math.hypot(p.pos[0] - 3, p.pos[2] - 2) < 0.05, 'at home: ' + p.pos);
  assert.throws(() => G.loadSave(fresh, { ...save, game: 'other' }), /cannot load this save: a save of "other", not of "farol-fight"/);
  assert.throws(() => G.loadSave(fresh, { hello: 1 }), /not a save of the engine/);
  assert.throws(() => G.loadSave(fresh, { ...save, version: 99 }), /version 99; this engine reads up to 1/);
});

test('the HUD takes its colours from the scene: the lightest, the darkest, the reddest', () => {
  const c = UI.hudColours([0x06070f, 0xece4cc, 0x8e2328, 0x3a3d56, 0x26502c]);
  assert.deepEqual(c, { light: '#ece4cc', dark: '#06070f', accent: '#8e2328', dim: '#3a3d56' });
});
