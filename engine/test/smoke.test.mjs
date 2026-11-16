// Stage 0 checks: the toolkit bundle the page loads runs on its own and builds scenes; scene modules wrap correctly;
// the engine entry bundles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { kitScript, sceneScript } from '../scripts/kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// the bundle as a browser would run it: a fresh global with only `window` on it
function browserLike() {
  const sandbox = { console, performance };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(kitScript(), sandbox, { filename: 'kit.js' });
  return sandbox;
}

test('kit bundle defines window.INK and builds the burn demo', () => {
  const { INK } = browserLike();
  assert.ok(INK, 'window.INK is set');
  assert.ok(INK.SCENES.length >= 7, 'demo scenes are registered');
  const burn = INK.SCENES.find(s => s.id === 'burn');
  const world = burn.build(burn.seed);
  assert.ok(world.count > 1000, `burn has splats (${world.count})`);
  assert.equal(world.data.length >= world.count * 16, true, '16 floats per splat');
  assert.equal(typeof world.anim.update, 'function', 'a living world has a clock');
});

test('scene modules wrap and register on INK.extra', () => {
  const sb = browserLike();
  vm.runInContext(sceneScript('showcase/farol.js'), sb, { filename: 'farol.js' });
  assert.equal(sb.INK.extra.length, 1);
  assert.equal(sb.INK.extra[0].id, 'farol');
});

test('scene modules outside the repository are refused', () => {
  assert.equal(sceneScript('../../outside.js'), null);
  assert.equal(sceneScript('showcase/missing.js'), null);
});

test('engine entry bundles', async () => {
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.ts')],
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'silent'
  });
  assert.ok(out.outputFiles[0].text.length > 0);
});
