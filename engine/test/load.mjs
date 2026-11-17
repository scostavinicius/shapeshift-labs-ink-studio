// Test helpers: the engine's TypeScript bundled for Node, the toolkit, and games loaded with their scenes.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(ROOT, '..');

/** A TypeScript entry (relative to engine/) bundled and imported. */
export async function loadTs(rel) {
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent'
  });
  return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

/** The toolkit as the engine's page sees it (INK): a fresh copy each call, so tests do not share state. */
export function loadInk() {
  const kit = require(path.join(REPO, 'index.js')).load();
  return { ...kit, extra: [] };
}

/**
 * A small scene module for quick tests: a floor 20 x 20 (top at y = 0), a block 2 x 2 x 2 at (4, 0, 0), and a pillar of
 * radius 0.5 at (-4, 0, 0). o.stage false leaves the world without a stage.
 */
export const flatScene =
  (o = {}) =>
  ({ makeBuilder, makeSculpt, KIT: K }) => ({
    id: 'flat',
    name: 'Flat',
    seed: 3,
    build(seed) {
      const B = makeBuilder(
        seed,
        Array.from({ length: 24 }, (_, i) => (i ? 0x0a0b0c * (1 + (i % 18)) : 0x07080b))
      );
      const S = K.sculpt(makeSculpt(B));
      S.res = 0.2;
      S.box([0, -0.5, 0], [10, 0.5, 10], { r: [3, 4, 5] });
      S.box([4, 1, 0], [1, 1, 1], { r: [6, 7, 8] });
      S.tube([[-4, -0.2, 0], [-4, 3, 0]], 0.5, 0.5, { r: [9, 10, 11] });
      S.bake();
      const W = B.finish({ cam: { target: [0, 0.5, 0], dist: 16, pitch: 0.7, yaw: 0.3 }, detail: 6 });
      if (o.stage !== false) K.stage(W);
      return W;
    }
  });

/** A scene module's function, from a path relative to the repository. */
export function sceneFn(rel) {
  return require(path.join(REPO, rel));
}
