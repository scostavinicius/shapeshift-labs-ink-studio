const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { json } = require('./asset-files.js');

const usage = 'sim search-staging <world|checkpoint|run> <plan.json> --out <directory>';
const format = 'ink-studio/staging-search';
const kinds = {
  'reveal-during-dialogue': ['reveal','start','end'],
  'occluded-contact': ['event','camera','point','trace','exclude'],
  'cue-out-of-range': ['event','listener','emitter','delayTicks','maxDistance']
};
const integer = (value,min,max) => Number.isSafeInteger(value)&&value>=min&&value<=max;
const identifier = value => typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
const name = value => typeof value==='string'&&value.length>0&&value.length<=193;
const epsilon = 1e-6;

function prepare(W, raw, engine) {
  const {check,record,vector,selector,own} = W.data;
  const keys = (value,allowed) => record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const from = engine.view().tick, query = engine.query();
  const traces = query.inspect().traces;
  check(keys(raw,['format','version','until','maxStates','actions','checks'])&&raw.format===format&&
    raw.version===1&&integer(raw.until,from+1,Math.min(from+600,W.runtime.maxTick)),
  'Staging search needs a version 1 plan ending within 600 ticks of its origin');
  const {until,maxStates=1000,actions=[],checks} = raw;
  check(integer(maxStates,1,5000),'Staging search maxStates must be between 1 and 5000');
  function list(rows, min, max) {
    return Array.isArray(rows)&&integer(rows.length,min,max)&&rows.every(row=>record(row)&&identifier(row.id))&&
      new Set(rows.map(row=>row.id)).size===rows.length;
  }
  check(list(actions,0,32)&&list(checks,1,16),'Use distinct IDs for up to 32 actions and 1 to 16 staging checks');

  function target(at) {
    return keys(at,['entity','socket'])&&name(at.entity)&&(at.socket===undefined||name(at.socket));
  }
  function site(value,allowEvent) {
    if (vector(value)||target(value)) return value;
    check(allowEvent&&keys(value,['eventPath'])&&typeof value.eventPath==='string',
      'A staging position needs an XYZ point, entity/socket or eventPath');
    return {eventPath:selector(value.eventPath)};
  }
  function event(value) {
    check(keys(value,['kind','system','where'])&&name(value.kind)&&
      (value.system===undefined||name(value.system))&&(value.where===undefined||record(value.where)),
    'A staging event selector needs a kind, with optional system and where');
    W.query.condition(value.where,undefined);
    return value;
  }

  const control = actions.map(row=>{
    const {id,fromTick=1,toTick=W.runtime.maxTick,gate,commands} = row;
    check(keys(row,['id','fromTick','toTick','gate','commands'])&&integer(fromTick,1,W.runtime.maxTick)&&
      integer(toTick,fromTick,W.runtime.maxTick)&&Array.isArray(commands)&&integer(commands.length,1,16)&&
      commands.every(command=>keys(command,['action','args'])&&name(command.action)&&
        (command.args===undefined||record(command.args))),
    'Invalid staging action '+id);
    if (gate!==undefined) {
      check(keys(gate,['field','at','args','when'])&&name(gate.field)&&query.field(gate.field)&&
        (gate.at===undefined||vector(gate.at)||target(gate.at))&&(gate.args===undefined||record(gate.args))&&record(gate.when),
      'Invalid staging action gate '+id);
      W.query.condition(gate.when,undefined);
    }
    return {id,fromTick,toTick,gate,commands};
  });

  const probes = checks.map(row=>{
    const {id,kind} = row;
    check(own(kinds,kind)&&keys(row,['id','kind',...kinds[kind]]),'Invalid staging check '+id);
    switch (kind) {
      case 'reveal-during-dialogue':
        return {id,kind,reveal:event(row.reveal),start:event(row.start),end:event(row.end)};
      case 'occluded-contact': {
        const {trace,exclude=[]} = row;
        check(name(trace)&&traces.some(item=>item.name===trace&&item.role==='occlusion-ray')&&
          Array.isArray(exclude)&&exclude.length<=64&&exclude.every(name),'Invalid occlusion trace or exclusions for '+id);
        return {id,kind,event:event(row.event),camera:site(row.camera),point:site(row.point,true),trace,exclude};
      }
      case 'cue-out-of-range': {
        const {delayTicks,maxDistance} = row;
        check(integer(delayTicks,1,600)&&Number.isFinite(maxDistance)&&maxDistance>0,
          'Invalid cue delay or distance for '+id);
        return {id,kind,event:event(row.event),listener:site(row.listener),emitter:site(row.emitter,true),delayTicks,maxDistance};
      }
    }
  });
  return {from,until,maxStates,actions:control,checks:probes};
}

