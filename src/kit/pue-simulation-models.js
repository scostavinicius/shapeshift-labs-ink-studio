/* Versioned simulation definitions compile to the ordinary world runtime. */
(function (K) {
  const W = K.world;
  const {check, copy, endpoint, id, own, read, record, selector, vector} = W.data;
  const {freeze} = K.procedural.data;
  const format = 'ink-studio/simulation-model';
  const version = 1, heldAdvance = Symbol('model input block');
  const sections = ['domain', 'parameters', 'initial', 'boundaries'];
  const revision = value => Number.isSafeInteger(value) && value > 0;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));

  function entries(value, label) {
    check(record(value) && Object.keys(value).every(id), 'Invalid model ' + label + ' names');
    return Object.entries(value);
  }

  function bindings(value, source) {
    if (Array.isArray(value)) return value.map(item => bindings(item, source));
    if (!record(value) || value.format === format) return value;
    if (own(value, '$model')) {
      check(Object.keys(value).length === 1 && typeof value.$model === 'string',
        'Expected a single $model JSON Pointer');
      const path = selector(value.$model);
      check(sections.includes(path[0]), 'Unknown model binding section: ' + path[0]);
      const result = read(source, path);
      check(result !== undefined, 'Unresolved model binding: ' + value.$model);
      return result;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindings(item, source)]));
  }

  function probeTarget(at) {
    return at === undefined || vector(at) || fields(at, ['point', 'entity', 'socket']) &&
      (at.entity !== undefined ? id(at.entity) && at.point === undefined &&
        (at.socket === undefined || id(at.socket)) : vector(at.point) && at.socket === undefined);
  }

  function parameterValues(source, overrides = {}) {
    const declared = source.parameterSchema === undefined ? {} : source.parameterSchema;
    const exposed = entries(declared, 'parameter schema');
    for (const [name] of entries(overrides, 'parameter override'))
      check(own(declared,name), 'Model ' + source.id + ' does not expose parameter ' + name);
    for (const [name, spec] of exposed) {
      const valid = K.procedural.graphTypes.validator(spec?.type);
      check(fields(spec, ['type','min','max','choices','description']) && valid &&
        (spec.description === undefined || typeof spec.description === 'string') &&
        (spec.min === undefined || spec.type === 'number' && Number.isFinite(spec.min)) &&
        (spec.max === undefined || spec.type === 'number' && Number.isFinite(spec.max)) &&
        (spec.min === undefined || spec.max === undefined || spec.min <= spec.max) &&
        (spec.choices === undefined || Array.isArray(spec.choices) &&
          spec.choices.length > 0 && spec.choices.every(valid)),
      'Invalid model parameter schema for ' + name);
      const accepts = value => valid(value) && (spec.min === undefined || value >= spec.min) &&
        (spec.max === undefined || value <= spec.max) &&
        (spec.choices === undefined || spec.choices.some(choice => W.data.equal(choice,value)));
      check(own(source.parameters,name) && accepts(source.parameters[name]), 'Invalid default model parameter ' + name);
      if (own(overrides,name)) check(accepts(overrides[name]), 'Invalid override for model parameter ' + name);
    }
    return {...source.parameters,...overrides};
  }

  function instantiate(model, {parameters, seed} = {}) {
    check(model?.format === format && model.version === version && record(model.parameters),
      'A module needs an embedded versioned simulation model');
    const source = copy(model), values = parameterValues(source, parameters === undefined ? {} : copy(parameters));
    check(seed === undefined || Number.isSafeInteger(seed), 'Model instance seed must be an integer');
    return freeze({...source, parameters:values, ...(seed !== undefined && {seed})});
  }

  function expand(source, scope) {
    if (source?.modules === undefined && source?.instances === undefined) return source;
    const {modules = {}, instances = {}, systems = {}, ...world} = source;
    const definitions = Object.fromEntries(entries(modules, 'module').map(([name, model]) => {
      check(model?.format === format && model.version === version && id(model.id) && revision(model.revision),
        'Module ' + name + ' needs a versioned simulation model');
      return [name,model];
    }));
    check(record(systems), 'Invalid world systems');
    const additions = Object.fromEntries(entries(instances, 'instance').map(([name, declaration]) => {
      const spec = scope ? bindings(declaration,scope) : declaration;
      check(name !== 'world' && !own(systems,name), 'Duplicate or reserved model instance ' + name);
      check(fields(spec, ['module','parameters','seed','drive','schedule','contract']) &&
        id(spec.module) && own(definitions,spec.module), 'Unknown or invalid module for instance ' + name);
      const {module, schedule, contract, ...options} = spec;
      return [name,{
        ...system(definitions[module],options), operatorRevision:1, module,
        ...(schedule !== undefined && {schedule}), ...(contract !== undefined && {contract})
      }];
    }));
    return {...world,systems:{...systems,...additions}};
  }

  function compile(raw) {
    const source = copy(raw);
    check(fields(source, ['format', 'version', 'id', 'revision', 'seed', 'numerics', ...sections,
      'operators', 'inputs', 'outputs', 'probes', 'connections', 'commands', 'world', 'modules', 'instances', 'parameterSchema']) &&
      source.format === format && source.version === version && id(source.id) && revision(source.revision) &&
      Number.isSafeInteger(source.seed), 'Expected an Ink Studio simulation model with a supported version, ID, revision and integer seed');
    check(sections.every(key => record(source[key])), 'Model needs domain, parameters, initial and boundaries records');
    parameterValues(source);
    const {numerics} = source;
    check(fields(numerics, ['dt','blockSize']) && Number.isFinite(numerics.dt) && numerics.dt > 0 && numerics.dt <= 1,
      'Model numerics needs an explicit timestep in (0, 1]');
    const {blockSize} = numerics;
    check(blockSize === undefined || Number.isSafeInteger(blockSize) && blockSize >= 1 && blockSize <= W.kernels.maxBlockSize,
      'Model blockSize must be 1–'+W.kernels.maxBlockSize+' samples');
    check(source.world === undefined || fields(source.world, ['entities', 'visual', 'assetPacks', 'metadata']),
      'Model world may supply entities, visual settings, asset packs and metadata');

    const systems = Object.fromEntries(entries(source.operators === undefined ? {} : source.operators, 'operator').map(([name, spec]) => {
      check(fields(spec, ['kind', 'revision', 'config', 'schedule', 'contract', 'portQuantities']) && id(spec.kind) &&
        revision(spec.revision) && record(spec.config ?? {}), 'Model operator ' + name + ' needs a kind and pinned revision');
      const {revision: operatorRevision, ...settings} = bindings(spec, source);
      return [name, {...settings, operatorRevision}];
    }));

    for (const key of ['inputs', 'outputs'])
      for (const [, port] of entries(source[key], key)) endpoint(port);
    for (const [name, probe] of entries(source.probes, 'probe'))
      check(fields(probe, ['field', 'at', 'args']) && typeof probe.field === 'string' && probe.field.length > 0 &&
        probeTarget(probe.at) && (probe.args === undefined || record(probe.args)), 'Invalid model probe ' + name);
    check(Array.isArray(source.commands ?? []), 'Model commands must be an array');
    const commands = (source.commands ?? []).map(command => {
      check(fields(command, ['tick', 'input', 'value', 'id']) && own(command, 'value') &&
        id(command.input) && own(source.inputs, command.input), 'Model command needs a named input and value');
      const {input, value, ...timing} = command;
      return {...timing, action: 'world/input', args: {port: source.inputs[input], value: bindings(value, source)}};
    });

    const {id: name, revision: assetRevision, inputs, outputs, probes, modules, instances} = source;
    const exposedParameters = Object.fromEntries(Object.entries(source.parameterSchema ?? {}).map(([key,schema]) =>
      [key,{...schema,value:source.parameters[key]}]));
    const world = expand({
      ...bindings(source.world ?? {}, source), id: name, seed: source.seed, dt: numerics.dt,
      systems, ...(modules !== undefined && {modules}), ...(instances !== undefined && {instances}),
      connections: source.connections ?? [], commands,
      simulationModel: {id: name, version, revision: assetRevision, inputs, outputs, probes,
        ...(blockSize !== undefined && {blockSize}),
        ...(Object.keys(exposedParameters).length && {exposedParameters})}
    }, source);
    check(Object.keys(world.systems).length > 0, 'A model needs at least one operator or module instance');
    return W.manifest(world);
  }

  function checkInterface(world, ports, incoming, systems) {
    const model = world.simulationModel;
    for (const [name, port] of entries(model.inputs, 'input'))
      check(own(ports.inputs, port) && !incoming.has(port), 'Model input ' + name + ' needs an unconnected input port: ' + port);
    for (const [name, port] of entries(model.outputs, 'output'))
      check(own(ports.outputs, port), 'Unknown port for model output ' + name + ': ' + port);
    const query = W.query.create({world}, systems);
    for (const [name, probe] of entries(model.probes, 'probe'))
      check(query.field(probe.field), 'Unknown field for model probe ' + name + ': ' + probe.field);
  }

  function sample(run) {
    const {world, tick, time, signals} = run.view(), model = world.simulationModel;
    check(model, 'This run has no simulation model interface');
    const outputs = Object.fromEntries(Object.entries(model.outputs).map(([name, port]) => [name, signals[port]]));
    return freeze({id: model.id, revision: model.revision, tick, time, outputs, probes: sampleProbes(model, run.query())});
  }

  function sampleProbes(model, query) {
    return Object.fromEntries(Object.entries(model.probes).map(([name, spec]) =>
      [name, query.probe(spec.field, spec.at, spec.args)]));
  }

  function command(world, input, value, tick) {
    const port = world.simulationModel?.inputs;
    check(id(input) && own(port, input), 'Unknown model input ' + input);
    return {tick, action: 'world/input', args: {port: port[input], value: copy(value)}};
  }

  function session(model, {checkpoint, commands = [], checkpointEvery, checkpointCache} = {}) {
    const world = compile(model);
    check(checkpoint === undefined || checkpoint.format === W.runtime.checkpointFormat &&
      W.data.equal(checkpoint.world, world), 'Checkpoint does not match this simulation model');
    check(Array.isArray(commands), 'Expected model input commands');
    const scheduled = commands.map(row => {
      check(fields(row, ['tick', 'input', 'value', 'id']) && own(row, 'value'), 'Invalid model input command');
      return {...command(world, row.input, row.value, row.tick), ...(row.id !== undefined && {id:row.id})};
    });
    return W.scrub.create(checkpoint ?? world, {commands:scheduled, checkpointEvery, checkpointCache});
  }

  function system(model, {drive = [], parameters, seed} = {}) {
    check(model?.format === format, 'A simulation-model system needs an embedded model definition');
    return {kind: 'simulation-model', config: {model, drive,
      ...(parameters !== undefined && {parameters}), ...(seed !== undefined && {seed})}};
  }

  W.models = Object.freeze({format, compile, expand, instantiate, checkInterface, sample, command, session, system, heldAdvance});
})(KIT);
