// Live check: opens the live page in a headless browser for a few scenes and reports what a frame costs, how many rows
// of splats are sent, and whether the sort worker agrees with a sort made on the page.
//
//   npm run live                        every scene
//   npm run live -- --only farol        scenes whose name contains "farol"
//   npm run live -- --browser chrome    use Chrome instead of Edge
//
// For each scene, with the worker and (for comparison) with sorting on the page's own thread:
//   fps and milliseconds of the page's thread a frame, rows sent a frame (median over 2 seconds)
// and, three times while it runs, ENGINE.checkWorker(): the worker's order and the page's must be the same, element for
// element, and so must the two pictures. Any difference fails the run (exit 1).
// Then the game core with the real mouse (see coreChecks; `--only core` runs just that). Pictures go to test/live/out/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from '../../scripts/server.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

const SCENES = [
  { name: 'farol', q: 'file=showcase/farol.js' },
  { name: 'farol colored', q: 'file=showcase/farol.js&look=colored' },
  { name: 'burn', q: 'scene=burn' },
  { name: 'idol', q: 'scene=idol' },
  { name: 'watcher', q: 'scene=watcher' },
  { name: 'cabinet', q: 'scene=cabinet' }
];

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf('--' + name);
  return i < 0 ? undefined : args[i + 1];
};
const only = opt('only'),
  browserName = opt('browser') || 'msedge';

const server = await startServer({ port: 0 });
const browser = await chromium.launch({ channel: browserName, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));

// two seconds of frames: the page's own figures, and the median of rows sent
const sample = () =>
  page.evaluate(async () => {
    const E = window.ENGINE,
      rows = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 2000) {
      await new Promise(requestAnimationFrame);
      rows.push(E.renderer.lastUpload.rows);
    }
    rows.sort((a, b) => a - b);
    return {
      fps: E.info.fps,
      frameMs: E.info.frameMs,
      rows: rows[rows.length >> 1],
      total: Math.ceil(E.world.count / 512),
      sort: E.renderer.lastSort.by,
      workerMs: +E.renderer.lastSort.workerMs.toFixed(1)
    };
  });

