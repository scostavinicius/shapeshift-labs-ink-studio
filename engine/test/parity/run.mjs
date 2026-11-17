// Parity harness: draws a fixed set of scenes with the engine's renderer (in a headless browser) and with the toolkit's
// own reference renderer (cli/render.js, in Node), on the same art grid, and compares them pixel by pixel.
//
//   npm run parity                       every case
//   npm run parity -- --only burn        cases whose name contains "burn"
//   npm run parity -- --min 90           exit 1 if any scene's foreground parity is below 90%
//   npm run parity -- --browser chrome   use Chrome instead of Edge (any Chromium the system has)
//
// Score: "foreground parity" is the share of pixels that match among those where either picture shows something other
// than the background colour, so an empty picture scores 0% whatever the scene. "all" counts every pixel.
// Pictures go to test/parity/out/<case>.png: reference | engine | difference (red where they differ).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from '../../scripts/server.mjs';
import { poseAt, start } from '../../src/shared/pose.mjs';
import { compare, sheet } from './compare.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const OUT = path.join(HERE, 'out');
const R = require(path.join(REPO, 'cli', 'render.js'));
const PNG = require(path.join(REPO, 'cli', 'png.js'));
const kit = require(path.join(REPO, 'index.js')).load();

// the fixed set the plan names: each scene at two moments, from three sides
const W = 900,
  H = 620,
  TIMES = [0, 2],
  YAWS = [0, 2.1, 4.2],
  // the default look, and the `colored` one (cli/render.js --colored)
  LOOKS = ['default', 'colored'];
export const CASES = [
  { name: 'watcher', scene: 'watcher' },
  { name: 'burn', scene: 'burn' },
  { name: 'cabinet', scene: 'cabinet' },
  { name: 'idol', scene: 'idol' },
  { name: 'farol', file: 'showcase/farol.js' }
];

// games run by a script to a moment (stage 6): the engine in the browser against `cli.js shot` in Node. Besides the
// picture, the two simulations must agree exactly (the same hash): the same seed and script give the same game
export const GAMES = [
  { name: 'farol-walk game', game: 'farol-walk', input: 'farol-walk/walk.json', t: 6 },
  // a moment with a grunt's pieces in the air and the grass on fire: debris and the ground's memory roll Math.random
  { name: 'farol-fight game', game: 'farol-fight', input: 'farol-fight/fight.json', t: 8.3 }
];

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf('--' + name);
  return i < 0 ? undefined : args[i + 1];
};
const only = opt('only'),
  min = opt('min') === undefined ? null : Number(opt('min')),
  browserName = opt('browser') || 'msedge';

function sceneOf(c) {
  if (c.file) return require(path.join(REPO, c.file))(kit);
  return kit.SCENES.find(s => s.id === c.scene);
}

// the reference pictures, made the way the toolkit's CLI makes them
function references(c) {
  const scene = sceneOf(c),
    world = scene.build(scene.seed),
    out = [];
  start(world);
  for (const t of TIMES) {
    poseAt(world, t, kit.KIT);
    for (const look of LOOKS)
      for (const dy of YAWS)
        out.push({
          t,
          yaw: dy,
          look,
          img: R.render(world, { t, yaw: world.cam.yaw + dy, w: W, h: H, colored: look === 'colored' })
        });
  }
  return out;
}

// a game's reference: run in Node exactly as `cli.js shot` runs it, drawn by cli/render.js in each look
async function gameReference(g) {
  const { loadTs, loadInk, sceneFn } = await import('../load.mjs');
  const def = (await loadTs(`examples/${g.game}/game.ts`)).default;
  const { runHeadless } = await loadTs('src/headless/run.ts');
  const script = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'examples', g.input), 'utf8'));
  const { game } = runHeadless(def, loadInk(), sceneFn(def.scene), script, g.t, { bones: 'cpu' });
  const view = game.core.camera.view();
  return {
    hash: game.hash(),
    steps: game.steps,
    imgs: LOOKS.map(look => R.render(game.world, { t: game.t, ...view, w: W, h: H, colored: look === 'colored' }))
  };
}

