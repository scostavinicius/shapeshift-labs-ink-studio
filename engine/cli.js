#!/usr/bin/env node
// The engine's command line: games without a browser, for people and for AIs. One game per process. Every command ends
// with one line of JSON on stdout (what it made, what it found), so whoever runs it can read the result without parsing
// the rest.
//
//   node engine/cli.js new   <name> [--from blank|walk|fight]           a new game in engine/examples/<name>/, ready to run
//   node engine/cli.js check <game> [--seconds 2] [--parity [--input s.json] [--t 3] [--browser chrome]]
//                                                                        every mistake the validator finds; --parity also
//                                                                        draws it in a browser and compares with Node
//   node engine/cli.js shot  <game> [--input s.json] [--t 5] [--out f.png] [--state st.json] [--colored]
//                                   [--w 900 --h 620] [--seed n] [--load save.json] [--save save.json] [--trace 0.5]
//                                                                        one picture at time t (with the HUD's text, unless
//                                                                        --no-hud); --trace notes the player every 0.5 s
//   node engine/cli.js sheet <game> [--input s.json] [--times 0,1,2,4] [--cols 4] [--out f.png] [--colored] [--w 600 --h 420]
//                                                                        several moments of one run, side by side
//   node engine/cli.js play  <game> [--port 5173] [--no-open]           the game in the browser (dev server)
//
// <game> is a folder of engine/examples/ or the path of a game module. Pictures go to engine/out/ unless --out says.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ENGINE = __dirname;
const REPO = path.resolve(ENGINE, '..');
const OUT = path.join(ENGINE, 'out');
const R = require(path.join(REPO, 'cli', 'render.js'));
const PNG = require(path.join(REPO, 'cli', 'png.js'));

