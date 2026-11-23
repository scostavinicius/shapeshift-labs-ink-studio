/* Render the editable cap and join sheet under a matched 3D camera move. */
const path = require('node:path');
const ink = require('..'), { KIT: K } = ink.load();
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const recipe = require('./curve-splat-caps.json');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-caps');
const width = 1020, height = 582, artWidth = 106, artHeight = 53, scale = 3, frames = 48, fps = 12;
const paper = '#122031', inkColor = '#efebdf', dim = '#a9c0ca', line = '#354d62';
const views = [
  ['Rounded', 'SOFT END ON THE NATIVE KERNEL'],
  ['Blunt', 'SQUARE CUT AT THE PATH END'],
  ['Tapered', 'WIDTH TAPERS TO ZERO'],
  ['Fading', 'OPACITY FALLS AT THE ENDS'],
  ['Pigment pool', 'WIDER, DENSER COLOUR AT THE CORNER'],
  ['Small break', 'A 7.6 PERCENT GAP IN THE PATH']
];

function render(t) {
  const camera = { target: [0, 0, 0], dist: 5.8, yaw: .31 * Math.sin(t), pitch: .10 + .16 * Math.cos(t) };
  return recipe.strands.map((strand, i) => {
    const x = 5.68 * (i % 3 - 1), y = i < 3 ? 1.22 : -1.22;
    const source = { ...strand.source, points: strand.source.points.map(([px, py, pz]) => [px - x, py - y, pz]) };
    const world = K.curveSplats.world({ ...recipe, camera, strands: [{ ...strand, source }] });
    return ink.render(world, { raw: true, w: artWidth, h: artHeight, px: 1 });
  });
}

function board(images, phase) {
  const commands = [];
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (value, x, y, size, color = inkColor) =>
    commands.push({ type: 'text', text: value, at: [x, y], scale: size, color });
  rect(0, 0, width, height, paper);
  rect(22, 23, 25, 4, '#8fdbca');
  text('INK STUDIO / CURVE SPLATS', 63, 18, 2, '#8fdbca');
  text('Caps and joins', 20, 49, 5);
  text('MATCHED 3D VIEWS AT 106 X 53 ART PIXELS', 23, 104, 2, dim);
  const placements = views.map(([label, note], i) => {
    const x = 22 + 329 * (i % 3), y = i < 3 ? 138 : 353;
    text(label, x, y, 3, i === 4 ? '#ffacac' : '#edc494');
    text(note, x, y + 29, 1, dim);
    rect(x - 2, y + 48, artWidth * scale + 4, artHeight * scale + 4, line);
    return [x, y + 50];
  });
  rect(22, 572, 976, 3, line);
  rect(22, 572, Math.max(1, 976 * phase), 3, '#8fdbca');
  const art = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
  for (const [i, [left, top]] of placements.entries()) {
    for (let y = 0; y < artHeight * scale; y++) for (let x = 0; x < artWidth * scale; x++) {
      const from = (Math.floor(y / scale) * artWidth + Math.floor(x / scale)) * 3;
      const to = ((y + top) * width + x + left) * 4;
      art.data[to] = images[i].rgb[from];
      art.data[to + 1] = images[i].rgb[from + 1];
      art.data[to + 2] = images[i].rgb[from + 2];
    }
  }
  return PNG.packRGBA(art);
}

const gallery = [];
for (let f = 0; f < frames; f++) {
  const phase = f / frames, frame = board(render(phase * Math.PI * 2), phase);
  write(path.join(out, 'frames', 'frame-' + String(f).padStart(3, '0') + '.png'), PNG.encodeFrame(frame));
  if (f % 2 === 0) gallery.push(frame);
  if (f === 4) write(path.join(out, 'caps-and-joins.png'), PNG.encodeFrame(frame));
}
write(path.join(out, 'caps-and-joins-apng.png'), PNG.encodeAnimation(gallery, fps / 2));
json(path.join(out, 'curve-splat-caps.json'), recipe);
console.log('Rendered caps and joins to ' + out);