async function launch() {
  try {
    return await chromium.launch({ channel: browserName, headless: true, args: ['--enable-unsafe-swiftshader'] });
  } catch (err) {
    throw new Error(
      `could not start the "${browserName}" browser (${err.message.split('\n')[0]}). Try --browser chrome, or install one.`
    );
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer({ port: 0 });
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(server.url + 'parity.html');
  await page.waitForFunction(() => window.PARITY && window.PARITY.ready);
  const caps = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: true,
      floatTargets: !!gl.getExtension('EXT_color_buffer_float'),
      floatBlend: !!gl.getExtension('EXT_float_blend'),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    };
  });
  console.log('browser graphics:', JSON.stringify(caps));
  // the deterministic Math gives the same bits here as in Node (the fingerprint a port to another language must match too)
  const { loadTs } = await import('../load.mjs');
  const here = (await loadTs('src/game/dmath.ts')).fingerprint();
  const there = await page.evaluate(() => window.PARITY.fingerprint());
  console.log(`deterministic Math fingerprint: Node ${here}, browser ${there}` + (here === there ? ' (same)' : ' DIFFERENT'));
  if (here !== there) errors.push(`deterministic Math differs: Node ${here}, browser ${there}`);
  const rows = [];
  try {
    for (const c of CASES) {
      if (only && !c.name.includes(only)) continue;
      const refs = references(c);
      const shots = await page.evaluate(
        spec => window.PARITY.run(spec),
        { scene: c.scene, file: c.file, times: TIMES, yaws: YAWS, looks: LOOKS, w: W, h: H }
      );
      // a fresh page per scene, so scene modules and GL state never leak from one to the next
      await page.reload();
      await page.waitForFunction(() => window.PARITY && window.PARITY.ready);
      refs.forEach((ref, k) => {
        const shot = shots[k],
          img = ref.img;
        const label = `${c.name}-t${ref.t}-y${ref.yaw}` + (ref.look === 'default' ? '' : '-' + ref.look);
        const notes = [];
        if (shot.look !== ref.look) notes.push(`look ${shot.look} vs ${ref.look}`);
        if (shot.view.W !== img.w || shot.view.H !== img.h || shot.view.px !== img.px)
          notes.push(`grid ${shot.view.W}x${shot.view.H}/${shot.view.px} vs ${img.w}x${img.h}/${img.px}`);
        let got = null;
        if (shot.frame) {
          if (shot.frame.w !== img.w || shot.frame.h !== img.h) notes.push(`frame ${shot.frame.w}x${shot.frame.h}`);
          else got = Buffer.from(shot.frame.rgb, 'base64');
        } else notes.push('no renderer');
        // the background is palette entry 0 of the world, which is the colour of the reference's top-left corner on
        // every scene in the set (nothing is drawn there); read it from the reference itself
        const bg = [img.rgb[0], img.rgb[1], img.rgb[2]];
        const s = compare(img, got, bg);
        if (got && s.fg < 100) notes.push(`off by <=1/<=2/<=16/more: ${s.deltas.join('/')} of ${s.fgCount} fg px`);
        const pic = sheet(img.w, img.h, [img.rgb, got, s.diff]);
        PNG.write(path.join(OUT, label + '.png'), pic.w, pic.h, pic.rgb);
        rows.push({ upload: shot.upload, case: label, scene: c.name + (ref.look === 'default' ? '' : ' ' + ref.look), fg: s.fg, all: s.all, ms: shot.ms, notes: notes.join('; ') });
      });
    }
    for (const g of GAMES) {
      if (only && !g.name.includes(only)) continue;
      const ref = await gameReference(g);
      const got = await page.evaluate(spec => window.PARITY.game(spec), { game: g.game, input: g.input, t: g.t, looks: LOOKS, w: W, h: H });
      await page.reload();
      await page.waitForFunction(() => window.PARITY && window.PARITY.ready);
      // the same seed and script give the same game in any JavaScript engine, to the last bit: the engine puts its own
      // deterministic Math in place of the native one while a game runs (docs/engine-determinism.md)
      const same = got.hash === ref.hash && got.steps === ref.steps;
      if (!same) errors.push(`${g.name}: the browser's game is not Node's: hash ${got.hash} vs ${ref.hash}, steps ${got.steps} vs ${ref.steps}`);
      ref.imgs.forEach((img, k) => {
        const shot = got.shots[k],
          look = LOOKS[k];
        const label = `${g.game}-t${g.t}` + (look === 'default' ? '' : '-' + look);
        const notes = [`hash ${same ? 'same as Node' : 'DIFFERS'} (${got.hash})`];
        let pix = null;
        if (shot.frame.w !== img.w || shot.frame.h !== img.h) notes.push(`frame ${shot.frame.w}x${shot.frame.h} vs ${img.w}x${img.h}`);
        else pix = Buffer.from(shot.frame.rgb, 'base64');
        const bg = [img.rgb[0], img.rgb[1], img.rgb[2]];
        const s = compare(img, pix, bg);
        const pic = sheet(img.w, img.h, [img.rgb, pix, s.diff]);
        PNG.write(path.join(OUT, label + '.png'), pic.w, pic.h, pic.rgb);
        rows.push({ case: label, scene: g.name + (look === 'default' ? '' : ' ' + look), fg: s.fg, all: s.all, ms: 0, notes: notes.join('; ') });
      });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  // the table, then one line per scene
  const pct = v => v.toFixed(1).padStart(5) + '%';
  console.log('\ncase'.padEnd(24) + 'foreground    all   engine ms  notes');
  for (const r of rows)
    console.log(r.case.padEnd(31) + pct(r.fg) + '  ' + pct(r.all) + '  ' + r.ms.toFixed(0).padStart(8) + '   ' + r.notes);
  // how the splats reached the graphics card: the first shot of each time, the one that carried the changes
  console.log('\nuploads (first shot of each time):');
  for (const r of rows)
    if (r.case.endsWith('-y0') && r.upload) console.log('  ' + r.case.padEnd(20) + `${r.upload.rows} of ${r.upload.total} rows (${r.upload.mode})`);
  const byScene = {};
  for (const r of rows) (byScene[r.scene] = byScene[r.scene] || []).push(r.fg);
  console.log('\nscene        worst   mean');
  let failed = false;
  for (const [s, v] of Object.entries(byScene)) {
    const worst = Math.min(...v),
      mean = v.reduce((a, b) => a + b, 0) / v.length;
    if (min !== null && worst < min) failed = true;
    console.log(s.padEnd(17) + pct(worst) + ' ' + pct(mean));
  }
  if (errors.length) console.log('\npage errors:\n  ' + [...new Set(errors)].join('\n  '));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), caps, rows, errors }, null, 2));
  console.log(`\npictures and report.json in ${OUT}`);
  if (failed) {
    console.log(`below the --min ${min}% foreground parity`);
    process.exitCode = 1;
  }
  if (errors.length) process.exitCode = 1;
}

await main();
