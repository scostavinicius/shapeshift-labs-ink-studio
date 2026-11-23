/* Inspect the compiled scheduler, declared signal loops and retained payloads. */
(function (K) {
  const W = K.world, {check,endpoint,record} = W.data, {freeze} = K.procedural.data;
  const policies = {
    hold:'Latest available level at the consumer boundary.',
    average:'Time-weighted held levels over the consumer window.',
    sum:'Sum of publications since the consumer last ran.',
    events:'Ordered events queued until the consumer runs.',
    interpolate:'Causal linear interpolation one source interval behind the receiver clock.',
    decimate:'Low-pass FIR filtering followed by sampling at the slower receiver clock.',
    'fractional-delay':'Linear reconstruction at an explicitly delayed, possibly fractional tick.'
  };
  const finite = value => Number.isFinite(value) ? value : null;
  const sum = values => values.reduce((total,value) => total+value,0);

  function signals(plan, cadences, sampling) {
    const {incoming,systems,ports,schedule,chunks} = plan;
    const shape = name => cadences[name].map(({every,substeps}) => every+'/'+substeps).join(',');
    const signatures = new Map(plan.order.map(name => [name,shape(name)]));
    return Array.from(incoming.values()).sort((a,b) => a.to < b.to ? -1 : a.to > b.to ? 1 : 0).map(edge => {
      const {from,to,delay,sample,signal,crossing} = edge, [source] = endpoint(from), [target] = endpoint(to);
      const type = ports.outputs[from].type, sourceChunk = chunks?.managed.get(source)?.chunk;
      const targetChunk = chunks?.managed.get(target)?.chunk;
      const buffered = schedule.active && (sample === 'average' || W.rates.buffered(edge));
      return {from,to,delay,sample,signal,type,source,target,
        crossRate:signatures.get(source) !== signatures.get(target) || sourceChunk !== targetChunk,
        ...(ports.inputs[to].timing && {reaction:ports.inputs[to].timing}),
        publication:edge.earlyEvent ? 'same-phase-event' : crossing && !crossing.immediate ? 'source-history' : crossing ? 'same-phase-if-due' :
          delay ? 'delayed-tick' : sample === 'average' ? 'elapsed-interval' :
          systems[source].combinational ? 'same-phase-if-due' : 'after-source-phase',
        ...(delay && {delaySeconds:delay*plan.world.dt}),
        ...(crossing && {crossing:{
          ...W.signalCrossings.describe(edge),latencySeconds:crossing.latencyTicks*plan.world.dt,
          retainedSamples:sampling[W.signalCrossings.historyKey][from].values.length
        }}),
        ...(buffered && {buffer:{mode:sample,
          ...(sample === 'average' && {pendingQuanta:sampling[to].quanta}),
          ...(type === 'event' && {maxEvents:W.rates.maxEvents,pendingEvents:sampling[to].length})
        }})
      };
    });
  }

  function feedback(plan, connections) {
    const outgoing = new Map(plan.order.map(name => [name,[]]));
    const reverse = new Map(plan.order.map(name => [name,[]]));
    const links = connections.map(({source,target,from,to,delay,sample,publication}) =>
      ({source,target,kind:'signal',from,to,delay,sample,publication}));
    for (const [target,contract] of plan.contracts)
      for (const [alias,{system:source,sample}] of Object.entries(contract.reads))
        links.push({source,target,kind:'state',alias,sample,publication:sample === 'previous' ?
          'phase-start-state' : 'same-phase-if-due'});
    for (const {source,target} of links) {
      outgoing.get(source).push(target);
      reverse.get(target).push(source);
    }

    // Find strongly connected groups without recursion on large compiled worlds.
    const seen = new Set(), finished = [];
    for (const root of plan.order) {
      if (seen.has(root)) continue;
      const stack = [{name:root,next:0}];
      seen.add(root);
      while (stack.length) {
        const cursor = stack.at(-1), targets = outgoing.get(cursor.name);
        if (cursor.next === targets.length) {
          finished.push(stack.pop().name);
          continue;
        }
        const target = targets[cursor.next++];
        if (seen.has(target)) continue;
        seen.add(target);
        stack.push({name:target,next:0});
      }
    }
    const membership = new Map(), groups = [];
    for (const root of finished.reverse()) {
      if (membership.has(root)) continue;
      const group = {systems:[],links:[],boundaries:[]}, stack = [root];
      membership.set(root,group);
      while (stack.length) {
        const name = stack.pop();
        group.systems.push(name);
        for (const source of reverse.get(name)) {
          if (membership.has(source)) continue;
          membership.set(source,group);
          stack.push(source);
        }
      }
      group.systems.sort();
      groups.push(group);
    }
    for (const link of links) {
      const group = membership.get(link.source);
      if (group !== membership.get(link.target)) continue;
      group.links.push(link);
      if (!['same-phase-if-due','same-phase-event'].includes(link.publication)) group.boundaries.push(link);
    }
    return groups.filter(group => group.links.length).sort((a,b) => a.systems[0] < b.systems[0] ? -1 : 1);
  }

  function assets(world, bytes) {
    const packs = world.assetPacks.map(raw => {
      const pack = K.authoring.assetPacks.manifest(raw);
      const inventory = key => (pack[key] ?? []).map(({id,version,revision}) =>
        ({id,...(version !== undefined && {version}),...(revision !== undefined && {revision})}));
      return {id:pack.id,revision:pack.revision,bytes:bytes(raw),
        families:pack.families.map(({id,version,variants}) =>
          ({id,version,recipes:variants.map(({id,recipe}) => ({id,type:recipe.type}))})),
        looks:inventory('looks'),materials:inventory('materials'),environments:inventory('environments'),
        bakedImages:(pack.environmentImages ?? []).map(({id,width,height}) => ({id,width,height}))};
    });
    const dataInputs = K.dataInputs.prepare(world.dataInputs).describe().map(({id,kind,format,rowCount}) =>
      ({id,kind,format,rowCount,bytes:bytes(world.dataInputs[id])}));
    const modules = Object.entries(world.systems).filter(([,spec]) => spec.kind === 'simulation-model' &&
      spec.config?.model?.format === W.models.format).map(([system,{config:{model}}]) =>
      ({system,id:model.id,revision:model.revision,bytes:bytes(model)}));
    return {storage:'embedded-in-world',packs,dataInputs,modules,serializedBytes:sum([...packs,...dataInputs,...modules].map(row => row.bytes))};
  }

  function estimate(raw, name) {
    check(record(raw) && Object.keys(raw).every(key => ['workspaceBytes','workPerStep'].includes(key)) &&
      (raw.workspaceBytes === undefined || Number.isSafeInteger(raw.workspaceBytes) && raw.workspaceBytes >= 0) &&
      (raw.workPerStep === undefined || record(raw.workPerStep) &&
        Object.entries(raw.workPerStep).every(([unit,count]) => W.data.id(unit) && Number.isFinite(count) && count >= 0)),
    'Invalid simulation resource estimate for '+name);
    return raw;
  }

  function describe(plan,{tick,world,states,delays,sampling,chunkState,partitioned,observers}) {
    const {order,systems,schedule,rates,chunks,transfers,couplings} = plan, {subdivision} = schedule;
    const phases = rates?.phases ?? [{slice:1,names:order}];
    const T = K.procedural.takeTime;
    const hostHz = world.takeClock?.simulationRate === undefined ? 1/world.dt : T.seconds(T.read(world.takeClock.simulationRate));
    const encoder = new TextEncoder(), sizes = new WeakMap();
    function bytes(value) {
      if (value === undefined) return 0;
      if (value === null || typeof value !== 'object') return encoder.encode(JSON.stringify(value)).length;
      if (!sizes.has(value)) sizes.set(value,encoder.encode(JSON.stringify(value)).length);
      return sizes.get(value);
    }
    const cadences = Object.fromEntries(order.map(name => {
      const managed = chunks?.managed.get(name);
      const choices = managed ? managed.rates : [schedule.rates[name]];
      return [name,choices.map(({every,substeps},index) => ({
        ...(managed && {level:chunks.levelIds[index]}),every,substeps,
        visitsPerTick:substeps/every,hz:finite(hostHz*substeps/every)
      }))];
    }));
    const connections = signals(plan,cadences,sampling);
    const lanes = Object.fromEntries(order.map(name => {
      const system = systems[name], spec = world.systems[name], state = states[name], managed = chunks?.managed.get(name);
      const hooks = ['step','output'].filter(key => typeof system[key] === 'function');
      const estimateRow = system.estimate ? estimate(system.estimate({state,world,id:name}),name) : {};
      const cadence = cadences[name].map(rate => ({...rate,...(estimateRow.workPerStep &&
        {workPerTick:Object.fromEntries(Object.entries(estimateRow.workPerStep).map(([unit,count]) =>
          [unit,finite(count*rate.visitsPerTick)]))})}));
      const processing = system.processingReport?.();
      return [name,{
        kind:spec.kind,...(spec.operatorRevision !== undefined && {revision:spec.operatorRevision}),
        cadence,hooks,...(plan.timedSolvers.has(name) && {timedInputs:plan.timedSolvers.get(name),
          maxEventBoundaries:W.timedEvents.maxBoundaries}),worker:partitioned?.has(name) ? 'eligible' : 'host',
        ...(managed && {chunk:{id:managed.chunk,level:chunkState.entries[managed.chunk].level,sleep:chunks.levelIds.at(-1)}}),
        ...(system.childPlan && {child:system.childPlan(state)}),
        ...(processing && {processing}),
        resources:{stateJsonBytes:bytes(state),...(system.typedStateBytes &&
          {typedStateBytes:system.typedStateBytes(state)}),...estimateRow}
      }];
    }));
    const baked = assets(world,bytes), entries = Object.values(lanes);
    const withSolver = entries.filter(lane => lane.hooks.length);
    const scheduled = withSolver.filter(lane => !lane.chunk);
    const nestedMemory = lane => lane.child?.plan.execution.resources.memory;
    const eventBuffers = connections.filter(edge => edge.buffer?.mode === 'events').map(edge => edge.to);
    if (rates) {
      for (const [port,{type}] of Object.entries(plan.ports.inputs))
        if (type === 'event' && !plan.incoming.has(port)) eventBuffers.push(port);
    }
    return freeze({
      version:1, world:world.id,tick, ...(world.simulationModel &&
        {model:{id:world.simulationModel.id,revision:world.simulationModel.revision}}),
      ...(world.simulationModel?.blockSize !== undefined && {
        blocks:{maxSamples:world.simulationModel.blockSize,
          ...(lanes[order[0]]?.processing && {effectiveMaxSamples:Math.min(world.simulationModel.blockSize,
            lanes[order[0]].processing.capacity.effectiveMaxSamples)}),range:'start-inclusive/end-exclusive',
          publication:'block-end',splitsAt:'input commands and requested endpoints'}
      }),
      clock:{dtSeconds:world.dt,hz:finite(hostHz),subdivision,mode:rates ? 'multi-rate' : 'fixed'},
      phases:phases.map(({slice,names}) => ({slice,at:slice/subdivision,candidates:names})),
      systems:lanes,postStep:{observers,transferProducers:transfers.producers},
      ...(couplings.length&&{transferCouplings:couplings.map(({name,describe})=>({id:name,...describe,
        phase:'after ordinary transfers, before system steps',latest:states[name]}))}),
      samplingPolicies:policies,signals:connections,feedback:feedback(plan,connections),assets:baked,
      resources:{
        memory:{
          systemStateJsonBytes:sum(entries.map(lane => lane.resources.stateJsonBytes)),
          typedStateBytes:sum(entries.map(lane => lane.resources.typedStateBytes ?? nestedMemory(lane)?.typedStateBytes ?? 0)),
          samplingJsonBytes:bytes(sampling),delayJsonBytes:bytes(delays),
          delaySlots:sum(connections.map(edge => edge.crossing ? 0 : edge.delay)),
          ...(rates?.historySlots && {crossingHistorySlots:rates.historySlots}),eventBuffers:eventBuffers.sort(),
          maxEventsPerBuffer:W.rates.maxEvents,
          declaredWorkspaceBytes:sum(entries.map(lane => (lane.resources.workspaceBytes ?? 0) +
            (nestedMemory(lane)?.declaredWorkspaceBytes ?? 0))),
          assetsJsonBytes:baked.serializedBytes
        },
        work:{
          fixedSolverVisitsPerTick:sum(scheduled.map(lane => lane.cadence[0].visitsPerTick)),
          maxSolverVisitsPerTick:sum(withSolver.map(lane => Math.max(...lane.cadence.map(rate => rate.substeps)))),
          observerCallsPerTick:observers.length,
          variableSystems:order.filter(name => lanes[name].chunk),
          undeclaredWork:order.filter(name => lanes[name].hooks.includes('step') && !lanes[name].resources.workPerStep)
        }
      }
    });
  }

  W.executionPlan = Object.freeze({describe});
})(KIT);
