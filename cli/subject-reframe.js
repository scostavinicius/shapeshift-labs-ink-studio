// Fit one constant-scale, pixel-aligned pan per delivery format.
const { measureScreenSubjects } = require('./screen-subjects.js');
const format = 'ink-studio/subject-reframe';
const maxPixels = 262144;
const maxFrames = 240;
const maxOutputPixels = 2048 * 2048;
const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && within(value, min, max);
const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => keys.includes(key));
const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rect = (value, min, max) => Array.isArray(value) && value.length === 4 &&
  Array.from(value).every(n => within(n, min, max));
const epsilon = 1e-8;

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function normalize(options) {
  const { width, height, from = 0, fps = 24, frames, subjects, formats, smoothing = 8 } = options;
  if (!integer(width, 1, 2048) || !integer(height, 1, 2048) || width * height > maxPixels ||
      !integer(frames, 2, maxFrames) || !within(from, 0, 120) || !integer(fps, 1, 120) ||
      from + (frames - 1) / fps > 120 || !within(smoothing, 0, 64))
    throw new RangeError('Reframing needs a native art grid, 2–240 samples, a whole-number fps and smoothing between 0 and 64');
  if (!Array.isArray(subjects) || !integer(subjects.length, 1, 8))
    throw new TypeError('Reframing needs one to eight named subjects');
  const targets = Array.from(subjects, subject => {
    if (!fields(subject, ['id', 'label', 'select', 'weight']) || !validId(subject.id))
      throw new TypeError('Each reframe subject needs a lowercase ID and selector');
    const { id, label: name = id, select, weight = 1 } = subject;
    if (!label(name) || !fields(select, ['object', 'material']) || !Object.keys(select).length ||
        Object.values(select).some(value => !label(value) && !Number.isSafeInteger(value)) || !within(weight, .1, 10))
      throw new TypeError('Select subjects by named object, material or both, with optional weight between .1 and 10');
    return { id, label: name, select: { ...select }, weight };
  });
  if (!Array.isArray(formats) || !integer(formats.length, 1, 6))
    throw new TypeError('Reframing needs one to six output formats');
  const deliveries = Array.from(formats, delivery => {
    if (!fields(delivery, ['id', 'label', 'width', 'height', 'safeArea', 'scale']) || !validId(delivery.id))
      throw new TypeError('Each delivery format needs a lowercase ID and dimensions');
    const { id, label: name = id, width: w, height: h, scale = 1, safeArea = [.05, .05, .95, .95] } = delivery;
    if (!label(name) || !integer(w, 1, 2048) || !integer(h, 1, 2048) || w * h > maxOutputPixels ||
        !within(scale, .1, 1) || !rect(safeArea, 0, 1) || safeArea[0] >= safeArea[2] || safeArea[1] >= safeArea[3])
      throw new RangeError('Delivery formats need a native art grid, valid normalized safe area and scale between .1 and 1');
    const divisor = gcd(w, h);
    if (w / divisor > width || h / divisor > height)
      throw new RangeError('The native art grid is too small for an exact ' + id + ' crop');
    return { id, label: name, width: w, height: h, scale, safeArea: safeArea.slice() };
  });
  for (const rows of [targets, deliveries])
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new TypeError('Reframe IDs must be unique within each list');
  return { width, height, from, fps, frames, smoothing, subjects: targets, formats: deliveries };
}

function intervals(samples, [w, h], [cw, ch], [l, t, r, b]) {
  const maxX = w - cw, maxY = h - ch;
  return samples.map(({ targets }) => {
    let x0 = 0, x1 = maxX, y0 = 0, y1 = maxY;
    for (const { box } of targets) {
      if (!box) continue;
      x0 = Math.max(x0, Math.ceil(box[2] - r * cw - epsilon));
      x1 = Math.min(x1, Math.floor(box[0] - l * cw + epsilon));
      y0 = Math.max(y0, Math.ceil(box[3] - b * ch - epsilon));
      y1 = Math.min(y1, Math.floor(box[1] - t * ch + epsilon));
    }
    return [[x0, x1], [y0, y1]];
  });
}

function bridge(values, fallback) {
  let previous = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    for (let j = previous + 1; j < i; j++)
      values[j] = previous < 0 ? values[i] : values[previous] + (values[i] - values[previous]) * (j - previous) / (i - previous);
    previous = i;
  }
  for (let i = previous + 1; i < values.length; i++) values[i] = previous < 0 ? fallback : values[previous];
  return values;
}

function smooth(desired, limits, max, strength) {
  const spans = limits.map(([low, high]) => {
    if (low <= high) return [low, high];
    const compromise = clamp(Math.round((low + high) / 2), 0, max);
    return [compromise, compromise];
  });
  const path = desired.map((value, i) => clamp(value, ...spans[i]));
  // Projected coordinate descent smooths the pan without ever relaxing a feasible safe area.
  for (let pass = 0; pass < 96 && strength; pass++) {
    let shift = 0;
    for (let step = 0; step < path.length; step++) {
      const i = pass % 2 ? path.length - 1 - step : step;
      const left = path[i - 1], right = path[i + 1];
      const count = Number(left !== undefined) + Number(right !== undefined);
      const next = clamp((desired[i] + strength * ((left ?? 0) + (right ?? 0))) / (1 + strength * count), ...spans[i]);
      shift = Math.max(shift, Math.abs(next - path[i]));
      path[i] = next;
    }
    if (shift < .0001) break;
  }
  return path.map(Math.round);
}

function clearance(box, [x, y, w, h], [l, t, r, b]) {
  return Math.min(box[0] - x - l * w, box[1] - y - t * h, x + r * w - box[2], y + b * h - box[3]);
}

