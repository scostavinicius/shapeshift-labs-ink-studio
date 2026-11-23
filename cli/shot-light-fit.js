const { createHash } = require('node:crypto');
const { render } = require('./render.js');
const { prepareLightSearch } = require('./shot-light-search.js');
const { toOKLab } = require('../src/color-space.js');

const format = 'ink-studio/shot-light-targets';
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);

function validateFrame({ grid, time }) {
  if (!Array.isArray(grid) || grid.length !== 2 || !Array.from(grid).every(n => integer(n, 1, 512)) ||
      grid[0] * grid[1] > 65_536 || !Number.isFinite(time) || time < 0)
    throw new RangeError('Painted lighting needs a finite nonnegative time and a native art grid of up to 65,536 pixels');
}

function frameOptions(frame, view) {
  validateFrame(frame);
  const [w, h] = frame.grid;
  return { ...view, w, h, px: 1, width: w, height: h, time: undefined, t: frame.time, raw: true, transparent: false,
    renderGraph: false, composite: false, renderGrid: false, inspection: false, shutter: false, afterimages: false,
    passes: false, objectMattes: false, cameraGuides: false, samples: false,
    artHistory: undefined, renderHistory: undefined, volumeHistory: undefined, afterimageHistory: undefined,
    transparencyHistory: undefined, motionalCoverageHistory: undefined, partMotionHistory: undefined,
    colorClusterHistory: undefined, strandMotionHistory: undefined, lookInputSession: undefined };
}

function draw(world, options, shotLighting) {
  const image = render(world, { ...options, shotLighting });
  if (image.w !== options.w || image.h !== options.h || image.rgb?.length !== image.w * image.h * 3)
    throw new Error('The scene did not render at the painted art grid');
  return image;
}

function signature(image) {
  return createHash('sha256').update(image.rgb).digest('hex');
}

function capture(world, { frame, view = {}, rig = view.shotLighting } = {}) {
  const image = draw(world, frameOptions(frame, view), rig);
  return { image, plan: { format, version: 1, grid: frame.grid.slice(), time: frame.time,
    sourceSha256: signature(image), regions: [] } };
}

function pixelsFor(plan) {
  if (plan?.format !== format || plan.version !== 1) throw new TypeError('Expected version 1 painted light targets');
  validateFrame(plan);
  const [w, h] = plan.grid;
  if (plan.sourceSha256 !== undefined && !/^[a-f0-9]{64}$/.test(plan.sourceSha256))
    throw new TypeError('Invalid painted frame SHA-256');
  if (plan.aim !== undefined && !vector(plan.aim)) throw new TypeError('The key pivot needs a finite XYZ point');
  if (!Array.isArray(plan.regions) || !integer(plan.regions.length, 1, 12))
    throw new RangeError('Paint one to twelve lighting regions');
  const taken = new Uint8Array(w * h), ids = new Set();
  return Array.from(plan.regions, region => {
    const { id, color, spans, weight = 1 } = region ?? {};
    if (typeof id !== 'string' || !idPattern.test(id) || ids.has(id) ||
        typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color) ||
        !Array.isArray(spans) || !integer(spans.length, 1, w * h) ||
        !Number.isFinite(weight) || weight < .01 || weight > 100)
      throw new TypeError('Each lighting region needs a unique ID, hex color, painted spans and weight from .01 to 100');
    ids.add(id);
    const pixels = [];
    for (const span of spans) {
      if (!Array.isArray(span) || span.length !== 3) throw new TypeError('Painted spans need [y, x, length]');
      const [y, x, length] = span;
      if (!integer(y, 0, h - 1) || !integer(x, 0, w - 1) || !integer(length, 1, w - x))
        throw new RangeError('Painted span outside the art grid in ' + id);
      for (let p = y * w + x, end = p + length; p < end; p++) {
        if (taken[p]) throw new RangeError('Painted regions overlap at pixel ' + (p % w) + ', ' + Math.floor(p / w));
        taken[p] = 1;
        pixels.push(p * 3);
      }
    }
    const rgb = color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
    return { id, color, target: toOKLab(rgb), weight, pixels };
  });
}

