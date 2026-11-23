const fs = require('node:fs');
const path = require('node:path');
const ShotLighting = require('../src/shot-lighting.js');
const { named, prepare, fitNativeLighting } = require('./native-lighting-approval.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const embed = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const png = frame => PNG.encodeFrame(PNG.packFrame(frame));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function run(file, directory, { build, pose, view, kit }) {
  const input = path.resolve(file), root = path.dirname(input), plan = read(input);
  const { time, grids } = prepare(plan);
  if (!named(plan.scene, 1024) || (plan.rig !== undefined && !named(plan.rig, 1024)) ||
      (plan.seed !== undefined && !Number.isSafeInteger(plan.seed)) ||
      (plan.controls !== undefined && Object.getPrototypeOf(plan.controls ?? []) !== Object.prototype))
    throw new TypeError('Lighting approval needs a scene and optional static rig file, seed and controls');
  const scene = /\.(?:js|json|obj|gltf|glb)$/i.test(plan.scene) ? path.resolve(root, plan.scene) : plan.scene;
  const rigFile = plan.rig === undefined ? undefined : path.resolve(root, plan.rig);
  const filenames = ['rig.json', 'approval.json', 'index.html', ...grids.flatMap(grid =>
    ['before', 'fitted'].map(stage => grid.id + '-' + stage + '.png'))];
  for (const name of filenames)
    if ([input, scene, rigFile].includes(path.join(directory, name))) throw new RangeError('Write the approval separately from its inputs');
  const rig = rigFile && read(rigFile);
  const world = build(scene, plan.seed, { controls: plan.controls, retainSdf: ShotLighting.needsCasters(rig) });
  pose(world, time);
  const result = fitNativeLighting(world, { plan, rig, view: view({ t: time }), kit });
  const { report, before, after } = result;
  report.scene = plan.scene;
  if (plan.rig !== undefined) report.startingRig = plan.rig;
  if (plan.seed !== undefined) report.seed = plan.seed;
  if (plan.controls !== undefined) report.controls = plan.controls;
  const images = Object.fromEntries(grids.map((grid, i) => {
    const shots = {};
    for (const [stage, plates] of [['before', before], ['fitted', after]]) {
      const bytes = png(plates[i].frame);
      write(path.join(directory, grid.id + '-' + stage + '.png'), bytes);
      shots[stage] = { image: embed(bytes), evidence: embed(png(plates[i].marked)) };
    }
    return [grid.id, shots];
  }));
  json(path.join(directory, 'rig.json'), result.rig);
  json(path.join(directory, 'approval.json'), report);
  const template = fs.readFileSync(path.join(__dirname, 'native-lighting-approval-review.html'), 'utf8');
  const data = JSON.stringify({ report, rig: result.rig, images }).replaceAll('<', '\\u003c');
  write(path.join(directory, 'index.html'), template.replace('/*APPROVAL_DATA*/', () => data));
  return report;
}

module.exports = { run };
