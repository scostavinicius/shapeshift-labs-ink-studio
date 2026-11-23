const Color = require('../src/color-space.js');
const TargetSelectors = require('../src/target-selectors.js');
const { hex } = require('./look-palette.js');
const { prepareOutputGrade, packedAt, pack, normalized } = require('./output-grade.js');

const format = 'ink-studio/shared-object-grade';
const maxPixels = 262_144;
const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && within(value, min, max);
const bytes = (value, length) => (value instanceof Uint8Array || value instanceof Uint8ClampedArray) && value.length === length;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(name => names.includes(name));
const toLab = color => Color.toOKLab(normalized(color));
const relative = ([L, a, b]) => [a / Math.max(.08, L), b / Math.max(.08, L)];
const difference = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function prepareSelection(subject, width, height) {
  if (!fields(subject, ['select', 'region']) || !fields(subject.select, ['object', 'material']))
    throw new TypeError('A grade sample needs a named object or material selection');
  const select = TargetSelectors.prepare(subject.select);
  const region = subject.region ?? [0, 0, width, height];
  if (!Array.isArray(region) || region.length !== 4 || !Array.from(region).every(Number.isSafeInteger) ||
      region[0] < 0 || region[1] < 0 || region[2] < 1 || region[3] < 1 ||
      region[0] + region[2] > width || region[1] + region[3] > height)
    throw new RangeError('A sample region needs [x, y, width, height] inside its native frame');
  return { select, region };
}

function validateFrame(frame, label) {
  const { w, h, rgb, alpha, passes } = frame ?? {};
  const size = w * h;
  if (!integer(w, 1, 1024) || !integer(h, 1, 1024) || size > maxPixels || !bytes(rgb, size * 3) ||
      (alpha != null && !bytes(alpha, size))) throw new RangeError('Invalid native RGB ' + label + ' frame');
  if (!passes || passes.w !== w || passes.h !== h ||
      ['object', 'material'].some(key => !(passes[key + 'Id'] instanceof Uint32Array) ||
        passes[key + 'Id'].length !== size || !Array.isArray(passes[key + 's'])))
    throw new TypeError('The ' + label + ' frame needs aligned object and material ID passes');
}

function settings(options, source, reference) {
  const { anchors, maxShift = .14, name = 'Shared-object match' } = options;
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || !within(maxShift, .001, .5) ||
      !Array.isArray(anchors) || !integer(anchors.length, 1, 16))
    throw new TypeError('A grade match needs a name, 1 to 16 anchors and a shift limit from .001 to .5');
  const ids = new Set();
  const rows = Array.from(anchors, anchor => {
    if (!fields(anchor, ['id', 'label', 'select', 'source', 'reference', 'approved', 'weight']))
      throw new TypeError('Invalid shared-object grade anchor');
    const { id, label = id, select, approved, weight = 1 } = anchor;
    if (typeof id !== 'string' || !/^[a-z\d][a-z\d_-]{0,47}$/i.test(id) || ids.has(id.toLowerCase()) ||
        typeof label !== 'string' || !label.trim() || label.length > 120 || !within(weight, .01, 100) ||
        (approved !== undefined && (typeof approved !== 'string' || !/^#[\da-f]{6}$/i.test(approved))))
      throw new TypeError('Use distinct anchor IDs, valid labels, positive weights and optional approved hex swatches');
    ids.add(id.toLowerCase());
    return { id, label, approved: approved?.toLowerCase(), weight,
      source: prepareSelection({ select, ...anchor.source }, source.w, source.h),
      reference: prepareSelection({ select, ...anchor.reference }, reference.w, reference.h) };
  });
  return { name, maxShift, rows };
}

function sample(frame, { select, region }, label, lookup) {
  const { w, h, rgb, alpha, passes } = frame, [left, top, width, height] = region;
  const mask = new Uint8Array(w * h), counts = new Map();
  const channels = Object.entries(select).map(([key, name]) => [passes[key + 'Id'], passes[key + 's'].indexOf(name)]);
  let pixels = 0, measured = 0;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
    const p = y * w + x, opacity = (alpha?.[p] ?? 255) / 255;
    if (!opacity || channels.some(([channel, id]) => channel[p] !== id)) continue;
    mask[p] = 1;
    pixels++;
    const color = packedAt(rgb, p * 3), coordinates = lookup(color);
    counts.set(color, (counts.get(color) ?? 0) + opacity);
    if (coordinates[0] >= .08 && coordinates[0] <= .98) measured += opacity;
  }
  if (pixels < 4 || measured < 4) throw new RangeError(label + ' needs at least four visible, non-extreme color pixels');
  const distribution = Array.from(counts, ([color, mass]) => ({ color, mass, lab: lookup(color) })).sort((a, b) => a.lab[0] - b.lab[0] || a.color - b.color);
  const middle = distribution.filter(row => row.lab[0] >= .08 && row.lab[0] <= .98);
  let cumulative = 0;
  // Trim by weighted lightness ranks. Split tied bins so flat objects still train the fit.
  const points = middle.flatMap(row => {
    const start = cumulative;
    cumulative += row.mass;
    const mass = Math.min(cumulative, measured * .8) - Math.max(start, measured * .2);
    return mass > 0 ? [{ ...row, mass }] : [];
  });
  return { pixels, distribution, points, mask };
}

function representative(points, transform, lookup) {
  const uv = [0, 0], rgb = [0, 0, 0];
  let weight = 0;
  for (const { color, mass } of points) {
    const corrected = transform(color), sample = relative(lookup(corrected)), srgb = normalized(corrected);
    for (let c = 0; c < 2; c++) uv[c] += mass * sample[c];
    for (let c = 0; c < 3; c++) rgb[c] += mass * srgb[c];
    weight += mass;
  }
  return { uv: uv.map(value => value / weight), color: hex(pack(rgb.map(value => value / weight))) };
}

function solve(rows, solver) {
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]), vectors = [[0, 0, 0], [0, 0, 0]];
  let total = 0;
  for (const { weight, before, target } of rows) {
    const axis = [1, ...before.uv], delta = target.map((value, c) => value - before.uv[c]);
    total += weight;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[i][j] += weight * axis[i] * axis[j];
      for (let c = 0; c < 2; c++) vectors[c][i] += weight * axis[i] * delta[c];
    }
  }
  matrix[0][0] += total * 1e-6;
  matrix[1][1] += total * .012;
  matrix[2][2] += total * .012;
  return vectors.map(vector => {
    const result = solver(matrix, vector);
    if (!result.converged) throw new Error('Could not solve the shared-object grade');
    return Array.from(result.solution, (value, i) => i ? Math.max(-.35, Math.min(.35, value)) : value);
  });
}

