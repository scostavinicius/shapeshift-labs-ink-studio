// Stage 31: missions as data. A game's campaign in the kit's story format (ink-studio/story version 1), run by the
// engine (src/game/story.ts): triggers, objectives and branches against the game's events and queries, the kit's story
// events, and event actions that make them do things. Checked on small documents rule by rule, every document first
// through the kit's own validator; then the nest's campaign won by its script, saved and loaded; then the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { flatScene, loadInk, loadTs, REPO, ROOT } from './load.mjs';

const require = createRequire(import.meta.url);
const tools = require(path.join(REPO, 'cli', 'story-document.js'));
const G = await loadTs('src/game/index.ts');
const H = await loadTs('src/headless/run.ts');
const { walker } = await loadTs('examples/farol-walk/game.ts');
const nest = (await loadTs('examples/ninho/game.ts')).default;
const winScript = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'ninho', 'win.json'), 'utf8'));

/** a document of stories, valid for the kit (the test fails if it is not) */
function doc(stories, extra = {}) {
  const d = { format: 'ink-studio/story', version: 1, id: 'test', stories, ...extra };
  tools.validateStoryDocument(d);
  return d;
}
const auto = { mode: 'autonomous' };
/** a story of one stage with these objectives, ending in `done` (or as its next says) */
const story = (o = {}) => ({
  kind: 'questlet',
  title: 'T',
  lifecycle: { progression: true, ...(o.lifecycle || {}) },
  ...(o.triggers && { triggers: o.triggers }),
  entry: 'one',
  stages: { one: { title: 'One', decision: auto, ...(o.objectives && { objectives: o.objectives }), next: o.next || { end: { outcome: 'done', auto: true } } } },
  outcomes: o.outcomes || { done: { title: 'Done' } }
});

/** a game on the flat scene with a story; `rule(game)` runs as def.step; every event is logged with its step */
function run(document, { actions, rule, seconds = 4, state = {} } = {}) {
  const def = G.defineGame({
    id: 'story-test',
    scene: flatScene(),
    combat: false,
    actors: { hero: { spec: walker } },
    story: { document, actions },
    init: game => (game.spawnActor({ actor: 'hero', kind: 'player', at: [0, 0, 0], brain: 'player', tags: ['player'] }), { n: 0, ...state }),
    step(game) {
      game.state.n++;
      rule?.(game);
    }
  });
  const game = G.createGame(def, loadInk(), { scene: def.scene, bones: 'cpu' });
  const log = [];
  for (let k = 0; k < seconds * 60; k++) {
    game.runSteps(1);
    // (inside a step, game.steps already counts it: the same number the rules see)
    for (const e of game.events) log.push({ step: game.steps, ...e });
  }
  return { game, log, first: (name, f = () => true) => log.find(e => e.name === name && f(e.data || {})) };
}

test('stage 31: triggers start a story: so many events within a window, a state crossing, a state held', () => {
  const d = doc({
    pings: story({ triggers: { three: { event: { kind: 'ping' }, count: 3, within: 0.5 } } }),
    cross: story({ triggers: { hundred: { state: { field: 'game/state', when: { path: '/n', op: 'gte', value: 100 } } } } }),
    held: story({ triggers: { long: { state: { field: 'game/state', when: { path: '/n', op: 'gte', value: 30 } }, hold: 1 } } }),
    open: story()
  });
  // three pings over 1.5 s do not start it; three in 10 steps do
  const at = [10, 50, 100, 200, 205, 210];
  const { first, game } = run(d, { rule: g => at.includes(g.steps) && g.emit('ping') });
  const started = s => first('story-started', x => x.story === s);
  assert.equal(started('pings').step, 210, 'the third ping within 0.5 s');
  assert.equal(started('pings').data.trigger, 'three');
  assert.equal(started('cross').step, 100, 'the step n reaches 100');
  assert.equal(started('held').step, 30 + 60, 'n >= 30 held for a second');
  assert.equal(started('open').step, 1, 'no triggers: on the first step');
  assert.equal(game.story.of('open').state, 'completed');
});

