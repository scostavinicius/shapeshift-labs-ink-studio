const fs = require('node:fs');
const path = require('node:path');
const ProbeSettings = require('../src/bounce-probes.js');
const { render } = require('./render.js');
const { write, json } = require('./asset-files.js');
const PNG = require('./png.js');

const embed = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const integer = (value, lo, hi) => Number.isInteger(value) && value >= lo && value <= hi;

function review(world, directory, { pose, view, width, height, from, to, fps }) {
  const frames = Math.round((to - from) * fps);
  if (!integer(width, 1, 1024) || !integer(height, 1, 1024) || !Number.isFinite(from) || from < 0 ||
      !Number.isFinite(to) || to <= from || to > 120 || !integer(fps, 1, 60) ||
      !integer(frames, 2, 120) || width * height * frames > 4e6)
    throw new RangeError('Bounce review needs a native art grid and 2–120 frames');
  const sample = view({ w: width, h: height, t: from });
  if (sample.px !== undefined && sample.px !== 1) throw new RangeError('Bounce review captures native art pixels');
  const active = sample.bounceProbes === true ? world.bounceProbes : sample.bounceProbes ?? world.bounceProbes;
  const settings = ProbeSettings.prepare(active);
  if (!settings?.dynamic || !settings.probes.length || !settings.strength)
    throw new TypeError('Bounce review needs enabled probes and dynamic sources');
  const sites = settings.probes.map(site => site.id), footage = { baked: [], live: [] }, pictures = [], samples = [];
  for (let frame = 0; frame < frames; frame++) {
    const time = from + frame / fps;
    pose(world, time);
    const options = { ...view({ w: width, h: height, t: time }), px: 1, composite: false, renderGraph: false,
      renderGrid: false, inspection: false, shutter: false, cameraGuides: false, renderStats: true };
    const baked = render(world, { ...options, dynamicBounce: false });
    const live = render(world, { ...options, dynamicBounce: true });
    const stats = live.renderStats.bounceProbes;
    if (!stats || [baked, live].some(image => image.w !== width || image.h !== height))
      throw new Error('The bounce comparison did not capture the expected native probe and picture samples');
    const overlay = new Uint8Array(width * height * 4);
    let changedPixels = 0;
    for (let p = 0; p < width * height; p++) {
      const i = p * 3, change = Math.max(Math.abs(live.rgb[i] - baked.rgb[i]),
        Math.abs(live.rgb[i + 1] - baked.rgb[i + 1]), Math.abs(live.rgb[i + 2] - baked.rgb[i + 2]));
      if (change < 4) continue;
      changedPixels++;
      overlay.set([117, 243, 202, Math.min(180, 54 + change * 3)], p * 4);
    }
    const flat = PNG.packFrame(baked), bounced = PNG.packFrame(live);
    footage.baked.push(flat);
    footage.live.push(bounced);
    pictures.push({ baked: embed(PNG.encodeFrame(flat)), live: embed(PNG.encodeFrame(bounced)),
      changes: embed(PNG.encode(width, height, overlay, 4)) });
    samples.push({ frame, time, updated: stats.updated, rays: stats.rays, changedPixels });
  }
  const report = { format: 'ink-studio/bounce-probes-review', version: 1, title: world.name ?? 'Dynamic colored bounce',
    scene: world.id ?? null, width, height, fps, from, to, sites, samples };
  for (const [id, images] of Object.entries(footage))
    write(path.join(directory, id + '.png'), PNG.encodeAnimation(images, fps));
  json(path.join(directory, 'review.json'), report);
  const template = fs.readFileSync(path.join(__dirname, 'bounce-probes-review.html'), 'utf8');
  const data = JSON.stringify({ report, pictures }).replaceAll('<', '\\u003c');
  write(path.join(directory, 'index.html'), template.replace('/*BOUNCE_DATA*/', () => data));
  return report;
}

module.exports = { review };
