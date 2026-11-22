// Entry point: a scene, live, on the game core (fixed 1/60 s steps, input, follow camera, clicks into the scene).
//   drag: turn the camera · wheel: zoom · click: tap the scene (st.poke) · WASD / arrows / left stick: move the point the
//   camera follows (Shift runs) · right stick: turn · C: switch between the default and the colored look
//   ?scene=burn                    a built-in demo by id
//   ?file=showcase/farol.js        a scene module from the repository
//   &look=colored                  start in the colored look (soft body-coloured contours)
//   &sort=worker / &sort=page      where the splats are sorted. Default: the toolkit's renderer sorts on the page (its
//                                  counting sort reuses the order when nothing moved, and costs less than handing it a
//                                  worker's order: docs/engine-performance.md, stage 14); the old renderer sorts in a worker
//   &renderer=old                  the engine's first renderer (splat-renderer.ts) instead of the toolkit's (webgl.mjs)
//   ?game=farol-walk               a game (engine/examples/<name>/game.ts), played: the player's character takes the input
//   &input=farol-walk/walk.json&t=6   ...or that game run by a script to t (as `cli.js shot` runs it), the clock then stopped
//   &fresh=1                       start the game over, forgetting its save
//   &replay=arena/win.json         play the game in real time with a script's input (a recorded game, watched live)
//   &perf=1                        keep what each frame costs (simulation, upload, draw, HUD) in ENGINE.perf;
//   &perf=gpu                      ...and wait for the graphics card each frame (a pixel read back) to time it (slows it)
// A game shows its HUD and makes sound (M: music on or off, N: all sound off), saves itself every 2 seconds and when the
// page is left (P: save now), and comes back where it was saved when the page is opened again.
import { Core, DomInput, project, type Sample } from './core/index';
import { forgetLocal, loadSave, readLocal, saveGame, saveProblem, storeLocal } from './game/save';
import { ScriptPlayer } from './game/script';
import { Sound } from './ui/audio';
import { CameraShake } from './ui/shake';
import { Hud, HudFeed, hudModel } from './ui/hud';
import { createGame, type RunningGame } from './game/game';
import { runHeadless } from './headless/run';
import { buildWorld, findScene, ink, loadGame, loadSceneFile } from './kit';
import { rendererFor, UpstreamRenderer } from './render/index';
import { makeScratch, sortSplats } from './render/order';
import type { Look } from './render/splat-renderer';
import type { View } from './render/view';
import type { World } from '../types/ink-studio';

