/* Render the profile recipe and turn its last strand around the transported tangent. */
const path = require('node:path');
const ink = require('..'), { KIT: K } = ink.load();
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const scene = require('./curve-splat-profiles.json');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-profiles');
const canvasWidth = 1008, canvasHeight = 582, w = 232, h = 128, scale = 3;
const frames = 64, fps = 12, background = '#182739', inkColor = '#f1eddd', note = '#a6bdcc';
const styles = [
  { label: 'FIXED GAUGE', note: 'CONSTANT WORLD WIDTH', samples: [.55, .55] },
  { label: 'PAINTED PRESSURE', note: 'NINE WIDTH SAMPLES', samples: scene.strands[1].width.samples.map(v => v / .4) },
  { label: 'TAPERED TIP', note: 'FOUR TAPER KEYS', keys: scene.strands[2].taper },
  { label: 'RIBBON TWIST', note: 'ELLIPSE ROTATES IN 3D' }
];
const artX = 30, artY = 149;

function board(frame, time, angle) {
  const commands = [];
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (label, x, y, fontSize = 2, color = inkColor) =>
    commands.push({ type: 'text', text: label, at: [x, y], scale: fontSize, color });
  const line = (points, stroke, width = 1) => commands.push({ type: 'path', points, stroke, width });
  rect(0, 0, canvasWidth, canvasHeight, '#122031');
  rect(30, 27, 23, 4, '#91ded2');
  text('INK STUDIO / CURVE SPLAT PROFILES', 65, 22, 2, '#91ded2');
  text('Width, taper and twist', 29, 63, 5);
  text('FOUR EDITABLE STRANDS AT 232 X 128 ART PIXELS', 31, 117, 2, note);
  rect(artX - 4, artY - 4, w * scale + 8, h * scale + 8, '#364e62');
  rect(747, artY - 4, 232, h * scale + 8, background);
  for (let i = 0; i < styles.length; i++) {
    const y = artY + 15 + 96 * i, { label, note: detail, samples, keys } = styles[i], { color } = scene.strands[i];
    text(label, 762, y, 2, color);
    text(detail, 762, y + 25, 1, note);
    const plot = samples?.map((v, j) => [j / (samples.length - 1), v]) ?? keys ??
      Array.from({ length: 41 }, (_, j) => [j / 40, .12 + .83 * Math.abs(Math.cos(angle + j / 40 * Math.PI * 2.5))]);
    line([[762, y + 66], [959, y + 66]], '#3e5366');
    line(plot.map(([u, value]) => [762 + 197 * u, y + 65 - 24 * value]), color, 2);
  }
  rect(27, 554, 952, 3, '#364e62');
  rect(27, 554, Math.max(1, time * 952), 3, '#91ded2');
  const art = K.procedural.drawing2d.render({ width: canvasWidth, height: canvasHeight, commands, edges: 'hard' });
  for (let y = 0; y < h * scale; y++) for (let x = 0; x < w * scale; x++) {
    const at = (Math.floor(y / scale) * frame.w + Math.floor(x / scale)) * 3;
    const dst = ((y + artY) * canvasWidth + x + artX) * 4;
    art.data[dst] = frame.rgb[at];
    art.data[dst + 1] = frame.rgb[at + 1];
    art.data[dst + 2] = frame.rgb[at + 2];
  }
  return PNG.packRGBA(art);
}

const gallery = [];
for (let i = 0; i < frames; i++) {
  const t = i / frames, angle = 2 * Math.PI * t;
  const shot = structuredClone(scene);
  shot.camera.yaw = .22 * Math.sin(angle);
  shot.camera.pitch += .09 * Math.cos(angle);
  shot.strands[3].twist = shot.strands[3].twist.map(([u, value]) => [u, value + angle]);
  const image = ink.render(K.curveSplats.world(shot), { raw: true, w, h, px: 1 });
  const frame = board(image, t, angle);
  write(path.join(out, 'frames', 'frame-' + String(i).padStart(3, '0') + '.png'), PNG.encodeFrame(frame));
  if (i % 2 === 0) gallery.push(frame);
  if (i === 11) write(path.join(out, 'strand-profiles.png'), PNG.encodeFrame(frame));
}
write(path.join(out, 'strand-profiles-apng.png'), PNG.encodeAnimation(gallery, fps / 2));
json(path.join(out, 'strand-profiles.json'), scene);
console.log('Rendered ' + frames + ' profile frames to ' + out);
