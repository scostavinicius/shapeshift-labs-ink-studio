const fs = require('node:fs');
const path = require('node:path');
const { format, fields, named, settings, findMatchCuts } = require('./match-cut.js');
const { captureScreenFrame } = require('./screen-subjects.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const sides = ['outgoing', 'incoming'];
const range = ([from, to]) => Array.from({ length: to - from }, (_, i) => from + i);
const dataImage = bytes => 'data:image/png;base64,' + bytes.toString('base64');

function compileShot(shot, side, directory) {
  if (!fields(shot, ['scene', 'label', 'seed', 'controls', 'camera', 'fromFrame', 'toFrame']) || !named(shot.scene, 1024))
    throw new TypeError('The ' + side + ' handle needs a scene and frame range');
  const { scene, label = scene, fromFrame = 0, toFrame, seed, controls, camera = {} } = shot;
  if (!named(label, 1024) || !Number.isSafeInteger(fromFrame) || !Number.isSafeInteger(toFrame) ||
      (seed !== undefined && !Number.isSafeInteger(seed)) ||
      (controls !== undefined && Object.getPrototypeOf(controls ?? []) !== Object.prototype) ||
      !fields(camera, ['target', 'yaw', 'pitch', 'zoom', 'dist', 'ortho']) || Object.entries(camera).some(([key, value]) =>
        key === 'target' ? !Array.isArray(value) || value.length !== 3 || !Array.from(value).every(Number.isFinite) :
        key === 'ortho' ? typeof value !== 'boolean' : !Number.isFinite(value) || (key === 'zoom' || key === 'dist') && value <= 0))
    throw new TypeError('Invalid ' + side + ' shot label, frame range, seed, controls or camera');
  return { scene, label, fromFrame, toFrame, seed, controls, camera,
    source: /\.(?:js|json|obj|gltf|glb)$/i.test(scene) ? path.resolve(directory, scene) : scene };
}

function run(file, directory, hooks) {
  const input = path.resolve(file), plan = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!fields(plan, ['format', 'version', 'title', 'width', 'height', 'fps', 'motionFrames', 'previewFrames',
      'limit', 'separationFrames', 'restSpeed', 'matches', ...sides]) || plan.format !== format || plan.version !== 1 ||
      (plan.title !== undefined && !named(plan.title)))
    throw new TypeError('Expected a version 1 match-cut plan with two shot handles');
  const shots = sides.map(side => compileShot(plan[side], side, path.dirname(input)));
  const lengths = shots.map(shot => shot.toFrame - shot.fromFrame);
  const options = settings({ ...plan, outgoingStart: shots[0].fromFrame, incomingStart: shots[1].fromFrame }, lengths);
  const { width, height, fps, limit } = options;
  if (width * height * (lengths[0] + lengths[1]) > 12e6)
    throw new RangeError('Search shorter handles or use a smaller native art grid');
  const filenames = ['cuts.json', 'index.html', ...Array.from({ length: limit }, (_, i) => 'match-' + (i + 1) + '.png')];
  for (const name of filenames)
    if ([input, ...shots.map(shot => shot.source)].includes(path.join(directory, name)))
      throw new RangeError('Write the match cut separately from its inputs');

  const handles = shots.map(({ source, seed, controls, camera, fromFrame, toFrame }) => {
    const world = hooks.build(source, seed, { controls });
    return range([fromFrame, toFrame]).map(frame => captureScreenFrame(world, width, height, frame / fps, hooks, camera));
  });
  const report = findMatchCuts(handles[0], handles[1], options);
  report.title = plan.title ?? 'Match-cut finder';
  sides.forEach((side, i) => {
    const { source, ...shot } = shots[i];
    Object.assign(report[side], shot);
  });

  const pack = handles.some(handle => handle.some(frame => frame.alpha)) ?
    frame => PNG.packFrame(frame.alpha ? frame : { ...frame, alpha: new Uint8Array(width * height).fill(255) }) : PNG.packFrame;
  const packed = new Map(), pictures = sides.map(() => ({}));
  for (const candidate of report.candidates) {
    const frames = sides.flatMap((side, i) => range(candidate.preview[side]).map(frame => {
      const key = side + frame;
      if (!packed.has(key)) {
        const image = pack(handles[i][frame - shots[i].fromFrame]);
        packed.set(key, image);
        pictures[i][frame] = dataImage(PNG.encodeFrame(image));
      }
      return packed.get(key);
    }));
    candidate.file = 'match-' + candidate.rank + '.png';
    write(path.join(directory, candidate.file), PNG.encodeAnimation(frames, fps));
  }
  json(path.join(directory, 'cuts.json'), report);
  const template = fs.readFileSync(path.join(__dirname, 'match-cut-review.html'), 'utf8');
  const data = JSON.stringify({ report, pictures }).replaceAll('<', '\\u003c');
  write(path.join(directory, 'index.html'), template.replace('/*MATCH_CUT_DATA*/', () => data));
  return report;
}

module.exports = { run };
