const fs = require('node:fs');
const path = require('node:path');
const Color = require('../src/color-space.js');
const { fitSharedObjectGrade, format, maxPixels } = require('./shared-object-grade.js');
const { packedAt, normalized } = require('./output-grade.js');
const { render } = require('./render.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(name => names.includes(name));
const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && within(value, min, max);
const filename = value => typeof value === 'string' && value.trim() && value.length <= 1024;
const imageBytes = image => PNG.encodeFrame(PNG.packFrame(image));
const embed = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function compileShot(shot, directory, label) {
  if (!fields(shot, ['scene', 'time', 'seed', 'camera', 'shotLighting', 'colorStack', 'raw', 'transparent']) || !filename(shot.scene))
    throw new TypeError('The ' + label + ' shot needs a scene');
  const { scene, time = 0, seed, camera = {}, shotLighting, colorStack, raw = false, transparent = false } = shot;
  if (!within(time, 0, 120) || (seed !== undefined && !Number.isSafeInteger(seed)) || typeof raw !== 'boolean' || typeof transparent !== 'boolean' ||
      [shotLighting, colorStack].some(value => value !== undefined && value !== false && !filename(value)))
    throw new TypeError('Invalid time, seed, lighting or color stack in ' + label);
  if (!fields(camera, ['target', 'yaw', 'pitch', 'zoom', 'dist', 'ortho']) || Object.entries(camera).some(([key, value]) =>
    key === 'target' ? !Array.isArray(value) || value.length !== 3 || !Array.from(value).every(Number.isFinite) :
      key === 'ortho' ? typeof value !== 'boolean' : !Number.isFinite(value) || (key === 'zoom' || key === 'dist') && value <= 0))
    throw new TypeError('Invalid camera in ' + label);
  return { scene: /\.(?:js|json|obj|gltf|glb)$/i.test(scene) ? path.resolve(directory, scene) : scene, time, seed,
    shotLighting: typeof shotLighting === 'string' ? path.resolve(directory, shotLighting) : shotLighting,
    colorStack: typeof colorStack === 'string' ? path.resolve(directory, colorStack) : colorStack, raw, transparent, camera };
}

function capture(shot, width, height, { build, pose }) {
  const world = build(shot.scene, shot.seed);
  pose(world, shot.time);
  return render(world, { ...shot.camera, t: shot.time, w: width, h: height, px: 1, raw: shot.raw, transparent: shot.transparent,
    shotLighting: typeof shot.shotLighting === 'string' ? read(shot.shotLighting) : shot.shotLighting,
    colorStack: typeof shot.colorStack === 'string' ? require('./color-stack.js').override(shot.colorStack) : shot.colorStack,
    passes: ['objectId', 'materialId'], composite: false, renderGraph: false, renderGrid: false, inspection: false, shutter: false });
}

function lightness(image) {
  const rgb = new Uint8Array(image.rgb.length), cache = new Map();
  for (let at = 0; at < rgb.length; at += 3) {
    const packed = packedAt(image.rgb, at);
    if (!cache.has(packed)) {
      const [L] = Color.toOKLab(normalized(packed));
      cache.set(packed, Math.round(Color.fromOKLab([L, 0, 0])[0] * 255));
    }
    rgb.fill(cache.get(packed), at, at + 3);
  }
  return { ...image, rgb };
}

function outline(frame, mask) {
  const { w, h } = frame, rgba = new Uint8Array(mask.length * 4);
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const x = p % w, y = Math.floor(p / w);
    if (!x || x === w - 1 || !y || y === h - 1 || !mask[p - 1] || !mask[p + 1] || !mask[p - w] || !mask[p + w])
      rgba.set([173, 255, 227, 230], p * 4);
  }
  return embed(PNG.encode(w, h, rgba, 4));
}

function run(file, directory, hooks) {
  const input = path.resolve(file), root = path.dirname(input), plan = read(input);
  if (!fields(plan, ['format', 'version', 'name', 'width', 'height', 'source', 'reference', 'anchors', 'maxShift']) ||
      plan.format !== format || plan.version !== 1) throw new TypeError('Expected a version 1 shared-object grade plan');
  const { width = 160, height = 112, name, maxShift, anchors } = plan;
  if (!integer(width, 1, 1024) || !integer(height, 1, 1024) || width * height > maxPixels)
    throw new RangeError('Shared-object grading needs a native grid of up to 262,144 pixels');
  const sourceShot = compileShot(plan.source, root, 'source'), referenceShot = compileShot(plan.reference, root, 'reference');
  const writing = new Set(['grade.json', 'report.json', 'source.png', 'reference.png', 'matched.png', 'index.html'].map(name => path.join(directory, name)));
  for (const name of [input, ...[sourceShot, referenceShot].flatMap(shot => [shot.scene, shot.shotLighting, shot.colorStack])])
    if (writing.has(name)) throw new RangeError('Write the grade match separately from its inputs');
  const source = capture(sourceShot, width, height, hooks), reference = capture(referenceShot, width, height, hooks);
  const { stack, matched, report, masks } = fitSharedObjectGrade(source, reference, { anchors, maxShift, name, kit: hooks.kit });
  const pictures = {};
  for (const [id, image] of Object.entries({ source, matched, reference })) {
    const bytes = imageBytes(image);
    write(path.join(directory, id + '.png'), bytes);
    pictures[id] = { image: embed(bytes), lightness: embed(imageBytes(lightness(image))) };
  }
  json(path.join(directory, 'grade.json'), stack);
  json(path.join(directory, 'report.json'), { ...report, width, height, sourceTime: sourceShot.time, referenceTime: referenceShot.time });
  const html = fs.readFileSync(path.join(__dirname, 'shared-object-grade-review.html'), 'utf8');
  const data = { stack, pictures, report, masks: masks.map(mask => ({ id: mask.id,
    source: outline(source, mask.source), reference: outline(reference, mask.reference) })) };
  write(path.join(directory, 'index.html'), html.replace('/*GRADE_DATA*/', () => JSON.stringify(data).replaceAll('<', '\\u003c')));
  return report;
}

module.exports = { run };