function lighting(distribution, transform, lookup) {
  const ranked = distribution.map(row => ({ mass: row.mass, L: lookup(transform(row.color))[0] })).sort((a, b) => a.L - b.L);
  const mass = ranked.reduce((sum, row) => sum + row.mass, 0);
  const percentile = share => {
    let remaining = mass * share;
    return ranked.find(row => (remaining -= row.mass) <= 0)?.L ?? ranked.at(-1).L;
  };
  const low = percentile(.1), high = percentile(.9);
  return { low, high, range: high - low };
}

function fitSharedObjectGrade(source, reference, options = {}) {
  validateFrame(source, 'source');
  validateFrame(reference, 'reference');
  const { name, maxShift, rows } = settings(options, source, reference), cache = new Map();
  const lookup = color => {
    if (!cache.has(color)) cache.set(color, toLab(color));
    return cache.get(color);
  };
  const identity = color => color;
  const anchors = rows.map(row => {
    const from = sample(source, row.source, row.id + ' in source', lookup);
    const to = sample(reference, row.reference, row.id + ' in reference', lookup);
    const before = representative(from.points, identity, lookup), approved = representative(to.points, identity, lookup);
    const target = row.approved ? relative(lookup(parseInt(row.approved.slice(1), 16))) : approved.uv;
    return { ...row, from, to, before, target, referenceColor: approved.color };
  });
  const kit = options.kit ?? require('../index.js').load();
  const correction = solve(anchors, kit.KIT.world.solvers.dense);
  const score = values => anchors.reduce((sum, row, i) => sum + row.weight * difference(values[i].uv, row.target), 0);
  const beforeScore = score(anchors.map(row => row.before));
  let best;
  for (const strength of [1, .75, .5, .25, 0]) {
    const stack = { name, steps: [{ type: 'oklabChroma', id: 'shared-chroma', maxShift,
      correction: correction.map(row => row.map(value => strength ? value * strength : 0)) }] };
    const grade = prepareOutputGrade(stack);
    const values = anchors.map(row => representative(row.from.points, grade.applyColor, lookup));
    const error = score(values);
    if (!best || error < best.error) best = { stack, grade, values, error, strength };
  }
  const matched = best.grade.apply(source);
  let maxLightnessDrift = 0;
  for (let p = 0, at = 0; at < source.rgb.length; p++, at += 3) {
    if (source.alpha?.[p] === 0) continue;
    maxLightnessDrift = Math.max(maxLightnessDrift, Math.abs(lookup(packedAt(source.rgb, at))[0] - lookup(packedAt(matched.rgb, at))[0]));
  }
  const mass = anchors.reduce((sum, row) => sum + row.weight, 0);
  const report = { format: format + '-report', version: 1, name, maxShift, strength: best.strength, maxLightnessDrift,
    beforeError: Math.sqrt(beforeScore / mass), afterError: Math.sqrt(best.error / mass),
    anchors: anchors.map((row, i) => ({ id: row.id, label: row.label, weight: row.weight, approved: row.approved,
      source: row.source, reference: row.reference, sourcePixels: row.from.pixels, referencePixels: row.to.pixels,
      before: row.before.color, after: best.values[i].color, referenceColor: row.referenceColor,
      beforeError: Math.sqrt(difference(row.before.uv, row.target)), afterError: Math.sqrt(difference(best.values[i].uv, row.target)),
      lighting: { before: lighting(row.from.distribution, identity, lookup),
        after: lighting(row.from.distribution, best.grade.applyColor, lookup), reference: lighting(row.to.distribution, identity, lookup) } })) };
  return { stack: best.stack, matched, report, masks: anchors.map(row => ({ id: row.id, source: row.from.mask, reference: row.to.mask })) };
}

module.exports = { fitSharedObjectGrade, format, maxPixels };