function matches(W, selector, row) {
  return row.kind===selector.kind&&(selector.system===undefined||row.system===selector.system)&&
    W.query.condition(selector.where,row.payload);
}

function position(W, query, site, event) {
  const value = site.eventPath===undefined?site:W.data.read(event.payload,site.eventPath);
  if (W.data.vector(value)) return value;
  if (W.data.record(value)&&typeof value.entity==='string'&&
    (value.socket===undefined||typeof value.socket==='string')) return query.frame(value)?.point;
}

function observe(W, spec, state, query, events, tick, until) {
  let unavailable = 0;
  if (spec.kind==='reveal-during-dialogue') {
    let dialogue = state;
    for (const row of events) {
      if (matches(W,spec.end,row)) dialogue = undefined;
      if (matches(W,spec.reveal,row)&&dialogue) return {hit:{dialogue,reveal:row}};
      if (matches(W,spec.start,row)) dialogue = row;
    }
    return {state:dialogue,unavailable};
  }
  if (spec.kind==='occluded-contact') {
    for (const row of events) {
      if (!matches(W,spec.event,row)) continue;
      const camera = position(W,query,spec.camera), point = position(W,query,spec.point,row);
      if (!camera||!point) { unavailable++; continue; }
      const delta = point.map((value,index)=>value-camera[index]);
      const distance = Math.hypot(...delta);
      if (distance<=epsilon) continue;
      const exclude = [...new Set([...spec.exclude,spec.camera.entity].filter(Boolean))];
      const sample = query.trace(spec.trace,camera,{direction:delta.map(value=>value/distance),
        distance:Math.min(100000,distance-epsilon),exclude});
      if (sample.status==='ok'&&sample.value.distance<distance-epsilon) {
        const {id,point:position,distance} = sample.value;
        return {hit:{contact:row,camera,point,blocker:{id,position,distance,trace:spec.trace}}};
      }
      if (!['ok','empty'].includes(sample.status)||distance>100000) unavailable++;
    }
    return {unavailable};
  }

  if (!state?.length&&!events.length) return {unavailable};
  const pending = [];
  const queued = events.filter(row=>matches(W,spec.event,row));
  const listener = (state?.some(cue=>cue.due===tick)||queued.length&&tick+spec.delayTicks<=until)
    ? position(W,query,spec.listener) : undefined;
  for (const cue of state??[]) {
    if (cue.due>tick) { pending.push(cue); continue; }
    if (!listener) { unavailable++; continue; }
    const distance = Math.hypot(...listener.map((value,index)=>value-cue.emitter[index]));
    if (distance>spec.maxDistance) return {hit:{...cue,listenerAtArrival:listener,
      distanceAtArrival:distance,maxDistance:spec.maxDistance}};
  }
  const points = new Set(), due = tick+spec.delayTicks;
  for (const row of due<=until?queued:[]) {
    const emitter = position(W,query,spec.emitter,row);
    if (!emitter||!listener) { unavailable++; continue; }
    const distance = Math.hypot(...listener.map((value,index)=>value-emitter[index]));
    if (distance<=spec.maxDistance) {
      // One outstanding arrival per due tick and source point has the same range test.
      const key = JSON.stringify(emitter);
      if (points.has(key)) continue;
      points.add(key);
      if (pending.length>=4096) { unavailable++; continue; }
      pending.push({cue:row,due,emitter,listenerAtQueue:listener,distanceAtQueue:distance});
    }
  }
  return {state:pending,unavailable};
}

function schedule(engine, tick, action) {
  if (action) engine.schedule(action.commands.map(command=>({...command,tick})));
}

