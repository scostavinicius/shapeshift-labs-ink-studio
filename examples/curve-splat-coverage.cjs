/* Compare native coverage on a small cableway with a matched slow pan. */
const path = require('node:path'), ink = require('..'), { KIT: K } = ink.load();
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-coverage');
const artWidth = 172, artHeight = 92, scale = 3, width = 1104, height = 676;
const count = 48, fps = 12, left = [22, 566], top = 181;
const background = '#17273a', rig = '#a7f2d4', gold = '#f3c382', dim = '#aebfd0';
const frameColor = '#3a5168', inkColor = '#eee9e5';
const palette = [
  '#202f42', '#263d50', '#304b5a', '#3b576a', '#426c7c', '#517987', '#6793a0',
  '#345755', '#4b746b', '#5f9082', '#77af9b', '#90cdb5', rig, '#c9ffed',
  '#645663', '#937269', '#c09376', gold, '#ffdea2', '#feeed1'
];

const strands = [];
function stroke(id, points, width, color, material = 'structure', options = {}) {
  const strand = { source: { kind: 'path', id, points }, object: id, width, color, material, edge: 'hard', ...options };
  strands.push(strand);
  return strand;
}
const line = (id, a, b, width, color, material, options) => stroke(id, [a, b], width, color, material, options);
const gradient = points => Array.from({ length: 37 }, (_, i) => points(i / 36));
for (const [layer, color] of ['#202f42', '#263d50', '#304b5a'].entries()) {
  const ridge = gradient(u => {
    const x = 7 * (u - .5), peak = .38 * Math.cos(x * 1.3 + layer);
    return [x, -.91 - .19 * layer + peak + .12 * Math.cos(5.3 * x - layer), -1.34 + layer * .26];
  });
  stroke('headland-' + layer, ridge, .44, color);
}
line('moon', [-1.37, 1.12, -1.70], [-1.37, 1.13, -1.70], .29, '#feeed1');
line('gantry', [-2.28, -.30, -.16], [2.28, -.30, -.16], .13, '#263d50');
line('deck-cap', [-2.35, -.243, -.06], [2.35, -.243, -.06], .037, '#6793a0');
for (const side of [-1, 1]) {
  const x = 2.26 * side;
  stroke('mast-back-' + side, [[x + .17 * side, -1.36, -.15], [x, -.16, -.15], [x, .83, -.15]], .23, '#263d50');
  stroke('mast-front-' + side, [[x + .075 * side, -1.34, .21], [x, -.19, .21], [x, .89, .21]], .135, '#3b576a');
  line('platform-' + side, [x - .19, .79, .22], [x + .19, .79, .22], .05, '#6793a0');
  stroke('mast-mark-' + side, [[x - .14, .41, .29], [x, .52, .29], [x + .14, .41, .29]], .061, gold, 'paint',
    { caps: 'blunt' });
  line('wick-' + side, [x, .89, .24], [x, 1.02, .24], .05, '#ffdea2', 'paint');
  stroke('foot-' + side, [[x - .25, -1.23, .24], [x + .21, -1.23, .24]], .10, '#517987');
}
for (let i = 0; i < 9; i++) {
  const x = -1.8 + i * .45;
  line('hanger-' + i, [x, -.22, -.065], [x, .38 + .50 * (x / 2.26) ** 2, -.065], .024, '#77af9b', 'rigging');
}
for (const [z, offset, tone] of [[-.12, 0, '#90cdb5'], [.13, .10, rig]]) {
  stroke('suspension-' + z, gradient(u => [4.52 * (u - .5), .325 + .55 * (2 * u - 1) ** 2 + offset, z]),
    .025, tone, 'rigging');
}
const wire = line('signal-wire', [-2.23, 0, .26], [2.23, 0, .26], .019, '#c9ffed', 'rigging');
for (const [i, x] of [-.90, .33, 1.49].entries()) {
  stroke('signal-pennant-' + i, [[x - .071, -.06, .29], [x, -.14, .29], [x + .064, -.061, .29]],
    .046, i === 1 ? '#ffdea2' : '#c09376', 'paint', { caps: 'blunt' });
}
for (const [i, x] of [-1.8, -1.2, -.61, .83, 1.69, 2.06].entries()) {
  const y = -1.19 - .12 * Math.sin(i * 2.3);
  line('water-mark-' + i, [x - .15, y, .23], [x + .2, y, .23], .032, '#426c7c');
}

