/* Render distance-based strand finishes with Ink's headless renderer. */
const path = require('node:path');
const ink = require('..'), { KIT: K } = ink.load();
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const copper = require('./curve-splat-materials.json');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-materials');
const still = process.argv.includes('--still'), width = 1196, height = 718, fps = 12, frames = 48;
const paper = '#142131', light = '#eff0e4', soft = '#aec5cf', trim = '#375368';
const format = K.curveSplats.format, bg = '#101b27';
const yarn = K.textile.weave({
  size: [4.58, 2.48], columns: 10, rows: 6, radius: .083, clearance: .022, flatness: .71,
  chart: (u, v) => [(u - .5) * 4.58, (v - .5) * 2.48 + .14 * Math.sin(Math.PI * u),
    .51 * Math.cos(Math.PI * u * 1.45) * (.48 + .52 * v) + .18 * (v - .5)]
});
const bands = (first, second, third) => [[0, first], [.22, second], [.44, first], [.61, third], [.82, second]];
const weave = {
  format, version: 1, id: 'woven-yarn', background: bg,
  palette: ['#239889', '#67d0ad', '#256477', '#9f493e', '#eea567', '#f4d196', '#754461'],
  paletteRoles: { sea: [1, 2, 3], ember: [4, 5, 6], plum: [7] },
  camera: { target: [0, .06, 0], dist: 6.5, yaw: -.28, pitch: .17 },
  liveSun: { direction: [-.23, .63, .86], intensity: .83, shadows: false },
  strands: [
    ['warp', 0, bands('sea.2', 'sea.0', 'sea.1')],
    ['warp', 1, bands('sea.0', 'sea.1', 'sea.2')],
    ['weft', 0, bands('ember.1', 'ember.0', 'ember.2')],
    ['weft', 1, bands('ember.0', 'plum', 'ember.1')]
  ].map(([family, parity, paletteRole]) => ({
    source: { kind: 'textile', plan: { threads: yarn.threads.filter(thread => thread.family === family && thread.index % 2 === parity) } },
    object: 'woven-yarn', material: family, section: 'elliptical', aspect: .63, edge: 'hard',
    caps: 'rounded', along: { paletteRole, roughness: .77 }
  }))
};

const studyPath = { kind: 'spline', points: [[-1.9,-.12,0],[-1.57,.24,-.13],[-.98,.24,-.19],[-.46,-.19,.14],
  [.22,-.35,.42],[.79,.22,.33],[1.31,.31,0],[1.87,.08,-.31]], samples: 9 };
function study(id, appearance) {
  return { format, version: 1, id, background: bg, camera: { target: [0, 0, 0], dist: 3.25, yaw: 0, pitch: .2 },
    liveSun: copper.liveSun, strands: [{ source: studyPath, radius: .17, ...appearance }] };
}
const rough = study('roughness-study', { edge: 'hard', color: '#8a4228',
  along: { roughness: { keys: [[0, .91], [.48, .12]], interpolation: 'step' } } });
const fade = study('opacity-study', { edge: 'beta', color: '#78d7be',
  along: { opacity: { samples: [.96, .96, .78, .5, .17, .92, .55, .03] } } });
const glow = study('emission-study', { edge: 'beta', color: '#182e40',
  along: { emission: { keys: [[0, 0], [.14, 0], [.32, 1], [.50, 0], [.69, .1], [.82, .95], [1, 0]] },
    emissionColor: { samples: ['#416de1', '#79d2ff', '#89dfff', '#ad82ff', '#f3b9ff'] } } });