async function start(): Promise<void> {
  const status = document.getElementById('status')!;
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const q = new URLSearchParams(location.search);
  const dom = new DomInput(canvas);
  const t0 = performance.now();
  let world: World,
    core: Core,
    game: RunningGame<unknown> | null = null,
    name: string,
    id: string,
    // a game run by a script is shown at its last step, the clock stopped
    frozen = false,
    // a game played live with a script's input
    replay: ScriptPlayer | null = null,
    loadedFrom: ReturnType<typeof readLocal> = null;
  if (q.get('game')) {
    const loaded = await loadGame(q.get('game')!);
    const input = q.get('input');
    if (input) {
      const script = await (await fetch('/examples/' + input)).json();
      const run = runHeadless(loaded.def, ink(), loaded.scene, script, +(q.get('t') || 5), { bones: 'gpu' });
      game = run.game;
      frozen = true;
    } else game = createGame(loaded.def, ink(), { scene: loaded.scene, input: dom.state, bones: 'gpu' });
    world = game.world;
    core = game.core;
    name = loaded.def.name || loaded.def.id;
    id = loaded.def.id;
    if (q.get('replay')) replay = new ScriptPlayer(await (await fetch('/examples/' + q.get('replay'))).json());
    if (!frozen && !replay) {
      if (q.get('fresh')) forgetLocal(id);
      const saved = readLocal(id);
      const problem = saved && saveProblem(game, saved);
      if (saved && !problem) {
        loadSave(game, saved);
        loadedFrom = saved;
      } else if (problem) console.warn(`${id}: the save kept in this browser was not loaded: ${problem}`);
    }
  } else {
    const file = q.get('file');
    const scene = file ? await loadSceneFile(file) : findScene(q.get('scene') || 'burn');
    world = buildWorld(scene).world;
    name = scene.name;
    id = scene.id;
    // The viewer's "game": a point the camera follows, walked about by the movement keys, at a pace that suits the
    // size of the scene.
    const focus: [number, number, number] = [...world.cam.target];
    const pace = Math.max(1, world.radius || world.cam.dist / 4) * 0.6;
    core = new Core(world, ink().KIT, {
      input: dom.state,
      onStep(dt, _t, s: Sample, c) {
        const k = pace * (s.act.run ? 2.2 : 1) * dt;
        focus[0] += s.act.move * k;
        focus[2] += s.act.mz * k;
        c.camera.follow(focus);
      }
    });
  }
  const info = { scene: id, splats: world.count, buildMs: Math.round(performance.now() - t0), palette: world.pal.length, fps: 0, frameMs: 0, steps: 0 };
  console.log('ink-engine', info);
  const renderer = rendererFor(canvas);
  const sortIn = q.get('sort') || (renderer instanceof UpstreamRenderer ? 'page' : 'worker');
  const sorter = sortIn === 'page' ? null : renderer.useSortWorker('sort-worker.js');
  let look: Look = q.get('look') === 'colored' ? 'colored' : 'default';
  // the art-pixel size (stage 15): &px=N fixes it; [ and ] make pixels smaller or bigger; \ goes back to the scene's own
  const pxAsked = Number(q.get('px'));
  if (Number.isInteger(pxAsked) && pxAsked >= 1) core.px = Math.min(pxAsked, 18);
  // splat coverage: 'continuous' joins neighbouring opaque splats, so small art pixels show no holes between them.
  // Games are built with it (createGame); &coverage=legacy|continuous|soft overrides it for any page
  const coverage = q.get('coverage');
  if (renderer instanceof UpstreamRenderer && (coverage === 'legacy' || coverage === 'continuous' || coverage === 'soft'))
    renderer.frame.splatCoverage = coverage;
  addEventListener('keydown', e => {
    if (e.code === 'KeyC' && !e.repeat) look = look === 'colored' ? 'default' : 'colored';
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      const now = core.px ?? view.px;
      core.px = Math.max(1, Math.min(18, now + (e.code === 'BracketLeft' ? -1 : 1)));
    }
    if (e.code === 'Backslash') core.px = null;
  });

  // what shows the game: the HUD and the sound, fed with its events between steps; and its saves
  const hud = game ? new Hud(document.body, world.pal) : null,
    feed = new HudFeed(),
    sound = game ? new Sound(game.def.sounds) : null;
  // the picture jolts on hits, smashes and kills (stage 20): def.camera.shake scales it, &shake=0 turns it off
  const shakeScale = q.get('shake') === '0' ? 0 : game?.def.camera?.shake ?? 1;
  const shake = game && shakeScale > 0 ? new CameraShake(ink().KIT, shakeScale) : null;
  if (loadedFrom) feed.say('WELCOME BACK', performance.now() / 1000);
  // what happened before the first frame (a scripted run) is not news
  game?.takeEvents();
  let savedAt = performance.now(),
    saves = 0;
  const save = (say: boolean) => {
    if (!game || frozen || replay) return false;
    const ok = storeLocal(saveGame(game));
    if (ok) saves++;
    if (say) {
      feed.say(ok ? 'SAVED' : 'COULD NOT SAVE', performance.now() / 1000);
      sound?.play('save');
    }
    return ok;
  };
  addEventListener('keydown', e => {
    if (e.code === 'KeyP' && !e.repeat) save(true);
  });
  addEventListener('pagehide', () => save(false));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save(false));

  let paused = false,
    last = -1,
    frames = 0,
    since = performance.now(),
    spent = 0,
    view: View = core.view(canvas.clientWidth, canvas.clientHeight);
  // measuring (stage 11): what each frame costs, part by part
  const perfMode = q.get('perf');
  type PerfFrame = { drew: boolean; sim: number; steps: number; upload: number; rows: number; draw: number; gpu: number; hud: number; total: number; sort: string; sortMs: number };
  const perfFrames: PerfFrame[] = [];
  /** what the last picture was drawn for (page size and look), and how many pictures have been drawn */
  let drawnKey = '',
    drawn = 0;
  const perfPixel = new Uint8Array(4);
  // the card's own time per draw, by timer query, where the browser has one (not waiting: a few frames late)
  const perfTimer = !!perfMode && renderer.timeGpu(true);
  const gpuTimes: number[] = [];
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (paused) return;
    const began = performance.now();
    const steps0 = core.loop.steps;
    let tSim = 0,
      tUp = 0,
      tDraw = 0,
      tGpu = 0,
      tHud = 0;
    // the first frame only starts the clock; after that, the time between frames is simulated in fixed steps
    const real = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    if (game) {
      if (!frozen)
        game.advance(real, (dt, step) => {
          dom.poll(dt);
          // the script's events for the step about to run (keyed by step, so a late frame changes nothing)
          if (replay) replay.apply(step, game!.core.input);
        });
    } else core.advance(real, dt => dom.poll(dt));
    if (perfMode) tSim = performance.now();
    // draw only when there is something new: a step ran, or the page's size or the look changed. On a screen faster than
    // the 60 steps a second (120, 144 Hz) the frames between steps would show the same picture again, at full cost
    const key = `${canvas.clientWidth}x${canvas.clientHeight} ${look}`,
      fresh = core.loop.steps !== steps0 || key !== drawnKey;
    if (fresh) {
      view = core.view(canvas.clientWidth, canvas.clientHeight);
      renderer.upload(world);
    }
    if (perfMode) tUp = performance.now();
    if (fresh) {
      // camera impulses: the toolkit's renderer jolts the drawn view; core.shown (clicks) stays the unshaken one
      if (shake && renderer instanceof UpstreamRenderer)
        renderer.frame.extra = { ...renderer.frame.extra, cameraImpulses: shake.motion, cameraTime: core.t };
      renderer.draw(world, view, { look });
      drawnKey = key;
      drawn++;
    }
    if (perfMode) tDraw = performance.now();
    if (perfMode === 'gpu' && fresh) {
      // wait for the card: reading a pixel back cannot happen before it has drawn (gl.finish does not wait in Chrome)
      renderer.gl.readPixels(0, 0, 1, 1, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, perfPixel);
      tGpu = performance.now();
    }
    if (perfMode && perfTimer && fresh) gpuTimes.push(renderer.lastGpuMs);
    core.shown = view;
    if (game && hud) {
      const events = game.takeEvents(),
        sec = now / 1000;
      feed.feed(events, game, sec);
      // each sound from its place (stage 23), heard from the point the camera follows
      if (sound) {
        sound.listen(view.target, view.V);
        sound.events(events, e => {
          const d = (e.data || {}) as Record<string, unknown>;
          if (Array.isArray(d.at)) return d.at as number[];
          const id = d.target ?? d.id;
          if (id !== undefined) return game.entities.find(x => x.id === id)?.pos ?? null;
          if (typeof d.tag === 'string') {
            const b = game.breakables?.boxOf(d.tag);
            return b ? [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2] : null;
          }
          return null;
        });
      }
      shake?.events(events, game);
      hud.render(hudModel(game, feed, sec), Math.max(2, Math.round(view.px * 0.6)));
      if (!frozen && now - savedAt >= 2000) {
        savedAt = now;
        save(false);
      }
    }
    if (perfMode) {
      tHud = performance.now();
      perfFrames.push({
        drew: fresh,
        sim: tSim - began,
        steps: core.loop.steps - steps0,
        upload: tUp - tSim,
        rows: renderer.lastUpload.rows,
        draw: tDraw - tUp,
        gpu: perfMode === 'gpu' ? tGpu - tDraw : 0,
        hud: tHud - (perfMode === 'gpu' ? tGpu : tDraw),
        total: tHud - began,
        sort: renderer.lastSort.by,
        sortMs: renderer.lastSort.by === 'worker' ? renderer.lastSort.workerMs : renderer.lastSort.ms
      });
      if (perfFrames.length > 5000) perfFrames.shift();
    }
    spent += performance.now() - began;
    frames++;
    if (now - since >= 500) {
      info.fps = Math.round((frames * 1000) / (now - since));
      info.frameMs = +(spent / frames).toFixed(1);
      info.steps = core.loop.steps;
      (info as Record<string, unknown>).upload = { ...renderer.lastUpload };
      const p = core.pokes[core.pokes.length - 1];
      status.textContent =
        `${name} (${id})${frozen ? ' · scripted, stopped' : replay ? ' · replaying a script' : ''}\n${world.count} splats · ${info.fps} fps · ${info.frameMs} ms a frame · ` +
        `${renderer.lastUpload.rows} of ${Math.ceil(world.count / 512)} rows sent (${renderer.lastUpload.mode}) · ` +
        `sort: ${renderer.lastSort.by}` +
        (renderer.lastSort.by === 'worker' ? ` (${renderer.lastSort.workerMs.toFixed(1)} ms off-thread)` : '') +
        `\nt ${core.t.toFixed(2)} s · ${core.loop.steps} steps` +
        (p ? ` · last tap at ${p.t.toFixed(2)} s: ${p.hit ? 'hit (' + p.hit.p.map(v => v.toFixed(2)).join(', ') + ')' : 'nothing'}` : '') +
        (game ? ` · hash ${game.hash()}` + (game.player ? ` · player (${game.player.pos.map(v => v.toFixed(2)).join(', ')})` : '') : '') +
        '\n' +
        `look: ${look} (C) · pixel ${view.px} (${core.px === null ? 'auto' : 'set'}; [ ] \\) · grid ${view.W}x${view.H}` +
        (renderer instanceof UpstreamRenderer ? ` · coverage ${renderer.frame.splatCoverage ?? (world as { look?: { splatCoverage?: string } }).look?.splatCoverage ?? 'legacy'}` : '') +
        ` · drag: turn · wheel: zoom · click: tap · WASD: move (Shift runs)` +
        (game
          ? ` · J hit · K dash
sound: ${sound!.ctx ? sound!.ctx.state : 'waits for a key'} · music ${sound!.volumes.musicOn ? 'on' : 'off'} (M) · ` +
            `${sound!.volumes.muted ? 'muted' : 'sound on'} (N) · saves: ${saves} (P to save now; &fresh=1 starts over)`
          : '');
      frames = 0;
      spent = 0;
      since = now;
    }
  };
  requestAnimationFrame(frame);
  // read by tests and by anyone driving the page from outside
  (window as unknown as { ENGINE: unknown }).ENGINE = {
    scene: id,
    game,
    /** (with &perf) the cost of the last frames, part by part, in ms */
    perf: perfFrames,
    /** how many pictures have been drawn (frames with nothing new are not drawn again) */
    get drawn() {
      return drawn;
    },
    /** (with &perf) the card's time per draw, by timer query; empty if the browser has no timer */
    gpuTimes,
    hud,
    feed,
    sound,
    save,
    /** the save this page was opened from, if any */
    loadedFrom,
    world,
    info,
    core,
    cam: core.camera,
    renderer,
    /** the camera impulses (stage 20), or null */
    shake,
    /** the view last drawn */
    get view() {
      return view;
    },
    /** where a world point is on the page (client pixels), in the view last drawn, or null behind the eye */
    screenOf(p: [number, number, number]) {
      const at = project(view, p);
      if (!at) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + at.u * r.width, y: r.top + at.v * r.height };
    },
    /**
     * Stop the clock, then compare the worker's order for this very moment with one sorted here: the two orders element
     * by element, and the two pictures byte by byte. Both should be 0: the worker's copy of the splats, kept up to date
     * row by row, is then the same as the page's. The clock starts again afterwards.
     */
    async checkWorker() {
      if (!sorter) return { skipped: 'no worker' };
      paused = true;
      await new Promise(requestAnimationFrame);
      const v = view,
        bones = (world.anim && world.anim.bones) || null,
        fromWorker = await sorter.exact(v.t, v.V, bones),
        here = sortSplats(world, v, makeScratch(world.count), bones).slice();
      let orderDiff = 0;
      for (let i = 0; i < here.length; i++) if (here[i] !== fromWorker[i]) orderDiff++;
      renderer.draw(world, v, { look, order: fromWorker });
      const a = renderer.read().rgb;
      renderer.draw(world, v, { look, order: here });
      const b = renderer.read().rgb;
      let pixelDiff = 0;
      for (let i = 0; i < a.length; i += 3) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) pixelDiff++;
      // the clock goes on from now, not from before the pause
      last = -1;
      paused = false;
      return { t: +v.t.toFixed(2), splats: world.count, orderDiff, pixelDiff, pixels: a.length / 3 };
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