const USAGE = `usage: node engine/cli.js <command> <game> [options]
  new   <name> [--from blank|walk|fight]        start a game in engine/examples/<name>/
  check <game> [--seconds 2] [--parity [--input s.json] [--t 3]]
  shot  <game> [--input s.json] [--t 5] [--out f.png] [--state st.json] [--save s.json] [--load s.json] [--trace 0.5] [--colored] [--no-hud]
  sheet <game> [--input s.json] [--times 0,1,2,4] [--cols 4] [--out f.png] [--colored]
  play  <game> [--port 5173] [--no-open]
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
    else if (['--colored', '--parity', '--no-open', '--no-hud'].includes(a)) o[a.slice(2)] = true;
    else o[a.slice(2)] = argv[++i];
  }
  return o;
}

function die(msg, json) {
  console.error(msg);
  if (json) console.log(JSON.stringify(json));
  process.exit(1);
}

function gameFile(name) {
  if (!name) die(USAGE);
  const ex = path.join(ENGINE, 'examples', name, 'game.ts');
  if (fs.existsSync(ex)) return ex;
  const p = path.resolve(name);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  if (fs.existsSync(path.join(p, 'game.ts'))) return path.join(p, 'game.ts');
  die(`no game "${name}"\n${USAGE}`, { ok: false, error: 'no such game' });
}

/** the game's module and the engine's runtime, bundled together (one copy of the engine) and loaded */
async function loadGame(file) {
  let out;
  try {
    out = await esbuild.build({
      stdin: {
        contents:
          `import def from ${JSON.stringify(file.replace(/\\/g, '/'))};\n` +
          `export { def };\nexport * from ${JSON.stringify(path.join(ENGINE, 'src', 'headless', 'cli-runtime.ts').replace(/\\/g, '/'))};\n`,
        resolveDir: ENGINE,
        loader: 'ts'
      },
      bundle: true,
      format: 'esm',
      platform: 'node',
      write: false,
      logLevel: 'silent'
    });
  } catch (e) {
    const first = e.errors && e.errors[0];
    const where = first && first.location ? `${first.location.file}:${first.location.line}:${first.location.column}` : file;
    die(`${where}: ${first ? first.text : e.message}`, { ok: false, error: 'does not compile', where, message: first ? first.text : e.message });
  }
  const mod = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
  const def = mod.def;
  if (!def || typeof def !== 'object') die(`${file}: export default defineGame({ ... }) was expected`, { ok: false, error: 'no default export' });
  return { def, rt: mod };
}

/** the scene's function: the module at def.scene (a path from the repository), or def.scene itself */
function sceneOf(def) {
  if (typeof def.scene === 'function') return def.scene;
  if (typeof def.scene !== 'string') die(`${def.id}: scene must be a path ('showcase/farol.js') or a function kit => ({ build })`);
  const file = path.join(REPO, def.scene);
  if (!fs.existsSync(file)) die(`${def.id}: no scene file ${def.scene} (paths are from the repository root)`, { ok: false, error: 'no scene file' });
  return require(file);
}

const freshInk = () => ({ ...require(path.join(REPO, 'index.js')).load(), extra: [] });

function readScript(o) {
  const script = o.input ? JSON.parse(fs.readFileSync(path.resolve(o.input), 'utf8')) : { events: [] };
  if (o.seed !== undefined) script.seed = +o.seed;
  return script;
}

function writePng(file, img) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  PNG.write(file, img.w, img.h, img.rgb);
  return file;
}

// ---------------------------------------------------------------------------------------------------------- shot

async function shot(o) {
  const file = gameFile(o._[1]);
  const { def, rt } = await loadGame(file);
  const script = readScript(o);
  const w = +(o.w || (script.view && script.view.w) || 900),
    h = +(o.h || (script.view && script.view.h) || 620);
  script.view = { w, h };
  const t = o.t === undefined ? 5 : +o.t;
  if (!(t >= 0)) die('--t must be a time in seconds, 0 or more');
  const t0 = Date.now();
  const saved = o.load ? JSON.parse(fs.readFileSync(path.resolve(o.load), 'utf8')) : undefined;
  // --trace s: step by hand, noting where the player is (and the game's state) every s seconds
  const every = o.trace === undefined ? 0 : Math.max(1, Math.round(+o.trace * 60));
  const { game } = rt.runHeadless(def, freshInk(), sceneOf(def), script, every ? 0 : t, { bones: 'cpu', load: saved });
  const trace = [];
  if (every) {
    const player = new rt.ScriptPlayer(script),
      steps = Math.round(t * 60);
    const note = () => trace.push(sample(game));
    note();
    while (game.steps < steps) {
      game.core.shown = game.core.view(w, h);
      game.runSteps(1, k => player.apply(k, game.core.input));
      if (game.steps % every === 0 || game.steps === steps) note();
    }
    game.core.shown = game.core.view(w, h);
  }
  const ms = Date.now() - t0;
  const img = R.render(game.world, { t: game.t, ...game.core.camera.view(), w, h, colored: !!o.colored });
  const big = R.upscale(img, img.px);
  if (!o['no-hud']) rt.overlayText(big, rt.hudLines(game), Math.max(2, Math.round(img.px / 2)), game.world.pal);
  const png = writePng(path.resolve(o.out || path.join(OUT, `${def.id}-${String(t).replace('.', '_')}.png`)), big);
  const snap = game.snapshot();
  let state = null,
    save = null;
  if (o.state) {
    state = path.resolve(o.state);
    fs.mkdirSync(path.dirname(state), { recursive: true });
    fs.writeFileSync(state, JSON.stringify(snap, null, 2));
  }
  if (o.save) {
    save = path.resolve(o.save);
    fs.mkdirSync(path.dirname(save), { recursive: true });
    fs.writeFileSync(save, JSON.stringify(rt.saveGame(game), null, 2));
  }
  const p = game.player;
  console.log(
    `${def.id}: ${game.steps} steps (${game.t.toFixed(2)} s) in ${ms} ms` +
      (p ? ` · player at (${p.pos.map(v => v.toFixed(2)).join(', ')}) hp ${p.hp}` : '') +
      ` · ${game.entities.length} entities · state ${JSON.stringify(game.state)}`
  );
  if (trace.length) for (const s of trace) console.log(`${s.t.toFixed(2).padStart(7)} s  ` + (s.player ? `player (${s.player.pos.join(', ')}) hp ${s.player.hp}` : '') + `  ${JSON.stringify(s.state)}`);
  console.log(JSON.stringify({ png, state, save, hash: snap.hash, t: +game.t.toFixed(6), steps: game.steps, game: sample(game), ...(trace.length ? { trace } : {}) }));
}

/** the game in a few numbers: time, the player, the state, how many are on stage */
function sample(game) {
  const p = game.player;
  return {
    t: +game.t.toFixed(4),
    player: p ? { pos: p.pos.map(v => +v.toFixed(3)), hp: p.hp, down: p.deadFor >= 0 } : null,
    state: JSON.parse(JSON.stringify(game.state ?? null)),
    entities: game.entities.length,
    enemies: game.entities.filter(e => e.type === 'actor' && e.team !== 'player').length
  };
}

// ---------------------------------------------------------------------------------------------------------- sheet

async function sheet(o) {
  const file = gameFile(o._[1]);
  const { def, rt } = await loadGame(file);
  const script = readScript(o);
  const times = String(o.times || '0,1,2,4')
    .split(',')
    .map(Number)
    .filter(v => v >= 0)
    .sort((a, b) => a - b);
  if (!times.length) die('--times wants times in seconds: --times 0,1,2,4');
  const w = +(o.w || 600),
    h = +(o.h || 420);
  script.view = script.view || { w: 900, h: 620 };
  // one run, stepped forward to each moment in turn
  const { game } = rt.runHeadless(def, freshInk(), sceneOf(def), script, 0, { bones: 'cpu' });
  const player = new rt.ScriptPlayer(script),
    imgs = [],
    states = [];
  for (const t of times) {
    const target = Math.round(t * 60);
    while (game.steps < target) {
      game.core.shown = game.core.view(script.view.w, script.view.h);
      game.runSteps(1, k => player.apply(k, game.core.input));
    }
    const img = R.render(game.world, { t: game.t, ...game.core.camera.view(), w, h, colored: !!o.colored });
    const big = R.upscale(img, img.px);
    if (!o['no-hud']) rt.overlayText(big, rt.hudLines(game), Math.max(2, Math.round(img.px / 2)), game.world.pal);
    imgs.push(big);
    states.push({ t, hash: game.hash(), player: game.player ? { pos: game.player.pos.map(v => +v.toFixed(3)), hp: game.player.hp } : null, state: JSON.parse(JSON.stringify(game.state ?? null)) });
  }
  // pictures of different art-pixel sizes cannot share a grid: bring them all to the first one's size
  const W0 = imgs[0].w,
    H0 = imgs[0].h;
  const same = imgs.map(im => (im.w === W0 && im.h === H0 ? im : crop(im, W0, H0)));
  const cols = +(o.cols || Math.min(4, times.length));
  const out = writePng(path.resolve(o.out || path.join(OUT, `${def.id}-sheet.png`)), R.grid(same, cols, times.map(t => t + 's')));
  for (const s of states) console.log(`${String(s.t).padStart(5)} s  ${s.hash}  ` + (s.player ? `player (${s.player.pos.join(', ')}) hp ${s.player.hp}` : '') + `  ${JSON.stringify(s.state)}`);
  console.log(JSON.stringify({ png: out, times: states }));
}

/** an image cut or padded to w x h (top left kept) */
function crop(im, w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < Math.min(h, im.h); y++) rgb.set(im.rgb.subarray(y * im.w * 3, y * im.w * 3 + Math.min(w, im.w) * 3), y * w * 3);
  return { w, h, rgb };
}

// ---------------------------------------------------------------------------------------------------------- check

async function check(o) {
  const file = gameFile(o._[1]);
  const { def, rt } = await loadGame(file);
  const sources = [{ file: path.relative(REPO, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf8') }];
  // a scene module of the game's own (beside it) is the game's code too; the kit's own scenes are not linted
  if (typeof def.scene === 'string' && path.join(REPO, def.scene).startsWith(path.join(ENGINE, 'examples')))
    sources.push({ file: def.scene, text: fs.readFileSync(path.join(REPO, def.scene), 'utf8') });
  let scene;
  try {
    scene = sceneOf(def);
  } catch (e) {
    die(String(e));
  }
  const t0 = Date.now();
  const { problems, stats } = rt.validateGame(def, freshInk(), scene, { sources, seconds: +(o.seconds || 2) });
  let parity = null;
  if (o.parity && !problems.some(p => p.level === 'error')) parity = await browserParity(def, file, o, rt);
  if (parity && parity.problem) problems.push(parity.problem);
  const errors = problems.filter(p => p.level === 'error'),
    warnings = problems.filter(p => p.level === 'warning');
  for (const p of problems) console.log(`${p.level === 'error' ? 'ERROR  ' : 'warning'} ${p.where}: ${p.problem}\n        -> ${p.hint}  [${p.code}]`);
  if (stats)
    console.log(
      `${def.id}: ${stats.splats} splats, ${stats.groundColumns} columns of ground, ${stats.entities} entities; ` +
        `built in ${stats.buildMs} ms, ${stats.stepMs} ms a step` +
        (parity && parity.fg !== undefined ? `; browser parity ${parity.fg.toFixed(1)}%, hash ${parity.same ? 'same as Node' : 'DIFFERS'}` : '')
    );
  console.log(errors.length ? `${errors.length} error(s), ${warnings.length} warning(s)` : `no errors, ${warnings.length} warning(s) (${Date.now() - t0} ms)`);
  console.log(JSON.stringify({ ok: !errors.length, errors, warnings, stats, parity: parity && { fg: parity.fg, same: parity.same } }));
  if (errors.length) process.exitCode = 1;
}

/** the game drawn by the engine in a headless browser and by the toolkit's renderer in Node, compared */
async function browserParity(def, file, o, rt) {
  const exDir = path.join(ENGINE, 'examples');
  if (!file.startsWith(exDir)) return { problem: { level: 'warning', code: 'parity-skipped', where: 'check --parity', problem: 'only games in engine/examples/ can be opened in the browser', hint: 'put the game in engine/examples/<name>/game.ts' } };
  const name = path.basename(path.dirname(file));
  const input = o.input ? path.relative(exDir, path.resolve(o.input)).replace(/\\/g, '/') : null;
  if (o.input && input.startsWith('..')) return { problem: { level: 'warning', code: 'parity-skipped', where: 'check --parity', problem: 'the script must be in engine/examples/ for the browser to read it', hint: 'move it next to the game' } };
  const t = o.t === undefined ? 3 : +o.t;
  const { chromium } = require('playwright-core');
  const { startServer } = await import('./scripts/server.mjs');
  const { compare } = await import('./test/parity/compare.mjs');
  const server = await startServer({ port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ channel: o.browser || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
    await page.goto(server.url + 'parity.html');
    await page.waitForFunction(() => window.PARITY && window.PARITY.ready);
    // without a script the browser needs one too: an empty one written beside the game for the moment
    let scriptRel = input,
      temp = null;
    if (!scriptRel) {
      temp = path.join(path.dirname(file), '.check-empty.json');
      fs.writeFileSync(temp, JSON.stringify({ events: [] }));
      scriptRel = name + '/.check-empty.json';
    }
    try {
      const got = await page.evaluate(spec => window.PARITY.game(spec), { game: name, input: scriptRel, t, looks: ['default'], w: 900, h: 620 });
      const script = JSON.parse(fs.readFileSync(path.join(exDir, scriptRel), 'utf8'));
      const { game } = rt.runHeadless(def, freshInk(), sceneOf(def), script, t, { bones: 'cpu' });
      const ref = R.render(game.world, { t: game.t, ...game.core.camera.view(), w: 900, h: 620 });
      const shot = got.shots[0];
      const s = compare(ref, shot.frame.w === ref.w && shot.frame.h === ref.h ? Buffer.from(shot.frame.rgb, 'base64') : null, [ref.rgb[0], ref.rgb[1], ref.rgb[2]]);
      const same = got.hash === game.hash();
      const problem =
        !same
          ? { level: 'error', code: 'browser-differs', where: 'check --parity', problem: `the browser's game is not Node's at ${t} s (hash ${got.hash} vs ${game.hash()})`, hint: 'something in the game is not deterministic across engines: see docs/engine-determinism.md' }
          : s.fg < 95
            ? { level: 'warning', code: 'browser-picture', where: 'check --parity', problem: `the browser's picture matches Node's in ${s.fg.toFixed(1)}% of its pixels`, hint: 'run npm run parity in engine/ to see the difference pictures' }
            : null;
      return { fg: s.fg, same, problem };
    } finally {
      if (temp) fs.rmSync(temp, { force: true });
    }
  } catch (e) {
    return { problem: { level: 'warning', code: 'parity-failed', where: 'check --parity', problem: 'could not run the browser: ' + String(e.message || e).split('\n')[0], hint: 'install Edge or Chrome, or give --browser chrome' } };
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

// ---------------------------------------------------------------------------------------------------------- play

async function play(o) {
  const file = gameFile(o._[1]);
  if (!file.startsWith(path.join(ENGINE, 'examples'))) die('play opens games in engine/examples/<name>/: put the game there');
  const name = path.basename(path.dirname(file));
  const { startServer } = await import('./scripts/server.mjs');
  const { url } = await startServer({ port: +(o.port || 5173) });
  const at = `${url}?game=${name}`;
  console.log(`${name}: ${at}  (Ctrl+C stops the server)`);
  console.log(JSON.stringify({ url: at }));
  if (!o['no-open']) {
    const { spawn } = require('node:child_process');
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', at]] : process.platform === 'darwin' ? ['open', [at]] : ['xdg-open', [at]];
    try {
      spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
    } catch {
      // the URL is printed: open it by hand
    }
  }
}

// ---------------------------------------------------------------------------------------------------------- new

const TEMPLATES = { blank: 'blank', walk: 'farol-walk', fight: 'farol-fight' };

function newGame(o) {
  const name = o._[1];
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) die('new <name>: a lower-case-and-dashes name, like my-arena');
  const dir = path.join(ENGINE, 'examples', name);
  if (fs.existsSync(dir)) die(`engine/examples/${name}/ already exists`, { ok: false, error: 'exists' });
  const from = o.from || 'blank';
  if (!TEMPLATES[from]) die(`--from ${from}: one of ${Object.keys(TEMPLATES).join(', ')}`);
  fs.mkdirSync(dir, { recursive: true });
  if (from === 'blank') {
    fs.writeFileSync(path.join(dir, 'game.ts'), BLANK.replace(/__NAME__/g, name));
    fs.writeFileSync(path.join(dir, 'walk.json'), JSON.stringify({ seed: 1, view: { w: 900, h: 620 }, events: [{ step: 0, press: 'up' }, { t: 1.5, release: 'up' }, { t: 2, tap: 'attack' }] }, null, 2) + '\n');
  } else {
    const src = path.join(ENGINE, 'examples', TEMPLATES[from]);
    for (const f of fs.readdirSync(src)) {
      let text = fs.readFileSync(path.join(src, f), 'utf8');
      if (f === 'game.ts') text = text.replace(/id: '[^']+'/, `id: '${name}'`).replace(/from '\.\.\/farol-walk\/game'/g, "from '../farol-walk/game'");
      fs.writeFileSync(path.join(dir, f), text);
    }
  }
  const files = fs.readdirSync(dir).map(f => `engine/examples/${name}/${f}`);
  console.log(`made ${files.join(', ')}\nnext: node engine/cli.js check ${name}   then   node engine/cli.js shot ${name} --input engine/examples/${name}/walk.json --t 3`);
  console.log(JSON.stringify({ ok: true, files }));
}

const BLANK = `// __NAME__: a level of its own. The scene is built right here (the kit's makeBuilder and sculpt), then the engine
// samples its ground, makes the actors and runs it. Read engine/AGENTS.md first.
import { chaser, defineGame } from '../../src/game/index';
import { walker } from '../farol-walk/game';