function replay(W, origin, route, tick, checkpoint, workerPool) {
  const entries = [];
  for (let entry = route; entry; entry = entry.previous) entries.push(entry);
  entries.reverse();
  const actions = new Map(entries.map(({tick,action})=>[tick,action]));
  const engine = origin.fork();
  for (let next = engine.view().tick+1; next<=tick; next++) {
    schedule(engine,next,actions.get(next));
    engine.step();
  }
  const record = engine.recording();
  W.data.check(W.runtime.checkpointsEqual(record.end,checkpoint,{workerPool}),
    'Staging witness did not reproduce its searched checkpoint');
  W.runtime.replay(record,{workerPool});
  return {steps:entries.map(({tick,action})=>({tick,action:action.id})),record};
}

function remember(W, layer, node) {
  const checkpoint = node.engine.checkpoint();
  const hash = createHash('sha256').update(JSON.stringify(checkpoint)).update(JSON.stringify(node.monitors)).digest('hex');
  const bucket = layer.get(hash);
  if (bucket?.some(previous=>W.data.equal(previous.engine.checkpoint(),checkpoint)&&
    W.data.equal(previous.monitors,node.monitors))) return false;
  if (bucket) bucket.push(node);
  else layer.set(hash,[node]);
  return true;
}

function search(W, plan, origin, {workerPool}={}) {
  const results = plan.checks.map(({id,kind})=>({id,kind,unavailable:0}));
  const recordings = new Map();
  let frontier = [{engine:origin,monitors:[]}], visited = 0, equivalentStates = 0, completeThrough = plan.from;
  let stop = 'search-complete', remaining = results.length;
  ticks: for (let tick=plan.from+1; tick<=plan.until&&frontier.length; tick++) {
    const next = [], layer = new Map();
    for (const node of frontier) {
      if (node.engine.scenario.status!=='running') continue;
      const query = node.engine.query();
      function enabled(action) {
        if (tick<action.fromTick||tick>action.toTick) return false;
        if (!action.gate) return true;
        const {field,at,args,when} = action.gate;
        const sample = query.probe(field,at,args);
        return sample.status==='ok'&&W.query.condition(when,sample.value);
      }
      for (const action of [null,...plan.actions.filter(enabled)]) {
        if (visited===plan.maxStates) { stop = 'budget-exhausted'; break ticks; }
        const engine = node.engine.fork();
        schedule(engine,tick,action);
        engine.step();
        visited++;
        const current = engine.query(), events = engine.committedEvents();
        const route = action?{previous:node.route,tick,action}:node.route;
        let witness;
        const monitors = plan.checks.map((spec,index)=>{
          const result = results[index];
          if (result.status==='found') return;
          const observation = observe(W,spec,node.monitors[index],current,events,tick,plan.until);
          if (!observation.hit) {
            result.unavailable+=observation.unavailable;
            return observation.state;
          }
          witness ??= replay(W,origin,route,tick,engine.checkpoint(),workerPool);
          recordings.set(spec.id,witness.record);
          Object.assign(result,{status:'found',tick,steps:witness.steps,evidence:observation.hit});
          remaining--;
        });
        if (!remaining) { stop = 'all-found'; break ticks; }
        if (tick<plan.until&&engine.scenario.status==='running') {
          const successor = {engine,route,monitors};
          if (remember(W,layer,successor)) next.push(successor);
          else equivalentStates++;
        }
      }
    }
    completeThrough = tick;
    frontier = next;
  }
  if (stop==='search-complete') completeThrough = plan.until;
  for (const result of results) {
    result.status ??= stop==='budget-exhausted'?'budget-exhausted':result.unavailable?'inconclusive':'not-found';
  }
  return {report:{format:format+'-report',version:1,world:origin.checkpoint().world.id,
    seed:origin.checkpoint().world.seed,from:plan.from,until:plan.until,completeThrough,stop,visited,equivalentStates,
    maxStates:plan.maxStates,checks:results},recordings};
}

function publish(result, directory, checkOutput) {
  const {report,recordings} = result;
  const files = report.checks.flatMap(check=>{
    const record = recordings.get(check.id);
    if (!record) return [];
    const digest = createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0,20);
    check.replay = check.id+'.'+digest+'.run.json';
    return [[path.resolve(directory,check.replay),record]];
  });
  files.push([path.resolve(directory,'report.json'),report]);
  for (const [file] of files) {
    checkOutput(file);
    if (fs.existsSync(file)&&!fs.statSync(file).isFile()) throw Error('Expected a file output for '+file);
  }
  for (const [file,value] of files) json(file,value);
  return report;
}

module.exports = {usage,prepare,search,publish};
