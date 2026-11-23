const Color = require('../src/color-space.js');
const PixelLook = require('../src/pixel-look.js');
const Palette = require('./look-palette.js');

const format = 'ink-studio/palette-sequence';
const maxPixels = 1_048_576;
const idPattern = /^[a-z\d][a-z\d_-]{0,47}$/i;
const isByte = value => value instanceof Uint8Array || value instanceof Uint8ClampedArray;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const weight = value => Number.isFinite(value) && value >= .01 && value <= 100;
const rgbAt = (rgb, offset) => rgb[offset] * 65536 + rgb[offset + 1] * 256 + rgb[offset + 2];
const lab = packed => Color.toOKLab(Palette.unpack(packed).map(value => value / 255));
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function settings({ budget, pins = [], materialWeights = {} }) {
  if (!integer(budget, 1, 48) || !Array.isArray(pins) || pins.length > budget)
    throw new RangeError('Use a sequence budget of 1 to 48 swatches, including any pins');
  if (!record(materialWeights) || Object.keys(materialWeights).length > 256 || Object.values(materialWeights).some(value => !weight(value)))
    throw new TypeError('Use named material weights from .01 to 100');
  const locked = new Set();
  const reserved = Array.from(pins, pin => {
    const { color, label, match = false } = typeof pin === 'string' ? { color: pin } : pin ?? {};
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color) || typeof match !== 'boolean' ||
        (label !== undefined && (typeof label !== 'string' || !label.trim() || label.length > 80)))
      throw new TypeError('A pin needs a hex color, optional label and optional match boolean');
    const packed = parseInt(color.slice(1), 16);
    if (locked.has(packed)) throw new RangeError('Each pinned color needs its own slot');
    locked.add(packed);
    return { color: Palette.hex(packed), packed, label, match };
  });
  if (reserved.length === budget && !reserved.some(pin => pin.match))
    throw new RangeError('Leave a slot free or enable matching on at least one pinned swatch');
  return { budget, reserved, locked, materialWeights };
}

function framesOf(shots) {
  if (!Array.isArray(shots) || !integer(shots.length, 1, 24)) throw new RangeError('A shared palette requires 1 to 24 shots');
  const ids = new Set();
  let count = 0, pixels = 0;
  return Array.from(shots, shot => {
    const { id, label = id, weight: importance = 1, frames } = shot ?? {};
    if (typeof id !== 'string' || !idPattern.test(id) || ids.has(id.toLowerCase()) ||
        typeof label !== 'string' || !label.trim() || label.length > 120 || !weight(importance) ||
        !Array.isArray(frames) || !integer(frames.length, 1, 32) || (count += frames.length) > 96)
      throw new TypeError('Use unique shot IDs, valid labels and weights, and 1 to 96 frames across the sequence');
    ids.add(id.toLowerCase());
    const samples = Array.from(frames, frame => {
      const { w, h, rgb, alpha, materialId, materials, time = 0 } = frame ?? {};
      const area = w * h;
      if (!integer(w, 1, 1024) || !integer(h, 1, 1024) || !isByte(rgb) || rgb.length !== area * 3 ||
          (alpha !== undefined && (!isByte(alpha) || alpha.length !== area)) ||
          (materialId !== undefined && (!(materialId instanceof Uint32Array) || materialId.length !== area || !Array.isArray(materials))) ||
          !Number.isFinite(time) || time < 0 || (pixels += area) > maxPixels)
        throw new RangeError('Expected native RGB frames with aligned alpha and material IDs within the sequence pixel budget');
      const visible = alpha ? alpha.reduce((total, value) => total + value / 255, 0) : area;
      if (!visible) throw new RangeError('A sequence sample needs visible pixels in ' + id);
      return { w, h, rgb, alpha, materialId, materials, time, visible };
    });
    return { id, label, importance, frames: samples };
  });
}

function materialAt(frame, p) {
  return frame.materials?.[frame.materialId?.[p]] ?? null;
}

