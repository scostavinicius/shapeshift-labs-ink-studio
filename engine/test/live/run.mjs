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
import { chromium } from 'playwright-core';
import { startServer } from '../../scripts/server.mjs';

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

let failed = false;
console.log('scene           sort    fps  page ms/frame  rows sent   worker sort ms   worker check (order / pixels differing)');
try {
  for (const s of SCENES) {
    if (only && !s.name.includes(only)) continue;
    await open(s.q);
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
