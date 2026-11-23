const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const R = require('./render.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const { pose } = require('./diarama-pose.js');

const modes = Object.freeze(['splats', 'curves']);

function changedPixels(a, b) {
  let changed = 0;
  for (let i = 0, q = 0; i < a.w * a.h; i++, q += 3) {
    const alpha = a.alpha?.[i] ?? 255;
    if (alpha !== (b.alpha?.[i] ?? 255) || alpha > 0 &&
        (a.rgb[q] !== b.rgb[q] || a.rgb[q + 1] !== b.rgb[q + 1] || a.rgb[q + 2] !== b.rgb[q + 2])) changed++;
  }
  return changed;
}

function sampleCurveShot(world, {
  frame = {}, width = frame.w ?? frame.width, height = frame.h ?? frame.height,
  time, from, to, fps = 12, camera, replay, samplePose, kit = require('../index.js').load()
}, variants, receive, pixelBudget = Infinity) {
  if (!world?.curveSplats) throw new TypeError('Curve comparison needs a world with curve splats');
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || width * height > 4_000_000)
    throw new RangeError('Curve comparison needs explicit art dimensions of up to 4 million pixels per view');
  if (!Number.isInteger(fps) || fps < 1 || fps > 240)
    throw new RangeError('Curve comparison needs an integer fps from 1 to 240');
  const sequence = from !== undefined || to !== undefined;
  if (sequence && (time !== undefined || !Number.isFinite(from) || !Number.isFinite(to) || to <= from))
    throw new RangeError('Use either one time or an increasing from/to range');
  const start = sequence ? from : time ?? frame.time ?? frame.t ?? world.lookSnapshot?.time ?? 0;
  const count = sequence ? Math.ceil((to - from) * fps - 1e-9) : 1;
  if (!Number.isFinite(start) || count < 1 || count > 3600)
    throw new RangeError('Curve comparison needs a finite time and a range of 1 to 3600 frames');
  if (count * width * height * 2 > pixelBudget)
    throw new RangeError('Curve comparison preview exceeds 64 million art pixels. Reduce the resolution or frame range.');
  const histories = variants.map(() => R.sequenceHistory(kit.KIT));
  const applyPose = samplePose ?? ((world, t) => pose(world, t, { kit, artDirection: frame.artDirection }));

  function draw(t, resetRenderHistory) {
    applyPose(world, t);
    const phase = count === 1 ? 0 : Math.max(0, Math.min(1, (t - start) * fps / (count - 1)));
    const shared = { ...frame, ...camera?.(phase, t), t, time: t, px: 1, w: width, h: height, resetRenderHistory };
    const cameras = [];
    const images = variants.map((variant, i) => {
      const capture = R.cameraCapture(shared, view => {
        if (!cameras[i] || view.width === width && view.height === height) cameras[i] = view;
      });
      const image = R.render(world, { ...shared, ...histories[i], ...capture, ...variant });
      if (image.w !== width || image.h !== height)
        throw new RangeError('The render settings changed the requested art resolution');
      return image;
    });
    if (!isDeepStrictEqual(cameras[0], cameras[1]))
      throw new RangeError('The comparison modes resolved different cameras');
    return { time: t, camera: cameras[0], images, reset: resetRenderHistory === true };
  }

  for (let index = 0; index < count; index++) {
    const requestedTime = start + index / fps;
    const matched = replay ? R.sequenceOutput(histories[0], () =>
      R.sequenceOutput(histories[1], () => replay.sample(requestedTime, draw))) : draw(requestedTime, index === 0);
    receive({ index, requestedTime, time:matched.time, camera:matched.camera, reset:matched.reset }, matched.images);
  }
  return { scene:world.id, seed:world.seed, width, height, fps:sequence ? fps : null };
}

function run(world, options, receive, pixelBudget) {
  const frames = [];
  const summary = sampleCurveShot(world, options, modes.map(curveMode => ({ curveMode })), (sample, [splats, curves]) => {
    const { reset, ...row } = sample;
    row.changedPixels = changedPixels(splats, curves);
    frames.push(row);
    receive?.({ ...row, splats, curves });
  }, pixelBudget);
  return { format:'ink-studio/curve-mode-comparison', version:1, ...summary, modes, frames };
}

function compareCurveModes(world, options = {}, receive) {
  return run(world, options, receive);
}

function writeCurveComparison(world, options, directory) {
  const paired = [], frames = [];
  const report = run(world, options, ({ index, splats, curves }) => {
    const name = String(index).padStart(4, '0') + '.png';
    const paths = { splats: 'splats/' + name, curves: 'curves/' + name };
    for (const [mode, image] of Object.entries({ splats, curves }))
      files.write(path.join(directory, paths[mode]), PNG.encodeFrame(PNG.packFrame(image)));
    paired.push(PNG.packFrame(R.grid([splats, curves], 2)));
    frames.push(paths);
  }, 64_000_000);
  files.write(path.join(directory, 'comparison.png'), PNG.encodeFrame(paired[0]));
  if (paired.length > 1)
    files.write(path.join(directory, 'comparison.apng'), PNG.encodeAnimation(paired, report.fps));
  report.preview = paired.length > 1 ? 'comparison.apng' : 'comparison.png';
  report.frames.forEach((row, i) => { row.files = frames[i]; });
  files.json(path.join(directory, 'manifest.json'), report);
  return report;
}

module.exports = { sampleCurveShot, compareCurveModes, writeCurveComparison };