function histogram(shots, { locked, materialWeights }) {
  const colors = new Map();
  for (const shot of shots) for (const frame of shot.frames) {
    const unit = shot.importance / (shot.frames.length * frame.visible);
    for (let p = 0; p < frame.w * frame.h; p++) {
      const alpha = frame.alpha?.[p] ?? 255;
      if (!alpha) continue;
      const color = rgbAt(frame.rgb, p * 3);
      if (locked.has(color)) continue;
      const material = materialAt(frame, p);
      const emphasis = material !== null && Object.hasOwn(materialWeights, material) ? materialWeights[material] : 1;
      colors.set(color, (colors.get(color) ?? 0) + alpha / 255 * unit * emphasis);
    }
  }
  return colors;
}

function pointsFrom(colors) {
  const byColor = (a, b) => a.color - b.color;
  if (colors.size <= 8192) return Array.from(colors, ([color, mass]) => ({ color, mass, lab: lab(color) })).sort(byColor);
  const bins = new Map();
  for (const [packed, mass] of colors) {
    const color = packed & 0xf0f0f0;
    if (!bins.has(color)) bins.set(color, { color, mass: 0, lab: [0, 0, 0] });
    const bin = bins.get(color), coordinates = lab(packed);
    bin.mass += mass;
    for (let c = 0; c < 3; c++) bin.lab[c] += coordinates[c] * mass;
  }
  return Array.from(bins.values(), bin => ({ ...bin, lab: bin.lab.map(value => value / bin.mass) })).sort(byColor);
}

function allocate(points, { reserved, locked, budget }) {
  const fixed = reserved.filter(pin => pin.match).map(pin => lab(pin.packed));
  const centers = fixed.slice(), free = Math.min(budget - reserved.length, points.length);
  const errors = new Float64Array(points.length).fill(Infinity);
  function reduceErrors(center) {
    for (let i = 0; i < points.length; i++) errors[i] = Math.min(errors[i], distance(points[i].lab, center));
  }
  fixed.forEach(reduceErrors);
  for (let k = 0; k < free; k++) {
    let best = 0, score = -1;
    for (let i = 0; i < points.length; i++) {
      const value = points[i].mass * (centers.length ? errors[i] : 1);
      if (value > score) { best = i; score = value; }
    }
    if (score <= 0) break;
    centers.push(points[best].lab);
    reduceErrors(points[best].lab);
  }
  for (let iteration = 0; iteration < 12; iteration++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const point of points) {
      let best = 0, error = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const next = distance(point.lab, centers[i]);
        if (next < error) { best = i; error = next; }
      }
      if (best < fixed.length) continue;
      const target = sums[best];
      for (let c = 0; c < 3; c++) target[c] += point.lab[c] * point.mass;
      target[3] += point.mass;
    }
    let moved = false;
    for (let i = fixed.length; i < centers.length; i++) {
      const [l, a, b, mass] = sums[i];
      if (!mass) continue;
      const next = [l / mass, a / mass, b / mass];
      moved ||= distance(centers[i], next) > 1e-12;
      centers[i] = next;
    }
    if (!moved) break;
  }
  const colors = new Set(centers.slice(fixed.length).map(center => Palette.round(Color.fromOKLab(center)).color));
  for (const pin of locked) colors.delete(pin);
  for (const point of points) {
    if (colors.size >= free) break;
    const color = Palette.round(Color.fromOKLab(point.lab)).color;
    if (!locked.has(color)) colors.add(color);
  }
  return Array.from(colors).sort((a, b) => a - b);
}

function tally() {
  return { pixels: 0, mass: 0, error: 0, source: new Set(), slots: new Map() };
}

function add(row, color, slot, mass, error) {
  row.pixels++;
  row.mass += mass;
  row.error += mass * error;
  row.source.add(color);
  row.slots.set(slot, (row.slots.get(slot) ?? 0) + mass);
}

function summary(row, whole) {
  return { pixels: row.pixels, share: row.mass / whole, sourceSwatches: row.source.size, usedSwatches: row.slots.size,
    rmsError: Math.sqrt(row.error / row.mass), slots: Array.from(row.slots.keys()).sort((a, b) => a - b) };
}

function matcher(policy) {
  const prepared = PixelLook.preparePalette(policy), known = new Map();
  const colors = prepared.packed.map(Palette.unpack);
  function index(color) {
    if (!known.has(color)) {
      if (known.size >= 65_536) known.clear();
      known.set(color, prepared.index(Palette.unpack(color).map(value => value / 255), 0, 0, false));
    }
    return known.get(color);
  }
  return { packed: prepared.packed, colors, index };
}

