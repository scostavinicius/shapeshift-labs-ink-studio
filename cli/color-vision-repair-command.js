const fs = require('node:fs');
const path = require('node:path');
const { repairColorVisionPalette, format, maxPixels } = require('./color-vision-repair.js');
const { simulateFrame } = require('./color-vision.js');
const { render } = require('./render.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const embed = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const imageBytes = image => PNG.encodeFrame(PNG.packFrame(image));
const encode = image => embed(imageBytes(image));

function run(file, directory, { build, pose, view }) {
  const input = path.resolve(file), plan = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (plan?.format !== format || plan.version !== 1 || Object.keys(plan).some(key => ![
    'format', 'version', 'title', 'width', 'height', 'time', 'pairs', 'modes', 'minDistance', 'minLightness', 'minEdges',
    'editable', 'locked', 'candidates', 'maxChanges', 'maxShift', 'maxEvaluations'
  ].includes(key))) throw new TypeError('Expected a version 1 color-vision palette repair plan');
  const { title = 'Color-vision palette repair', width = 168, height = 108, time = 0, ...options } = plan;
  const settings = view({ w: width, h: height, t: time }), { w, h, t } = settings;
  if (typeof title !== 'string' || !title.trim() || title.length > 120 || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) ||
      w <= 0 || h <= 0 || w > 1024 || h > 1024 || w * h > maxPixels || !Number.isFinite(t) || t < 0 || t > 120)
    throw new RangeError('Invalid palette repair title, native art grid or time');
  const filenames = ['repair.json', 'report.json', 'before.png', 'repaired.png', 'index.html'];
  if (filenames.some(name => path.join(directory, name) === input)) throw new RangeError('Write palette repair separately from the plan');
  const world = build();
  pose(world, t);
  const frame = render(world, { ...settings, px: 1, passes: ['objectId', 'materialId'], composite: false, renderGraph: false,
    renderGrid: false, inspection: false, shutter: false });
  const { stack, repaired, report, masks } = repairColorVisionPalette(frame, options);
  write(path.join(directory, 'before.png'), imageBytes(frame));
  write(path.join(directory, 'repaired.png'), imageBytes(repaired));
  json(path.join(directory, 'repair.json'), stack);
  json(path.join(directory, 'report.json'), { ...report, title, time: t, width: w, height: h });
  const data = { title, stack, report, images: Object.fromEntries(report.modes.map(mode => [mode, {
    before: encode(simulateFrame(frame, mode)), after: encode(simulateFrame(repaired, mode))
  }])), masks: masks.map(({ id, mask }) => {
    const rgba = new Uint8Array(mask.length * 4);
    for (let i = 0; i < mask.length; i++) if (mask[i]) rgba.set([157, 239, 244, 245], i * 4);
    return { id, image: embed(PNG.encode(w, h, rgba, 4)) };
  }) };
  const html = fs.readFileSync(path.join(__dirname, 'color-vision-repair-review.html'), 'utf8');
  write(path.join(directory, 'index.html'), html.replace('/*REPAIR_DATA*/', () => JSON.stringify(data).replaceAll('<', '\\u003c')));
  return report;
}

module.exports = { run };
