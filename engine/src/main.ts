// Entry point. Stage 0 of docs/engine-plan.md: load the toolkit, build a scene, report it.
//   ?scene=burn                    a built-in demo by id
//   ?file=showcase/farol.js        a scene module from the repository
import { buildWorld, findScene, loadSceneFile } from './kit';

async function start(): Promise<void> {
  const status = document.getElementById('status')!;
  const q = new URLSearchParams(location.search);
  const file = q.get('file');
  const scene = file ? await loadSceneFile(file) : findScene(q.get('scene') || 'burn');
  const { world, ms } = buildWorld(scene);
  const info = { scene: scene.id, splats: world.count, buildMs: Math.round(ms), palette: world.pal.length };
  console.log('ink-engine', info);
  status.textContent = `${scene.name} (${scene.id})\n${world.count} splats · built in ${info.buildMs} ms`;
  // read by tests and by anyone driving the page from outside
  (window as unknown as { ENGINE: unknown }).ENGINE = { scene, world, info };
}

start().catch(err => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = 'error: ' + (err instanceof Error ? err.message : String(err));
});
