/* Render four editable strand finishes under animated directional lights. */
const path = require('node:path');
const ink = require('..'), { KIT: K } = ink.load();
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-splat-lighting');
const still = process.argv.includes('--still'), fps = 12, count = 48;
const width = 1196, height = 906, artWidth = 184, artHeight = 98, scale = 3;
const TAU = 2 * Math.PI, camera = { dist: 5.25, target: [0, 0, 0], yaw: -.08, pitch: .12 };
const spline = (points, samples = 8) => ({ kind: 'spline', points, samples });
const strand = (object, source, style) => ({ object, source, ...style });

const twine = K.curve.spline([[-2.4,-.58,.03],[-1.89,-.24,.21],[-1.09,.50,.20],[-.43,.65,.26],
  [.15,.35,.55],[.68,-.46,.55],[1.20,-.52,.33],[1.78,-.03,.16],[2.41,.60,.1]], 15);
const yarnFrames = K.curve.frames(twine, [0, 0, 1]);
const thread = ['#c99769', '#e5bf93', '#b87852'].map((color, ply) => strand('ply-' + ply, {
  kind: 'path', points: yarnFrames.map(({ p, t, N, B }) => {
    const angle = TAU * (8 * t + ply / 3);
    return p.map((value, k) => value + .128 * (N[k] * Math.cos(angle) + B[k] * Math.sin(angle)));
  })
}, {
  edge: 'beta', color, radius: .092, opacity: .97, caps: 'blunt', lighting: 'matte-thread'
}));

const lock = [[-2.23,.79,-.12],[-1.69,.96,.02],[-1.08,.67,.32],[-.57,-.08,.51],
  [.03,-.41,.59],[.70,-.47,.43],[1.39,-.31,-.08],[2.30,-.74,-.2]];
const hair = Array.from({ length: 19 }, (_, i) => {
  const across = i / 9 - 1;
  const points = lock.map(([x, y, z], k) => {
    const u = k / (lock.length - 1), spread = .18 + .48 * Math.sin(Math.PI * u);
    return [x + across * (.35 * u - .12), y + across * spread + .12 * across * Math.sin(TAU * u),
      z + .34 * across * Math.cos(u * Math.PI) + .16 * (1 - across * across)];
  });
  return strand('hair-' + i, spline(points), {
    radius: .046 + .009 * Math.sin(i * 1.93), edge: 'beta', opacity: .93,
    color: ['#28415e', '#374c74', '#52618d', '#385687'][i % 4],
    taper: [[0, .76], [.23, 1], [.83, .83], [1, .12]], profileSamples: 28,
    lighting: { preset: 'glossy-hair', specular: .98, highlightColor: '#b8d9ff' }
  });
});

const wire = [strand('copper-wire', spline([[-2.49,-.61,0],[-1.83,-.58,.02],[-1.32,-.08,.14],
  [-1.27,.63,.19],[-.68,1,.14],[.02,.62,.03],[.26,.02,.22],[-.06,-.37,.65],[-.65,-.16,.69],
  [-.48,.43,.85],[.33,.53,.46],[1.04,.16,.12],[1.65,-.32,-.08],[2.44,-.35,.06]], 10), {
  radius: .147, edge: 'hard', section: 'round', caps: 'blunt',
  lighting: { preset: 'metal-wire', highlightColor: '#ffd89c', specular: .96 },
  along: { pigment: { samples: ['#913f29', '#be6943', '#b8683e', '#c98759', '#8d432f'] },
    roughness: [[0,.31],[.31,.19],[.60,.12],[1,.39]] }
})];

const fibres = Array.from({ length: 21 }, (_, i) => {
  const across = i / 10 - 1, reach = 1 - .23 * across * across + .045 * Math.sin(i * 5);
  const points = Array.from({ length: 6 }, (_, k) => {
    const u = k / 5;
    return [-2.15 + 4.57 * u * reach, -.54 + .78 * Math.sin(1.85 * u) + across * (u ** 1.42) * 1.22,
      .21 * Math.sin(3.2 * u) + .49 * across * u + .033 * Math.sin(i * 3 + u * 5)];
  });
  return strand('fibre-' + i, spline(points, 6), {
    radius: .055, edge: 'beta', opacity: .90, profileSamples: 25,
    taper: [[0, .8], [.22, 1], [.87, .74], [1, .05]], color: ['#734c4c', '#86604d', '#634650'][i % 3],
    lighting: { preset: 'backlit-fibre', transmission: [.92, 1.14, .68][i % 3],
      transmissionColor: ['#ffc771', '#ffab65', '#ffe0a5'][i % 3] }
  });
});

