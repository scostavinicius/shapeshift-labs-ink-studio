// Stage 5: the game core. The fixed-step clock, input turned into K.character's shape, the follow camera's spring, the
// line through a clicked pixel, and a click that breaks the idol, all in Node (no browser, no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..');
const kit = require(path.join(ROOT, 'scripts', 'kit-node.cjs')).loadKit();

// the core is TypeScript: bundle it for Node and load it from a data URL
const out = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'core', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'silent'
});
const C = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const build = id => {
  const s = kit.SCENES.find(x => x.id === id);
  return s.build(s.seed);
};

test('the loop runs whole steps of 1/60 s, whatever the frames', () => {
  const run = frames => {
    const loop = new C.FixedLoop();
    let n = 0;
    for (const f of frames) loop.advance(f, dt => (assert.equal(dt, 1 / 60), n++));
    return { n, t: loop.t, steps: loop.steps };
  };
  // one second at 60, 30, 144 fps and at an uneven rate: 60 steps each (give or take the one still being filled)
  const even = run(Array(60).fill(1 / 60));
  assert.equal(even.n, 60);
  assert.ok(near(even.t, 1));
  assert.equal(run(Array(30).fill(1 / 30)).n, 60);
  assert.ok(Math.abs(run(Array(144).fill(1 / 144)).n - 60) <= 1);
  const uneven = [];
  for (let s = 0, k = 0; s < 1 - 1e-9; k++) {
    const f = Math.min(1 - s, [0.004, 0.02, 0.031, 0.009, 0.05][k % 5]);
    uneven.push(f);
    s += f;
  }
  assert.ok(Math.abs(run(uneven).n - 60) <= 1);
  // the clock is counted, not summed: no drift after an hour of frames
  const loop = new C.FixedLoop();
  for (let i = 0; i < 216000; i++) loop.advance(1 / 60, () => {});
  assert.equal(loop.t, loop.steps / 60);
});

test('a very late frame runs at most maxSteps steps and drops the rest', () => {
  const loop = new C.FixedLoop({ maxSteps: 8 });
  let n = 0;
  loop.advance(5, () => n++);
  assert.equal(n, 8);
  assert.ok(loop.dropped > 4.8);
  n = 0;
  loop.advance(1 / 60, () => n++);
  assert.equal(n, 1, 'and the next frame is back to normal');
});

test('input comes out as K.character wants it, relative to the camera', () => {
  const inp = new C.InputState();
  // "up" walks away from the camera: at yaw 0 the camera is on +z, so away is -z
  inp.press('up');
  let s = inp.sample(0).act;
  assert.ok(near(s.move, 0) && near(s.mz, -1), JSON.stringify(s));
  // at yaw pi/2 the camera is on +x: away is -x, and "right" is -z
  s = inp.sample(Math.PI / 2).act;
  assert.ok(near(s.move, -1) && near(s.mz, 0), JSON.stringify(s));
  inp.release('up');
  inp.press('right');
  s = inp.sample(Math.PI / 2).act;
  assert.ok(near(s.move, 0) && near(s.mz, -1), JSON.stringify(s));
  // diagonals are not faster
  inp.press('up');
  s = inp.sample(0).act;
  assert.ok(near(Math.hypot(s.move, s.mz), 1));
  inp.releaseAll();

  // jump is true on the step it was pressed only; jumpHeld while it is held
  inp.press('jump');
  s = inp.sample(0).act;
  assert.deepEqual([s.jump, s.jumpHeld], [true, true]);
  s = inp.sample(0).act;
  assert.deepEqual([s.jump, s.jumpHeld], [false, true]);
  inp.release('jump');
  // a tap shorter than a step is not lost
  inp.press('attack');
  inp.release('attack');
  assert.equal(inp.sample(0).act.attack, true);
  assert.equal(inp.sample(0).act.attack, false);
  // two keys on one action: letting go of one keeps it held
  inp.press('run');
  inp.press('run');
  inp.release('run');
  assert.equal(inp.sample(0).act.run, true);

  // camera turns and clicks are handed out once
  inp.turn(0.1, 0.2, 2);
  inp.click(0.5, 0.25);
  const a = inp.sample(0);
  assert.deepEqual([a.look.yaw, a.look.pitch, a.look.zoom, a.clicks.length], [0.1, 0.2, 2, 1]);
  const b = inp.sample(0);
  assert.deepEqual([b.look.yaw, b.look.pitch, b.look.zoom, b.clicks.length], [0, 0, 1, 0]);
});

