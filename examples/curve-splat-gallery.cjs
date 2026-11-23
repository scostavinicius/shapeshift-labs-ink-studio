/* Review the native renderer on editable, simulated, and woven curve sources. */
const fs = require('node:fs'), path = require('node:path');
const ink = require('..'), kit = ink.load(), K = kit.KIT, C = K.curveSplats;
const PNG = require('../cli/png.js'), { write } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splats');
const frameWidth = 216, frameHeight = 112, width = 960, height = 540, fps = 12, frames = 30;
const palette = [0x172637, 0x446276, 0x768799, 0xf7bc79, 0x8fdbcf, 0xe28f78, 0xd3b9ed, 0xffe9bb];
const paint = ['#edb170', '#7acfca', '#e0979c', '#b4a1df'];
const camera = (target, dist, yaw, pitch) => ({ target, dist, yaw, pitch });
const builder = () => kit.makeBuilder(7, palette);
const finish = (B, cam) => B.finish({ cam, radius: 5, dither: 0, look: { pixelSize: 1 },
  fog: { c: 0, start: 1, max: 0 } });

const workshopWorld = (() => {
  const def = structuredClone(require('./world-routed-workshop.json'));
  def.visual.routedLinkRenderer = 'curve-splats';
  const runtime = K.world.runtime.create(def);
  return K.world.visual(kit, runtime.view(), runtime.query());
})();
function workshop(t) {
  const B = kit.makeBuilder(1, workshopWorld.pal);
  const knots = [[-3.94, 2.06, .1], [-2.78, 2.18, .33], [-1.43, 2.72 + .28 * Math.sin(t * Math.PI), .6],
    [-.23, 2.05, .12], [1.33, 2.27, -.22]];
  C.draw(B, { kind: 'spline', points: knots, samples: 8 }, {
    object: 'editable-control-line', radius: .057, color: '#ffc48a'
  });
  C.draw(B, [[-3.94, 2.06, .1], [-3.58, 1.50, .65], [-3.73, .71, .84]], {
    object: 'polyline-lead', radius: .045, color: '#bad9d1'
  });
  const combined = K.procedural.splatProvenance.join([workshopWorld, B.finish({ paint: [] })], workshopWorld);
  combined.cam = camera([-1.28, 1.3, .15], 9.3, -.43 + .49 * t, .18 + .19 * t);
  return combined;
}
const fabricWorld = (() => {
  const B = builder(), size = [4.5, 2.3];
  const cloth = K.textile.weave({
    size, columns: 10, rows: 6, radius: .054, flatness: .85, clearance: .018, pattern: ['1100', '0110', '0011', '1001'],
    chart: (u, v) => [(u - .5) * size[0], (v - .5) * size[1], .19 * Math.sin(Math.PI * u) * Math.sin(2 * Math.PI * v)]
  });
  K.textile.draw(B, cloth, { renderer: 'curve-splats', object: 'woven-swatch',
    color: ({ family, index }) => family === 'warp' ? paint[index % 3] : index % 2 ? '#5eb0a8' : '#a591cd' });
  for (const direction of [-1, 1]) B.stick(0, direction * 1.38, -.14, [1, 0, 0], .85, .065, B.P[2], 2.7);
  return finish(B, camera([0, 0, 0], 6.4, 0, 0));
})();
function fabric(t) {
  return { ...fabricWorld, cam: camera([0, 0, 0], 6.4, -.38 + .71 * t, .05 + .11 * t) };
}