function prepareOutputPalette(policy) {
  const { packed, colors, index } = matcher(policy);
  return image => {
    const rgb = new Uint8Array(image.rgb.length), use = new Uint32Array(packed.length);
    for (let p = 0, offset = 0; offset < rgb.length; p++, offset += 3) {
      if (image.alpha?.[p] === 0) continue;
      const slot = index(rgbAt(image.rgb, offset));
      rgb.set(colors[slot], offset);
      use[slot]++;
    }
    return { ...image, rgb, use, palette: packed };
  };
}

function resolve(shots, policy, reserved) {
  const { packed, colors, index } = matcher(policy);
  const palette = packed.map(Palette.hex), labs = packed.map(lab);
  const known = new Map(), total = tally(), materials = new Map();
  const rendered = shots.map(shot => {
    const aggregate = tally();
    const frames = shot.frames.map(frame => {
      const { w, h, time, alpha } = frame, stats = tally(), owners = new Map();
      const rgb = new Uint8Array(frame.rgb.length);
      for (let p = 0; p < w * h; p++) {
        const mass = (alpha?.[p] ?? 255) / 255;
        if (!mass) continue;
        const offset = p * 3, color = rgbAt(frame.rgb, offset);
        if (!known.has(color)) {
          const slot = index(color);
          known.set(color, { slot, error: distance(lab(color), labs[slot]) });
        }
        const { slot, error } = known.get(color), material = materialAt(frame, p);
        rgb.set(colors[slot], offset);
        if (!owners.has(material)) owners.set(material, tally());
        if (!materials.has(material)) materials.set(material, tally());
        for (const row of [stats, aggregate, total, owners.get(material), materials.get(material)]) add(row, color, slot, mass, error);
      }
      const visibility = Array.from(owners, ([name, row]) => ({ name, ...summary(row, stats.mass) }));
      visibility.sort((a, b) => b.share - a.share);
      return { image: { w, h, rgb, alpha }, report: { time, width: w, height: h, ...summary(stats, stats.mass), materials: visibility } };
    });
    return { id: shot.id, label: shot.label, weight: shot.importance, frames, summary: summary(aggregate, aggregate.mass) };
  });
  const owners = palette.map(() => []), sourceOwners = new Map();
  for (const [name, row] of materials) {
    for (const slot of row.slots.keys()) owners[slot].push(name);
    for (const color of row.source) sourceOwners.set(color, (sourceOwners.get(color) ?? 0) + 1);
  }
  const materialReports = Array.from(materials, ([name, row]) => ({ name, ...summary(row, total.mass),
    sourceExclusiveSwatches: Array.from(row.source).filter(color => sourceOwners.get(color) === 1).length,
    exclusiveSwatches: Array.from(row.slots.keys()).filter(slot => owners[slot].length === 1).length }));
  materialReports.sort((a, b) => b.share - a.share);
  const swatches = palette.map((color, slot) => {
    const pin = reserved.find(entry => entry.color === color);
    return { color, pinned: Boolean(pin), ...(pin?.label && { label: pin.label }),
      share: (total.slots.get(slot) ?? 0) / total.mass, materials: owners[slot] };
  });
  return { palette, swatches, shots: rendered, summary: summary(total, total.mass), materials: materialReports };
}

function allocateSequencePalette(shots, options = {}) {
  const plan = settings(options), samples = framesOf(shots);
  const colors = histogram(samples, plan), points = pointsFrom(colors);
  const allocated = allocate(points, plan).map(Palette.hex);
  // All pixels can already be pinned. Keep the spare match slot usable on other frames.
  if (!allocated.length && !plan.reserved.some(pin => pin.match)) {
    let fallback = 0;
    while (plan.locked.has(fallback)) fallback++;
    allocated.push(Palette.hex(fallback));
  }
  const policy = { palette: allocated, reserved: plan.reserved.map(({ color, match }) => ({ color, match })), match: 'perceptual' };
  const result = resolve(samples, policy, plan.reserved);
  return { ...result, policy, budget: plan.budget, trainingColors: colors.size, trainingPoints: points.length };
}

module.exports = { allocateSequencePalette, prepareOutputPalette, format, maxPixels };
