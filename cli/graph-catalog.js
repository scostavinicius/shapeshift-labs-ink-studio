const { createGraphProject, operationRegistry } = require('./graph-project.js');
const { exampleFor } = require('./graph-catalog-examples.js');
const { socketDetails, specialization, notes } = require('./graph-catalog-metadata.js');

function registry(settings) {
  const { kit = require('../index.js').load(), operations = {} } = settings;
  const { toolkit, stock, extensions, overrides } = operationRegistry(kit, operations);
  const entries = { ...toolkit, ...overrides };
  return { kit, entries, origin(id) {
    return Object.hasOwn(extensions, id) && extensions[id] !== toolkit[id] ? 'host' :
      Object.hasOwn(stock, id) ? 'headless' : 'toolkit';
  } };
}

function describe(id, operation, origin, kit, settings) {
  const { graph } = kit.KIT.procedural;
  const builtin = origin !== 'host';
  const example = operation.example ?? (builtin ? exampleFor(id, operation, kit) : undefined);
  const dynamic = typeof operation.specialize === 'function';
  let signature;
  if (dynamic && example?.kind === 'graph') {
    const target = Object.entries(example.project.nodes).find(([, node]) => node.op === id)?.[0];
    if (!target) throw new TypeError('The graph example must include ' + id);
    signature = createGraphProject(example.project, builtin ? { kit } : { ...settings, kit }).sockets(target);
  } else if (!dynamic || operation.inputs || operation.outputs) signature = graph.operationSchema(operation);
  function ports(values, direction) {
    const input = direction === 'input';
    return Object.fromEntries(Object.entries(values).map(([name, socket]) => {
      const defaults = Object.hasOwn(socket, 'default');
      const details = socketDetails(builtin ? id : null, name, socket.type, builtin && input);
      return [name, { type: socket.type, unit: socket.unit ?? details.unit,
        constraints: { ...details.constraints, ...socket.constraints },
        ...(socket.quantity && {quantity:socket.quantity}),
        ...(input && { required: !defaults }), ...(defaults && { default: socket.default }),
        ...(socket.description !== undefined && { description: socket.description }),
        ...(socket.properties || details.properties ? { properties: socket.properties ?? details.properties } : {}) }];
    }));
  }
  return {
    id, origin, category: operation.category ?? (id.includes('.') ? id.split('.')[0] : 'core'),
    ...(operation.description !== undefined && { description: operation.description }),
    timeDependent: signature ? Boolean(signature.time ?? operation.time) : null,
    ...(dynamic && { specialization: builtin && Object.hasOwn(specialization, id) ? specialization[id] :
      { description: 'Ports are resolved from the node definition.' } }),
    inputs: signature ? ports(signature.inputs, 'input') : null,
    outputs: signature ? ports(signature.outputs, 'output') : null,
    constraints: operation.constraints ?? (builtin && Object.hasOwn(notes, id) ? notes[id] : []),
    example: example ?? null
  };
}

function listGraphNodes(settings = {}) {
  const { kit, entries, origin } = registry(settings);
  const nodes = Object.keys(entries).sort().map(id => describe(id, entries[id], origin(id), kit, settings));
  return { format: 'ink-studio/graph-node-catalog', version: 1, count: nodes.length, nodes };
}

function describeGraphNode(id, settings = {}) {
  const { kit, entries, origin } = registry(settings);
  if (!Object.hasOwn(entries, id)) throw new RangeError('Unknown graph operation ' + id);
  return { format: 'ink-studio/graph-node', version: 1, ...describe(id, entries[id], origin(id), kit, settings) };
}

function exampleText(example) {
  return example.kind === 'graph' ? JSON.stringify(example.project, null, 2) : example.source.trimEnd();
}

function nodeText(node) {
  function portLines(ports) {
    if (!ports) return ['  Resolved when the node is specialized.'];
    return Object.keys(ports).length ? Object.entries(ports).flatMap(([name, port]) => {
      const suffix = [
        ...(port.unit ? ['unit ' + port.unit] : []),
        ...(port.quantity ? [JSON.stringify(port.quantity)] : []),
        ...(Object.hasOwn(port, 'default') ? ['default ' + JSON.stringify(port.default)] : port.required ? ['required'] : []),
        ...(Object.keys(port.constraints).length ? [JSON.stringify(port.constraints)] : [])
      ];
      return ['  ' + name + '  ' + port.type + (suffix.length ? '  ' + suffix.join(' · ') : ''),
        ...(port.description ? ['    ' + port.description] : []),
        ...Object.entries(port.properties ?? {}).map(([key, detail]) => '    ' + key + '  ' + JSON.stringify(detail))];
    }) : ['  None.'];
  }
  const filename = node.example?.kind === 'node' ? 'example.cjs' : 'example.json';
  return [node.id + ' (' + node.origin + ')', ...(node.description ? [node.description] : []),
    ...(node.specialization ? [node.specialization.description, ...(node.inputs && ['Ports below show the example specialization.'])] : []),
    ...(node.timeDependent ? ['Samples the graph clock.'] : []),
    'Inputs', ...portLines(node.inputs), 'Outputs', ...portLines(node.outputs),
    ...(node.constraints.length ? ['Operation constraints', ...node.constraints.map(line => '  ' + line)] : []),
    ...(node.example ? ['Runnable example', '  ink-studio graph describe ' + node.id + ' --example > ' + filename,
      '  ' + (node.example.kind === 'node' ? 'node ' : 'ink-studio graph run ') + filename, '', exampleText(node.example)] :
      ['No catalog example supplied.'])].join('\n');
}

function listText({ count, nodes }) {
  function ports(values) {
    return values ? Object.entries(values).map(([name, port]) => name + (port.required === false ? '?' : '') +
      ' ' + port.type).join(', ') : 'specialized';
  }
  return [count + ' graph operations', 'Use graph describe <op> for defaults, constraints and a runnable example.', '',
    ...nodes.map(node => node.id + '  (' + ports(node.inputs) + ') → ' + (ports(node.outputs) || 'no ports') +
      (node.specialization ? '  [specializes]' : ''))].join('\n');
}

module.exports = { listGraphNodes, describeGraphNode, exampleText, nodeText, listText };
