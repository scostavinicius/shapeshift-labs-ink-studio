// The level validator (stage 9): every mistake it can find in a game, at once, each with where it is, what is wrong and
// what was probably meant (in the spirit of the kit's own K.diorama.check). Three passes:
//   lintSource(text)      the game's source: what breaks determinism (Math.random, the clock, **), and what escapes it
//   checkDefinition(def)  the definition alone: shapes of things, degrees where radians go, numbers out of reason
//   checkRun(...)         builds the level and runs it a little: spawn points on ground, things set aside too late,
//                         what init returns, nothing falling through the world or turning to NaN, the same run twice
// `node engine/cli.js check <game>` runs all three and prints them; the problems are plain data for an AI to read.
import type { Ink, Vec3 } from '../../types/ink-studio';
import { createGame, type RunningGame } from './game';
import type { SceneFn } from './level';
import type { GameDef } from './types';
import { SOUND_NAMES } from '../ui/audio';
import { ENGINE_EVENTS, STORY_ACTIONS, STORY_FIELDS, STORY_TYPES, storyRules } from './story';

export interface Problem {
  level: 'error' | 'warning';
  /** a short stable name for the kind of problem */
  code: string;
  /** where: 'source:12', 'spawns.east', 'actors.grunt.spec', 'run' ... */
  where: string;
  problem: string;
  /** what was probably meant, or what to do */
  hint: string;
}

const err = (code: string, where: string, problem: string, hint: string): Problem => ({ level: 'error', code, where, problem, hint });
const warn = (code: string, where: string, problem: string, hint: string): Problem => ({ level: 'warning', code, where, problem, hint });

// ---------------------------------------------------------------------------------------------------------- the source

/** the text with comments and the insides of strings blanked out (same length, same lines), so patterns only see code */
export function codeOnly(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i],
      d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') (out += ' '), i++;
    } else if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) (out += src[i] === '\n' ? '\n' : ' '), i++;
      out += '  ';
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') (out += ' '), i++;
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += c;
      i++;
    } else (out += c), i++;
  }
  return out;
}

const RULES: { re: RegExp; level: 'error' | 'warning'; code: string; problem: string; hint: string }[] = [
  {
    re: /\bMath\.random\s*\(/g,
    level: 'error',
    code: 'math-random',
    problem: 'Math.random() in the game',
    hint: 'use game.rng(): the same seed must give the same game (docs/engine-determinism.md)'
  },
  {
    re: /\bDate\.now\s*\(|\bnew\s+Date\b|\bperformance\.now\s*\(/g,
    level: 'error',
    code: 'clock',
    problem: 'the game reads the clock',
    hint: 'use game.t (simulation time) or count steps: the clock differs every run'
  },
  {
    re: /[\w)\]]\s*\*\*\s*[\w(]|\*\*=/g,
    level: 'error',
    code: 'power-operator',
    problem: 'the ** operator',
    hint: 'write Math.pow(a, b): ** is worked out by the JavaScript engine itself and is not deterministic across engines'
  },
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*Math\.(?:sin|cos|tan|asin|acos|atan2?|exp|expm1|log1p|log2|log10|log|pow|cbrt|sinh|cosh|tanh|asinh|acosh|atanh|hypot)\s*[;,]/gm,
    level: 'warning',
    code: 'captured-math',
    problem: 'a Math function kept in a variable when the module loads',
    hint: 'call Math.sin (etc.) where it is used: the engine swaps in its deterministic Math only while the game runs'
  },
  {
    re: /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(|\bawait\b/g,
    level: 'warning',
    code: 'async',
    problem: 'timers or await in the game',
    hint: 'a game runs in fixed steps (def.step): count time with game.t, never with timers'
  }
];

/** Problems in a game's source text (its game.ts, or a scene module of its own). */
export function lintSource(src: string, file = 'source'): Problem[] {
  const code = codeOnly(src),
    out: Problem[] = [];
  const lineOf = (i: number) => code.slice(0, i).split('\n').length;
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(code))) out.push({ level: r.level, code: r.code, where: `${file}:${lineOf(m.index)}`, problem: r.problem, hint: r.hint });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- the definition

const isVec = (v: unknown, n = 3) => Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x));