test('stage 31: objectives look from the step after their stage began; maintain, survive (and its failure), deadlines', () => {
  const twoStages = doc({
    two: {
      kind: 'questlet',
      title: 'Two',
      lifecycle: { progression: true },
      entry: 'a',
      stages: {
        // the event that ends stage a happens on the same step: stage b must not take it
        a: { title: 'A', decision: auto, objectives: { x: { title: 'x', evidence: { event: { kind: 'tick' } } } }, next: { on: { stage: 'b', auto: true } } },
        b: { title: 'B', decision: auto, objectives: { y: { title: 'y', evidence: { event: { kind: 'tick' } } } }, next: { end: { outcome: 'done', auto: true } } }
      },
      outcomes: { done: { title: 'Done' } }
    }
  });
  const ticks = [20, 40];
  const r = run(twoStages, { rule: g => ticks.includes(g.steps) && g.emit('tick'), seconds: 1 });
  assert.equal(r.first('story-stage-entered', x => x.stage === 'b').step, 20);
  assert.equal(r.first('story-transition').step, 40, 'b took the second tick, not the one that ended a');

  const guard = (breaks, seconds) =>
    run(
      doc({
        guard: story({
          objectives: { keep: { title: 'Keep it safe', type: 'survive', params: { state: { field: 'game/state', when: { path: '/safe', value: true } }, for: 2 } } },
          next: { held: { outcome: 'held', auto: true }, lost: { outcome: 'lost', auto: true, requiresFailed: ['keep'] } },
          outcomes: { held: { title: 'Held' }, lost: { title: 'Lost', status: 'failed' } }
        }),
        steady: story({ objectives: { calm: { title: 'Calm', type: 'maintain', params: { state: { field: 'game/state', when: { path: '/safe', value: true } }, for: 1 } } } }),
        late: story({ objectives: { never: { title: 'Never', evidence: { event: { kind: 'never' } } } }, lifecycle: { deadlines: { work: { for: 1.5 } } } })
      }),
      { state: { safe: true }, rule: g => breaks !== null && g.steps === breaks && (g.state.safe = false), seconds }
    );
  const kept = guard(null, 3);
  assert.equal(kept.game.story.of('guard').outcome, 'held');
  assert.equal(kept.game.story.of('steady').state, 'completed');
  assert.ok(Math.abs(kept.first('story-transition', x => x.story === 'steady').step - 62) <= 1, 'maintain: a second of holding, from the step after it began');
  const late = kept.first('story-transition', x => x.story === 'late');
  assert.equal(late.data.to, 'expired');
  assert.equal(late.data.deadline.clock, 'work');
  const broken = guard(60, 3);
  assert.equal(broken.game.story.of('guard').state, 'failed');
  assert.equal(broken.game.story.of('guard').outcome, 'lost', 'the failed objective opened requiresFailed');
  assert.equal(broken.first('story-objective-resolved', x => x.story === 'guard').data.result, 'failed');
});

test('stage 31: event actions: bindings from the event, a delay, a limit, and a rule answering another rule', () => {
  const { game, log } = run(doc({ quiet: story({ triggers: { never: { event: { kind: 'never' } } } }) }), {
    state: { count: 0, last: null, pongs: 0 },
    rule: g => [10, 20, 30].includes(g.steps) && g.emit('ping', { n: g.steps }),
    seconds: 2,
    actions: {
      counted: { on: { kind: 'ping' }, limit: 2, actions: [{ action: 'game/add', args: { path: '/count', value: 1 } }] },
      echo: { on: { kind: 'ping' }, delay: 0.5, actions: [{ action: 'game/emit', args: { name: 'pong', data: {} }, bindings: { '/data/n': '/n' } }] },
      heard: {
        on: { kind: 'pong', where: { path: '/n', op: 'gte', value: 20 } },
        actions: [
          { action: 'game/set', args: { path: '/last', value: 0 }, bindings: { '/value': '/n' } },
          { action: 'game/add', args: { path: '/pongs' } }
        ]
      }
    }
  });
  assert.equal(game.state.count, 2, 'limit: 2');
  assert.deepEqual(
    log.filter(e => e.name === 'pong').map(e => [e.step, e.data.n]),
    [
      [40, 10],
      [50, 20],
      [60, 30]
    ],
    'half a second later, with the ping\'s n'
  );
  assert.equal(game.state.last, 30);
  assert.equal(game.state.pongs, 2, 'only pongs from n 20 on');
});

test('the nest: its campaign is data, and its script wins it: serpent, brood, nest, in that order', () => {
  const { game } = H.runHeadless(nest, loadInk(), nest.scene, winScript, 0);
  const player = new G.ScriptPlayer(winScript),
    log = [];
  assert.deepEqual(game.story.lines(), [], 'nothing before the first step');
  let start = null;
  for (let k = 0; k < 60 * 25 && !game.state.won; k++) {
    game.runSteps(1, s => player.apply(s, game.core.input));
    for (const e of game.events) log.push(e);
    if (k === 0) start = game.story.lines();
  }
  assert.deepEqual(start, ['KILL THE SERPENT']);
  assert.equal(game.state.won, true);
  assert.equal(game.state.lost, false);
  const run = game.story.progress.stories.hunt;
  assert.equal(run.state, 'completed');
  assert.equal(run.outcome, 'cleared');
  assert.deepEqual(run.route, [['serpent', 'brood'], ['brood', 'nest'], ['nest', 'done']]);
  assert.equal(game.story.of('falls').state, 'waiting', 'never fell three times');
  // what the actions said, in order
  assert.deepEqual(
    log.filter(e => e.name === 'say').map(e => e.data.text),
    ['THE SERPENT WAKES', 'THE BROOD HATCHES', 'STAND IN THE NEST', 'THE NEST IS YOURS']
  );
  assert.equal(log.filter(e => e.name === 'death' && e.data.kind === 'hatchling').length, 2);
  assert.ok(game.snapshot().story.stories.hunt, 'the progress is in the snapshot');
});

