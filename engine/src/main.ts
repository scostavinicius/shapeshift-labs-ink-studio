// Entry point: a scene, live. Drag to turn it, wheel to zoom, C to switch between the default and the colored look.
//   ?scene=burn                    a built-in demo by id
//   ?file=showcase/farol.js        a scene module from the repository
//   &look=colored                  start in the colored look (soft body-coloured contours)
import { buildWorld, findScene, ink, loadSceneFile } from './kit';
import { makeView, rendererFor } from './render/index';
import type { Look } from './render/splat-renderer';
import { poseAt, start as startWorld } from './shared/pose.mjs';

async function start(): Promise<void> {
  const status = document.getElementById('status')!;
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const q = new URLSearchParams(location.search);
  const file = q.get('file');
  const scene = file ? await loadSceneFile(file) : findScene(q.get('scene') || 'burn');
  const { world, ms } = buildWorld(scene);
  const info = { scene: scene.id, splats: world.count, buildMs: Math.round(ms), palette: world.pal.length, fps: 0, frameMs: 0 };
  console.log('ink-engine', info);
  startWorld(world);
  const renderer = rendererFor(canvas);
  let look: Look = q.get('look') === 'colored' ? 'colored' : 'default';
  addEventListener('keydown', e => {
    if (e.key === 'c' || e.key === 'C') look = look === 'colored' ? 'default' : 'colored';
  });

  // the camera: the scene's own, turned and zoomed by the mouse
  const cam = { yaw: world.cam.yaw, pitch: world.cam.pitch, zoom: 1 };
  let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.008;
    cam.pitch = Math.max(-1.2, Math.min(1.4, drag.pitch + (e.clientY - drag.y) * 0.006));
  });
  const end = () => {
    drag = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoom = Math.max(0.4, Math.min(6, cam.zoom * Math.exp(-e.deltaY * 0.001)));
  }, { passive: false });

  const t0 = performance.now();
  let frames = 0,
    since = t0,
    spent = 0;
  const frame = (now: number) => {
    // (a frame's timestamp can be a hair earlier than the clock read when the page started: time never goes below zero)
    const t = Math.max(0, (now - t0) / 1000),
      began = performance.now();
    // a world left in a background tab is not walked through all the time it missed
    if (t - ((world as { clock?: number }).clock || 0) > 0.5) (world as { clock?: number }).clock = t - 1 / 60;
    poseAt(world, t, ink().KIT);
    renderer.uploadAll(world);
    renderer.draw(
      world,
      makeView(world, { t, yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, w: canvas.clientWidth, h: canvas.clientHeight }),
      { look }
    );
    spent += performance.now() - began;
    frames++;
    if (now - since >= 500) {
      info.fps = Math.round((frames * 1000) / (now - since));
      info.frameMs = +(spent / frames).toFixed(1);
      status.textContent =
        `${scene.name} (${scene.id})\n${world.count} splats · ${info.fps} fps · ${info.frameMs} ms a frame\n` +
        `look: ${look} (C to switch) · drag to turn · wheel to zoom`;
      frames = 0;
      spent = 0;
      since = now;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // read by tests and by anyone driving the page from outside
  (window as unknown as { ENGINE: unknown }).ENGINE = {
    scene,
    world,
    info,
    cam,
    renderer,
    get look() {
      return look;
    },
    set look(v: Look) {
      look = v;
    }
  };
}

start().catch(err => {
  console.error(err);
  const status = document.getElementById('status');
  if (status) status.textContent = 'error: ' + (err instanceof Error ? err.message : String(err));
});