const panels = [
  { label: 'Copper wire', note: 'PALETTE ROLES, PIGMENT AND ROUGHNESS', color: '#f6bc82', x: 26, y: 133, w: 184, h: 110, scale: 3,
    recipe: copper, phase: 0 },
  { label: 'Woven yarn', note: 'STEPPED COLOURS ON WARP AND WEFT', color: '#82dfbd', x: 618, y: 133, w: 184, h: 110, scale: 3,
    recipe: weave, phase: .65 },
  { label: 'Roughness', note: 'SATIN TO POLISHED', color: '#f6bc82', x: 26, y: 541, w: 180, h: 49, scale: 2,
    recipe: rough, phase: .15 },
  { label: 'Opacity', note: 'PAINTED ALONG THE FIBRE', color: '#82dfbd', x: 418, y: 541, w: 180, h: 49, scale: 2,
    recipe: fade, phase: .2 },
  { label: 'Emission pass', note: 'ISOLATED LIGHT FROM THE STRAND', color: '#b6bbff', x: 810, y: 541, w: 180, h: 49, scale: 2,
    recipe: glow, phase: .1, emission: true }
];
for (const panel of panels) panel.world = K.curveSplats.world(panel.recipe);

function board(phase) {
  const commands = [];
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (value, x, y, size, color = light) =>
    commands.push({ type: 'text', text: value, at: [x, y], scale: size, color });
  rect(0, 0, width, height, paper);
  rect(26, 24, 28, 4, '#82dfbd');
  text('INK STUDIO / CURVE SPLATS', 68, 20, 2, '#82dfbd');
  text('Along-strand materials', 23, 48, 5);
  text('HEADLESS 3D RENDERS / 184 X 110 ART PIXELS', 26, 100, 2, soft);
  rect(26, 521, 1144, 1, trim);
  for (const panel of panels) {
    const size = panel.scale === 3 ? 3 : 2;
    text(panel.label, panel.x, panel.y, size, panel.color);
    text(panel.note, panel.x, panel.y + (size === 3 ? 28 : 21), 1, soft);
    const top = panel.y + (size === 3 ? 44 : 36);
    rect(panel.x - 2, top - 2, panel.w * panel.scale + 4, panel.h * panel.scale + 4, trim);
  }
  rect(26, 701, 1144, 3, trim);
  rect(26, 701, Math.max(1, 1144 * phase), 3, '#82dfbd');
  const plate = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });

  for (const panel of panels) {
    const { w, h, x, y, scale, world, recipe } = panel;
    const angle = phase * 2 * Math.PI + panel.phase;
    const yaw = recipe.camera.yaw + (scale === 3 ? .36 : .10) * Math.sin(angle);
    const pitch = recipe.camera.pitch + .13 * Math.cos(angle);
    const top = y + (scale === 3 ? 44 : 36);
    const frame = ink.render(world, { raw: true, w, h, px: 1, yaw, pitch, passes: panel.emission ? ['emission'] : undefined });
    const isolated = frame.passes?.emission;
    for (let v = 0; v < h * scale; v++) for (let u = 0; u < w * scale; u++) {
      const source = (Math.floor(v / scale) * w + Math.floor(u / scale)) * 3;
      const target = ((top + v) * width + x + u) * 4;
      for (let c = 0; c < 3; c++)
        plate.data[target + c] = isolated ? Math.min(255, Math.round(isolated[source + c] * 255)) : frame.rgb[source + c];
    }
  }
  return PNG.packRGBA(plate);
}

const preview = board(5 / frames);
write(path.join(out, 'along-strand-materials.png'), PNG.encodeFrame(preview));
for (const recipe of [copper, weave, rough, fade, glow]) json(path.join(out, recipe.id + '.json'), recipe);
if (!still) {
  const animation = [];
  for (let f = 0; f < frames; f++) {
    const image = f === 5 ? preview : board(f / frames);
    write(path.join(out, 'frames', 'frame-' + String(f).padStart(3, '0') + '.png'), PNG.encodeFrame(image));
    if (f % 2 === 0) animation.push(image);
  }
  write(path.join(out, 'along-strand-materials-apng.png'), PNG.encodeAnimation(animation, fps / 2));
}
console.log('Rendered along-strand materials to ' + out);