function sparks(t) {
  const B = builder(), age = .53 + t * 1.05, gravity = 2.75;
  for (let i = 0; i < 11; i++) {
    const born = .015 * i, latest = age - born, first = Math.max(0, latest - .44 - .023 * i);
    const start = [-2.1, -.78 + .018 * i, -.08];
    const velocity = [2.1 + i * .14, 2.65 + .21 * Math.cos(i * 2.4), .75 * Math.sin(i * 1.31)];
    const samples = Array.from({ length: 11 }, (_, n) => {
      const sampleAge = first + (latest - first) * n / 10;
      return { point: start.map((value, k) => value + velocity[k] * sampleAge - (k === 1 ? .5 * gravity * sampleAge ** 2 : 0)) };
    });
    C.draw(B, { kind: 'trail', samples }, { object: 'particle-' + i, radius: .033 + (i % 3) * .007,
      color: paint[i % paint.length], opacity: .88 });
    B.iso(...samples.at(-1).point, .042, B.P[7], .97, { nd: true });
  }
  const path = { kind: 'family', definition: { type: 'archimedeanSpiral', axis: [1, 0, 0], origin: [-2.11, -.81, -.02],
    startRadius: .046, endRadius: .38, turns: 2, height: .26, phase: t * 1.4, segments: 56 } };
  C.draw(B, path, { object: 'nozzle-coil', radius: .027, color: '#fbd08c' });
  return finish(B, camera([-.05, .06, .02], 7.5, .18 - .34 * t, .17));
}

const shots = [
  { title: 'Workshop rigging', sub: 'AUTHORED PATH, SPLINE AND SIMULATION ROUTES', build: workshop, color: '#edb170',
    notes: ['Routed solver outputs', 'Two authored sources', 'Editable spline knots'] },
  { title: 'Woven crossings', sub: 'TEXTILE STRANDS ON A CURVED CHART', build: fabric, color: '#7acfca',
    notes: ['Native textile plan', 'Alternating crossings', 'One row per segment'] },
  { title: 'Particle arcs', sub: 'RECORDED POSITIONS AS TRAILS', build: sparks, color: '#e7b6f6',
    notes: ['Eleven sampled trails', 'Palette per particle', 'Parametric coil'] }
];
function board(shot, frame, t) {
  const commands = [];
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (value, x, y, scale, color = '#f0ebe0') =>
    commands.push({ type: 'text', text: String(value), at: [x, y], scale, color });
  rect(0, 0, width, height, '#13202d');
  rect(30, 28, 24, 4, shot.color);
  text('INK STUDIO / CURVE SOURCES', 66, 23, 2, shot.color);
  text(shot.title, 29, 65, 5);
  text(shot.sub, 31, 117, 2, '#9db6c4');
  rect(26, 151, 656, 344, '#344959');
  rect(701, 151, 231, 344, '#203448');
  text('SOURCE DATA', 718, 177, 2, shot.color);
  shot.notes.forEach((note, i) => {
    rect(719, 228 + i * 48, 3, 9, shot.color);
    text(note, 733, 229 + i * 48, 1);
  });
  text(frameWidth + ' X ' + frameHeight + ' ART PIXELS', 718, 423, 1, '#aec4cc');
  text('GAUSSIAN CURVE COVERAGE', 718, 448, 1, shot.color);
  rect(26, 517, 906, 3, '#354c60');
  rect(26, 517, Math.max(1, 906 * t), 3, shot.color);
  const art = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
  for (let y = 0; y < frameHeight * 3; y++) for (let x = 0; x < frameWidth * 3; x++) {
    const from = (Math.floor(y / 3) * frameWidth + Math.floor(x / 3)) * 3;
    const to = ((y + 155) * width + x + 30) * 4;
    art.data.set(frame.rgb.subarray(from, from + 3), to);
  }
  return PNG.packRGBA(art);
}
const gallery = [];
for (const [i, shot] of shots.entries()) {
  for (let n = 0; n < frames; n++) {
    const t = n / (frames - 1), world = shot.build(t);
    const render = ink.render(world, { raw: true, w: frameWidth, h: frameHeight, px: 1 });
    const result = board(shot, render, t);
    write(path.join(out, 'frames', 'frame-' + String(i * frames + n).padStart(3, '0') + '.png'), PNG.encodeFrame(result));
    if (n % 2 === 0) gallery.push(result);
    if (n === 16) write(path.join(out, ['rigging', 'weave', 'trails'][i] + '.png'), PNG.encodeFrame(result));
  }
}
write(path.join(out, 'curve-splat-gallery.png'), PNG.encodeAnimation(gallery, fps / 2));
fs.copyFileSync(path.join(__dirname, 'curve-splat-scene.json'), path.join(out, 'crossing-cords.json'));
console.log('Rendered the curve-source gallery in ' + out);
