const ShotLighting = require('../src/shot-lighting.js');

const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);

function rotate([x, y, z], yaw, pitch) {
  const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180;
  const tiltedY = y * Math.cos(b) - z * Math.sin(b), tiltedZ = y * Math.sin(b) + z * Math.cos(b);
  return [x * Math.cos(a) + tiltedZ * Math.sin(a), tiltedY, tiltedZ * Math.cos(a) - x * Math.sin(a)];
}

function prepareLightSearch(world, { view = {}, rig = view.shotLighting, pivot } = {}) {
  const source = rig === true || rig === undefined ? world.shotLighting : rig;
  if (!source?.key || !source?.fill) throw new TypeError('Start with a shot lighting rig with a key and fill');
  const initial = JSON.parse(JSON.stringify(source, (name, value) => {
    if (typeof value === 'function') throw new TypeError('Lighting fit needs a static JSON rig (' + name + ')');
    return value;
  }));
  ShotLighting.prepare(initial);
  const { key, fill, exposureEV = 0 } = initial;
  if (key.intensity === 0) throw new RangeError('Start the lighting fit with the key light on');
  const normal = key.normal ?? [0, 0, 1];
  const aim = pivot ?? view.camera?.target ?? view.target ?? world.cam?.target ?? [0, 0, 0];
  if (!vector(aim)) throw new TypeError('Set an explicit XYZ key pivot in the targets');
  const offset = key.at.map((value, i) => value - aim[i]);
  if (Math.hypot(...offset) < 1e-8) throw new RangeError('The key pivot needs to be away from the key light');

  function candidate({ yaw, pitch, size = 1, fillIntensity, exposure }) {
    const at = rotate(offset, yaw, pitch).map((value, i) => value + aim[i]);
    return { ...initial, format: 'ink-studio/shot-lighting', version: 1,
      key: { ...key, at, normal: rotate(normal, yaw, pitch), size: key.size.map(value => Math.min(1000, Math.max(.001, value * size))),
        ...(key.up && { up: rotate(key.up, yaw, pitch) }) }, fill: { ...fill, intensity: fillIntensity }, exposureEV: exposure };
  }

  const initialFill = fill.intensity ?? 2;
  const parameters = {
    yaw: { min: -55, max: 55, initial: 0 }, pitch: { min: -35, max: 35, initial: 0 },
    size: { min: Math.max(.4, .001 / Math.min(...key.size)), max: Math.min(2.5, 1000 / Math.max(...key.size)), initial: 1 },
    fillIntensity: { min: 0, max: Math.min(64, Math.max(6, initialFill * 4)), initial: initialFill },
    exposure: { min: Math.max(-4, exposureEV - 1.5), max: Math.min(4, exposureEV + 1.5), initial: exposureEV }
  };

  if (parameters.size.min === parameters.size.max) delete parameters.size;
  return { initial, parameters, candidate };
}

module.exports = { prepareLightSearch };
