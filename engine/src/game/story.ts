// Missions as data (stage 31): a game's campaign written in the kit's story format (ink-studio/story version 1,
// docs/story-documents.md), run by the engine. The kit's own runner works on its world runtime (K.world: systems,
// accounts, places), which the engine does not use; this one reads the same documents against the engine's game: its
// events (death, hit, break, whatever game.emit sends) and a few queries (game/enemies, game/player, game/state ...).
//
// What runs, each step, after def.step:
//   1. stories waiting for a trigger look at the step's events and queries; a story with no triggers starts at once
//   2. the current stage of each active story checks its objectives' evidence (from the step after it was entered)
//   3. a stage whose objectives allow a branch takes the first one by ID: to another stage, or to an outcome that ends
//      the story (completed, or failed when the outcome says status: 'failed'); deadlines can expire it
//   4. what happened is published as the kit's story events (story-started, story-stage-entered, story-objective-resolved,
//      story-branch-chosen, story-transition), into the game's own events
//   5. the event actions (def.story.actions, the kit's eventActions shape) run on the step's events: spawn, say, sound,
//      set state, win, lose ...
// Every bit of progress is plain data (StoryProgress): it goes into snapshots, saves and the hash.
import type { Vec3 } from '../../types/ink-studio';
import type { Actor, Brain, Game, GameEvent } from './types';

// ---------------------------------------------------------------------------------------------------------- the shapes

/** a condition of the kit's world conditions: a test at a JSON Pointer, or all / any / not of others */
export type Condition =
  | { path?: string | (string | number)[]; op?: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'exists'; value?: unknown }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface EventRule {
  kind: string;
  system?: string;
  where?: Condition;
}
export interface StateRule {
  field: string;
  args?: Record<string, unknown>;
  select?: string | (string | number)[];
  when: Condition;
}
export type Evidence = { event: EventRule } | { state: StateRule };

/** one rule of def.story.actions: when an event matches `on`, run `actions` (the kit's eventActions shape) */
export interface EventAction {
  on: EventRule;
  /** how many times it may run in a game (default: no limit) */
  limit?: number;
  /** seconds after the event (default 0: in the same step) */
  delay?: number;
  actions: { action: string; args?: Record<string, unknown>; bindings?: Record<string, string> }[];
}

/** def.story: the document and what its events do */
export interface StoryDef {
  /** an ink-studio/story version 1 document (import it from a JSON file next to game.ts) */
  document: any;
  /** event actions: id -> rule */
  actions?: Record<string, EventAction>;
}

/** where one story is: plain data */
export interface StoryRun {
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'expired';
  stage: string | null;
  /** visits so far: a stage entered again is a new visit */
  visit: number;
  /** the step the current visit began: its evidence is looked at from the next step */
  entered: number;
  objectives: Record<string, 'open' | 'completed' | 'failed' | 'skipped'>;
  /** timed objectives (maintain, survive, protect): the time their condition first held, while it holds */
  since: Record<string, number>;
  /** each trigger's memory: matching event times (count within), the last sample (crossing), since when it holds */
  triggers: Record<string, { times: number[]; was: boolean | null; since: number | null }>;
  outcome: string | null;
  /** seconds active (the work deadline) */
  worked: number;
  /** the stages it went through: [stage, branch] */
  route: [string, string][];
}

export interface StoryProgress {
  stories: Record<string, StoryRun>;
  /** times each action rule has run */
  fired: Record<string, number>;
  /** actions waiting for their delay: the step they are due, the rule, and the event that set them off */
  queue: { due: number; rule: string; event: { name: string; data?: unknown } }[];
  /** what the stories published last step (their own triggers and evidence see it this step) */
  carry: { name: string; data?: unknown }[];
}

/** the queries a story can ask (state rules' field), each with what it returns */
export const STORY_FIELDS: Record<string, string> = {
  'game/state': 'game.state',
  'game/enemies': 'how many actors are up: of a tag (args.tag), or else of any team but the player\'s',
  'game/actors': 'how many actors are up, of a kind, a tag and a team (args.kind, args.tag, args.team)',
  'game/player': '{ hp, pos, down } of the player, unavailable while there is none',
  'game/time': 'seconds since the start',
  'game/story': '{ [story]: { state, stage, outcome } } of every story of the document'
};