// palette: 0 is the sky, then dark-to-light ramps that materials pick from ({ r: [first, ..., last] })
const PALETTE = [
  0x0b0d17, // 0 sky
  0x1e2230, 0x343a4f, 0x565e78, 0x8790a8, // 1-4 stone, dark to light
  0x1f3a24, 0x2f5e35, 0x4d8c45, 0x86c05a, // 5-8 grass
  0x3b2a55, 0x5c4380, 0x8c6bb5, 0xb7a6d9, // 9-12 purples (the grunt)
  0x4c1020, 0x8e2328, 0xc9433a, // 13-15 reds (the walker's body: its spec uses these indices)
  0xb7b2a6, 0xece4cc, // 16-17 whites (the walker's head)
  0xffd77a // 18 a warm light (sparks)
];

export default defineGame({
  id: '__NAME__',
  name: '__NAME__',
  scene: kit => ({
    id: '__NAME__',
    name: '__NAME__',
    seed: 1,
    build(seed) {
      const K = kit.KIT;
      const B = kit.makeBuilder(seed, PALETTE);
      const S = K.sculpt(kit.makeSculpt(B));
      S.sun = B.norm([-0.4, 0.8, 0.5]);
      // a square floor 12 across, its top at y = 0 (S.box takes half sizes)
      S.box([0, -0.5, 0], [6, 0.5, 6], { r: [5, 6, 7, 8] }, { res: 0.2 });
      // two stones to walk round
      S.ball([3, 0.6, -2], 0.8, { r: [1, 2, 3, 4] }, { res: 0.12 });
      S.box([-3, 0.75, 1.5], [0.6, 0.75, 0.6], { r: [1, 2, 3, 4] }, { res: 0.12 });
      S.bake();
      return B.finish({ cam: { target: [0, 0.5, 0], dist: 16, pitch: 0.65, yaw: 0.4 }, detail: 8, radius: 8 });
    }
  }),
  actors: {
    hero: { spec: walker, hp: 5 },
    grunt: { spec: { ...walker, sculpt: (S: any, T: (b: string) => unknown) => {
      S.ball([0, 0.5, 0], [0.34, 0.4, 0.34], { r: [9, 10, 11] }, T('root'));
      S.ball([0, 1.0, 0], 0.2, { r: [16, 17, 17] }, T('head'));
    } }, max: 2, hp: 2 }
  },
  spawns: { start: [0, null, 3], east: [4, null, 1] },
  effects: { weather: { rain: 0.6 } },
  hud: { lines: game => ['KILLS ' + (game.state as { kills: number }).kills] },
  init(game) {
    game.spawnActor({ actor: 'hero', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    game.spawnActor({ actor: 'grunt', at: 'east', brain: chaser({ sight: 8 }), tags: ['enemy'] });
    return { kills: 0 };
  },
  step(game) {
    for (const e of game.events) if (e.name === 'death' && (e.data as { team: string }).team === 'enemy') (game.state as { kills: number }).kills++;
  }
});
`;

// ---------------------------------------------------------------------------------------------------------- main

const o = parse(process.argv.slice(2));
const commands = { shot, sheet, check, play, new: newGame };
const run = commands[o._[0]];
if (!run) die(USAGE);
Promise.resolve(run(o)).catch(e => die(e && e.stack ? e.stack : String(e), { ok: false, error: String((e && e.message) || e) }));