test('the camera follows on a spring that settles without overshoot, the same at any step size', () => {
  const run = (dt, n) => {
    const cam = new C.FollowCamera({ target: [0, 0, 0], dist: 10 });
    cam.follow([4, 0, 0]);
    let max = 0;
    for (let i = 0; i < n; i++) {
      cam.update(dt);
      max = Math.max(max, cam.target[0]);
    }
    return { x: cam.target[0], max };
  };
  const a = run(1 / 60, 60),
    b = run(1 / 120, 120);
  assert.ok(near(a.x, b.x, 1e-9), `${a.x} vs ${b.x}`);
  assert.ok(a.x > 3.9 && a.max <= 4, `${a.x}, max ${a.max}`);
  const half = run(1 / 60, 10).x;
  assert.ok(half > 0.5 && half < 3.5, 'it takes a moment to get there: ' + half);

  const cam = new C.FollowCamera({ dist: 10, minDist: 5, maxDist: 20, minPitch: 0.2, maxPitch: 1 });
  cam.look({ yaw: 0.3, pitch: 5, zoom: 100 });
  assert.equal(cam.pitch, 1);
  assert.equal(cam.goalDist, 5);
  cam.snap();
  assert.equal(cam.dist, 5);
  cam.look({ yaw: 0, pitch: -5, zoom: 0.01 });
  assert.deepEqual([cam.pitch, cam.goalDist], [0.2, 20]);
});

test('a click on a pixel gives the line through what is drawn there', async () => {
  const { makeView } = await import(
    'data:text/javascript,' +
      encodeURIComponent(
        (
          await esbuild.build({
            entryPoints: [path.join(ROOT, 'src', 'render', 'view.ts')],
            bundle: true,
            format: 'esm',
            write: false,
            logLevel: 'silent'
          })
        ).outputFiles[0].text
      )
  );
  const world = build('burn');
  const view = makeView(world, { w: 1280, h: 720, yaw: 0.7, pitch: 0.4, zoom: 1.5 });
  // the middle of the picture looks straight at the target
  const mid = C.rayThrough(view, 0.5, 0.5),
    to = view.target.map((v, k) => v - mid.eye[k]),
    l = Math.hypot(...to);
  assert.ok(to.every((v, k) => near(v / l, mid.dir[k], 1e-9)));
  assert.ok(near(l, view.dist, 1e-9));
  // any point, projected as the shader does and clicked, is on the line
  for (const p of [[1, 0.5, -2], [-3, 2, 1], [0.2, 0, 0.3]]) {
    const { u, v } = C.project(view, p),
      r = C.rayThrough(view, u, v),
      d = p.map((x, k) => x - r.eye[k]),
      t = d[0] * r.dir[0] + d[1] * r.dir[1] + d[2] * r.dir[2],
      miss = Math.hypot(d[0] - r.dir[0] * t, d[1] - r.dir[1] * t, d[2] - r.dir[2] * t);
    assert.ok(miss < 1e-9, `missed by ${miss}`);
  }
});

// how many splats are more than 5 cm from where they are in another run of the same world
const moved = (a, b) => {
  let n = 0;
  for (let q = 0; q < a.length; q += 16) if (Math.hypot(a[q] - b[q], a[q + 1] - b[q + 1], a[q + 2] - b[q + 2]) > 0.05) n++;
  return n;
};

test('clicking the idol breaks pieces off it', tc => {
  const run = clickAt => {
    const world = build('idol');
    const core = new C.Core(world, kit.KIT, { bones: 'cpu' });
    core.shown = core.view(900, 620);
    if (clickAt) {
      core.run(clickAt);
      // aim at the idol's head: the solid splat highest up near the middle
      let best = -1,
        top = -1e9;
      for (let i = 0, q = 0; i < world.count; i++, q += 16)
        if (world.data[q + 3] >= 1 && Math.hypot(world.data[q], world.data[q + 2]) < 0.6 && world.data[q + 1] > top) {
          top = world.data[q + 1];
          best = i;
        }
      const { u, v } = C.project(core.shown, [world.data[best * 16], world.data[best * 16 + 1], world.data[best * 16 + 2]]);
      core.input.click(u, v);
    }
    core.run(1.5 - (clickAt || 0));
    return { core, data: world.data.slice() };
  };
  const plain = run(0),
    again = run(0),
    tapped = run(0.5);
  assert.equal(tapped.core.pokes.length, 1);
  const hit = tapped.core.pokes[0].hit;
  assert.ok(hit, 'the click met the idol');
  // it goes into the next step, which ends at 0.5 + 1/60 (as the CLI's --poke: a tap in (t0, t1] lands before the update to t1)
  assert.ok(near(tapped.core.pokes[0].t, 0.5 + 1 / 60, 1e-9), 'in the step after it was made: ' + tapped.core.pokes[0].t);
  const noise = moved(plain.data, again.data),
    broken = moved(plain.data, tapped.data);
  tc.diagnostic(`${broken} splats moved by the click, ${noise} between two plain runs`);
  assert.ok(broken > 200 && broken > 20 * (noise + 1), `${broken} splats moved by the click (${noise} between two plain runs)`);
});
