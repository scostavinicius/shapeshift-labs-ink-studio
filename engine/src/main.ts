// Entry point: a scene, live, on the game core (fixed 1/60 s steps, input, follow camera, clicks into the scene).
//   drag: turn the camera · wheel: zoom · click: tap the scene (st.poke) · WASD / arrows / left stick: move the point the
//   camera follows (Shift runs) · right stick: turn · C: switch between the default and the colored look
//   ?scene=burn                    a built-in demo by id
//   ?file=showcase/farol.js        a scene module from the repository
//   &look=colored                  start in the colored look (soft body-coloured contours)
//   &sort=page                     sort on the page's own thread every frame (exact) instead of in the worker
//   ?game=farol-walk               a game (engine/examples/<name>/game.ts), played: the player's character takes the input
//   &input=farol-walk/walk.json&t=6   ...or that game run by a script to t (as `cli.js shot` runs it), the clock then stopped
//   &fresh=1                       start the game over, forgetting its save
//   &replay=arena/win.json         play the game in real time with a script's input (a recorded game, watched live)
// A game shows its HUD and makes sound (M: music on or off, N: all sound off), saves itself every 2 seconds and when the
// page is left (P: save now), and comes back where it was saved when the page is opened again.
import { Core, DomInput, project, type Sample } from './core/index';
import { forgetLocal, loadSave, readLocal, saveGame, saveProblem, storeLocal } from './game/save';
import { ScriptPlayer } from './game/script';
import { Sound } from './ui/audio';
import { Hud, HudFeed, hudModel } from './ui/hud';
import { createGame, type RunningGame } from './game/game';
import { runHeadless } from './headless/run';
import { buildWorld, findScene, ink, loadGame, loadSceneFile } from './kit';
import { rendererFor } from './render/index';
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
  const sorter = q.get('sort') === 'page' ? null : renderer.useSortWorker('sort-worker.js');
  let look: Look = q.get('look') === 'colored' ? 'colored' : 'default';
  addEventListener('keydown', e => {
    if (e.code === 'KeyC' && !e.repeat) look = look === 'colored' ? 'default' : 'colored';
  });

  // what shows the game: the HUD and the sound, fed with its events between steps; and its saves
  const hud = game ? new Hud(document.body, world.pal) : null,
    feed = new HudFeed(),
    sound = game ? new Sound(game.def.sounds) : null;
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
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (paused) return;
    const began = performance.now();
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
    view = core.view(canvas.clientWidth, canvas.clientHeight);
    renderer.upload(world);
    renderer.draw(world, view, { look });
    core.shown = view;
    if (game && hud) {
      const events = game.takeEvents(),
        sec = now / 1000;
      feed.feed(events, game, sec);
      sound?.events(events);
      hud.render(hudModel(game, feed, sec), Math.max(2, Math.round(view.px * 0.6)));
      if (!frozen && now - savedAt >= 2000) {
        savedAt = now;
        save(false);
      }
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
        `look: ${look} (C) · drag: turn · wheel: zoom · click: tap · WASD: move (Shift runs)` +
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