/** Problems in a definition, without building anything. */
export function checkDefinition(def: GameDef<any>): Problem[] {
  const out: Problem[] = [];
  if (!def || typeof def !== 'object') return [err('no-definition', 'default export', 'the module does not export a game', 'export default defineGame({ id, scene, init })')];
  if (typeof def.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(def.id))
    out.push(err('id', 'id', `id ${JSON.stringify(def.id)} is not a lower-case-and-dashes name`, "give id: 'my-game' (it names saves and files)"));
  if (typeof def.init !== 'function') out.push(err('init', 'init', 'no init(game)', 'init(game) spawns what starts on stage and returns game.state: return {} if there is nothing to keep'));
  if (typeof def.scene !== 'string' && typeof def.scene !== 'function')
    out.push(err('scene', 'scene', 'no scene', "scene: 'showcase/farol.js' (a path from the repository) or a function kit => ({ id, name, seed, build })"));
  for (const [name, a] of Object.entries(def.actors || {})) {
    const w = `actors.${name}`,
      s = (a && a.spec) as Record<string, any> | undefined;
    if (!s || typeof s !== 'object') {
      out.push(err('actor-spec', w + '.spec', 'no spec', 'spec is a K.character spec: start from the walker in examples/farol-walk/game.ts'));
      continue;
    }
    if (!s.pts || !isVec(s.pts.hip) || !isVec(s.pts.chest) || !isVec(s.pts.neck))
      out.push(err('actor-pts', w + '.spec.pts', 'the spec has no pts { hip, chest, hem, neck }', 'K.character needs the points its body hangs from: copy pts from the walker in examples/farol-walk/game.ts'));
    if (typeof s.sculpt !== 'function') out.push(err('actor-sculpt', w + '.spec.sculpt', 'the spec has no sculpt(S, T)', "sculpt(S, T) makes its body: S.ball([0, 0.5, 0], 0.4, { r: [1, 2, 3] }, T('root'))"));
    if (s.world) out.push(warn('actor-world', w + '.spec.world', 'the spec has its own world', 'leave world out: the engine gives every actor the level\'s collision'));
    if (a.max !== undefined && !(Number.isInteger(a.max) && a.max >= 1)) out.push(err('actor-max', w + '.max', `max ${a.max} is not a whole number from 1`, 'max is how many of these can be on stage at once'));
    if (a.hp !== undefined && !(a.hp >= 1)) out.push(err('actor-hp', w + '.hp', `hp ${a.hp}`, 'hp is whole points of health, 1 or more'));
    if (a.radius !== undefined && !(a.radius >= 0.05 && a.radius <= 3)) out.push(warn('actor-radius', w + '.radius', `radius ${a.radius}`, 'a body radius is in world units: a walker is 0.3'));
    if (s.height !== undefined && !(s.height > 0.2 && s.height < 10)) out.push(warn('actor-height', w + '.spec.height', `height ${s.height}`, 'height is in world units: the walker is 1.2'));
  }
  for (const [name, p] of Object.entries(def.spawns || {})) {
    if (!Array.isArray(p) || p.length !== 3 || typeof p[0] !== 'number' || typeof p[2] !== 'number' || !(p[1] === null || typeof p[1] === 'number'))
      out.push(err('spawn-shape', `spawns.${name}`, `${JSON.stringify(p)} is not [x, y, z]`, 'give [x, null, z] to stand it on the ground there, or [x, y, z]'));
  }
  const c = def.camera;
  if (c) {
    if (c.pitch !== undefined && Math.abs(c.pitch) > 1.6)
      out.push(err('degrees', 'camera.pitch', `pitch ${c.pitch}: more than a quarter turn`, `angles are in radians: did you mean ${((c.pitch * Math.PI) / 180).toFixed(3)} (${c.pitch} degrees)?`));
    if (c.yaw !== undefined && Math.abs(c.yaw) > 6.3)
      out.push(warn('degrees', 'camera.yaw', `yaw ${c.yaw}: more than a full turn`, `angles are in radians: did you mean ${((c.yaw * Math.PI) / 180).toFixed(3)} (${c.yaw} degrees)?`));
    if (c.target && !isVec(c.target)) out.push(err('camera-target', 'camera.target', 'target is not [x, y, z]', 'target: [0, 1, 0]'));
  }
  if (def.combat) {
    const k = def.combat;
    if (k.arc !== undefined && k.arc > 0 && k.arc <= Math.PI + 0.01)
      out.push(warn('radians', 'combat.arc', `arc ${k.arc}: a very narrow swing`, `arc is in degrees: did you mean ${((k.arc * 180) / Math.PI).toFixed(0)} (${k.arc} radians)?`));
    if (k.invuln !== undefined && !(k.invuln >= 0 && k.invuln <= 5)) out.push(warn('invuln', 'combat.invuln', `invuln ${k.invuln} s`, 'seconds a hit actor cannot be hit again: 0.6 is the default'));
    if (k.respawnAt && def.spawns && !def.spawns[k.respawnAt])
      out.push(err('respawn-at', 'combat.respawnAt', `no spawn point "${k.respawnAt}"`, `spawn points: ${Object.keys(def.spawns).join(', ')}`));
  }
  if (def.effects && def.effects !== true) {
    const e = def.effects;
    const r = e.weather?.rain;
    if (r !== undefined && !(r >= 0 && r <= 1)) out.push(warn('weather', 'effects.weather.rain', `rain ${r}`, 'rain is 0 (dry) to 1 (pouring)'));
    if (e.fuel !== undefined && !(e.fuel >= 0 && e.fuel <= 1)) out.push(warn('fuel', 'effects.fuel', `fuel ${e.fuel}`, 'fuel is 0 (nothing burns) to 1'));
  }
  for (const [event, sound] of Object.entries(def.sounds || {}))
    if (!(SOUND_NAMES as readonly string[]).includes(sound))
      out.push(warn('sound', `sounds.${event}`, `no sound "${sound}": the event plays nothing`, `sounds: ${SOUND_NAMES.join(', ')}`));
  return out;
}

