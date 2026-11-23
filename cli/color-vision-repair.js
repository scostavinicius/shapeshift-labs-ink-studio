const Color = require('../src/color-space.js');
const Selectors = require('../src/target-selectors.js');
const { hex } = require('./look-palette.js');
const { packedAt, pack, normalized, prepareOutputGrade } = require('./output-grade.js');
const { modes, simulateColor } = require('./color-vision.js');

const format = 'ink-studio/color-vision-palette-repair';
const maxPixels = 262_144;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && within(value, min, max);
const isByte = (value, length) => (value instanceof Uint8Array || value instanceof Uint8ClampedArray) && value.length === length;
const lab = color => Color.toOKLab(normalized(color));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function swatch(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Expected a hex swatch');
  return parseInt(value.slice(1), 16);
}

function swatches(values, limit) {
  if (!Array.isArray(values) || values.length > limit) throw new TypeError('Expected up to ' + limit + ' swatches');
  return new Set(Array.from(values, swatch));
}

function selector(value) {
  const prepared = Selectors.prepare(value);
  if (Object.keys(prepared).some(key => !['object', 'material'].includes(key)))
    throw new TypeError('Palette repair selects a visible object, material or both');
  return prepared;
}

function prepare(frame, options) {
  const { w, h, rgb, alpha, passes } = frame ?? {}, size = w * h;
  if (!integer(w, 1, 1024) || !integer(h, 1, 1024) || size > maxPixels || !isByte(rgb, size * 3) ||
      (alpha != null && !isByte(alpha, size)) || !passes || passes.w !== w || passes.h !== h ||
      ['object', 'material'].some(key => !(passes[key + 'Id'] instanceof Uint32Array) ||
        passes[key + 'Id'].length !== size || !Array.isArray(passes[key + 's'])))
    throw new TypeError('Palette repair needs a native RGB frame with aligned object and material ID passes');
  const { pairs, modes: selectedModes = modes, minDistance = .09, minLightness = 0, minEdges = 1,
    editable, locked = [], candidates = {}, maxChanges = 3, maxShift = .22, maxEvaluations = 65_536 } = options;
  if (!Array.isArray(pairs) || !integer(pairs.length, 1, 12) || !Array.isArray(selectedModes) ||
      !integer(selectedModes.length, 1, modes.length) || !Array.from(selectedModes).every(mode => modes.includes(mode)) ||
      new Set(selectedModes).size !== selectedModes.length || !within(minDistance, .001, 1) || !within(minLightness, 0, 1) ||
      !integer(minEdges, 1, maxPixels) || !integer(maxChanges, 0, 4) || !within(maxShift, .001, 1) ||
      !integer(maxEvaluations, 1, 262_144) || !record(candidates) || Object.keys(candidates).length > 48)
    throw new RangeError('Invalid palette repair pairs, modes, thresholds or search bounds');
  const ids = new Set();
  const relationships = Array.from(pairs, row => {
    if (!record(row) || Object.keys(row).some(key => !['id', 'label', 'subject', 'background'].includes(key)))
      throw new TypeError('Expected a named subject and optional background selection');
    const { id, label = id, subject, background } = row;
    if (typeof id !== 'string' || !/^[a-z\d][a-z\d_-]{0,47}$/i.test(id) || ids.has(id.toLowerCase()) ||
        typeof label !== 'string' || !label.trim() || label.length > 120) throw new TypeError('Invalid or duplicate palette pair ID');
    ids.add(id.toLowerCase());
    return { id, label, subject: selector(subject), background: background === undefined ? undefined : selector(background) };
  });
  const alternatives = new Map();
  for (const [source, values] of Object.entries(candidates)) {
    const color = swatch(source);
    if (alternatives.has(color)) throw new TypeError('Duplicate candidate list for ' + source);
    alternatives.set(color, swatches(values, 40));
  }
  return { relationships, selectedModes, minDistance, minLightness, minEdges, maxChanges, maxShift, maxEvaluations, alternatives,
    editable: editable === undefined ? null : swatches(editable, 48), locked: swatches(locked, 48) };
}