async function open(q) {
  await page.goto(server.url + '?' + q);
  await page.waitForFunction(() => window.ENGINE && window.ENGINE.info.fps > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

/**
 * Stage 5, with the real mouse: dragging turns the farol at full frame rate while the clock keeps fixed steps, and a click
 * on the idol meets it (the Node test core.test.mjs shows the same click breaking pieces off).
 */
async function coreChecks() {
  console.log('\ngame core (real mouse):');
  await open('file=showcase/farol.js');
  const before = await page.evaluate(() => ({ yaw: window.ENGINE.cam.yaw, t: window.ENGINE.core.t, now: performance.now() }));
  const cx = 640,
    cy = 360;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 80; k++) {
    await page.mouse.move(cx + Math.sin(k / 12) * 300, cy + Math.sin(k / 20) * 80);
    await page.waitForTimeout(25);
  }
  const during = await page.evaluate(() => ({ fps: window.ENGINE.info.fps, frameMs: window.ENGINE.info.frameMs }));
  await page.mouse.up();
  const after = await page.evaluate(() => ({ yaw: window.ENGINE.cam.yaw, t: window.ENGINE.core.t, now: performance.now(), pokes: window.ENGINE.core.pokes.length }));
  const real = (after.now - before.now) / 1000,
    sim = after.t - before.t;
  const orbitOK = Math.abs(after.yaw - before.yaw) > 0.5 && during.fps >= 55 && Math.abs(sim - real) < 0.1 && after.pokes === 0;
  console.log(
    `  farol  orbit: yaw ${before.yaw.toFixed(2)} -> ${after.yaw.toFixed(2)} · ${during.fps} fps, ${during.frameMs} ms a frame while dragging · ` +
      `${sim.toFixed(2)} s simulated in ${real.toFixed(2)} s · a drag is not a tap: ${after.pokes} taps  ${orbitOK ? 'ok' : 'FAILED'}`
  );
  if (!orbitOK) failed = true;

  await open('scene=idol');
  // aim at the idol: a solid splat high up near its middle, wherever it is on the page now
  const at = await page.evaluate(() => {
    const E = window.ENGINE,
      D = E.world.data;
    let best = -1,
      top = -1e9;
    for (let i = 0, q = 0; i < E.world.count; i++, q += 16)
      if (D[q + 3] >= 1 && Math.hypot(D[q], D[q + 2]) < 0.6 && D[q + 1] > top) {
        top = D[q + 1];
        best = i;
      }
    return E.screenOf([D[best * 16], D[best * 16 + 1], D[best * 16 + 2]]);
  });
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(800);
  const tap = await page.evaluate(() => {
    const p = window.ENGINE.core.pokes;
    return p.length ? { n: p.length, t: p[p.length - 1].t, hit: p[p.length - 1].hit } : { n: 0 };
  });
  const tapOK = tap.n === 1 && !!tap.hit;
  console.log(
    `  idol   click at (${at.x.toFixed(0)}, ${at.y.toFixed(0)}): ${tap.n} tap at ${tap.n ? tap.t.toFixed(2) + ' s' : '-'}, ` +
      (tap.hit ? `hit splat ${tap.hit.i} at (${tap.hit.p.map(v => v.toFixed(2)).join(', ')})` : 'nothing hit') +
      `  ${tapOK ? 'ok' : 'FAILED'}`
  );
  if (!tapOK) failed = true;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'idol-after-click.png') });

  // stage 6: a game, played with the real keyboard: W walks the walker away from the camera
  await open('game=farol-walk');
  const g0 = await page.evaluate(() => ({ pos: window.ENGINE.game.player.pos.slice(), t: window.ENGINE.game.t }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  const playing = await page.evaluate(() => ({ fps: window.ENGINE.info.fps, frameMs: window.ENGINE.info.frameMs }));
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const g1 = await page.evaluate(() => ({ pos: window.ENGINE.game.player.pos.slice(), t: window.ENGINE.game.t, ground: window.ENGINE.game.player.ch.st.ground }));
  const walked = Math.hypot(g1.pos[0] - g0.pos[0], g1.pos[2] - g0.pos[2]);
  const walkOK = walked > 1.5 && playing.fps >= 55 && g1.ground;
  console.log(
    `  farol-walk  W held 1.5 s: walked ${walked.toFixed(2)} from (${g0.pos.map(v => v.toFixed(2))}) to (${g1.pos.map(v => v.toFixed(2))}) · ` +
      `${playing.fps} fps, ${playing.frameMs} ms a frame  ${walkOK ? 'ok' : 'FAILED'}`
  );
  if (!walkOK) failed = true;
  await page.screenshot({ path: path.join(OUT, 'farol-walk.png') });

  // stage 7: the serpent comes for a player who stands still, and bites; J swings back
  await open('game=ninho');
  for (let k = 0; k < 22; k++) {
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(400);
  }
  const f = await page.evaluate(() => {
    const E = window.ENGINE,
      g = E.game;
    return { fps: E.info.fps, frameMs: E.info.frameMs, t: g.t, hp: g.player ? g.player.hp : null, down: !g.player, state: g.state, foes: g.byTag('enemy').map(e => e.hp) };
  });
  // (the player's own health going down is the HUD check's: it may already have died and stood up again here)
  const fightOK = f.fps >= 55 && (f.state.won || f.foes.some(h => h < 6));
  console.log(
    `  ninho        9 s standing and swinging: player hp ${f.hp}, serpent's hp ${JSON.stringify(f.foes)}, ${JSON.stringify(f.state)} · ` +
      `${f.fps} fps, ${f.frameMs} ms a frame  ${fightOK ? 'ok' : 'FAILED'}`
  );
  if (!fightOK) failed = true;
  await page.screenshot({ path: path.join(OUT, 'ninho.png') });

  // stage 8: the HUD follows the health; the page saves itself, and a reload brings the player back where it was
  await open('game=ninho&fresh=1');
  await page.keyboard.press('KeyJ'); // (a key: the browser lets the page make sound from now on)
  const hudSamples = [];
  for (let k = 0; k < 70; k++) {
    await page.waitForTimeout(150);
    hudSamples.push(
      await page.evaluate(() => {
        const g = window.ENGINE.game,
          h = document.getElementById('hud-health');
        return { hp: g.player.deadFor >= 0 ? 0 : g.player.hp, shown: +h.dataset.hp, down: g.player.deadFor >= 0 };
      })
    );
    if (hudSamples[hudSamples.length - 1].hp < 6 && k > 4) break;
  }
  // walk away from the serpent for a moment, then leave the page as it is
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const left = await page.evaluate(() => {
    const E = window.ENGINE,
      p = E.game.player;
    return {
      pos: p.pos.slice(),
      hp: p.hp,
      down: p.deadFor >= 0,
      steps: E.game.steps,
      audio: E.sound.ctx ? E.sound.ctx.state : 'none',
      played: { ...E.sound.played },
      // stage 27: the takes made from the kit's sound recipes (made one per tick after the first key)
      takes: Object.fromEntries(Object.entries(E.sound.takes).map(([n, t]) => [n, t.length])),
      messages: document.getElementById('hud-messages').dataset.text
    };
  });
  // open it again (without &fresh=1, which forgets the save): leaving the page saves it
  await page.goto(server.url + '?game=ninho');
  await page.waitForFunction(() => window.ENGINE && window.ENGINE.info.fps > 0, null, { timeout: 60000 });
  const back = await page.evaluate(() => {
    const E = window.ENGINE,
      s = E.loadedFrom,
      p = s && s.entities.find(e => e.kind === 'player');
    return {
      loaded: !!s,
      steps: s ? s.steps : 0,
      pos: p ? p.pos : null,
      hp: p ? p.hp : null,
      shown: +document.getElementById('hud-health').dataset.hp,
      now: E.game.player.hp,
      welcome: document.getElementById('hud-messages').dataset.text
    };
  });
  const hudFollows = hudSamples.every(x => x.hp === x.shown) && hudSamples.some(x => x.hp < 6);
  const moved = back.pos ? Math.hypot(back.pos[0] - left.pos[0], back.pos[2] - left.pos[2]) : Infinity;
  const restored = back.loaded && back.steps >= left.steps && moved < 0.5 && (left.down || back.hp === left.hp) && back.shown === back.now;
  console.log(
    `  HUD          ${hudSamples.length} samples, hearts = health in all: ${hudSamples.map(x => x.shown).join(' ')}  ${hudFollows ? 'ok' : 'FAILED'}`
  );
  console.log(
    `  sound        context ${left.audio}, played ${JSON.stringify(left.played)}  ${left.audio === 'running' && left.played.swing > 0 && left.takes.hit > 0 ? 'ok' : 'FAILED'}; kit takes ${JSON.stringify(left.takes)}`
  );
  console.log(
    `  save/reload  left at (${left.pos.map(v => v.toFixed(2))}) hp ${left.hp}${left.down ? ' (down)' : ''}, step ${left.steps}; ` +
      `came back at (${back.pos ? back.pos.map(v => v.toFixed(2)) : '-'}) hp ${back.hp} from the save of step ${back.steps}; ` +
      `HUD shows ${back.shown}; "${(back.welcome || '').split(String.fromCharCode(10)).join(' / ')}"  ${restored ? 'ok' : 'FAILED'}`
  );
  if (!hudFollows || !restored || left.audio !== 'running' || !(left.takes.hit > 0)) failed = true;
  await page.screenshot({ path: path.join(OUT, 'ninho-hud.png') });

  // stage 10: the arena played from start to end in the browser, in real time, by its winning script
  await open('game=arena&replay=arena/win.json');
  const fpsSeen = [];
  let end = null;
  const started = Date.now();
  while (Date.now() - started < 90000) {
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => {
      const E = window.ENGINE,
        g = E.game;
      return { fps: E.info.fps, frameMs: E.info.frameMs, steps: g.steps, t: g.t, state: g.state, hash: g.hash() };
    });
    fpsSeen.push(r.fps);
    if (r.state.won || r.state.lost) {
      end = r;
      break;
    }
  }
  const settled = fpsSeen.slice(1),
    minFps = Math.min(...settled),
    meanFps = settled.reduce((a, b) => a + b, 0) / Math.max(1, settled.length);
  const arenaOK = !!end && end.state.won && minFps >= 55;
  console.log(
    `  arena        replayed win.json live: ${end ? (end.state.won ? 'VICTORY' : 'DEFEAT') + ` at ${end.t.toFixed(1)} s (step ${end.steps}), kills ${end.state.kills}, falls ${end.state.falls}` : 'no end in 90 s'}; ` +
      `fps min ${minFps}, mean ${meanFps.toFixed(0)} over ${settled.length} s  ${arenaOK ? 'ok' : 'FAILED'}`
  );
  if (!arenaOK) failed = true;
  await page.screenshot({ path: path.join(OUT, 'arena-victory.png') });
}

