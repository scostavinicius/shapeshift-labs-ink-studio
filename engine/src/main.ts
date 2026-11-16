// Entry point: a scene, live. Drag to turn it, wheel to zoom, C to switch between the default and the colored look.
//   ?scene=burn                    a built-in demo by id
//   ?file=showcase/farol.js        a scene module from the repository
//   &look=colored                  start in the colored look (soft body-coloured contours)
//   &sort=page                     sort on the page's own thread every frame (exact) instead of in the worker
import { buildWorld, findScene, ink, loadSceneFile } from './kit';
import { makeView, rendererFor } from './render/index';
import { makeScratch, sortSplats } from './render/order';
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
  const sorter = q.get('sort') === 'page' ? null : renderer.useSortWorker('sort-worker.js');
  let paused = false;
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
  const viewNow = (t: number) =>
    makeView(world, { t, yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, w: canvas.clientWidth, h: canvas.clientHeight });
  let lastT = 0;
  const frame = (now: number) => {
    if (paused) return void requestAnimationFrame(frame);
    // (a frame's timestamp can be a hair earlier than the clock read when the page started: time never goes below zero)
    const t = Math.max(0, (now - t0) / 1000),
      began = performance.now();
    // a world left in a background tab is not walked through all the time it missed
    if (t - ((world as { clock?: number }).clock || 0) > 0.5) (world as { clock?: number }).clock = t - 1 / 60;
    poseAt(world, t, ink().KIT, { bones: 'gpu' });
    renderer.upload(world);
    renderer.draw(world, viewNow(t), { look });
    lastT = t;
    spent += performance.now() - began;
    frames++;
    if (now - since >= 500) {
      info.fps = Math.round((frames * 1000) / (now - since));
      info.frameMs = +(spent / frames).toFixed(1);
      (info as Record<string, unknown>).upload = { ...renderer.lastUpload };
      status.textContent =
        `${scene.name} (${scene.id})\n${world.count} splats · ${info.fps} fps · ${info.frameMs} ms a frame · ` +
        `${renderer.lastUpload.rows} of ${Math.ceil(world.count / 512)} rows sent (${renderer.lastUpload.mode}) · ` +
        `sort: ${renderer.lastSort.by}` +
        (renderer.lastSort.by === 'worker' ? ` (${renderer.lastSort.workerMs.toFixed(1)} ms off-thread)` : '') +
        '\n' +
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
    /**
     * Stop the clock, then compare the worker's order for this very moment with one sorted here: the two orders element
     * by element, and the two pictures byte by byte. Both should be 0: the worker's copy of the splats, kept up to date
     * row by row, is then the same as the page's. The clock starts again afterwards.
     */
    async checkWorker() {
      if (!sorter) return { skipped: 'no worker' };
      paused = true;
      await new Promise(requestAnimationFrame);
      const view = viewNow(lastT),
        bones = (world.anim && world.anim.bones) || null,
        fromWorker = await sorter.exact(view.t, view.V, bones),
        here = sortSplats(world, view, makeScratch(world.count), bones).slice();
      let orderDiff = 0;
      for (let i = 0; i < here.length; i++) if (here[i] !== fromWorker[i]) orderDiff++;
      renderer.draw(world, view, { look, order: fromWorker });
      const a = renderer.read().rgb;
      renderer.draw(world, view, { look, order: here });
      const b = renderer.read().rgb;
      let pixelDiff = 0;
      for (let i = 0; i < a.length; i += 3) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) pixelDiff++;
      paused = false;
      return { t: +lastT.toFixed(2), splats: world.count, orderDiff, pixelDiff, pixels: a.length / 3 };
    },
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
