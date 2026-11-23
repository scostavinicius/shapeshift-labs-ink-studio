/* North Lock, a tiled station display with a moving palette write head. */
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const ink = require('..');
const PNG = require('../cli/png.js');

function study(K) {
  const width = 240, height = 128, x = 24, y = 24, panelWidth = 192, panelHeight = 72;
  const duration = 4.8;
  const palette = {
    palette: [
      '#0c2730', '#9aeede', '#0b202b', '#57a9a3', '#13323a', '#c0fff0',
      '#2d183c', '#e798d6', '#441943', '#ffb2e5', '#742754', '#fff0f5',
      '#29352f', '#f2ce87', '#192c36', '#80aca8'
    ],
    roles: {
      glass: 0, mint: 1, dimGlass: 2, dimMint: 3, brightGlass: 4, whiteMint: 5,
      violet: 6, orchid: 7, plum: 8, rose: 9, hotPlum: 10, pinkWhite: 11,
      brass: 12, honey: 13, slate: 14, fog: 15
    }
  };
  const styles = {
    glass: { ink: 'mint', paper: 'glass' },
    low: { ink: 'dimMint', paper: 'dimGlass' },
    bright: { ink: 'whiteMint', paper: 'brightGlass' },
    trail: { ink: 'orchid', paper: 'violet' },
    scan: { ink: 'rose', paper: 'plum' },
    crest: { ink: 'pinkWhite', paper: 'hotPlum' },
    alert: { ink: 'honey', paper: 'brass' },
    fog: { ink: 'fog', paper: 'slate' }
  };

  // The sign matrix is drawn at its final size. Its foreground and background share one bitplane.
  const small = {
    A:'25755', B:'65656', C:'34443', D:'65556', E:'74647', F:'74644', G:'34553',
    H:'55755', I:'72227', J:'11153', K:'55655', L:'44447', M:'57755', N:'57775', O:'25552',
    P:'65644', Q:'25573', R:'65655', S:'34216', T:'72222', U:'55557', V:'55552', W:'55577',
    X:'55255', Y:'55222', Z:'71247', '0':'25552', '1':'26227', '2':'61247','3':'61216',
    '4':'55711','5':'74616','6':'34653','7':'71122','8':'25252','9':'25316','·':'00020'
  };
  const large = {
    N:[17,25,29,21,23,19,17], O:[14,27,17,17,17,27,14], R:[30,17,17,30,20,18,17],
    T:[31,31,4,4,4,4,4], H:[17,17,17,31,17,17,17], L:[16,16,16,16,16,16,31],
    C:[15,24,16,16,16,24,15], K:[17,18,20,24,20,18,17]
  };
  function letters(plot, text, left, top, {scale = 1, big = false} = {}) {
    const font = big ? large : small, size = big ? 5 : 3;
    for (const char of text) {
      const rows = font[char];
      if (rows) for (let row = 0; row < rows.length; row++)
        for (let col = 0; col < size; col++)
          if (+rows[row] & (1 << (size - col - 1))) plot(left + col * scale, top + row * scale, scale, scale);
      left += (size + 1) * scale;
    }
  }
  const data = new Uint8Array(panelWidth * panelHeight);
  function bits(left, top, w, h) {
    for (let row = top; row < top + h; row++) data.fill(1, row * panelWidth + left, row * panelWidth + left + w);
  }
  letters(bits, 'TIDEWAY TRANSIT', 11, 6);
  letters(bits, 'EASTBOUND', 145, 6);
  letters(bits, 'NORTH LOCK', 11, 19, { scale: 2, big: true });
  for (const [row, line] of [
    [0,'...........##........'], [1,'...........####......'], [2,'.............####....'],
    [3,'...............####..'], [4,'#####################'], [5,'#####################'],
    [6,'...............####..'], [7,'.............####....'], [8,'...........####......'],
    [9,'...........##........']
  ]) {
    for (let col = 0; col < line.length; col++) if (line[col] === '#') bits(155 + col, 21 + row, 1, 1);
  }
  bits(10, 39, 69, 1);
  bits(83, 39, 23, 1);
  bits(112, 39, 69, 1);
  bits(10, 40, 2, 1);
  bits(179, 40, 2, 1);
  letters(bits, 'PLATFORM', 11, 52);
  letters(bits, '07', 51, 48, { scale: 2 });
  letters(bits, 'NEXT DEPARTURE', 104, 48);
  letters(bits, '02 MIN', 104, 56);
  letters(bits, 'LIVE', 162, 57);
  for (let i = 0; i < 43; i++) {
    const px = 10 + i * 4;
    bits(px, i % 4 === 0 ? 66 : 67, i % 5 === 0 ? 2 : 1, i % 4 === 0 ? 3 : 1);
  }
  for (const [left, top, dx, dy] of [[3, 3, 1, 1], [188, 3, -1, 1], [3, 68, 1, -1], [188, 68, -1, -1]]) {
    bits(Math.min(left, left + 4 * dx), top, 5, 1);
    bits(left, Math.min(top, top + 3 * dy), 1, 4);
  }

  const cells = [];
  for (let row = 0; row < 9; row++) for (let col = 0; col < 24; col++) {
    let attributes;
    if (row === 0 || row === 4 || row === 8 || col === 0 || col === 23) attributes = styles.low;
    if ((row === 2 || row === 3) && col >= 19 && col <= 22) attributes = styles.bright;
    if (row === 7 && col >= 20 && col <= 22) attributes = { ...styles.alert, priority: 9 };
    if (attributes) cells.push({ cell: [col, row], attributes });
  }
  const bitmap = { width: panelWidth, height: panelHeight, channels: 1, data };
  const initial = K.procedural.pixelEffects.tileAttributes.compile(bitmap, palette, { defaults: styles.glass, cells });

  const D = K.procedural.drawing2d, R = K.procedural.raster;
  const scene = [];
  function rect(left, top, w, h, fill, commands = scene) {
    commands.push({ type: 'rect', rect: [left, top, w, h], fill });
  }
  function chamfer(left, top, right, bottom, cut, fill) {
    scene.push({ type: 'polygon', points: [
      [left + cut, top], [right - cut, top], [right, top + cut], [right, bottom - cut],
      [right - cut, bottom], [left + cut, bottom], [left, bottom - cut], [left, top + cut]
    ], fill });
  }

  rect(0, 0, width, height, '#162733');
  rect(0, 105, width, 6, '#12232e');
  rect(0, 111, width, 9, '#1a2b36');
  rect(0, 121, width, 7, '#101b26');
  for (const top of [8, 39, 74, 111]) {
    rect(0, top, width, 1, '#0f1c29');
    rect(0, top + 1, width, 1, '#263842');
  }
  for (const left of [8, 230]) {
    rect(left, 0, 3, height, '#101e2a');
    rect(left + 1, 0, 1, height, '#35464b');
    for (const top of [13, 40, 75, 115]) {
      rect(left - 2, top, 7, 3, '#1f303a');
      rect(left - 1, top, 4, 1, '#617769');
    }
  }
  for (let i = 0; i < 210; i++) {
    const px = Math.floor(K.hash(i, 19, 23) * width), py = Math.floor(K.hash(i, 41, 82) * height);
    rect(px, py, i % 9 === 0 ? 2 : 1, 1, i % 3 === 0 ? '#39464a' : '#20313c');
  }

  chamfer(13, 16, 228, 114, 8, '#101927');
  chamfer(14, 12, 225, 108, 8, '#1b303a');
  chamfer(15, 12, 225, 106, 7, '#6f867c');
  chamfer(16, 13, 224, 107, 7, '#334b52');
  chamfer(18, 15, 222, 105, 6, '#233942');
  rect(24, 14, 192, 1, '#8e9d81');
  rect(24, 15, 192, 1, '#48646a');
  rect(23, 23, 194, 74, '#071722');
  rect(22, 24, 1, 72, '#466a68');
  rect(217, 22, 1, 74, '#607667');
  rect(23, 97, 194, 1, '#5c766b');
  rect(23, 98, 194, 2, '#304a50');
  rect(26, 101, 187, 1, '#1a2f3b');
  rect(23, 19, 194, 3, '#0c2430');
  rect(24, 19, 192, 1, '#396463');
  rect(24, 21, 192, 1, '#152f3a');
  for (const [left, top] of [[19, 20], [218, 20], [19, 100], [218, 100]]) {
    rect(left, top, 3, 3, '#101d2b');
    rect(left, top, 2, 1, '#a5a284');
    rect(left + 1, top + 1, 1, 1, '#4f6d6c');
  }
  for (const left of [25, 191]) for (let i = 0; i < 6; i++) {
    rect(left + i * 4, 102, 2, 2, '#112632');
    rect(left + i * 4, 102, 2, 1, '#496369');
  }
  for (const left of [32, 201]) {
    rect(left, 108, 5, 9, '#0e2330');
    rect(left + 1, 109, 1, 8, '#546d6a');
    rect(left - 2, 116, 17, 3, '#162a34');
    rect(left + 1, 116, 12, 1, '#516060');
  }
  rect(90, 99, 60, 6, '#1d282f');
  letters((l, t, w, h) => rect(l, t, w, h, '#85836f'), 'RELAY 07', 104, 100);
  rect(93, 101, 3, 2, '#d68e69');
  rect(144, 101, 3, 2, '#668b80');
  rect(14, 124, 26, 1, '#394b4a');
  rect(201, 124, 26, 1, '#394b4a');

  const housing = D.render({ width, height, commands: scene, edges: 'hard' });
  function beam(left, right) {
    const width = 85, height = panelHeight, data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const step = Math.floor((height - y - 1) / 4) + (y % 13 >= 11 ? 2 : 0);
      data.fill(255, y * width + left + step, y * width + right + step);
    }
    return { width, height, channels: 1, data };
  }
  const masks = [
    ['Afterglow', 2, styles.trail, beam(2, 21)],
    ['Scanner', 4, styles.scan, beam(21, 55)],
    ['Beam edge', 6, styles.crest, beam(55, 59)]
  ];

  function frame(surface, time = 0) {
    const phase = ((time % duration) + duration) % duration;
    const travel = -86 + Math.floor(Math.max(0, phase - .5) * 100);
    const writes = masks.map(([id, priority, attributes, mask]) => ({ id, priority, attributes, mask, at: [travel, 0] }));
    const panel = surface.frame({ writes });
    const head = Math.min(panelWidth - 3, Math.max(2, travel + 73));
    const rail = [
      { type: 'rect', rect: [head - 4, 0, 9, 5], fill: '#122232' },
      { type: 'rect', rect: [head - 3, 0, 7, 1], fill: '#735063' },
      { type: 'rect', rect: [head - 2, 2, 5, 1], fill: '#d971a6' },
      { type: 'rect', rect: [head, 3, 2, 2], fill: '#fff0ef' }
    ];
    const carriage = D.render({ width: panelWidth, height: 5, commands: rail, edges: 'hard' });
    const { value } = R.stack({ width, height, layers: [
      { source: housing }, { source: panel.value, x, y }, { source: carriage, x, y: y - 6 }
    ] });
    return { value, panel };
  }

  return { initial, frame, duration, width, height, x, y, palette, styles };
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] ?? 'studio/tile-attributes');
  fs.mkdirSync(out, { recursive: true });
  const packed = gzipSync(ink.bundle() + '\nreturn KIT;', { level: 9 }).toString('base64');
  const template = fs.readFileSync(path.join(__dirname, 'tile-attributes.html.template'), 'utf8');
  fs.writeFileSync(path.join(out, 'north-lock.html'), template.replace('/* STUDIO */', () => `
    const bytes = Uint8Array.from(atob('${packed}'), char => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const K = Function(await new Response(stream).text())();
    const demo = (${study.toString()})(K);`));
  if (process.argv.includes('--frames')) {
    const K = ink.load().KIT;
    const demo = study(K);
    const directory = path.join(out, 'frames');
    fs.mkdirSync(directory, { recursive: true });
    for (let n = 0; n < Math.round(demo.duration * 15); n++) {
      const { value } = demo.frame(demo.initial, n / 15);
      fs.writeFileSync(path.join(directory, String(n).padStart(3, '0') + '.png'),
        PNG.encode(value.width, value.height, value.data, 4));
    }
  }
}
module.exports = study;
