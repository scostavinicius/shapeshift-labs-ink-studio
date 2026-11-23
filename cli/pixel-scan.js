const CameraLens = require('../src/camera-lens.js');

const triple = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = value => {
  const size = Math.hypot(...value);
  if (!(size > 0) || !Number.isFinite(size)) throw new RangeError('A scan emitter must aim at a different finite point');
  return value.map(n => n / size);
};

function capturePixelScan(world, { at, target, w = 96, h = 64, fov = .72, time = 0, sdfAssist } = {}) {
  if (!world || !triple(at) || !triple(target) || !Number.isFinite(time) ||
      ![w, h].every(n => Number.isSafeInteger(n) && n > 0) || w * h > 262144 ||
      !Number.isFinite(fov) || fov <= 0 || fov >= Math.PI)
    throw new RangeError('Pixel scan capture needs an emitter pose, bounded art grid, positive FOV and finite time');
  const back = unit(at.map((n, axis) => n - target[axis]));
  const right = unit(cross(Math.abs(back[1]) < .999 ? [0, 1, 0] : [0, 0, 1], back));
  const pose = CameraLens.pose({ eye: at, right, back, up: cross(back, right) });
  const { passes } = require('../index.js').render(world, {
    w, h, t: time, px: 1, raw: true, ortho: false, lockCamera: true,
    camera: { target, pose, dist: 1 }, cameraStaging: false, fov,
    composite: false, renderGraph: false, cutaway: false, afterimages: false,
    atmosphere: false, water: false, reflections: false, areaLights: false,
    emissiveFinishes: false, precipitation: false, rainImpacts: false,
    shutter: false, sdfAssist, splatOrder: 'surface',
    passes: ['depth', 'position', 'normal', 'objectId']
  });
  return passes;
}

module.exports = { capturePixelScan };
