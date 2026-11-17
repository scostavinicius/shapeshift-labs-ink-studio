#!/usr/bin/env node
// The engine's command line: games run without a browser (docs/engine-stage6-design.md §5). One game per process.
//
//   node engine/cli.js shot <game> [--input script.json] [--t 5] [--out frame.png] [--state state.json]
//                                  [--w 900 --h 620] [--colored] [--seed n] [--load save.json] [--save save.json]
// --load starts the game where a save left it (a file written by --save, or saved from the page); --save writes one at
// the end.
//
// <game> is a folder of engine/examples/ (its game.ts) or the path of a game module. The game is stepped to --t exactly as
// the page steps it (fixed 1/60 s steps, the script's input), drawn with the toolkit's own renderer (cli/render.js), and
// saved as a PNG. The last line printed is always one line of JSON: { png, state, hash, t, steps }, for whoever reads it.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ENGINE = __dirname;
const REPO = path.resolve(ENGINE, '..');
const R = require(path.join(REPO, 'cli', 'render.js'));
const PNG = require(path.join(REPO, 'cli', 'png.js'));

const USAGE = `usage: node engine/cli.js shot <game> [--input script.json] [--t 5] [--out frame.png] [--state state.json]
                                       [--w 900 --h 620] [--colored] [--seed n] [--load save.json] [--save save.json]
  <game>: a folder of engine/examples/ (${listExamples().join(', ') || 'none yet'}) or a path to a game module`;

function listExamples() {
  const dir = path.join(ENGINE, 'examples');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'game.ts'))) : [];
}

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) o._.push(a);
    else if (a === '--colored') o.colored = true;
    else o[a.slice(2)] = argv[++i];
  }
  return o;
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

/** a TypeScript (or JavaScript) module, bundled for Node and loaded */
async function load(entry) {
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  return import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
}

function gameFile(name) {
  const ex = path.join(ENGINE, 'examples', name, 'game.ts');
  if (fs.existsSync(ex)) return ex;
  const p = path.resolve(name);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  if (fs.existsSync(path.join(p, 'game.ts'))) return path.join(p, 'game.ts');
  die(`no game "${name}"\n${USAGE}`);
}

async function shot(o) {
  const name = o._[1];
  if (!name) die(USAGE);
  const file = gameFile(name);
  const def = (await load(file)).default;
  if (!def || typeof def.init !== 'function') die(`${file}: export default defineGame({ ... }) was expected`);
  const { runHeadless, saveGame } = await load(path.join(ENGINE, 'src', 'headless', 'run.ts'));
  const script = o.input ? JSON.parse(fs.readFileSync(path.resolve(o.input), 'utf8')) : { events: [] };
  if (o.seed !== undefined) script.seed = +o.seed;
  const w = +(o.w || (script.view && script.view.w) || 900),
    h = +(o.h || (script.view && script.view.h) || 620);
  script.view = { w, h };
  const t = o.t === undefined ? 5 : +o.t;
  if (!(t >= 0)) die('--t must be a time in seconds, 0 or more');
  if (typeof def.scene !== 'string') die(`${def.id}: the CLI loads scenes by path: give scene as 'showcase/farol.js' or the like`);
  const ink = { ...require(path.join(REPO, 'index.js')).load(), extra: [] };
  const scene = require(path.join(REPO, def.scene));

  const t0 = Date.now();
  const saved = o.load ? JSON.parse(fs.readFileSync(path.resolve(o.load), 'utf8')) : undefined;
  const { game } = runHeadless(def, ink, scene, script, t, { bones: 'cpu', load: saved });
  const ms = Date.now() - t0;
  const img = R.render(game.world, { t: game.t, ...game.core.camera.view(), w, h, colored: !!o.colored });
  const big = R.upscale(img, img.px);
  const outDir = path.join(ENGINE, 'out');
  const png = path.resolve(o.out || path.join(outDir, `${def.id}-${String(t).replace('.', '_')}.png`));
  fs.mkdirSync(path.dirname(png), { recursive: true });
  PNG.write(png, big.w, big.h, big.rgb);
  const snap = game.snapshot();
  let state = null;
  if (o.state) {
    state = path.resolve(o.state);
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(state, JSON.stringify(snap, null, 2));
  }
  let save = null;
  if (o.save) {
    save = path.resolve(o.save);
    fs.mkdirSync(path.dirname(save), { recursive: true });
    fs.writeFileSync(save, JSON.stringify(saveGame(game), null, 2));
  }
  const p = game.player;
  console.log(
    `${def.id}: ${game.steps} steps (${game.t.toFixed(2)} s) in ${ms} ms` +
      (p ? ` · player at (${p.pos.map(v => v.toFixed(2)).join(', ')})` : '') +
      ` · ${game.entities.length} entities`
  );
  console.log(JSON.stringify({ png, state, save, hash: snap.hash, t: +game.t.toFixed(6), steps: game.steps }));
}

const o = parse(process.argv.slice(2));
const cmd = o._[0];
if (cmd === 'shot') shot(o).catch(e => die(e && e.stack ? e.stack : String(e)));
else die(USAGE);