/** the objective types the engine can confirm */
export const STORY_TYPES = ['reach', 'observe', 'maintain', 'survive', 'protect'];

/** what def.story.actions can do */
export const STORY_ACTIONS: Record<string, string> = {
  'game/spawn': '{ actor, at, brain?, kind?, tags?, team?, face?, count? }: brain is a name of def.brains (default: the kind\'s)',
  'game/say': '{ text }: a message on the HUD',
  'game/sound': '{ name }: a sound of the engine',
  'game/emit': '{ name, data? }: an event of the game',
  'game/set': '{ path, value }: a value in game.state, at a JSON Pointer',
  'game/add': '{ path, value }: a number added to one in game.state',
  'game/heal': '{ amount }: health back to the player, up to its most',
  'game/win': '{}: game.state.won = true, and the event won',
  'game/lose': '{}: game.state.lost = true, and the event lost',
  'game/break': '{ tag }: a breakable thing broken, as by a blow',
  'game/remove': '{ tag }: every actor of a tag leaves the stage',
  'game/story-start': '{ story }: a story waiting for its trigger starts now'
};

/** the story's own events, published with system 'story' */
export const STORY_EVENTS = ['story-started', 'story-stage-entered', 'story-objective-resolved', 'story-branch-chosen', 'story-transition'];

// ---------------------------------------------------------------------------------------------------------- reading data