// ---------------------------------------------------------------------------------------------------------- the story

/** the kit's own checks of a story document (cli/story-document.js), handed in by whoever can load them (Node) */
export interface StoryTools {
  validateStoryDocument(doc: unknown): unknown;
  preflightStoryDocument(doc: unknown): { diagnostics?: { code?: string; path?: string; message?: string; severity?: string }[] };
}

/**
 * def.story (stage 31): the document by the kit's own validation and route preview (when `tools` are given), then what
 * the engine adds: the queries, objective types and actions it knows, the actors, spawn points, brains and sounds the
 * actions name, and event kinds nothing in the game sends (a kind the game's source emits counts, when it is given).
 */
export function checkStory(def: GameDef<any>, tools?: StoryTools, sourceText = ''): Problem[] {
  const out: Problem[] = [];
  const st = def.story;
  if (!st) return out;
  const doc = st.document;
  if (!doc || typeof doc !== 'object' || doc.format !== 'ink-studio/story')
    return [err('story', 'story.document', 'not a story document', "an ink-studio/story version 1 document: { format: 'ink-studio/story', version: 1, id, stories } (see docs/story-documents.md)")];
  if (tools) {
    try {
      tools.validateStoryDocument(doc);
    } catch (e: any) {
      const i = e && e.storyIssue;
      out.push(err('story', i?.path || 'story.document', i?.message || String(e?.message || e), 'see docs/story-documents.md, "Write a definition"'));
      return out;
    }
    for (const d of tools.preflightStoryDocument(doc).diagnostics || [])
      out.push((d.severity === 'error' ? err : warn)('story-route', d.path || 'story.document', `${d.code}: ${d.message}`, 'see the routes with: node cli/ink-studio.js story preview <file>'));
  }
  const { events, states, types } = storyRules(st);
  for (const [where, rule] of states)
    if (!STORY_FIELDS[rule.field]) out.push(err('story-field', where + '.field', `no query "${rule.field}" in the engine`, `queries: ${Object.keys(STORY_FIELDS).join(', ')}`));
  for (const [where, type] of types)
    if (!STORY_TYPES.includes(type) && !doc.objectiveTypes?.[type])
      out.push(err('story-type', where, `the engine cannot confirm a "${type}" objective`, `types: ${STORY_TYPES.join(', ')}, or give the objective its own evidence`));
  // event kinds: the engine's, the ones the game's actions emit, and any its source sends with game.emit
  const emitted = new Set<string>();
  for (const rule of Object.values(st.actions || {})) for (const a of rule?.actions || []) if (a.action === 'game/emit' && a.args?.name) emitted.add(String(a.args.name));
  for (const m of sourceText.matchAll(/emit\(\s*['"]([^'"]+)['"]/g)) emitted.add(m[1]);
  for (const [where, rule] of events)
    if (!ENGINE_EVENTS.includes(rule.kind) && !emitted.has(rule.kind))
      out.push(warn('story-event', where + '.kind', `nothing sends an event "${rule.kind}"`, `the engine's: ${ENGINE_EVENTS.join(', ')}; or game.emit('${rule.kind}') in a rule`));
  const stories = doc.stories || {};
  for (const [s, story] of Object.entries<any>(stories)) {
    if (!story.lifecycle?.progression)
      out.push(warn('story-progression', `story.stories.${s}.lifecycle`, 'no lifecycle.progression: the kit runs no stages without it', 'add "lifecycle": { "progression": true } (the engine runs the stages either way)'));
    for (const [sid, stage] of Object.entries<any>(story.stages || {}))
      if (stage.decision && stage.decision.mode !== 'autonomous')
        out.push(warn('story-decision', `story.stories.${s}.stages.${sid}.decision`, `mode "${stage.decision.mode}": the engine has no player choices`, 'the engine takes the first open branch by ID: use { "mode": "autonomous" } and "auto": true on the branches'));
    if (story.lifecycle?.activation === 'manual' || story.lifecycle?.deadlines?.offer)
      out.push(warn('story-offer', `story.stories.${s}.lifecycle`, 'an offer waits for a command the engine does not give', "start it from an action instead: { action: 'game/story-start', args: { story } }"));
  }
  for (const [id, rule] of Object.entries(st.actions || {})) {
    const w = `story.actions.${id}`;
    if (!rule || !rule.on || typeof rule.on.kind !== 'string') out.push(err('story-action', w + '.on', 'no on: { kind }', "on: { kind: 'story-stage-entered', where: { path: '/stage', value: 'boss' } }"));
    (rule?.actions || []).forEach((a, k) => {
      const aw = `${w}.actions[${k}]`,
        args: any = a.args || {};
      if (!STORY_ACTIONS[a.action]) {
        out.push(err('story-action', aw + '.action', `no action "${a.action}"`, `actions: ${Object.keys(STORY_ACTIONS).join(', ')}`));
        return;
      }
      if (a.action === 'game/spawn') {
        if (!def.actors?.[args.actor]) out.push(err('story-action', aw + '.args.actor', `no actor "${args.actor}"`, `actors: ${Object.keys(def.actors || {}).join(', ') || 'none'}`));
        if (typeof args.at === 'string' && !def.spawns?.[args.at] && !a.bindings?.['/at'])
          out.push(err('story-action', aw + '.args.at', `no spawn point "${args.at}"`, `spawns: ${Object.keys(def.spawns || {}).join(', ') || 'none'}`));
        const brain = args.brain || args.kind || args.actor;
        if (!def.brains?.[brain]) out.push(err('story-action', aw + '.args.brain', `no brain "${brain}" in def.brains`, `brains: { ${brain}: chaser() } (a spawned actor needs one, and so does the save)`));
      }
      if (a.action === 'game/sound' && !(SOUND_NAMES as readonly string[]).includes(args.name))
        out.push(warn('sound', aw + '.args.name', `no sound "${args.name}"`, `sounds: ${SOUND_NAMES.join(', ')}`));
      if (a.action === 'game/story-start' && !stories[args.story])
        out.push(err('story-action', aw + '.args.story', `no story "${args.story}"`, `stories: ${Object.keys(stories).join(', ')}`));
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- a run

export interface RunStats {
  buildMs: number;
  stepMs: number;
  splats: number;
  groundColumns: number;
  entities: number;
}

/** the nearest place with ground to (x, z), searching outward, or null */
function nearestGround(g: RunningGame<any>, x: number, z: number): [number, number, number] | null {
  for (let r = 0.25; r <= 60; r += r < 4 ? 0.25 : 0.5)
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2,
        px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r,
        y = g.collision.ground(px, pz);
      if (y > -1e8 && !g.collision.blocked([px, y, pz], 0.3, 1.2)) return [+px.toFixed(2), +y.toFixed(2), +pz.toFixed(2)];
    }
  return null;
}

/**
 * Build the level and run it for `seconds` with no input, twice: everything a definition cannot show on its own. `scene`
 * is the scene module's function.
 */
export function checkRun(def: GameDef<any>, ink: Ink, scene: SceneFn, seconds = 2): { problems: Problem[]; stats: RunStats | null } {
  const out: Problem[] = [];
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let game: RunningGame<any>;
  let initFailed = false;
  const t0 = now();
  try {
    game = createGame(def, ink, { scene, bones: 'cpu' });
  } catch (e) {
    // init or the build failed: build the level again without init, so the level itself can still be checked
    const msg = e instanceof Error ? e.message : String(e);
    try {
      game = createGame({ ...def, init: () => ({}) }, ink, { scene, bones: 'cpu' });
    } catch {
      out.push(err('build', 'build', msg, hintFor(msg)));
      return { problems: out, stats: null };
    }
    out.push(err('init-failed', 'init', msg, hintFor(msg)));
    initFailed = true;
  }
  const buildMs = now() - t0,
    level = game.level;

  // things set aside after the world was finished never reach it
  const late = level.B.count() - game.world.count;
  if (late > 0)
    out.push(
      err('after-finish', 'scene', `${late} splats were made after B.finish()`, 'K.pool, K.character, K.play.fx ... set splats aside: make them before B.finish(), or through def.build(ctx) / def.actors')
    );
  if (level.S && level.S.solidCount() > 0)
    out.push(
      warn('after-bake', 'scene', `${level.S.solidCount()} solids were added after the last S.bake()`, 'they are not drawn and nobody can stand on them: call S.bake() after adding them')
    );
  const cols = level.bakes.reduce((s, b) => s + b.columns, 0);
  if (cols === 0)
    out.push(
      err('no-ground', 'scene', 'nothing to stand on: no bake left any solid ground', 'call S.bake() after the solids; a negative solid ({ neg: true }) removes everything inside it; ghosts ({ ghost: true }) are not ground')
    );

  // spawn points
  for (const [name, p] of Object.entries(def.spawns || {})) {
    if (!Array.isArray(p) || p.length !== 3) continue;
    const g = game.collision.ground(p[0], p[2]);
    if (p[1] === null && g < -1e8) {
      const n = nearestGround(game, p[0], p[2]);
      out.push(err('spawn-no-ground', `spawns.${name}`, `(${p[0]}, ${p[2]}) has no ground under it`, n ? `the nearest ground is at [${n[0]}, null, ${n[2]}]` : 'the level has no ground near it'));
      continue;
    }
    const y = p[1] === null ? g : p[1];
    if (p[1] !== null) {
      const below = game.collision.height(p[0], p[2], p[1] + 0.1);
      if (below > -1e8 && below < 1e8 && Math.abs(below - p[1]) > 1)
        out.push(warn('spawn-height', `spawns.${name}`, `y ${p[1]}, but the ground there is at ${below.toFixed(2)}`, `give null for y to stand it on the ground: [${p[0]}, null, ${p[2]}]`));
    }
    if (game.collision.blocked([p[0], y, p[2]], 0.3, 1.2)) {
      const n = nearestGround(game, p[0], p[2]);
      out.push(err('spawn-in-wall', `spawns.${name}`, `(${p[0]}, ${p[2]}) is inside something`, n ? `free ground nearby: [${n[0]}, null, ${n[2]}]` : 'move it into the open'));
    }
  }

  if (initFailed) return { problems: out, stats: null };

  // what init made
  const plain = (v: unknown) => {
    try {
      return JSON.stringify(JSON.parse(JSON.stringify(v ?? null))) === JSON.stringify(v ?? null);
    } catch {
      return false;
    }
  };
  if (!plain(game.state) || hasFunction(game.state))
    out.push(err('state-not-data', 'init', 'init returned something that is not plain data', 'game.state goes into saves and snapshots: numbers, strings, booleans, arrays, plain objects; keep functions and kit objects in def.build / game.built'));
  for (const e of game.entities)
    if (!plain(e.data) || hasFunction(e.data)) out.push(err('data-not-data', `entity ${e.id} (${e.kind})`, 'its data is not plain data', 'entity.data goes into saves: plain values only'));
  if (!game.player) out.push(warn('no-player', 'init', 'no actor with brain "player"', "nobody takes the keys and the camera follows nothing: spawnActor({ actor, at, brain: 'player', tags: ['player'] })"));

  // a little of the game, twice
  const starts = new Map(game.entities.filter(e => e.type === 'actor').map(e => [e.id, e.pos[1]]));
  const steps = Math.round(seconds * 60);
  let stepMs = 0;
  try {
    const t1 = now();
    for (let n = 0; n < steps; n++) {
      game.runSteps(1);
      for (const e of game.entities) {
        if (e.pos.some(v => !Number.isFinite(v))) throw new Error(`${e.kind} #${e.id} has a position of NaN or Infinity at ${game.t.toFixed(2)} s`);
        const y0 = starts.get(e.id);
        if (e.type === 'actor' && y0 !== undefined && e.pos[1] < y0 - 3)
          throw new Error(`${e.kind} #${e.id} fell from y ${y0.toFixed(2)} to ${e.pos[1].toFixed(2)} by ${game.t.toFixed(2)} s`);
      }
    }
    stepMs = (now() - t1) / steps;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out.push(err('run', 'run', msg, msg.includes('fell') ? 'it stands on an edge or a hole: move its spawn point onto solid ground' : hintFor(msg)));
  }
  if (!out.some(p => p.code === 'run')) {
    try {
      const again = createGame(def, ink, { scene, bones: 'cpu' });
      again.runSteps(steps);
      if (again.hash() !== game.hash())
        out.push(
          err('not-deterministic', 'run', `two runs of ${seconds} s from the same seed differ`, 'something outside the game changes it: Math.random, the clock, state kept outside game.state, or a module-level variable the game writes to')
        );
    } catch {
      // the first run is what matters for messages
    }
  }
  if (buildMs > 4000) out.push(warn('slow-build', 'scene', `the level takes ${(buildMs / 1000).toFixed(1)} s to build`, 'raise res on large solids (res is the spacing of surface samples: 0.2 instead of 0.1 makes 4 times fewer splats)'));
  if (stepMs > 8) out.push(warn('slow-step', 'run', `a step takes ${stepMs.toFixed(1)} ms (a frame has 16.7)`, 'fewer actors or effects, or lighter systems in the scene'));
  return {
    problems: out,
    stats: { buildMs: Math.round(buildMs), stepMs: +stepMs.toFixed(3), splats: game.world.count, groundColumns: cols, entities: game.entities.length }
  };
}

function hasFunction(v: unknown): boolean {
  if (typeof v === 'function') return true;
  if (v && typeof v === 'object') return Object.values(v as object).some(hasFunction);
  return false;
}

/** a hint for an error the engine or the kit threw */
function hintFor(msg: string): string {
  if (/max is \d+, all in use/.test(msg)) return 'raise actors.<name>.max to the most that are ever on stage together';
  if (/no spawn point/.test(msg)) return 'add it to spawns, or spawn at [x, y, z]';
  if (/no actor "/.test(msg)) return 'declare it in actors: { name: { spec, max } }';
  if (/has no ground under it/.test(msg)) return 'move the spawn point onto the level, or give its y';
  if (/did not use makeBuilder|not made by B.finish/.test(msg)) return 'the scene must build with makeBuilder and return B.finish({ cam, detail })';
  if (/is not a function|undefined/.test(msg)) return 'a name is wrong: compare with engine/AGENTS.md and the examples';
  return 'see engine/AGENTS.md';
}

/** Everything: the definition, the source (if given), and a run. */
export function validateGame(
  def: GameDef<any>,
  ink: Ink,
  scene: SceneFn,
  o: { sources?: { file: string; text: string }[]; seconds?: number; storyTools?: StoryTools } = {}
): { problems: Problem[]; stats: RunStats | null } {
  const problems = [...checkDefinition(def), ...checkStory(def, o.storyTools, (o.sources || []).map(x => x.text).join('\n'))];
  for (const s of o.sources || []) problems.push(...lintSource(s.text, s.file));
  if (problems.some(p => p.level === 'error' && ['no-definition', 'init', 'scene', 'actor-spec', 'actor-pts', 'actor-sculpt', 'spawn-shape', 'story', 'story-action'].includes(p.code)))
    return { problems, stats: null };
  const run = checkRun(def, ink, scene, o.seconds ?? 2);
  return { problems: [...problems, ...run.problems], stats: run.stats };
}

export type { Vec3 };
