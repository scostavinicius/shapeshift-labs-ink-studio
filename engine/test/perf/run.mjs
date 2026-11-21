// Stage 11: what a frame costs, part by part, measured in a headless browser while the arena plays its winning script
// live (the page's &replay and &perf modes). For each case: the simulation (per step), sending splats to the graphics
// card, the draw call (CPU side), the graphics card's own time (gl.finish, in the gpu runs), the HUD, the sort.
//
//   npm run perf                                  every case
//   npm run perf -- --only dense                  cases whose name contains "dense"
//   npm run perf -- --seconds 12                  how long to measure each (default 10, starting 6 s in)
//   npm run perf -- --query '&sort=page'         added to every page address (compare variants: &renderer=old, &sort=page)
//
// Two graphics back-ends: the machine's graphics card ("hw"), and SwiftShader ("sw"), Chromium's software renderer on the
// CPU: much slower than any integrated graphics card, so a case that holds 60 fps there holds it anywhere.
// Results: a table, and test/perf/out/report.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from '../../scripts/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const args = process.argv.slice(2);
const opt = n => {
  const i = args.indexOf('--' + n);
  return i < 0 ? undefined : args[i + 1];
};
const only = opt('only'),
  seconds = +(opt('seconds') || 10),
  browserName = opt('browser') || 'msedge',
  query = opt('query') || '';

const CASES = [];
for (const backend of ['hw', 'sw'])
  for (const game of ['arena', 'arena-dense'])
    for (const look of ['default', 'colored']) {
      if (backend === 'sw' && look === 'colored') continue; // software: the plain look is enough to see the bound
      CASES.push({ name: `${backend} ${game}${look === 'colored' ? ' colored' : ''}`, backend, game, look });
    }

const median = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const p95 = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : 0);
const r2 = v => Math.round(v * 100) / 100;

async function measure(browser, server, c, mode) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${server.url}?game=${c.game}&replay=arena/win.json&perf=${mode}${c.look === 'colored' ? '&look=colored' : ''}${query}`);
  await page.waitForFunction(() => window.ENGINE && window.ENGINE.info.fps > 0, null, { timeout: 120000 });
  // into the fight (wave 1 has come in), then a clean window
  await page.waitForFunction(() => window.ENGINE.game.t > 6, null, { timeout: 120000 });
  await page.evaluate(() => ((window.ENGINE.perf.length = 0), (window.ENGINE.gpuTimes.length = 0)));
  const t0 = await page.evaluate(() => window.ENGINE.game.t);
  await page.waitForTimeout(seconds * 1000);
  const r = await page.evaluate(() => {
    const E = window.ENGINE;
    const gl = E.renderer.gl,
      dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { frames: E.perf.slice(), timer: E.gpuTimes.filter(v => v === v), splats: E.world.count, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), t: E.game.t, state: E.game.state, view: { W: E.view.W, H: E.view.H, px: E.view.px } };
  });
  await page.close();
  const f = r.frames,
    stepped = f.filter(x => x.steps > 0),
    drew = f.filter(x => x.drew);
  return {
    frames: f.length,
    fps: f.length / seconds,
    // pictures actually drawn a second (frames with no new step are not drawn again)
    drawsPerSecond: drew.length / seconds,
    simulated: r2(r.t - t0),
    splats: r.splats,
    grid: r.view,
    renderer: r.gpu,
    simPerStep: r2(median(stepped.map(x => x.sim / x.steps))),
    simPerStep95: r2(p95(stepped.map(x => x.sim / x.steps))),
    upload: r2(median(stepped.map(x => x.upload))),
    upload95: r2(p95(stepped.map(x => x.upload))),
    rows: median(stepped.map(x => x.rows)),
    draw: r2(median(drew.map(x => x.draw))),
    gpu: r2(median(drew.map(x => x.gpu))),
    timer: r2(median(r.timer)),
    timer95: r2(p95(r.timer)),
    // the card's busy time in each second: time a draw x draws a second
    gpuBusyMsPerS: r2(median(r.timer) * (drew.length / seconds)),
    gpu95: r2(p95(drew.map(x => x.gpu))),
    hud: r2(median(f.map(x => x.hud))),
    total: r2(median(f.map(x => x.total))),
    total95: r2(p95(f.map(x => x.total))),
    sort: f.length ? f[f.length - 1].sort : '-',
    sortMs: r2(median(f.map(x => x.sortMs))),
    wave: r.state && r.state.wave,
    errors
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer({ port: 0 });
  const rows = [];
  try {
    for (const backend of ['hw', 'sw']) {
      const cases = CASES.filter(c => c.backend === backend && (!only || c.name.includes(only)));
      if (!cases.length) continue;
      const launchArgs = backend === 'sw' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] : [];
      const browser = await chromium.launch({ channel: browserName, headless: true, args: launchArgs });
      try {
        for (const c of cases) {
          // one run as it plays (fps, CPU parts), one waiting for the card every frame (its time)
          const plain = await measure(browser, server, c, '1');
          const gpu = await measure(browser, server, c, 'gpu');
          const row = { ...c, plain, gpu };
          rows.push(row);
          console.log(
            `${c.name.padEnd(26)} ${String(plain.splats).padStart(7)} splats  grid ${plain.grid.W}x${plain.grid.H}/${plain.grid.px}  ` +
              `fps ${plain.fps.toFixed(0).padStart(4)} (${plain.drawsPerSecond.toFixed(0)} drawn)  frame ${plain.total} (p95 ${plain.total95}) ms  ` +
              `sim/step ${plain.simPerStep} (p95 ${plain.simPerStep95})  upload ${plain.upload} (${plain.rows} rows, p95 ${plain.upload95})  ` +
              `draw ${plain.draw}  hud ${plain.hud}  sort ${plain.sort} ${plain.sortMs}  |  gpu timer ${plain.timer} (p95 ${plain.timer95}) ms a draw, busy ${plain.gpuBusyMsPerS} ms a second; ` +
              `waiting ${gpu.gpu} (p95 ${gpu.gpu95}) ms, fps ${gpu.fps.toFixed(0)}  ` +
              `[${plain.renderer.replace(/ANGLE \(|\)$/g, '').slice(0, 60)}]` +
              (plain.errors.length || gpu.errors.length ? '  ERRORS: ' + [...plain.errors, ...gpu.errors].join('; ') : '')
          );
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), seconds, rows }, null, 2));
  console.log(`\nreport: ${path.join(OUT, 'report.json')}`);
}

await main();