function measure(image, regions) {
  return Object.fromEntries(regions.map(({ id, pixels }) => {
    const channels = [0, 0, 0];
    for (const i of pixels) for (let c = 0; c < 3; c++) channels[c] += image.rgb[i + c];
    return [id, channels.map(total => total / (255 * pixels.length))];
  }));
}

function fitShotLighting(world, { plan, view = {}, rig = view.shotLighting, evaluations = 64,
  kit = require('../index.js').load(), tolerance = .012, onCandidate } = {}) {
  const options = frameOptions(plan ?? {}, view), regions = pixelsFor(plan);
  if (!integer(evaluations, 1, 256) || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > .2)
    throw new RangeError('Lighting fit needs 1–256 evaluations and an OKLab tolerance from 0 to .2');
  const { initial, parameters, candidate } = prepareLightSearch(world, { rig, view, pivot: plan.aim });
  const exposureEV = parameters.exposure.initial, initialFill = parameters.fillIntensity.initial;

  const before = draw(world, options, initial);
  if (plan.sourceSha256 && signature(before) !== plan.sourceSha256)
    throw new Error('The painted frame does not match this render. Use the original scene, view options and starting rig.');
  const beforeRGB = measure(before, regions);
  const weights = regions.reduce((sum, region) => sum + region.weight, 0);
  const lightnessOffsets = regions.map(region => {
    const beforeLightness = toOKLab(beforeRGB[region.id])[0];
    return 3 * Math.log2((region.target[0] + .002) / (beforeLightness + .002));
  }).sort((a, b) => a - b);
  const exposure = Math.max(parameters.exposure.min, Math.min(parameters.exposure.max,
    exposureEV + lightnessOffsets[Math.floor(lightnessOffsets.length / 2)]));
  const raisedFill = Math.min(parameters.fillIntensity.max, initialFill * 2 + 1);
  const starts = [{ exposure }, ...[-38, 38].map(yaw => ({ yaw, exposure })),
    ...[-38, 0, 38].map(yaw => ({ yaw, exposure, ...(parameters.size && { size: Math.min(parameters.size.max, 1.6) }), fillIntensity: raisedFill }))];
  const inverse = kit.KIT.world.inverseTargets;
  const fit = inverse.fit({ format: inverse.planFormat, version: 1, id: 'painted-lighting', parameters, starts,
    targets: Object.fromEntries(regions.map(region => [region.id,
      { value: region.target, tolerance, weight: region.weight * regions.length / weights }])),
    settings: { maxEvaluations: evaluations, initialRadius: .25, differenceStep: .035, parameterTolerance: .004,
      goal: 'minimize', history: 'errors' }
  }, values => {
    const original = Object.keys(values).every(name => Math.abs(values[name] - parameters[name].initial) < 1e-12);
    const rig = candidate(values), image = original ? before : draw(world, options, rig);
    onCandidate?.(rig, image);
    const rgb = original ? beforeRGB : measure(image, regions);
    return Object.fromEntries(Object.entries(rgb).map(([id, value]) => [id, toOKLab(value)]));
  });
  const solved = candidate(fit.parameters), after = draw(world, options, solved), afterRGB = measure(after, regions);
  const hex = rgb => '#' + rgb.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
  const error = (rgb, target) => Math.hypot(...toOKLab(rgb).map((value, i) => value - target[i]));
  const report = { format: 'ink-studio/shot-light-fit', version: 1, grid: plan.grid, time: plan.time,
    status: fit.status, metTolerance: fit.converged, tolerance, work: fit.work, bounds: fit.bounds, parameters: fit.parameters,
    sourceSha256: signature(before), fittedSha256: signature(after),
    regions: regions.map(({ id, color, target, pixels, weight }) => ({ id, color, weight, pixels: pixels.length,
      before: hex(beforeRGB[id]), after: hex(afterRGB[id]), beforeError: error(beforeRGB[id], target), afterError: error(afterRGB[id], target) })),
    candidates: fit.history };
  return { rig: solved, before, after, report };
}

module.exports = { capture, fitShotLighting };
