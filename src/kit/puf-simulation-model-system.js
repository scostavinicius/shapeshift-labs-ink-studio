/* A model instance owns its clock, state and random stream inside a world. */
(function (K) {
  const W = K.world, R = W.runtime, M = W.models, T = K.procedural.takeTime;
  const {check, equal, own, record, portOf} = W.data;
  const {freeze} = K.procedural.data;
  const maxTicksPerVisit = 10000;

  function provider(config, {world: parent, id}) {
    check(Object.keys(config).every(key => ['model','drive','parameters','seed'].includes(key)) && config.model?.format === M.format,
      'Simulation-model system ' + id + ' needs an embedded model definition');
    const definition = config.parameters === undefined && config.seed === undefined ? config.model :
      M.instantiate(config.model,{parameters:config.parameters,seed:config.seed});
    const {world, systems, ports} = R.modelInterface(definition), model = world.simulationModel;
    const {id:modelId, version, revision, exposedParameters = {}} = model;
    const instanceInfo = {...(parent.systems[id].module !== undefined && {name:parent.systems[id].module}),
      id:modelId, version, revision, seed:world.seed, parameters:exposedParameters};
    const selectPorts = (aliases, table, inbound = false) => Object.fromEntries(Object.entries(aliases).map(([name, port]) => {
      const {sampleRates, timing, ...descriptor} = table[port];
      if (inbound && timing!==undefined) descriptor.timing='forward';
      if (!descriptor.quantity) return [name, descriptor];
      const {sampleRate, ...quantity} = descriptor.quantity;
      return [name, {...descriptor,quantity}];
    }));
    const inputs = selectPorts(model.inputs, ports.inputs, true), outputs = selectPorts(model.outputs, ports.outputs);
    const explicit = config.drive ?? [];
    check(Array.isArray(explicit) && new Set(explicit).size === explicit.length && explicit.every(name => own(inputs, name)),
      'Model drive must list distinct named inputs on ' + id);
    const connected = new Set(parent.connections.map(edge => portOf(parent, edge.to)));
    const driven = Object.keys(inputs).filter(name => explicit.includes(name) || connected.has(id + '/' + name));
    const events = driven.filter(name => inputs[name].type === 'event');
    const levels = driven.filter(name => inputs[name].type !== 'event');
    const eventOutputs = Object.keys(outputs).filter(name => outputs[name].type === 'event');
    const emptyEvents = names => Object.fromEntries(names.map(name => [name, []]));
    const descriptor = W.query.create({world}, systems);
    const fields = Object.fromEntries(Object.entries(model.probes).map(([name, probe]) => {
      const {type, units} = descriptor.field(probe.field);
      return [name, {type, ...(units !== undefined && {units}), qualified:true, selector:true,
        read: ({state}) => state ? restore(state).query().probe(probe.field, probe.at, probe.args) :
          W.query.missing('model state is unavailable')}];
    }));
    const hostRate = parent.takeClock?.simulationRate;
    const hostPeriod = hostRate === undefined ? T.period(parent.dt) : T.div(T.read(1), T.read(hostRate));
    const ratio = parent.dt === world.dt ? T.read(1) : T.div(hostPeriod, T.period(world.dt));
    let live;

    function capture(run, pending, eventValues) {
      return freeze({checkpoint:run.checkpoint(), pending, eventValues});
    }

    function restore(state) {
      if (live?.checkpoint() !== state.checkpoint) live = R.create(world, {checkpoint:state.checkpoint});
      return live;
    }

    return {
      inputs, outputs, fields, module:instanceInfo, shareCheckpoint:true, timedForward:true,
      childProcessing:state=>restore(state).processing(),
      childQueueDepths:state=>state?.pending?Object.fromEntries(events.map(name=>[name,state.pending[name].length])):{},
      childPlan(state) {
        const ticksPerHostTick = T.seconds(ratio);
        return {
          ticksPerHostTick:Number.isFinite(ticksPerHostTick) ? ticksPerHostTick : null,
          maxTicksPerVisit,
          hostToModel:{hold:levels,queue:events}, modelToHost:{accumulate:eventOutputs},
          plan:restore(state).composition()
        };
      },
      initial() {
        live = R.create(world);
        return capture(live, emptyEvents(events), emptyEvents(eventOutputs));
      },
      validateState(state) {
        check(record(state) && equal(state.checkpoint?.world, world) && record(state.pending) &&
          Object.keys(state.pending).length === events.length && events.every(name =>
            Array.isArray(state.pending[name]) && state.pending[name].length <= 10000), 'Invalid saved simulation model ' + id);
        restore(state);
        check(record(state.eventValues) &&
          Object.keys(state.eventValues).length === eventOutputs.length && eventOutputs.every(name =>
            Array.isArray(state.eventValues[name]) && state.eventValues[name].length <= 10000),
        'Invalid saved model event outputs on ' + id);
      },
      output(state) {
        return Object.fromEntries(Object.entries(model.outputs).map(([name, port]) =>
          [name, state.eventValues[name] ?? state.checkpoint.outputs[port]]));
      },
      step(state, ctx) {
        const count = ctx.substeps ?? 1;
        const phase = [BigInt((ctx.tick - 1) * count + (ctx.substep ?? count)), BigInt(count)];
        const to = T.index(T.roundDown(T.mul(phase, ratio))), from = state.checkpoint.tick;
        check(to >= from && to - from <= maxTicksPerVisit, 'Model ' + id + ' exceeds its per-step tick budget');
        const pending = Object.fromEntries(events.map(name => [name, W.rates.add(state.pending[name], ctx.input[name], 'event')]));
        const eventValues = emptyEvents(eventOutputs);
        if (to === from) return freeze({...state, pending, eventValues});
        const current = restore(state);
        if (current[M.heldAdvance]) {
          const held = Object.fromEntries(levels.map(name => [model.inputs[name],ctx.input[name]]));
          const batches = current[M.heldAdvance](to,held);
          for (const name of eventOutputs) eventValues[name] = batches[model.outputs[name]] ?? [];
          return capture(current,emptyEvents(events),eventValues);
        }
        // Outer ticks own the input history. A driven child starts its command ledger at this checkpoint.
        const run = driven.length ? current.fork() : current;
        live = run;
        if (!driven.length && !eventOutputs.length) run.advance(to);
        else for (let tick = from + 1; tick <= to; tick++) {
          const commands = levels.map(name => M.command(world, name, ctx.input[name], tick));
          for (const name of events) if (pending[name].length) {
            const {ready,pending:waiting} = W.timedEvents.select(pending[name],tick*world.dt);
            pending[name] = waiting;
            if (ready.length) commands.push(M.command(world,name,ready,tick));
          }
          if (commands.length) run.schedule(commands);
          run.step();
          for (const name of eventOutputs)
            eventValues[name] = W.rates.add(eventValues[name], run.view().signals[model.outputs[name]], 'event');
        }
        return capture(run, pending, eventValues);
      }
    };
  }

  R.register('simulation-model', provider);
})(KIT);
