const fs = require('node:fs');
const path = require('node:path');
const { format, fields, label, normalize, planSubjectReframe, reframeRaster } = require('./subject-reframe.js');
const { captureScreenFrame } = require('./screen-subjects.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const embed = bytes => 'data:image/png;base64,' + bytes.toString('base64');

function run(file, directory, hooks) {
  const input = path.resolve(file), plan = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!fields(plan, ['format', 'version', 'title', 'scene', 'seed', 'controls', 'width', 'height', 'from', 'fps', 'frames', 'smoothing', 'subjects', 'formats']) ||
      plan.format !== format || plan.version !== 1 || typeof plan.scene !== 'string' || !plan.scene.trim() || plan.scene.length > 1024 ||
      (plan.controls !== undefined && Object.getPrototypeOf(plan.controls ?? []) !== Object.prototype) ||
      (plan.title !== undefined && !label(plan.title)) || (plan.seed !== undefined && !Number.isSafeInteger(plan.seed)))
    throw new TypeError('Expected a version 1 subject reframe plan with a scene');
  const { title = 'Subject reframing', seed, controls } = plan;
  const settings = normalize(plan), { width, height, fps, from, frames, formats } = settings;
  if (width * height * frames > 12e6 || formats.reduce((sum, item) => sum + item.width * item.height, 0) * frames > 150e6)
    throw new RangeError('Reframe in shorter sections or at a smaller art resolution');
  const scene = /\.(?:js|json|obj|gltf|glb)$/i.test(plan.scene) ? path.resolve(path.dirname(input), plan.scene) : plan.scene;
  for (const name of ['index.html', 'paths.json', ...formats.map(item => item.id + '.png')])
    if ([input, scene].includes(path.join(directory, name))) throw new RangeError('Write the reframe separately from its inputs');

  const world = hooks.build(scene, seed, { controls });
  const source = Array.from({ length: frames }, (_, i) => captureScreenFrame(world, width, height, from + i / fps, hooks));
  const solution = planSubjectReframe(source, settings);
  for (const frame of source) delete frame.passes;
  solution.title = title;
  solution.scene = plan.scene;
  if (seed !== undefined) solution.seed = seed;
  if (controls !== undefined) solution.controls = controls;

  // The review animates one source plate with exact crop coordinates. The delivery files use full output resolution.
  const pictures = source.map(frame => embed(PNG.encodeFrame(PNG.packFrame(frame))));
  for (const delivery of solution.formats) {
    const packed = source.map((frame, i) => PNG.packFrame(reframeRaster(frame, delivery, solution.samples[i].time)));
    write(path.join(directory, delivery.id + '.png'), PNG.encodeAnimation(packed, fps));
  }
  json(path.join(directory, 'paths.json'), solution);
  const template = fs.readFileSync(path.join(__dirname, 'subject-reframe-review.html'), 'utf8');
  const data = JSON.stringify({ solution, pictures }).replaceAll('<', '\\u003c');
  write(path.join(directory, 'index.html'), template.replace('/*REFRAME_DATA*/', () => data));
  return solution;
}

module.exports = { run };