test('the nest: the same script, the same campaign; a save keeps where the campaign is', () => {
  const a = H.runHeadless(nest, loadInk(), nest.scene, winScript, 12).game,
    b = H.runHeadless(nest, loadInk(), nest.scene, winScript, 12).game;
  assert.equal(a.hash(), b.hash());
  // a save in the middle of the brood
  let t = 0,
    g = null;
  for (t = 4; t < 20; t += 0.5) {
    g = H.runHeadless(nest, loadInk(), nest.scene, winScript, t).game;
    if (g.story.of('hunt').stage === 'brood' && g.byTag('enemy').length) break;
  }
  assert.equal(g.story.of('hunt').stage, 'brood', 'found a moment in the brood');
  const save = JSON.parse(JSON.stringify(G.saveGame(g)));
  const loaded = H.runHeadless(nest, loadInk(), nest.scene, { events: [] }, 0, { load: save }).game;
  assert.deepEqual(loaded.story.progress, g.story.progress, 'the progress came back');
  assert.deepEqual(loaded.story.lines(), ['KILL THE BROOD']);
  assert.equal(loaded.byTag('enemy').length, g.byTag('enemy').length, 'the hatchlings too (def.brains)');
  // and it does not start over: no second serpent on the next step
  loaded.runSteps(1);
  assert.ok(!loaded.events.some(e => e.name === 'story-started'));
});

test('stage 31: the check: the kit\'s validation, then what the engine adds', () => {
  const base = { ...nest, story: { ...nest.story } };
  assert.deepEqual(G.checkStory(nest, tools), [], 'the nest is clean');
  // a broken reference: the kit's validator names the field
  const broken = JSON.parse(JSON.stringify(nest.story.document));
  broken.stories.hunt.stages.brood.next.nest.stage = 'nowhere';
  const p1 = G.checkStory({ ...base, story: { ...nest.story, document: broken } }, tools);
  assert.equal(p1[0].code, 'story');
  assert.equal(p1[0].where, 'story.stories.hunt.stages.brood.next.nest.stage');
  // an unreachable stage: the kit's route preview
  const orphan = JSON.parse(JSON.stringify(nest.story.document));
  orphan.stories.hunt.stages.lost = { title: 'Lost', next: { back: { stage: 'serpent' } } };
  assert.ok(G.checkStory({ ...base, story: { ...nest.story, document: orphan } }, tools).some(p => p.code === 'story-route' && /unreachable/.test(p.problem)));
  // what the engine does not have: a query, an objective type, an action, an actor, a brain, an event nothing sends
  const odd = JSON.parse(JSON.stringify(nest.story.document));
  odd.stories.hunt.stages.brood.objectives.clear.evidence.state.field = 'world/account';
  odd.stories.hunt.stages.nest.objectives.stand = { title: 'Pay', type: 'acquire', params: { account: 'gold/purse', amount: 3 } };
  odd.stories.hunt.stages.serpent.objectives.kill.evidence.event.kind = 'slain';
  const p3 = G.checkStory(
    {
      ...base,
      story: {
        document: odd,
        actions: {
          a: { on: { kind: 'won' }, actions: [{ action: 'game/explode' }] },
          b: { on: { kind: 'won' }, actions: [{ action: 'game/spawn', args: { actor: 'dragon', at: 'cave' } }] }
        }
      }
    },
    tools
  );
  const codes = p3.map(p => `${p.code} ${p.where}`);
  assert.ok(codes.includes('story-field story.stories.hunt.stages.brood.objectives.clear.evidence.state.field'), codes.join('\n'));
  assert.ok(codes.includes('story-type story.stories.hunt.stages.nest.objectives.stand.type'));
  assert.ok(codes.includes('story-event story.stories.hunt.stages.serpent.objectives.kill.evidence.event.kind'));
  assert.ok(codes.includes('story-action story.actions.a.actions[0].action'));
  assert.ok(codes.includes('story-action story.actions.b.actions[0].args.actor'));
  assert.ok(codes.includes('story-action story.actions.b.actions[0].args.at'));
  assert.ok(codes.includes('story-action story.actions.b.actions[0].args.brain'));
  // an event the game's own source emits is not "nothing sends it"
  assert.ok(!G.checkStory({ ...base, story: { document: odd } }, tools, "game.emit('slain', { by })").some(p => p.code === 'story-event'));
});