function pointer(path: string | (string | number)[] | undefined): (string | number)[] {
  if (path === undefined || path === '' || path === '/') return [];
  if (Array.isArray(path)) return path;
  return path
    .split('/')
    .slice(1)
    .map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function at(value: unknown, path: string | (string | number)[] | undefined): unknown {
  let v: any = value;
  for (const k of pointer(path)) {
    if (v === null || typeof v !== 'object') return undefined;
    v = v[k as any];
  }
  return v;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** a condition on a value (the kit's world conditions) */
export function holds(c: Condition | undefined, value: unknown): boolean {
  if (!c) return true;
  if ('all' in c) return c.all.every(x => holds(x, value));
  if ('any' in c) return c.any.some(x => holds(x, value));
  if ('not' in c) return !holds(c.not, value);
  const v = at(value, c.path),
    w = c.value as any;
  switch (c.op ?? 'eq') {
    case 'eq':
      return same(v, w);
    case 'ne':
      return !same(v, w);
    case 'lt':
      return typeof v === 'number' && v < w;
    case 'lte':
      return typeof v === 'number' && v <= w;
    case 'gt':
      return typeof v === 'number' && v > w;
    case 'gte':
      return typeof v === 'number' && v >= w;
    case 'in':
      return Array.isArray(w) && w.some(x => same(x, v));
    case 'exists':
      return v !== undefined;
  }
  return false;
}

function setAt(root: any, path: string, value: unknown): void {
  const keys = pointer(path);
  if (!keys.length || root === null || typeof root !== 'object') return;
  let v = root;
  for (const k of keys.slice(0, -1)) {
    if (v[k] === null || typeof v[k] !== 'object') v[k] = {};
    v = v[k];
  }
  v[keys[keys.length - 1]] = value;
}

const sorted = (o: Record<string, unknown> | undefined) => Object.keys(o || {}).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// ---------------------------------------------------------------------------------------------------------- the runner

export class StoryRunner {
  progress: StoryProgress;
  private doc: any;
  private actions: Record<string, EventAction>;

  constructor(
    def: StoryDef,
    private game: Game<any>
  ) {
    this.doc = def.document;
    this.actions = def.actions || {};
    this.progress = StoryRunner.fresh(this.doc);
  }

  static fresh(doc: any): StoryProgress {
    const stories: Record<string, StoryRun> = {};
    for (const id of Object.keys(doc?.stories || {}))
      stories[id] = { state: 'waiting', stage: null, visit: 0, entered: 0, objectives: {}, since: {}, triggers: {}, outcome: null, worked: 0, route: [] };
    return { stories, fired: {}, queue: [], carry: [] };
  }

  /** the document's id */
  get id(): string {
    return this.doc?.id || 'story';
  }

  /** a story's state ('waiting', 'active', 'completed', 'failed', 'expired'), its stage and outcome */
  of(story: string): { state: StoryRun['state']; stage: string | null; outcome: string | null } | null {
    const r = this.progress.stories[story];
    return r ? { state: r.state, stage: r.stage, outcome: r.outcome } : null;
  }

  /** the HUD's lines: each active story's stage, and the objectives still open in it */
  lines(): string[] {
    const out: string[] = [];
    for (const [id, r] of Object.entries(this.progress.stories)) {
      if (r.state !== 'active' || !r.stage) continue;
      const st = this.doc.stories[id].stages[r.stage];
      out.push(String(st.title).toUpperCase());
      const objs = st.objectives || {};
      const open = Object.keys(objs).filter(o => r.objectives[o] === 'open' && !objs[o].optional);
      if (open.length > 1) for (const o of open) out.push('- ' + String(objs[o].title).toUpperCase());
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ queries

  query(field: string, args: Record<string, unknown> = {}): unknown {
    const g = this.game;
    const up = (a: Actor) => a.alive && a.deadFor < 0;
    const actors = () => g.entities.filter((e): e is Actor => e.type === 'actor' && up(e as Actor));
    switch (field) {
      case 'game/state':
        return g.state;
      case 'game/enemies': {
        const tag = args.tag as string | undefined;
        return actors().filter(a => (tag ? a.tags.includes(tag) : a.team !== 'player')).length;
      }
      case 'game/actors':
        return actors().filter(a => (!args.kind || a.kind === args.kind) && (!args.tag || a.tags.includes(args.tag as string)) && (!args.team || a.team === args.team)).length;
      case 'game/player': {
        const p = g.player;
        return p ? { hp: p.hp, pos: [p.pos[0], p.pos[1], p.pos[2]], down: p.deadFor >= 0 } : undefined;
      }
      case 'game/time':
        return g.t;
      case 'game/story': {
        const out: Record<string, unknown> = {};
        for (const [id, r] of Object.entries(this.progress.stories)) out[id] = { state: r.state, stage: r.stage, outcome: r.outcome };
        return out;
      }
    }
    return undefined;
  }

  private stateHolds(rule: StateRule): boolean | null {
    const v = this.query(rule.field, rule.args);
    if (v === undefined) return null;
    return holds(rule.when, rule.select !== undefined ? at(v, rule.select) : v);
  }

  private eventMatches(rule: EventRule, e: { name: string; data?: unknown }): boolean {
    if (e.name !== rule.kind) return false;
    const system = STORY_EVENTS.includes(e.name) ? 'story' : 'game';
    if (rule.system && rule.system !== system) return false;
    return holds(rule.where, e.data ?? {});
  }

  // ------------------------------------------------------------------------------------------------ the step

  /** one step, after def.step (game.events holds what the step has published so far) */
  step(dt: number): void {
    const g = this.game,
      P = this.progress,
      now = g.t,
      steps = g.steps;
    // what the stories see: what they published last step, and the step's own events so far
    const seen = [...P.carry, ...g.events.map(e => ({ name: e.name, data: e.data }))];
    const firstNew = g.events.length;
    for (const id of Object.keys(P.stories)) this.stepStory(id, seen, now, steps, dt);
    // the event actions: on every event of the step (their own emits too), and those whose delay is up
    this.runActions(steps);
    P.carry = g.events.slice(firstNew).map(e => ({ name: e.name, data: e.data }));
  }

  private emit(name: string, data: Record<string, unknown>) {
    this.game.emit(name, { document: this.id, ...data });
  }

  private stepStory(id: string, seen: { name: string; data?: unknown }[], now: number, steps: number, dt: number) {
    const def = this.doc.stories[id],
      r = this.progress.stories[id],
      dl = def.lifecycle?.deadlines;
    if (r.state === 'waiting') {
      if (dl?.world && now >= dl.world.at) return this.end(id, 'expired', null, 'world');
      const trig = this.triggered(id, seen, now);
      if (trig === undefined) return;
      r.state = 'active';
      this.emit('story-started', { story: id, stage: def.entry, ...(trig && { trigger: trig }) });
      this.enter(id, def.entry, steps);
      return;
    }
    if (r.state !== 'active' || !r.stage) return;
    r.worked += dt;
    if (dl?.world && now >= dl.world.at) return this.end(id, 'expired', null, 'world');
    if (dl?.work && r.worked >= dl.work.for) return this.end(id, 'expired', null, 'work');
    // a visit looks at evidence from the step after it began
    if (steps <= r.entered) return;
    const stage = def.stages[r.stage],
      objs = stage.objectives || {};
    for (const o of Object.keys(objs)) {
      if (r.objectives[o] !== 'open') continue;
      const res = this.confirm(this.ruleOf(objs[o]), r, o, seen, now);
      if (!res) continue;
      r.objectives[o] = res;
      delete r.since[o];
      this.emit('story-objective-resolved', { story: id, stage: r.stage, visit: r.visit, objective: o, result: res });
    }
    for (const b of sorted(stage.next)) {
      const br = stage.next[b];
      if (!this.open(objs, r, br)) continue;
      const to = br.stage ? { stage: br.stage } : { outcome: br.outcome };
      this.emit('story-branch-chosen', { story: id, stage: r.stage, visit: r.visit, branch: b, to });
      r.route.push([r.stage, b]);
      if (r.route.length > 32) r.route.shift();
      if (br.stage) this.enter(id, br.stage, steps);
      else this.end(id, def.outcomes[br.outcome]?.status === 'failed' ? 'failed' : 'completed', br.outcome);
      return;
    }
  }

  /** a branch opens when every required objective is done (or failed, where it says requiresFailed) and its requires are */
  private open(objs: Record<string, any>, r: StoryRun, br: any): boolean {
    const failed: string[] = br.requiresFailed || [];
    for (const o of Object.keys(objs)) {
      if (failed.includes(o)) {
        if (r.objectives[o] !== 'failed') return false;
      } else if (!objs[o].optional && r.objectives[o] !== 'completed') return false;
    }
    return (br.requires || []).every((o: string) => r.objectives[o] === 'completed');
  }

  private enter(id: string, stage: string, steps: number) {
    const r = this.progress.stories[id],
      objs = this.doc.stories[id].stages[stage].objectives || {};
    r.stage = stage;
    r.visit++;
    r.entered = steps;
    r.objectives = {};
    r.since = {};
    for (const o of Object.keys(objs)) r.objectives[o] = 'open';
    this.emit('story-stage-entered', { story: id, stage, visit: r.visit });
  }

  private end(id: string, to: 'completed' | 'failed' | 'expired', outcome: string | null, deadline?: string) {
    const r = this.progress.stories[id],
      from = r.state;
    r.state = to;
    r.outcome = outcome;
    r.stage = null;
    this.emit('story-transition', { story: id, from, to, ...(outcome && { outcome }), ...(deadline && { deadline: { clock: deadline } }) });
  }

  /** undefined while it waits; the trigger's id (or null for a story with none) once it starts */
  private triggered(id: string, seen: { name: string; data?: unknown }[], now: number): string | null | undefined {
    const trigs = this.doc.stories[id].triggers,
      r = this.progress.stories[id];
    if (!trigs || !Object.keys(trigs).length) return null;
    let first: string | undefined;
    for (const t of sorted(trigs)) {
      const rule = trigs[t],
        m = (r.triggers[t] ||= { times: [], was: null, since: null });
      let hit = false;
      if (rule.event) {
        for (const e of seen) if (this.eventMatches(rule.event, e)) m.times.push(now);
        const n = rule.count ?? 1,
          w = rule.within ?? Infinity;
        m.times = m.times.filter(x => now - x <= w + 1e-9);
        if (m.times.length > Math.max(n, 64)) m.times = m.times.slice(-Math.max(n, 64));
        hit = m.times.length >= n;
      } else if (rule.state) {
        const v = this.stateHolds(rule.state);
        if (rule.hold !== undefined) {
          if (v) m.since ??= now;
          else m.since = null;
          hit = m.since !== null && now - m.since >= rule.hold - 1e-9;
        } else {
          hit = v === true && m.was === false;
          m.was = v;
        }
      }
      if (hit && first === undefined) first = t;
    }
    return first;
  }

  /** an objective's proof: its evidence, its type's, or a custom type's of the document */
  private ruleOf(o: any): { evidence?: Evidence; timed?: { state: StateRule; for: number; fails: boolean }; reach?: { agent: string; min: Vec3; max: Vec3 } } {
    if (o.evidence) return { evidence: o.evidence };
    const p = o.params || {};
    switch (o.type) {
      case 'reach':
        return { reach: { agent: p.agent, min: p.min, max: p.max } };
      case 'observe':
        return { evidence: p.event ? { event: p.event } : { state: p.state } };
      case 'maintain':
        return { timed: { state: p.state, for: p.for, fails: false } };
      case 'survive':
      case 'protect':
        return { timed: { state: p.state, for: p.for, fails: true } };
    }
    const custom = this.doc.objectiveTypes?.[o.type];
    if (custom) {
      // the type's rule, with each parameter an equality at the pointer its match names
      const extra = Object.entries(custom.match || {}).map(([k, path]) => ({ path: path as string, value: p[k] }));
      const ev = custom.evidence;
      if (ev.event) return { evidence: { event: { ...ev.event, where: { all: [...(ev.event.where ? [ev.event.where] : []), ...extra] } } } };
      return { evidence: { state: { ...ev.state, when: { all: [ev.state.when, ...extra] } } } };
    }
    return {};
  }

  private confirm(rule: ReturnType<StoryRunner['ruleOf']>, r: StoryRun, o: string, seen: { name: string; data?: unknown }[], now: number): 'completed' | 'failed' | null {
    if (rule.evidence) {
      if ('event' in rule.evidence) return seen.some(e => this.eventMatches((rule.evidence as { event: EventRule }).event, e)) ? 'completed' : null;
      return this.stateHolds(rule.evidence.state) ? 'completed' : null;
    }
    if (rule.reach) {
      const { agent, min, max } = rule.reach,
        inside = (p: Vec3) => p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2];
      const who =
        agent === 'player'
          ? this.game.player
            ? [this.game.player]
            : []
          : this.game.entities.filter(e => e.alive && (e.kind === agent || e.tags.includes(agent)));
      return who.some(e => inside(e.pos)) ? 'completed' : null;
    }
    if (rule.timed) {
      const v = this.stateHolds(rule.timed.state);
      if (v === false && rule.timed.fails && r.since[o] !== undefined) return 'failed';
      if (v) r.since[o] ??= now;
      else delete r.since[o];
      return r.since[o] !== undefined && now - r.since[o] >= rule.timed.for - 1e-9 ? 'completed' : null;
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------------ the actions

  private runActions(steps: number) {
    const g = this.game,
      P = this.progress;
    const due = P.queue.filter(q => q.due <= steps);
    P.queue = P.queue.filter(q => q.due > steps);
    for (const q of due) if (this.actions[q.rule]) this.perform(q.rule, q.event);
    // events published while the actions run are seen too (a rule can answer another's emit), up to a bound
    for (let i = 0; i < g.events.length && i < 512; i++) {
      const e = g.events[i];
      for (const id of Object.keys(this.actions)) {
        const rule = this.actions[id];
        if (!this.eventMatches(rule.on, e)) continue;
        if (rule.limit !== undefined && (P.fired[id] || 0) >= rule.limit) continue;
        P.fired[id] = (P.fired[id] || 0) + 1;
        const ev = { name: e.name, data: e.data === undefined ? undefined : JSON.parse(JSON.stringify(e.data)) };
        if (rule.delay && rule.delay > 0) P.queue.push({ due: steps + Math.max(1, Math.ceil(rule.delay / g.core.loop.step - 1e-9)), rule: id, event: ev });
        else this.perform(id, ev);
      }
    }
  }

  private perform(id: string, e: { name: string; data?: unknown }) {
    for (const a of this.actions[id].actions) {
      const args: Record<string, unknown> = JSON.parse(JSON.stringify(a.args || {}));
      for (const [to, from] of Object.entries(a.bindings || {})) setAt(args, to, at(e.data, from));
      this.act(a.action, args, id);
    }
  }

  private act(action: string, a: Record<string, any>, rule: string) {
    const g = this.game;
    switch (action) {
      case 'game/spawn': {
        const brains: Record<string, Brain> = g.def.brains || {};
        const name = (a.brain as string) || (a.kind as string) || (a.actor as string),
          brain = brains[name];
        if (!brain) throw new Error(`${g.def.id}: story action ${rule}: no brain "${name}" in def.brains`);
        for (let n = 0; n < (a.count ?? 1); n++)
          g.spawnActor({ actor: a.actor, at: a.at, brain, kind: a.kind, tags: a.tags ?? ['enemy'], team: a.team, face: a.face });
        return;
      }
      case 'game/say':
        return g.emit('say', { text: String(a.text) });
      case 'game/sound':
        return g.emit('sound', { name: a.name });
      case 'game/emit':
        return g.emit(a.name, a.data);
      case 'game/set':
        return setAt(g.state, a.path, a.value);
      case 'game/add':
        return setAt(g.state, a.path, ((at(g.state, a.path) as number) || 0) + (a.value ?? 1));
      case 'game/heal': {
        const p = g.player;
        if (!p) return;
        const max = (g.def.actors?.[p.actor]?.hp as number) || p.ch.st.hp;
        p.ch.st.hp = p.hp = Math.min(max, p.ch.st.hp + (a.amount ?? 1));
        return g.emit('heal', { hp: a.amount ?? 1 });
      }
      case 'game/win':
        if (g.state && typeof g.state === 'object') (g.state as any).won = true;
        return g.emit('won');
      case 'game/lose':
        if (g.state && typeof g.state === 'object') (g.state as any).lost = true;
        return g.emit('lost');
      case 'game/break':
        g.breakables?.breakIt(g as any, a.tag);
        return;
      case 'game/remove':
        for (const e of g.byTag(a.tag)) g.remove(e);
        return;
      case 'game/story-start': {
        const r = this.progress.stories[a.story],
          def = this.doc.stories[a.story];
        if (!r || !def || r.state !== 'waiting') return;
        r.state = 'active';
        this.emit('story-started', { story: a.story, stage: def.entry, trigger: 'action:' + rule });
        this.enter(a.story, def.entry, g.steps);
        return;
      }
    }
    throw new Error(`${g.def.id}: story action ${rule}: no action "${action}"; known: ${Object.keys(STORY_ACTIONS).join(', ')}`);
  }
}

/** every event rule and state rule of a document and its actions, with where it is (for the check) */
export function storyRules(def: StoryDef): { events: [string, EventRule][]; states: [string, StateRule][]; types: [string, string][] } {
  const events: [string, EventRule][] = [],
    states: [string, StateRule][] = [],
    types: [string, string][] = [];
  const evidence = (ev: any, where: string) => {
    if (!ev) return;
    if (ev.event) events.push([where + '.event', ev.event]);
    if (ev.state) states.push([where + '.state', ev.state]);
  };
  const doc = def.document || {};
  for (const [t, spec] of Object.entries<any>(doc.objectiveTypes || {})) evidence(spec.evidence, `story.objectiveTypes.${t}.evidence`);
  for (const [s, story] of Object.entries<any>(doc.stories || {})) {
    for (const [t, rule] of Object.entries<any>(story.triggers || {})) evidence(rule, `story.stories.${s}.triggers.${t}`);
    for (const [st, stage] of Object.entries<any>(story.stages || {}))
      for (const [o, obj] of Object.entries<any>(stage.objectives || {})) {
        const w = `story.stories.${s}.stages.${st}.objectives.${o}`;
        evidence(obj.evidence, w + '.evidence');
        if (obj.type) {
          types.push([w + '.type', obj.type]);
          if (obj.type === 'observe') evidence(obj.params, w + '.params');
          if (['maintain', 'survive', 'protect'].includes(obj.type) && obj.params?.state) states.push([w + '.params.state', obj.params.state]);
        }
      }
  }
  for (const [id, rule] of Object.entries(def.actions || {})) if (rule?.on) events.push([`story.actions.${id}.on`, rule.on]);
  return { events, states, types };
}

/** the engine's own event names (combat, breakables, the story) */
export const ENGINE_EVENTS = ['swing', 'hit', 'death', 'respawn', 'hit-object', 'break', 'say', 'sound', 'won', 'lost', 'heal', ...STORY_EVENTS];

export type { GameEvent };
