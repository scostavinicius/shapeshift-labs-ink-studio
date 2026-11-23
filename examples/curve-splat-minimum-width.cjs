/* Compare the same woven panel through three projected-width policies. */
const path = require('node:path'), ink = require('..'), { KIT: K } = ink.load();
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-minimum-width');
const artWidth = 166, artHeight = 112, scale = 2, width = 1088, height = 642;
const frames = 48, fps = 12;
const background = '#182636', pale = '#f3ece1', dim = '#9cb4c8', line = '#405975', gold = '#f1bd78', mint = '#97dec3';
const palette = [
  '#223447', '#2d4151', '#354d5d', '#47616c', '#567077', '#759391',
  '#32615f', '#427773', '#528c81', '#63a28e', '#79b89f', mint, '#c0efcf',
  '#4d424e', '#73545a', '#9a6b5e', '#b98065', '#d69f70', gold, '#ffdfa7',
  '#684c62', '#895d74', '#af7788', '#cc94a0', '#ecc0b6'
];

const weave = K.textile.weave({
  size: [3.5, 2.34], columns: 23, rows: 15, samples: 2, radius: .028, clearance: .011,
  chart: (u, v) => {
    const x = 3.5 * (u - .5), y = 2.34 * (v - .5);
    return { p: [x, y + .085 * Math.cos(x * .93), .045 * Math.cos(x * 1.3 - y * 1.9)], n: [0, 0, 1] };
  }
});
const strands = weave.threads.map(thread => {
  const warp = thread.family === 'warp', accent = !warp && thread.index % 5 === 2;
  const fine = !warp && thread.index % 2 === 1 && !accent;
  const colors = warp ? ['#528c81', '#79b89f', '#97dec3'] :
    accent ? [gold] : fine ? ['#af7788', '#cc94a0'] : ['#9a6b5e', '#d69f70'];
  return {
    source: { kind: 'textile', plan: { threads: [thread] } }, object: thread.id,
    material: fine ? 'linen-infill' : 'body-yarn', width: fine ? .026 : accent ? .067 : warp ? .044 : .056,
    edge: 'hard', caps: 'blunt', color: colors[thread.index % colors.length]
  };
});
function stroke(id, points, width, color, material = 'frame', options = {}) {
  strands.push({ source: { kind: 'path', id, points }, object: id, width, color, material, edge: 'hard', ...options });
}
const bluntStroke = (id, points, width, color, material) => stroke(id, points, width, color, material, { caps: 'blunt' });
for (const side of [-1, 1]) {
  const x = side * 2.03;
  stroke('post-' + side, [[x, -1.59, -.15], [x, 1.53, -.15]], .164, '#32615f');
  bluntStroke('post-rim-' + side, [[x + .028, -1.50, -.026], [x + .028, 1.50, -.026]], .037, '#759391', 'frame');
  bluntStroke('foot-' + side, [[x - .17, -1.61, -.07], [x + .17, -1.61, -.07]], .11, '#47616c', 'frame');
  stroke('tension-' + side, [[x, 1.40, -.03], [side * 1.77, 1.12, .16],
    [side * 1.77, -1.06, .16], [x, -1.44, -.03]], .019, gold, 'tension-cord');
  stroke('tassel-' + side, [[side * 1.68, -1.07, .10], [side * 1.65, -1.38, .18],
    [side * 1.53, -1.56, .19]], .048, '#cc94a0', 'body-yarn');
  stroke('finial-' + side, [[x - .085, 1.53, -.10], [x, 1.65, -.10], [x + .085, 1.53, -.10]], .055, gold);
}
for (const y of [-1.42, 1.38]) {
  stroke('beam-' + y, [[-2.07, y, -.14], [2.07, y, -.14]], .14, '#4d424e');
  bluntStroke('beam-rim-' + y, [[-2.11, y + .043, -.025], [2.11, y + .043, -.025]], .053, '#d69f70', 'frame');
}
for (let i = 0; i < 13; i++) {
  const x = .237 * (i - 6);
  stroke('fringe-' + i, [[x, -1.05, .14], [x * 1.015 - .019, -1.30, .23],
    [x * 1.04, -1.45 + .10 * Math.cos(i * 1.17), .26]], .028, '#cc94a0', 'linen-infill');
}

