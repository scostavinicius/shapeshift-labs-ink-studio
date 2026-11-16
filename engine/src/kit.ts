// Typed access to the ink-studio toolkit, which the page loads before the engine as a classic script (kit.js → window.INK).
import type { Ink, Scene, World } from '../types/ink-studio';

export function ink(): Ink {
  if (!window.INK) throw new Error('ink-studio toolkit not loaded: kit.js must come before main.js');
  return window.INK;
}

/** A scene by id, from the toolkit's demos or from scene modules loaded after it. */
export function findScene(id: string): Scene {
  const { SCENES, extra } = ink();
  const scene = [...extra, ...SCENES].find(s => s.id === id);
  if (!scene) throw new Error(`no scene "${id}"; known: ${[...extra, ...SCENES].map(s => s.id).join(', ')}`);
  return scene;
}

/** Load a scene module from the repository (served by the dev server under /scene/<path>) and return its scene. */
export function loadSceneFile(rel: string): Promise<Scene> {
  return new Promise((resolve, reject) => {
    const before = ink().extra.length;
    const el = document.createElement('script');
    el.src = '/scene/' + rel;
    el.onload = () => {
      const s = ink().extra[before];
      if (s) resolve(s);
      else reject(new Error('scene module did not register: ' + rel));
    };
    el.onerror = () => reject(new Error('could not load scene module: ' + rel));
    document.head.appendChild(el);
  });
}

/** Build a scene's world, timing it. */
export function buildWorld(scene: Scene, seed = scene.seed): { world: World; ms: number } {
  const t0 = performance.now();
  const world = scene.build(seed);
  return { world, ms: performance.now() - t0 };
}
