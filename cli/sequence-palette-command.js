const fs = require('node:fs');
const path = require('node:path');
const { allocateSequencePalette, format, maxPixels } = require('./sequence-palette.js');
const { render } = require('./render.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const fields = (value, names) => record(value) && Object.keys(value).every(name => names.includes(name));
const imageBytes = frame => PNG.encodeFrame(PNG.packFrame(frame));
const embed = bytes => 'data:image/png;base64,' + bytes.toString('base64');

function manifest(value, directory) {
  if (!fields(value, ['format', 'version', 'title', 'width', 'height', 'budget', 'pins', 'materialWeights', 'previewBudgets', 'shots']) ||
      value.format !== format || value.version !== 1)
    throw new TypeError('Expected a version 1 palette sequence plan');
  const { title = 'Sequence palette', width = 160, height = 96, budget, pins = [], materialWeights,
    previewBudgets = [], shots } = value;
  if (typeof title !== 'string' || !title.trim() || title.length > 120 || !integer(width, 1, 1024) || !integer(height, 1, 1024) ||
      !integer(budget, 1, 48) || !Array.isArray(pins) || pins.length > budget ||
      !Array.isArray(previewBudgets) || previewBudgets.length > 5 ||
      !Array.from(previewBudgets).every(n => integer(n, Math.max(pins.length, 1), 48)) ||
      !Array.isArray(shots) || !integer(shots.length, 1, 24))
    throw new RangeError('Invalid palette sequence title, native dimensions, swatch budget or shot count');
  const budgets = Array.from(new Set([budget, ...previewBudgets])).sort((a, b) => a - b);
  const ids = new Set();
  let count = 0;
  const captures = Array.from(shots, shot => {
    if (!fields(shot, ['id', 'label', 'scene', 'times', 'seed', 'camera', 'weight', 'transparent', 'shotLighting']))
      throw new TypeError('Invalid palette sequence shot');
    const { id, label = id, scene, times = [0], seed, camera = {}, weight = 1, transparent = false, shotLighting } = shot;
    if (typeof id !== 'string' || !/^[a-z\d][a-z\d_-]{0,47}$/i.test(id) || ids.has(id.toLowerCase()) ||
        typeof label !== 'string' || !label.trim() || label.length > 120 || typeof scene !== 'string' || !scene.trim() || scene.length > 1024 ||
        (seed !== undefined && !Number.isSafeInteger(seed)) || !within(weight, .01, 100) || typeof transparent !== 'boolean' ||
        !Array.isArray(times) || !integer(times.length, 1, 32) ||
        !Array.from(times).every((time, i) => within(time, 0, 120) && (!i || time > times[i - 1])) ||
        (shotLighting !== undefined && shotLighting !== false && (typeof shotLighting !== 'string' || !shotLighting.trim())))
      throw new RangeError('Use distinct shot IDs, scene paths and increasing times from 0 to 120 seconds');
    if (!fields(camera, ['target', 'yaw', 'pitch', 'zoom', 'dist', 'ortho']) || Object.entries(camera).some(([key, value]) =>
      key === 'target' ? !Array.isArray(value) || value.length !== 3 || !Array.from(value).every(Number.isFinite) :
        key === 'ortho' ? typeof value !== 'boolean' : !Number.isFinite(value) || (key === 'zoom' || key === 'dist') && value <= 0))
      throw new TypeError('Invalid palette sequence camera for ' + id);
    ids.add(id.toLowerCase());
    count += times.length;
    const source = /\.(?:js|json|obj|gltf|glb)$/i.test(scene) ? path.resolve(directory, scene) : scene;
    return { id, label, source, times, seed, camera, weight, transparent,
      rig: typeof shotLighting === 'string' ? path.resolve(directory, shotLighting) : shotLighting };
  });
  if (count > 96 || count * width * height > maxPixels || count * width * height * budgets.length > maxPixels * 3)
    throw new RangeError('Palette sequence exceeds its capture or review pixel budget');
  return { title, width, height, budget, budgets, pins, materialWeights, captures };
}

function writeReview(directory, settings, shots, results) {
  const { title, budget } = settings;
  const source = shots.map(shot => ({ id: shot.id, label: shot.label,
    frames: shot.frames.map((frame, i) => {
      const bytes = imageBytes(frame), filename = `${shot.id}-${String(i + 1).padStart(2, '0')}-source.png`;
      write(path.join(directory, 'frames', filename), bytes);
      return { time: frame.time, image: embed(bytes), file: 'frames/' + filename };
    }) }));
  const primary = results.find(result => result.budget === budget);
  const variants = results.map(result => ({ budget: result.budget, palette: result.palette, swatches: result.swatches,
    materials: result.materials, summary: result.summary, policy: result.policy,
    shots: result.shots.map(shot => ({ id: shot.id, summary: shot.summary,
      frames: shot.frames.map(({ image, report }, i) => {
        const bytes = imageBytes(image);
        const filename = `${shot.id}-${String(i + 1).padStart(2, '0')}-allocated.png`;
        if (result === primary) write(path.join(directory, 'frames', filename), bytes);
        return { ...report, image: embed(bytes), ...(result === primary && { file: 'frames/' + filename }) };
      }) })) }));
  const primaryVariant = variants.find(row => row.budget === budget);
  const report = { format: 'ink-studio/palette-sequence-report', version: 1, title, budget, palette: primary.palette,
    trainingColors: primary.trainingColors, trainingPoints: primary.trainingPoints, summary: primary.summary,
    swatches: primary.swatches, materials: primary.materials,
    shots: primary.shots.map(({ id, label, weight, summary, frames }, index) => ({ id, label, weight, summary,
      frames: frames.map(({ report }, i) => ({ ...report, source: source[index].frames[i].file,
        allocated: primaryVariant.shots[index].frames[i].file })) })) };
  json(path.join(directory, 'palette.json'), primary.palette);
  json(path.join(directory, 'palette-policy.json'), primary.policy);
  json(path.join(directory, 'report.json'), report);
  const template = fs.readFileSync(path.join(__dirname, 'sequence-palette-review.html'), 'utf8');
  const data = { title, budget, source, variants };
  const html = template.replace('/*SEQUENCE_DATA*/', () => JSON.stringify(data).replaceAll('<', '\\u003c'));
  write(path.join(directory, 'index.html'), html);
  return report;
}

function run(file, directory, { build, pose }) {
  const input = path.resolve(file), settings = manifest(JSON.parse(fs.readFileSync(input, 'utf8')), path.dirname(input));
  const writing = new Set(['index.html', 'report.json', 'palette.json', 'palette-policy.json'].map(name => path.join(directory, name)));
  for (const candidate of [input, ...settings.captures.flatMap(({ source, rig }) => [source, rig])])
    if (writing.has(candidate)) throw new RangeError('Write the palette sequence separately from its inputs');
  const { captures, width, height, budgets, pins, materialWeights } = settings;
  const shots = captures.map(({ id, label, source, seed, times, camera, weight, transparent, rig }) => {
    const world = build(source, seed);
    const shotLighting = typeof rig === 'string' ? JSON.parse(fs.readFileSync(rig, 'utf8')) : rig;
    const frames = times.map(time => {
      pose(world, time);
      const { w, h, rgb, alpha, passes } = render(world, {
        ...camera, t: time, w: width, h: height, px: 1, transparent, shotLighting,
        passes: ['materialId'], renderGraph: false, renderGrid: false, composite: false, inspection: false
      });
      return { w, h, rgb, alpha, time, materialId: passes?.materialId, materials: passes?.materials };
    });
    return { id, label, weight, frames };
  });
  return writeReview(directory, settings, shots, budgets.map(budget => allocateSequencePalette(shots, { budget, pins, materialWeights })));
}

module.exports = { run };