const curveWidth = { rules: [
  { select: { material: 'tension-cord' }, policy: { mode: 'minimum', pixels: 1.12 } },
  { select: { material: 'linen-infill' }, policy: { mode: 'fade', range: [.48, .91] } },
  { select: { material: 'body-yarn' }, policy: { mode: 'physical' } }
] };
const blanket = { default: { mode: 'minimum', pixels: 2.2 } };
const recipe = {
  id: 'cedar-loom', format: K.curveSplats.format, version: 1, seed: 31, background, palette,
  camera: { target: [0, 0, 0], dist: 5.4, ortho: false, yaw: -.22, pitch: .073 },
  look: { edgeFilter: true, curveWidth }, strands
};
const world = K.curveSplats.world(recipe);
const panels = [
  { title: 'Physical width', x: 20, color: '#b3bfd3', rules: ['THREADS KEEP WORLD GAUGE', 'TENSION CORDS GET THIN'], options: { curveWidth: false } },
  { title: 'Minimum everywhere', x: 378, color: '#ecc0b6', rules: ['2.2 PX FOR EVERY STRAND', 'SMALL GAPS FILL IN'], options: { curveWidth: blanket } },
  { title: 'By material', x: 736, color: mint, rules: ['CORDS HOLD / INFILL FADES', 'BODY YARN KEEPS ITS GAUGE'], options: {} }
];

function board(frame) {
  const phase = frame / (frames - 1), take = phase * phase * (3 - 2 * phase);
  const view = { w: artWidth, h: artHeight, px: 1, zoom: 1.18 - .70 * take,
    yaw: -.23 + .47 * take, pitch: .065 + .057 * Math.sin(take * Math.PI), t: frame / fps };
  const commands = [];
  const rect = (x,y,w,h,fill) => commands.push({ type: 'rect', rect: [x,y,w,h], fill });
  const text = (value,x,y,size,color = pale) => commands.push({ type: 'text', text: value, at: [x,y], scale: size, color });
  rect(0, 0, width, height, '#111c2b');
  rect(20, 28, 27, 4, mint);
  text('INK STUDIO / CURVE SPLATS', 62, 24, 2, dim);
  text('Art-directed minimum width', 20, 54, 4);
  text('CEDAR LOOM / MATCHED PERSPECTIVE ZOOM / 166 X 112 ART PIXELS', 20, 106, 2, dim);
  const rendered = panels.map(({ title, x, color, rules, options }) => {
    text(title, x, 149, 3, color);
    rect(x - 1, 182, artWidth * scale + 2, artHeight * scale + 2, line);
    rect(x, 422, artWidth * scale, 102, '#1b2b3c');
    rect(x + 16, 439, 24, 3, color);
    text(rules[0], x + 16, 454, 2, pale);
    text(rules[1], x + 16, 484, 2, dim);
    return ink.render(world, { ...view, ...options });
  });
  rect(20, 556, 1048, 1, line);
  text('CLOSE', 20, 575, 2, dim);
  text('DISTANT', 985, 575, 2, dim);
  rect(20, 608, 1048, 4, line);
  rect(20, 608, Math.max(1, 1048 * take), 4, mint);
  const plate = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
  for (const [i, { x }] of panels.entries()) {
    const image = rendered[i];
    for (let y = 0; y < artHeight * scale; y++) for (let u = 0; u < artWidth * scale; u++) {
      const a = (Math.floor(y / scale) * artWidth + Math.floor(u / scale)) * 3, b = ((183 + y) * width + x + u) * 4;
      for (let c = 0; c < 3; c++) plate.data[b + c] = image.rgb[a + c];
    }
  }
  return PNG.packRGBA(plate);
}

json(path.join(out, 'cedar-loom.json'), recipe);
json(path.join(out, 'minimum-all.json'), blanket);
const animation = [];
for (let frame = 0; frame < frames; frame++) {
  const image = board(frame);
  write(path.join(out, 'frames', 'frame-' + String(frame).padStart(3, '0') + '.png'), PNG.encodeFrame(image));
  if (frame % 2 === 0) animation.push(image);
  if (frame === 8 || frame === frames - 1)
    write(path.join(out, frame === 8 ? 'loom-close.png' : 'loom-distant.png'), PNG.encodeFrame(image));
}
write(path.join(out, 'curve-minimum-width-apng.png'), PNG.encodeAnimation(animation, fps / 2));
console.log('Rendered matched loom zooms to ' + out);