const camera = { target: [0, 0, 0], dist: 5.25, yaw: 0, pitch: 0, ortho: true };
const look = { edgeFilter: { rules: [
  { select: { material: 'paint' }, strength: 0 },
  { select: { material: 'rigging' }, strength: 1 }
] } };
const recipe = { format: K.curveSplats.format, version: 1, id: 'night-cableway', background, palette, camera, look, strands };
const world = K.curveSplats.world(recipe), signal = K.curveSplats.world({ ...recipe, strands: [wire] });
const options = frame => ({ w: artWidth, h: artHeight, px: 1, t: frame / fps,
  target: [(frame / (count - 1) - .5) * .06, .077 * frame / (count - 1), 0] });
const filters = [{ edgeFilter: false }, {}];
const coverage = filters.map(mode => Array.from({ length: count }, (_, frame) => {
  const image = ink.render(signal, { ...options(frame), ...mode, raw: true, transparent: true });
  let total = 0;
  for (let y = 0; y < image.h; y++) total += image.alpha[y * image.w + image.w / 2] / 255;
  return total;
}));

function board(frame) {
  const commands = [];
  const rect = (x,y,w,h,fill) => commands.push({ type: 'rect', rect: [x,y,w,h], fill });
  const text = (value,x,y,size,color = inkColor) => commands.push({ type: 'text', text: value, at: [x,y], scale: size, color });
  const plot = (points,stroke) => commands.push({ type: 'path', points, stroke, width: 2 });
  rect(0, 0, width, height, '#111b29');
  rect(22, 27, 29, 4, rig);
  text('INK STUDIO / CURVE SPLATS', 65, 22, 2, dim);
  text('Subpixel coverage', 21, 51, 5);
  text('MATCHED CAMERA PAN / 172 X 92 ART PIXELS / FINAL PALETTE', 21, 106, 2, dim);
  text('Hard sampling', left[0], 137, 3, gold);
  text('ONE CENTER SAMPLE', left[0], 163, 1, dim);
  text('Filtered rigging', left[1], 137, 3, rig);
  text('16 SAMPLES ON WIRE / HARD EDGES ON PAINT', left[1], 163, 1, dim);
  for (const x of left) rect(x - 1, top - 1, artWidth * scale + 2, artHeight * scale + 2, frameColor);
  rect(21, 478, 1062, 173, '#1a2a3c');
  text('THIN SIGNAL WIRE / MEASURED AT CENTER COLUMN', 41, 495, 2);
  text('HARD', 917, 495, 1, gold);
  text('FILTERED', 982, 495, 1, rig);
  const x0 = 114, x1 = 1057, y0 = 530, y1 = 623;
  const xAt = i => x0 + (x1 - x0) * i / (count - 1);
  const yAt = value => y1 - (y1 - y0) * value;
  for (const value of [0, .5, 1]) {
    const y = Math.round(yAt(value));
    rect(x0, y, x1 - x0, 1, frameColor);
    text(String(value) + ' PX', 41, y - 4, 1, dim);
  }
  rect(Math.round(xAt(frame)), y0, 1, y1 - y0, '#8096a8');
  coverage.forEach((values, mode) => {
    const color = mode ? rig : gold;
    plot(values.map((value, i) => [xAt(i), yAt(value)]), color);
    rect(Math.round(xAt(frame)) - 2, Math.round(yAt(values[frame])) - 2, 5, 5, color);
  });
  text('PAN START', x0, 635, 1, dim);
  text('PAN END', x1 - 41, 635, 1, dim);
  const plate = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
  filters.forEach((mode, i) => {
    const image = ink.render(world, { ...options(frame), ...mode });
    for (let y = 0; y < artHeight * scale; y++) for (let x = 0; x < artWidth * scale; x++) {
      const source = (Math.floor(y / scale) * artWidth + Math.floor(x / scale)) * 3;
      const target = ((top + y) * width + left[i] + x) * 4;
      for (let c = 0; c < 3; c++) plate.data[target + c] = image.rgb[source + c];
    }
  });
  return PNG.packRGBA(plate);
}

const animation = [];
for (let i = 0; i < count; i++) {
  const frame = board(i);
  write(path.join(out, 'frames', 'frame-' + String(i).padStart(3, '0') + '.png'), PNG.encodeFrame(frame));
  if (i % 2 === 0) animation.push(frame);
  if (i === 1) write(path.join(out, 'curve-splat-coverage.png'), PNG.encodeFrame(frame));
}
write(path.join(out, 'curve-splat-coverage-apng.png'), PNG.encodeAnimation(animation, fps / 2));
json(path.join(out, 'night-cableway.json'), recipe);
json(path.join(out, 'wire-coverage.json'), { fps, units: 'art pixels', hard: coverage[0], filtered: coverage[1] });
console.log('Rendered matched cableway pans to ' + out);
