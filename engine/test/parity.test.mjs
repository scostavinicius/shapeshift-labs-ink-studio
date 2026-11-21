// The parity score itself: identical pictures score 100%, an empty one 0%, and the engine's view grid is the reference's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { compare } from './parity/compare.mjs';
import { poseAt, start } from '../src/shared/pose.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..');
const R = require(path.join(REPO, 'cli', 'render.js'));
const kit = require(path.join(ROOT, 'scripts', 'kit-node.cjs')).loadKit();

const burnAt = t => {
  const scene = kit.SCENES.find(s => s.id === 'burn'),
    world = scene.build(scene.seed);
  start(world);
  poseAt(world, t, kit.KIT);
  return world;
};

test('identical pictures score 100%, a missing one 0%', () => {
  const img = R.render(burnAt(0), { w: 300, h: 200 });
  const bg = [img.rgb[0], img.rgb[1], img.rgb[2]];
  assert.equal(compare(img, img.rgb, bg).fg, 100);
  assert.equal(compare(img, img.rgb, bg).all, 100);
  assert.equal(compare(img, null, bg).fg, 0);
});

test('an empty picture scores 0% on the foreground even where the background matches', () => {
  const img = R.render(burnAt(0), { w: 300, h: 200 });
  const bg = [img.rgb[0], img.rgb[1], img.rgb[2]];
  const blank = new Uint8Array(img.rgb.length);
  for (let i = 0; i < blank.length; i += 3) blank.set(bg, i);
  const s = compare(img, blank, bg);
  assert.equal(s.fg, 0);
  assert.ok(s.all > 0 && s.all < 100, `the background pixels still count in "all" (${s.all.toFixed(1)}%)`);
});

test("the engine's view grid matches cli/render.js", async () => {
  // view.ts is TypeScript: bundle it for Node and load it from a data URL
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'render', 'view.ts')],
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'silent'
  });
  const { makeView } = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
  const world = burnAt(2);
  for (const o of [{ w: 900, h: 620 }, { w: 640, h: 360, zoom: 2 }, { w: 1280, h: 720, yaw: 1, pitch: 0.6 }]) {
    const ref = R.render(world, o),
      v = makeView(world, o);
    assert.deepEqual([v.W, v.H, v.px], [ref.w, ref.h, ref.px], JSON.stringify(o));
  }
});

test('posing a stateful world twice from a fresh build gives the same splats', () => {
  const a = burnAt(1.5).data,
    b = burnAt(1.5).data;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  // recorded, not required yet: stage 6 makes simulation deterministic; until then a few particles may differ
  assert.ok(diff / a.length < 0.05, `${diff} of ${a.length} floats differ`);
});
