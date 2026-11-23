/* Matched native views and measured cross-strand coverage from the same section settings. */
const path = require('node:path');
const ink = require('..'), { KIT: K } = ink.load(), C = K.curveSplats;
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const recipe = require('./curve-splat-sections.json');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-sections');
const width = 1020, height = 546, w = 106, h = 76, scale = 3, frames = 60, fps = 12;
const inkColor = '#eeeadd', dim = '#adc0c9', lineColor = '#3a5063', background = '#112030';
const views = [
  { label: 'Round cord', detail: 'CIRCULAR GAUSSIAN', offset: 1.26 },
  { label: 'Elliptical yarn', detail: 'TWO GAUSSIAN AXES', offset: 0 },
  { label: 'Flattened ribbon', detail: 'FLAT FACE / ROUNDED EDGES', offset: -1.26 }
];
const camera = { target: [0, 0, 0], dist: 6.6, yaw: 0, pitch: 0 };

function render(strand, cam, options = {}) {
  return ink.render(C.world({ ...recipe, camera: cam, strands: [strand] }), {
    raw: true, px: 1, w, h, ...options
  });
}
const faceOn = recipe.strands.map(strand => {
  const frame = render({ ...strand, twist: 0, source: [[-2.4, 0, 0], [2.4, 0, 0]] }, camera,
    { transparent: true, ortho: true });
  const depth = Array.from({ length: 35 }, (_, i) => {
    const coverage = frame.alpha[(h / 2 - 17 + i) * w + Math.floor(w / 2)] / 255;
    return -Math.log1p(-Math.min(.999, coverage));
  });
  const peak = Math.max(...depth);
  return depth.map(value => value / peak);
});

function board(images, phase) {
  const commands = [];
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (value, x, y, size, color = inkColor) =>
    commands.push({ type: 'text', text: value, at: [x, y], scale: size, color });
  const line = (points, stroke, width = 1) => commands.push({ type: 'path', points, stroke, width });
  rect(0, 0, width, height, background);
  rect(22, 25, 26, 4, '#92decb');
  text('INK STUDIO / CURVE SPLAT CROSS-SECTIONS', 63, 20, 2, '#92decb');
  text('Three sections, the same path', 20, 53, 4);
  text('MATCHED 3D VIEWS AT 106 X 76 ART PIXELS', 22, 98, 2, dim);
  for (const [i, view] of views.entries()) {
    const x = 22 + 329 * i, color = recipe.strands[i].color;
    text(view.label, x, 139, 3, color);
    text(view.detail, x, 168, 1, dim);
    rect(x - 2, 187, w * scale + 4, h * scale + 4, lineColor);
    rect(x, 437, 318, 74, '#1a2d41');
    text('FACE-ON OPTICAL DEPTH', x + 11, 447, 1, dim);
    line([[x + 11, 502], [x + 306, 502]], lineColor);
    line(faceOn[i].map((value, j) => [x + 11 + j * 295 / 34, 502 - value * 34]), color, 2);
  }
  rect(22, 527, 976, 3, lineColor);
  rect(22, 527, Math.max(1, 976 * phase), 3, '#92decb');
  const art = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
  for (let i = 0; i < views.length; i++) {
    const image = images[i], left = 22 + 329 * i;
    for (let y = 0; y < h * scale; y++) for (let x = 0; x < w * scale; x++) {
      const from = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 3;
      const dst = ((y + 189) * width + left + x) * 4;
      art.data[dst] = image.rgb[from];
      art.data[dst + 1] = image.rgb[from + 1];
      art.data[dst + 2] = image.rgb[from + 2];
    }
  }
  return PNG.packRGBA(art);
}

const gallery = [];
for (let f = 0; f < frames; f++) {
  const phase = f / frames, t = Math.PI * 2 * phase, roll = t;
  const cam = { ...camera, yaw: .34 * Math.sin(t), pitch: .10 + .17 * Math.cos(t) };
  const images = recipe.strands.map((strand, i) => {
    const { offset } = views[i];
    const source = { ...strand.source, points: strand.source.points.map(([x, y, z]) => [x, y - offset, z]) };
    return render({ ...strand, source, twist: [[0, roll], [1, roll + 3.8]] }, cam);
  });
  const frame = board(images, phase);
  write(path.join(out, 'frames', 'frame-' + String(f).padStart(3, '0') + '.png'), PNG.encodeFrame(frame));
  if (f % 2 === 0) gallery.push(frame);
  if (f === 8) write(path.join(out, 'section-comparison.png'), PNG.encodeFrame(frame));
}
write(path.join(out, 'section-comparison-apng.png'), PNG.encodeAnimation(gallery, fps / 2));
json(path.join(out, 'curve-splat-sections.json'), recipe);
console.log('Rendered matched section views to ' + out);
