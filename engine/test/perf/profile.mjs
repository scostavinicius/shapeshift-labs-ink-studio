// Stage 11: where a simulation step spends its time. Runs a game headless with its script under the V8 profiler (in this
// process, through node:inspector) and adds up self time by function and by file.
//
//   node test/perf/profile.mjs [game] [script] [seconds]       default: arena, arena/win.json, 56
import fs from 'node:fs';
import path from 'node:path';
import inspector from 'node:inspector/promises';
import { fileURLToPath } from 'node:url';
import { loadInk, loadTs, ROOT, sceneFn } from '../load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [name = 'arena', scriptRel = 'arena/win.json', secs = '56'] = process.argv.slice(2);
const def = (await loadTs(`examples/${name}/game.ts`)).default;
const H = await loadTs('src/headless/run.ts');
const G = await loadTs('src/game/index.ts');
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', scriptRel), 'utf8'));
const scene = typeof def.scene === 'string' ? sceneFn(def.scene) : def.scene;

// build outside the profile: what is measured is the steps
const { game } = H.runHeadless(def, loadInk(), scene, script, 0);
const player = new G.ScriptPlayer(script);
const session = new inspector.Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: 100 });
await session.post('Profiler.start');
const t0 = performance.now(),
  steps = Math.round(+secs * 60);
while (game.steps < steps) {
  game.core.shown = game.core.view(900, 620);
  game.runSteps(1, k => player.apply(k, game.core.input));
}
const ms = performance.now() - t0;
const { profile } = await session.post('Profiler.stop');
session.disconnect();

// self time by function, and by where it lives
const total = profile.endTime - profile.startTime,
  dt = new Map();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
const byFn = new Map(),
  byFile = new Map();
const where = url => {
  if (!url) return '(native / engine)';
  if (url.startsWith('data:')) return 'engine bundle (src/)';
  if (url.startsWith('file:')) return path.relative(ROOT, fileURLToPath(url)).replace(/\\/g, '/');
  // the toolkit's bundle (dist/standalone.js) and Node's own modules come as plain paths or node: names
  return url.startsWith('node:') ? url : path.relative(ROOT, url).replace(/\\/g, '/');
};
for (const n of profile.nodes) {
  const t = dt.get(n.id) || 0;
  if (!t) continue;
  const fn = `${n.callFrame.functionName || '(anonymous)'}  ${where(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;
  byFn.set(fn, (byFn.get(fn) || 0) + t);
  const f = where(n.callFrame.url);
  byFile.set(f, (byFile.get(f) || 0) + t);
}
const pct = v => ((100 * v) / total).toFixed(1).padStart(5) + '%';
console.log(`${name}: ${steps} steps in ${ms.toFixed(0)} ms, ${(ms / steps).toFixed(3)} ms a step (profiled: sampling slows it a little)\n`);
console.log('by file:');
for (const [f, t] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log('  ' + pct(t) + '  ' + f);
console.log('\nby function (self time):');
for (const [f, t] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log('  ' + pct(t) + '  ' + f);
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', `${name}.cpuprofile`), JSON.stringify(profile));
