/* Review four surface strokes at the same art resolution and camera angle. */
const path = require('node:path'), ink = require('..');
const kit = ink.load(), { KIT: K } = kit;
const shot = require('./surface-bound-strokes.js')(kit);
const PNG = require('../cli/png.js'), { write } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/surface-bound-strokes');
const still = process.argv.includes('--still'), count = 40, fps = 10;
const width = 1068, height = 974, w = 162, h = 109, scale = 3;
const panels = [
  ['ink', 'Glazed ink', 'THIN INK FOLLOWS THE CURVE', '#bde8de'],
  ['stitch', 'Raised stitching', 'THREAD ARCHES ABOVE THE SEAM', '#f5b690'],
  ['hatch', 'Contour hatching', 'LINES WRAP AROUND THE FORM', '#c5dca9'],
  ['groove', 'Carved grooves', 'CUT INTO THE SCULPT', '#e3b2a2']
].map(([study, label, note, color], i) => ({
  label, note, color, world: shot.build(shot.seed, { controls: { study } }),
  x: 26 + 530 * (i % 2), y: i < 2 ? 132 : 528
}));

function board(phase) {
  const commands = [], white = '#eae9df', dim = '#a7bcc9', trim = '#405969';
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (value, x, y, size, color = white) =>
    commands.push({ type: 'text', text: value, at: [x, y], scale: size, color });
  rect(0, 0, width, height, '#161f2c');
  rect(26, 24, 28, 4, '#bde8de');
  text('INK STUDIO / CURVE SPLATS', 66, 20, 2, '#bde8de');
  text('Surface-bound strokes', 23, 49, 5);
  text('MATCHED CAMERA ORBIT / 162 X 109 ART PIXELS', 26, 103, 2, dim);
  const top = 45, angle = phase * 2 * Math.PI;
  for (const { x, y, label, note, color } of panels) {
    text(label, x, y, 3, color);
    text(note, x, y + 28, 1, dim);
    rect(x - 2, y + top - 2, scale * w + 4, scale * h + 4, trim);
  }
  rect(26, 942, 1016, 3, trim);
  rect(26, 942, Math.max(1, 1016 * phase), 3, '#bde8de');
  const plate = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
  for (const { x, y, world } of panels) {
    const frame = ink.render(world, { raw: true, w, h, px: 1,
      yaw: .61 * Math.sin(angle), pitch: .23 + .09 * Math.cos(angle) });
    for (let v = 0; v < scale * h; v++) for (let u = 0; u < scale * w; u++) {
      const source = (Math.floor(v / scale) * w + Math.floor(u / scale)) * 3;
      const target = ((y + top + v) * width + x + u) * 4;
      plate.data[target] = frame.rgb[source];
      plate.data[target + 1] = frame.rgb[source + 1];
      plate.data[target + 2] = frame.rgb[source + 2];
    }
  }
  return PNG.packRGBA(plate);
}
const poster = board(.10);
write(path.join(out, 'surface-bound-strokes.png'), PNG.encodeFrame(poster));
if (!still) {
  const apng = [];
  for (let i = 0; i < count; i++) {
    const image = i === 4 ? poster : board(i / count);
    write(path.join(out, 'frames', 'frame-' + String(i).padStart(3, '0') + '.png'), PNG.encodeFrame(image));
    if (i % 2 === 0) apng.push(image);
  }
  write(path.join(out, 'surface-bound-strokes-apng.png'), PNG.encodeAnimation(apng, fps / 2));
}
console.log('Rendered surface-bound strokes to ' + out);