function collect(frame, plan) {
  const { w, h, rgb, alpha, passes } = frame, size = w * h, counts = new Map();
  const colors = Uint32Array.from({ length: size }, (_, p) => {
    const color = packedAt(rgb, p * 3);
    if (alpha?.[p] === 0) return color;
    counts.set(color, (counts.get(color) ?? 0) + 1);
    return color;
  });
  const opaque = p => !alpha || alpha[p] === 255;
  function matches(select) {
    const tests = Object.entries(select).map(([key, value]) => [passes[key + 'Id'], passes[key + 's'].indexOf(value)]);
    return p => opaque(p) && tests.every(([ids, id]) => ids[p] === id);
  }
  const unique = new Map();
  const pairs = plan.relationships.map(pair => {
    const foreground = matches(pair.subject), background = pair.background && matches(pair.background);
    const owners = Uint8Array.from({ length: size }, (_, p) => foreground(p) ? 1 : Number(opaque(p) && (!background || background(p))) * 2);
    const edges = new Map(), mask = new Uint8Array(size);
    function visit(p, neighbor) {
      if (owners[neighbor] !== 2) return;
      const a = colors[p], b = colors[neighbor], key = a + ':' + b;
      if (!edges.has(key)) edges.set(key, { a, b, count: 0, point: [p % w, Math.floor(p / w)] });
      edges.get(key).count++;
      mask[p] = 1;
    }
    for (let p = 0; p < size; p++) {
      if (owners[p] !== 1) continue;
      const x = p % w;
      if (x > 0) visit(p, p - 1);
      if (x < w - 1) visit(p, p + 1);
      if (p >= w) visit(p, p - w);
      if (p < size - w) visit(p, p + w);
    }
    const qualified = Array.from(edges.values()).filter(edge => edge.count >= plan.minEdges);
    for (const { a, b } of qualified) {
      const key = Math.min(a, b) + ':' + Math.max(a, b);
      if (!unique.has(key)) unique.set(key, { a, b });
    }
    return { ...pair, edges: qualified, mask };
  });
  if (unique.size > 512) throw new RangeError('Too many distinct boundary pairs. Set a higher minEdges or narrow the selections.');
  return { counts, pairs, edges: Array.from(unique.values()) };
}

function createMetric(modes) {
  const colors = new Map(), comparisons = new Map();
  const samples = color => {
    if (!colors.has(color)) colors.set(color, modes.map(mode => lab(simulateColor(color, mode))));
    return colors.get(color);
  };
  return (a, b) => {
    const key = Math.min(a, b) + ':' + Math.max(a, b);
    if (comparisons.has(key)) return comparisons.get(key);
    const left = samples(a), right = samples(b);
    const result = modes.map((mode, i) => ({ mode, distance: distance(left[i], right[i]), lightness: Math.abs(left[i][0] - right[i][0]) }));
    if (comparisons.size < 65_536) comparisons.set(key, result);
    return result;
  };
}

function generated(color) {
  const [L, a, b] = lab(color), out = [];
  const at = (light, x, y) => pack(Color.fromOKLab([Math.max(0, Math.min(1, light)), x, y]));
  for (const step of [.025, .05, .075, .1, .15, .2]) out.push(at(L - step, a, b), at(L + step, a, b));
  for (const degrees of [-90, -55, -25, 25, 55, 90]) {
    const angle = degrees * Math.PI / 180, x = a * Math.cos(angle) - b * Math.sin(angle), y = a * Math.sin(angle) + b * Math.cos(angle);
    out.push(at(L, x, y), at(L - .07, x, y), at(L + .07, x, y));
  }
  return new Set(out);
}