let failed = false;
console.log('scene           sort    fps  page ms/frame  rows sent   worker sort ms   worker check (order / pixels differing)');
try {
  for (const s of SCENES) {
    if (only && !s.name.includes(only)) continue;
    await open(s.q + '&sort=worker'); // (the toolkit's renderer sorts on the page unless asked)
    const w = await sample();
    const checks = [];
    for (let k = 0; k < 3; k++) {
      checks.push(await page.evaluate(() => window.ENGINE.checkWorker()));
      await page.waitForTimeout(500);
    }
    if (checks.some(c => c.orderDiff || c.pixelDiff)) failed = true;
    await open(s.q + '&sort=page');
    const p = await sample();
    const line = (r, extra) =>
      console.log(
        s.name.padEnd(16) +
          r.sort.padEnd(7) +
          String(r.fps).padStart(4) +
          String(r.frameMs).padStart(12) +
          `${r.rows} / ${r.total}`.padStart(14) +
          (r.sort === 'worker' ? String(r.workerMs) : '-').padStart(13) +
          '      ' +
          extra
      );
    line(w, checks.map(c => `${c.orderDiff} / ${c.pixelDiff}`).join('   '));
    line(p, '');
  }
  if (!only || 'core'.includes(only)) await coreChecks();
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.log('\npage errors:\n  ' + [...new Set(errors)].join('\n  '));
  failed = true;
}
if (failed) {
  console.log('\nFAILED: the worker and the page disagree, or the page reported errors');
  process.exitCode = 1;
} else console.log('\nworker order and pictures match the page in every check');
