/* Matched native footage with each shape's measured art-pixel alpha below it. */
const path = require('node:path');
const ink = require('..'), { KIT: K } = ink.load();
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const recipe = require('./curve-splat-edges.json');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-edges');
const width = 1020, height = 540, artWidth = 106, artHeight = 72, scale = 3, frames = 48, fps = 12;
const background = '#122032', inkColor = '#ede8dd', dim = '#aabfc9', grid = '#3c5467';
const profiles = [
  { label: 'Gaussian', note: 'SOFT GRADUATED FALLOFF', color: '#99d4c8', offset: 1.26 },
  { label: 'Compact Beta', note: 'SOFT EDGE WITH A FIXED LIMIT', color: '#eec28d', offset: 0 },
  { label: 'Hard coverage', note: 'CRISP ART-PIXEL BOUNDARY', color: '#c6aff7', offset: -1.26 }
];
const camera = { target: [0, 0, 0], dist: 6.4, yaw: 0, pitch: 0 };

function render(strand, cam, options = {}) {
  const world = K.curveSplats.world({ ...recipe, camera: cam, strands: [strand] });
  return ink.render(world, { raw: true, px: 1, w: artWidth, h: artHeight, ...options });
}
const alpha = recipe.strands.map(strand => {
  const frame = render({ ...strand, source: [[-2, 0, 0], [2, 0, 0]] }, camera,
    { transparent: true, ortho: true });
  return Array.from({ length: 25 }, (_, i) =>
    frame.alpha[(artHeight / 2 - 12 + i) * artWidth + artWidth / 2] / 255);
});

function board(images, phase) {
  const commands = [];
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (value, x, y, size, color = inkColor) =>
    commands.push({ type: 'text', text: value, at: [x, y], scale: size, color });
  const line = (points, stroke, width = 1) => commands.push({ type: 'path', points, stroke, width });
  rect(0, 0, width, height, background);
  rect(22, 25, 26, 4, '#99d4c8');
  text('INK STUDIO / CURVE SPLAT EDGES', 65, 20, 2, '#99d4c8');
  text('Same strand, three edges', 20, 55, 5);
  text('MATCHED 3D VIEWS AT 106 X 72 ART PIXELS', 23, 111, 2, dim);
  for (const [i, { label, note, color }] of profiles.entries()) {
    const x = 22 + 329 * i;
    text(label, x, 150, 3, color);
    text(note, x, 179, 1, dim);
    rect(x - 2, 198, artWidth * scale + 4, artHeight * scale + 4, grid);
    rect(x, 435, 318, 72, '#1b2e41');
    text('MEASURED ALPHA ACROSS STRAND', x + 11, 445, 1, dim);
    line([[x + 11, 497], [x + 307, 497]], grid);
    const points = alpha[i].flatMap((value, j, row) => {
      const xAt = x + 12 + j * 294 / 24, y = 497 - value * 32;
      return j ? [[xAt, 497 - row[j - 1] * 32], [xAt, y]] : [[xAt, y]];
    });
    line(points, color, 2);
  }
  rect(22, 522, 976, 3, grid);
  rect(22, 522, Math.max(1, 976 * phase), 3, '#99d4c8');
  const art = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
  for (let i = 0; i < images.length; i++) {
    const left = 22 + 329 * i;
    for (let y = 0; y < artHeight * scale; y++) for (let x = 0; x < artWidth * scale; x++) {
      const src = (Math.floor(y / scale) * artWidth + Math.floor(x / scale)) * 3;
      const dst = ((y + 200) * width + left + x) * 4;
      art.data[dst] = images[i].rgb[src];
      art.data[dst + 1] = images[i].rgb[src + 1];
      art.data[dst + 2] = images[i].rgb[src + 2];
    }
  }
  return PNG.packRGBA(art);
}

const gallery = [];
for (let f = 0; f < frames; f++) {
  const phase = f / frames, angle = 2 * Math.PI * phase;
  const cam = { ...camera, yaw: .37 * Math.sin(angle), pitch: .12 + .22 * Math.cos(angle) };
  const images = recipe.strands.map((strand, i) => {
    const { offset } = profiles[i];
    return render({ ...strand, source: { ...strand.source,
      points: strand.source.points.map(([x, y, z]) => [x, y - offset, z]) } }, cam);
  });
  const frame = board(images, phase);
  write(path.join(out, 'frames', 'frame-' + String(f).padStart(3, '0') + '.png'), PNG.encodeFrame(frame));
  if (f % 2 === 0) gallery.push(frame);
  if (f === 5) write(path.join(out, 'edge-comparison.png'), PNG.encodeFrame(frame));
}
write(path.join(out, 'edge-comparison-apng.png'), PNG.encodeAnimation(gallery, fps / 2));
json(path.join(out, 'curve-splat-edges.json'), recipe);
console.log('Rendered matched edge views to ' + out);