function key(phase, backlit) {
  const angle = TAU * phase, fromBehind = (.5 - .5 * Math.cos(angle)) ** .65;
  return backlit ? {
    direction: [.49 * Math.sin(angle) - .17, .29 - .17 * fromBehind, .7 - 1.7 * fromBehind],
    ambient: .38, intensity: 1.21, shadows: false
  } : {
    direction: [.82 * Math.sin(angle), .59 + .15 * Math.cos(angle), .93],
    ambient: .43, intensity: 1.1, shadows: false
  };
}

const definitions = [
  ['matte-thread', 'Matte thread', 'BROAD SHEEN ON TWISTED YARN', '#efcba4', '#17212b', thread, .08],
  ['glossy-hair', 'Glossy hair', 'HIGHLIGHT FOLLOWS THE LOCK', '#b9d5ff', '#141e30', hair, .16],
  ['metal-wire', 'Metal wire', 'TIGHT GLINTS ON BENT COPPER', '#ffbf89', '#14232a', wire, -.04],
  ['backlit-fibre', 'Backlit fibres', 'TRANSMISSION AS THE KEY SWINGS BEHIND', '#ffd49e', '#211b2b', fibres, 0]
];
const posterPhase = .46;
const panels = definitions.map(([id, label, note, color, background, strands, offset], i) => {
  const backlit = id === 'backlit-fibre';
  const recipe = { format: K.curveSplats.format, version: 1, id, background, strands, camera,
    liveSun: key(posterPhase + offset, backlit) };
  return { label, note, color, recipe, world: K.curveSplats.world(recipe), offset, backlit,
    x: 26 + 592 * (i % 2), y: i < 2 ? 132 : 518 };
});

function board(phase) {
  const commands = [], pale = '#eae9df', dim = '#a7b9c8', trim = '#3e5468';
  const rect = (x, y, w, h, fill) => commands.push({ type: 'rect', rect: [x, y, w, h], fill });
  const text = (value, x, y, size, color = pale) =>
    commands.push({ type: 'text', text: value, at: [x, y], scale: size, color });
  rect(0, 0, width, height, '#141f2e');
  rect(26, 24, 28, 4, '#b9d5ff');
  text('INK STUDIO / CURVE SPLATS', 66, 20, 2, '#b9d5ff');
  text('Strand lighting', 23, 49, 5);
  text('MOVING DIRECTIONAL KEY / 184 X 98 ART PIXELS', 26, 103, 2, dim);
  const top = 45;
  for (const { label, note, color, x, y } of panels) {
    text(label, x, y, 3, color);
    text(note, x, y + 29, 1, dim);
    rect(x - 2, y + top - 2, artWidth * scale + 4, artHeight * scale + 4, trim);
  }
  rect(26, 880, 1144, 3, trim);
  rect(26, 880, Math.max(1, 1144 * phase), 3, '#b9d5ff');
  const output = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
  for (const { x, y, world, offset, backlit } of panels) {
    const frame = ink.render(world, { raw: true, w: artWidth, h: artHeight, px: 1, liveSun: key(phase + offset, backlit) });
    for (let iy = 0; iy < artHeight * scale; iy++) for (let ix = 0; ix < artWidth * scale; ix++) {
      const from = (Math.floor(iy / scale) * artWidth + Math.floor(ix / scale)) * 3;
      const to = ((y + top + iy) * width + x + ix) * 4;
      output.data[to] = frame.rgb[from];
      output.data[to + 1] = frame.rgb[from + 1];
      output.data[to + 2] = frame.rgb[from + 2];
    }
  }
  return PNG.packRGBA(output);
}

for (const { recipe } of panels) json(path.join(out, recipe.id + '.json'), recipe);
write(path.join(out, 'strand-lighting.png'), PNG.encodeFrame(board(posterPhase)));
if (!still) {
  const apng = [];
  for (let i = 0; i < count; i++) {
    const frame = board(i / count);
    write(path.join(out, 'frames', 'frame-' + String(i).padStart(3, '0') + '.png'), PNG.encodeFrame(frame));
    if (i % 2 === 0) apng.push(frame);
  }
  write(path.join(out, 'strand-lighting-apng.png'), PNG.encodeAnimation(apng, fps / 2));
}
console.log('Rendered directional strand lighting to ' + out);