function solve(delivery, source, samples, subjects, smoothing) {
  const { width, height, scale, safeArea } = delivery;
  const unit = gcd(width, height), rw = width / unit, rh = height / unit;
  const largest = Math.floor(Math.min(source[0] / rw, source[1] / rh));
  const preferred = Math.max(1, Math.round(scale * largest));
  const sizes = Array.from({ length: largest }, (_, i) => i + 1)
    .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || b - a);
  let cropWidth, cropHeight, limits, bestCount = -1;
  for (const size of sizes) {
    const candidate = intervals(samples, source, [size * rw, size * rh], safeArea);
    const count = candidate.filter(axes => axes.every(([low, high]) => low <= high)).length;
    if (count <= bestCount) continue;
    cropWidth = size * rw;
    cropHeight = size * rh;
    limits = candidate;
    bestCount = count;
    if (count === samples.length) break;
  }
  const max = [source[0] - cropWidth, source[1] - cropHeight];
  const centerCrop = [...max.map(n => Math.round(n / 2)), cropWidth, cropHeight];
  const offsets = [cropWidth, cropHeight].map((length, axis) => {
    const desired = samples.map(({ targets }) => {
      let weighted = 0, total = 0;
      for (let i = 0; i < targets.length; i++) {
        const { box } = targets[i], { weight } = subjects[i];
        if (!box) continue;
        weighted += (box[axis] + box[axis + 2]) / 2 * weight;
        total += weight;
      }
      const safeCenter = (safeArea[axis] + safeArea[axis + 2]) / 2;
      return total ? weighted / total - safeCenter * length : null;
    });
    return smooth(bridge(desired, max[axis] / 2), limits.map(axes => axes[axis]), max[axis], smoothing);
  });
  const keyframes = samples.map(({ time, targets }, i) => {
    const crop = [offsets[0][i], offsets[1][i], cropWidth, cropHeight];
    const missing = [], sourceEdge = [], outside = [], centerOutside = [];
    let minimum = Infinity;
    for (const { id, box, sourceEdge: clipped } of targets) {
      if (!box) {
        missing.push(id);
        continue;
      }
      if (clipped) sourceEdge.push(id);
      const gap = clearance(box, crop, safeArea);
      if (gap < -epsilon) outside.push(id);
      if (clearance(box, centerCrop, safeArea) < -epsilon) centerOutside.push(id);
      minimum = Math.min(minimum, gap);
    }
    return { time, crop, minimumClearance: Number.isFinite(minimum) ? Math.round(minimum * 100) / 100 : null,
      missing, sourceEdge, outside, centerOutside };
  });
  return {
    ...delivery, centerCrop, keyframes,
    safeFrames: keyframes.filter(frame => !frame.missing.length && !frame.sourceEdge.length && !frame.outside.length).length,
    centerSafeFrames: keyframes.filter(frame => !frame.missing.length && !frame.sourceEdge.length && !frame.centerOutside.length).length
  };
}

function planSubjectReframe(frames, options) {
  if (!Array.isArray(frames)) throw new TypeError('Expected an array of native frames with ownership passes');
  const plan = normalize({ ...options, frames: frames.length });
  const { width, height, from, fps, subjects, formats, smoothing } = plan;
  const samples = Array.from(frames, (frame, i) => ({ time: from + i / fps, targets: measureScreenSubjects(frame, subjects, width, height) }));
  return {
    format, version: 1, source: { width, height, from, fps, frames: frames.length }, smoothing, subjects, samples,
    formats: formats.map(delivery => solve(delivery, [width, height], samples, subjects, smoothing))
  };
}

// Crop geometry interpolates continuously, with pixel snapping only when writing a raster.
function sampleReframe(delivery, time) {
  const { keyframes } = delivery;
  if (!Array.isArray(keyframes) || !keyframes.length || !Number.isFinite(time))
    throw new TypeError('A solved delivery format and finite sample time are required');
  let lo = 0, hi = keyframes.length - 1;
  if (time <= keyframes[lo].time) return keyframes[lo].crop.slice();
  if (time >= keyframes[hi].time) return keyframes[hi].crop.slice();
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = keyframes[lo], b = keyframes[hi], mix = (time - a.time) / (b.time - a.time);
  return a.crop.map((n, i) => n + (b.crop[i] - n) * mix);
}

function reframeRaster(image, delivery, time) {
  const [x, y, w, h] = sampleReframe(delivery, time).map(Math.round);
  const { width, height } = delivery;
  if (!integer(width, 1, 2048) || !integer(height, 1, 2048) || width * height > maxOutputPixels ||
      !integer(w, 1, image.w) || !integer(h, 1, image.h) || w * height !== h * width ||
      !integer(x, 0, image.w - w) || !integer(y, 0, image.h - h) || image.rgb?.length !== image.w * image.h * 3 ||
      image.alpha && image.alpha.length !== image.w * image.h)
    throw new RangeError('Reframing needs a valid source raster and an in-bounds, aspect-matched crop');
  const rgb = new Uint8Array(w * h * 3), alpha = image.alpha && new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const start = (y + row) * image.w + x;
    rgb.set(image.rgb.subarray(start * 3, (start + w) * 3), row * w * 3);
    if (alpha) alpha.set(image.alpha.subarray(start, start + w), row * w);
  }
  return require('./render.js').resize({ w, h, rgb, ...(alpha && { alpha }) }, width, height);
}

module.exports = { format, fields, label, normalize, planSubjectReframe, sampleReframe, reframeRaster };