function search(edges, counts, options, measure) {
  const { maxShift, maxChanges, maxEvaluations, editable, locked, alternatives, minDistance, minLightness } = options;
  const passes = (a, b) => measure(a, b).every(value => value.distance + 1e-12 >= minDistance && value.lightness + 1e-12 >= minLightness);
  const relevant = new Set(edges.flatMap(({ a, b }) => [a, b]));
  const available = new Map();
  for (const color of relevant) {
    if (locked.has(color) || (editable && !editable.has(color))) continue;
    const original = lab(color);
    const choices = Array.from(alternatives.get(color) ?? generated(color), to => ({ to, cost: distance(original, lab(to)) }))
      .filter(({ to, cost }) => !counts.has(to) && !locked.has(to) && cost <= maxShift).sort((a, b) => a.cost - b.cost || a.to - b.to);
    if (choices.length) available.set(color, choices);
  }
  const current = new Map(), used = new Set();
  let evaluations = 0, exhausted = false, best;
  for (let limit = 0; limit <= maxChanges && !exhausted; limit++) {
    const visited = new Set();
    function visit(cost) {
      if (best && cost >= best.cost || exhausted) return;
      const key = [...current].sort(([a], [b]) => a - b).map(([from, to]) => from + ':' + to).join(',');
      if (visited.has(key)) return;
      if (evaluations === maxEvaluations) { exhausted = true; return; }
      evaluations++;
      visited.add(key);
      let branch;
      const free = color => !current.has(color) && available.has(color);
      for (const { a, b } of edges) {
        if (passes(current.get(a) ?? a, current.get(b) ?? b)) continue;
        const choices = [...new Set([a, b])].filter(free);
        if (a === b || !choices.length || current.size === limit) return;
        if (!branch || choices.length < branch.length) branch = choices;
      }
      if (!branch) { best = { mapping: new Map(current), cost }; return; }
      for (const from of branch) for (const { to, cost: delta } of available.get(from)) {
        if (used.has(to)) continue;
        current.set(from, to);
        used.add(to);
        visit(cost + delta);
        used.delete(to);
        current.delete(from);
      }
    }
    visit(0);
    if (best) break;
  }
  return { mapping: best?.mapping ?? new Map(), provenMinimum: Boolean(best), exhausted, evaluations, feasible: Boolean(best) };
}

function repairColorVisionPalette(frame, options = {}) {
  const plan = prepare(frame, options), { pairs, edges, counts } = collect(frame, plan), metric = createMetric(plan.selectedModes);
  const result = search(edges, counts, plan, metric);
  const changes = [...result.mapping].sort(([a], [b]) => a - b).map(([from, to]) => ({ from: hex(from), to: hex(to), pixels: counts.get(from) }));
  const replacements = Object.fromEntries(changes.map(({ from, to }) => [from, to]));
  const stack = { name: 'Color-vision palette repair', steps: [{ type: 'swatchReplace', replacements }] };
  const repaired = prepareOutputGrade(stack).apply(frame);
  const flagged = row => row.distance + 1e-12 < plan.minDistance || row.lightness + 1e-12 < plan.minLightness;
  let weakBefore = 0, weakAfter = 0;
  const relationships = pairs.map(({ edges, mask, ...pair }) => {
    const rows = edges.map(({ a, b, count, point }) => {
      const before = metric(a, b), after = metric(result.mapping.get(a) ?? a, result.mapping.get(b) ?? b);
      if (before.some(flagged)) weakBefore++;
      if (after.some(flagged)) weakAfter++;
      return { subject: hex(a), background: hex(b), count, point, before, after,
        weakBefore: before.filter(flagged).map(value => value.mode), weakAfter: after.filter(flagged).map(value => value.mode) };
    });
    return { ...pair, sampledEdges: rows.reduce((sum, row) => sum + row.count, 0), edges: rows };
  });
  const sampled = relationships.every(pair => pair.sampledEdges > 0);
  const status = !sampled ? 'unsampled' : result.feasible ? (changes.length ? 'repaired' : 'passing') : result.exhausted ? 'search-limit' : 'unresolved';
  const report = { format: format + '-report', version: 1, status, modes: plan.selectedModes, changes, relationships, weakBefore, weakAfter,
    thresholds: { minDistance: plan.minDistance, minLightness: plan.minLightness, minEdges: plan.minEdges },
    work: { evaluations: result.evaluations, maxEvaluations: plan.maxEvaluations, maxChanges: plan.maxChanges,
      maxShift: plan.maxShift, minimumChanges: sampled && result.provenMinimum ? changes.length : null, exhausted: result.exhausted } };
  return { stack, repaired, report, masks: pairs.map(({ id, mask }) => ({ id, mask })) };
}

module.exports = { repairColorVisionPalette, format, maxPixels };
