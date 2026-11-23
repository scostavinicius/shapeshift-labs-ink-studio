const fs = require('node:fs');
const path = require('node:path');
const { format, fields, named, settings, inspectSilhouetteFrame, collisionIntervals, findSilhouetteRepair } = require('./silhouette-repair.js');
const { render } = require('./render.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const embed = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const tint = [[0, 0, 0, 0], [103, 239, 214, 118], [255, 199, 110, 118], [255, 73, 122, 216]];
const image = raster => PNG.encodeFrame(PNG.packFrame(raster));

function run(file, directory, { build, pose, view }) {
  const input = path.resolve(file), plan = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!fields(plan, ['format', 'version', 'title', 'scene', 'seed', 'controls', 'width', 'height', 'fps', 'fromFrame', 'toFrame',
      'subjects', 'coverage', 'gapPixels', 'minVisible', 'stepDegrees', 'maxDegrees', 'contextFrames']) ||
      plan.format !== format || plan.version !== 1 || !named(plan.scene, 1024) ||
      (plan.title !== undefined && !named(plan.title)) || (plan.seed !== undefined && !Number.isSafeInteger(plan.seed)) ||
      (plan.controls !== undefined && Object.getPrototypeOf(plan.controls ?? []) !== Object.prototype))
    throw new TypeError('Expected a version 1 silhouette repair plan with a scene');
  const cfg = settings(plan);
  const { width, height, fps, fromFrame, toFrame, subjects, contextFrames } = cfg;
  const scene = /\.(?:js|json|obj|gltf|glb)$/i.test(plan.scene) ? path.resolve(path.dirname(input), plan.scene) : plan.scene;
  for (const name of ['index.html', 'repair.json', 'before.png', 'after.png'])
    if ([input, scene].includes(path.join(directory, name))) throw new RangeError('Write silhouette repair separately from its inputs');

  const objectMattes = { objects: subjects.map(subject => subject.object), projected: true };
  const assemble = () => build(scene, plan.seed, { controls: plan.controls });
  function capture(world, frame, offset) {
    const t = frame / fps;
    const { w, h, rgb, alpha, objectMattes: mattes } = render(world, {
      ...view({ w: width, h: height, t }), px: 1, objectMattes,
      composite: false, renderGraph: false, renderGrid: false, inspection: false, shutter: false,
      ...(offset && { cameraOrbitOffset: offset.map(n => n * Math.PI / 180) })
    });
    const inspected = inspectSilhouetteFrame({ w, h, objectMattes: mattes }, cfg, frame);
    return { raster: { w, h, rgb, alpha }, ...inspected };
  }
  function sample(offset, requireClear = false) {
    const world = assemble(), plates = [];
    for (let frame = fromFrame; frame < toFrame; frame++) {
      pose(world, frame / fps);
      const plate = capture(world, frame, offset);
      if (requireClear && plate.metrics.status !== 'clear') return null;
      plates.push(plate);
    }
    return plates;
  }

  const before = sample(), baseline = before.map(plate => plate.metrics), probeWorlds = new Map();
  function probe(offset, frame) {
    if (!probeWorlds.has(frame)) {
      const world = assemble();
      for (let at = fromFrame; at <= frame; at++) pose(world, at / fps);
      if (probeWorlds.size === 20) probeWorlds.delete(probeWorlds.keys().next().value);
      probeWorlds.set(frame, world);
    }
    return capture(probeWorlds.get(frame), frame, offset).metrics.status;
  }
  let search, unsupportedCamera = false;
  try {
    search = findSilhouetteRepair(baseline, cfg, probe, offset => sample(offset, true));
  } catch (error) {
    if (!(error instanceof RangeError) || error.message !== 'Camera lens: orbit offset requires an orbit-authored camera') throw error;
    unsupportedCamera = true;
    search = { intervals: collisionIntervals(baseline), repair: null, verification: null, checked: [] };
  }
  const { intervals, repair, verification, checked } = search;
  const preview = intervals.length ?
    [Math.max(fromFrame, intervals[0].fromFrame - contextFrames), Math.min(toFrame, intervals.at(-1).toFrame + contextFrames)] :
    [fromFrame, toFrame];
  const status = repair ? 'repaired' : unsupportedCamera ? 'unsupported-camera' : intervals.length ? 'unresolved' :
    baseline.some(row => row.status === 'unverified') ? 'unverified' : 'clear';
  const report = {
    format, version: 1, title: plan.title ?? 'Silhouette collision repair', scene: plan.scene,
    ...(plan.seed !== undefined && { seed: plan.seed }), ...(plan.controls && { controls: plan.controls }),
    ...cfg, status, intervals, preview, repair, checked, before: baseline, after: verification?.map(plate => plate.metrics) ?? null
  };
  const previews = {};
  for (const [side, plates] of [['before', before], ['after', verification]]) {
    if (!plates) continue;
    const segment = plates.slice(preview[0] - fromFrame, preview[1] - fromFrame);
    write(path.join(directory, side + '.png'), PNG.encodeAnimation(segment.map(plate => PNG.packFrame(plate.raster)), fps));
    previews[side] = segment.map(plate => {
      const rgba = new Uint8Array(plate.mask.length * 4);
      for (let i = 0; i < plate.mask.length; i++) if (plate.mask[i]) rgba.set(tint[plate.mask[i]], i * 4);
      return { picture: embed(image(plate.raster)), mask: embed(PNG.encode(width, height, rgba, 4)) };
    });
  }
  json(path.join(directory, 'repair.json'), report);
  const html = fs.readFileSync(path.join(__dirname, 'silhouette-repair-review.html'), 'utf8');
  const data = JSON.stringify({ report, previews }).replaceAll('<', '\\u003c');
  write(path.join(directory, 'index.html'), html.replace('/*SILHOUETTE_DATA*/', () => data));
  return report;
}

module.exports = { run };
