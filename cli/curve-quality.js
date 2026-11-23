const CurveSplat = require('../src/curve-splat.js');
const Targets = require('../src/target-selectors.js');

function prepare(value) {
  if (value === undefined || value === false) return null;
  const plain = object => object && Object.getPrototypeOf(object) === Object.prototype;
  if (!plain(value) || Object.keys(value).some(key => key !== 'layers') ||
      !Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > 64)
    throw new TypeError('Curve quality needs 1 to 64 layers');
  const ids = new Set();
  return Array.from(value.layers, layer => {
    if (!plain(layer) || Object.keys(layer).some(key => !['id', 'select', 'segments', 'fragments'].includes(key)) ||
        !Targets.name(layer.id) || ids.has(layer.id))
      throw new TypeError('Curve quality layers need distinct IDs, a selector and segment or fragment limits');
    ids.add(layer.id);
    const { id, segments, fragments } = layer;
    const limit = (n, max) => n === undefined || Number.isSafeInteger(n) && n >= 0 && n <= max;
    if (!limit(segments, 1e6) || !limit(fragments, 2e6) || segments === undefined && fragments === undefined)
      throw new RangeError('Curve quality needs nonnegative limits up to 1 million segments and 2 million fragments');
    return { id, segments, fragments, select: Targets.prepare(layer.select) };
  });
}

function pixelBounds(curve, margin, w, h) {
  const [left, bottom, right, top] = curve.bounds;
  if (left - margin >= w || bottom - margin >= h || right + margin <= 0 || top + margin <= 0) return;
  return [Math.max(0, Math.floor(left - margin)), Math.min(w - 1, Math.ceil(right + margin)),
    Math.max(0, Math.floor(bottom - margin)), Math.min(h - 1, Math.ceil(top + margin))];
}

function plan(world, layers, data, prepareRow, representation) {
  if (!layers) return;
  const match = Targets.index(world), stations = world.curveStations;
  const rows = new Map(), states = layers.map(layer => ({ layer, groups: new Map(), report: {
    id: layer.id, segmentLimit: layer.segments ?? null, fragmentLimit: layer.fragments ?? null,
    requestedSegments: 0, requestedFragmentSlots: 0, segments: 0, fragmentSlots: 0, fragments: 0,
    omittedSegments: 0, omittedStrands: 0, omittedNames: []
  } }));
  const candidates = new Map();
  for (let i = 0; i < world.count; i++) {
    if (!CurveSplat.isRow(data, i * 16)) continue;
    const id = stations?.[i * CurveSplat.stationStride] || 0;
    const fallback = world.curveStrands?.[id - 1], row = match.row(i);
    const key = id || row;
    if (!candidates.has(key)) {
      const target = fallback ? { entity: fallback.object, object: fallback.object,
        material: fallback.material, surface: fallback.name, ...row } : row;
      candidates.set(key, states.find(state => Targets.matches(state.layer.select, target)));
    }
    const state = candidates.get(key);
    if (!state) continue;
    const sample = prepareRow(i);
    if (!sample) continue;
    const [x0, x1, y0, y1] = sample.bounds;
    const slots = (x1 - x0 + 1) * (y1 - y0 + 1);
    const groupKey = representation?.get(i)?.cohort ?? (id || (sample.curve.group ? 'hard-' + sample.curve.group : -i - 1));
    if (!state.groups.has(groupKey)) state.groups.set(groupKey, { samples: [], names:new Map(), slots:0 });
    const group = state.groups.get(groupKey);
    group.samples.push(i);
    group.names.set(id || groupKey, fallback?.name ?? 'splat ' + (i + 1));
    group.slots += slots;
    rows.set(i, { ...sample, report:state.report });
  }
  const omitted = new Set();
  for (const { layer, groups, report } of states) for (const { samples, names, slots } of groups.values()) {
    report.requestedSegments += samples.length;
    report.requestedFragmentSlots += slots;
    if (report.segments + samples.length > (layer.segments ?? Infinity) ||
        report.fragmentSlots + slots > (layer.fragments ?? Infinity)) {
      report.omittedSegments += samples.length;
      report.omittedStrands += names.size;
      if (report.omittedNames.length < 32) report.omittedNames.push(...[...names.values()].slice(0, 32 - report.omittedNames.length));
      for (const i of samples) {
        omitted.add(i);
        rows.delete(i);
      }
    } else {
      report.segments += samples.length;
      report.fragmentSlots += slots;
    }
  }
  return { rows, omitted, layers:states.map(state => state.report) };
}

module.exports = { prepare, pixelBounds, plan };
