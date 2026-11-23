/* A falling signal and the exact pixel cels that make it. */
const W = 388, H = 240, LOOP = 4;
const COLUMNS = 12, ROWS = 18, PITCH = 10;
const glyphs = [
  ['cross', 'CROSS'], ['outline-cross', 'OUTLINE'], ['split-cross', 'SPLIT'], ['ring', 'RING'],
  ['diamond', 'DIAMOND'], ['four-dot', 'FOUR DOT'], ['brackets', 'BRACKETS']
];
const mod = (n, size) => ((n % size) + size) % size;

function put(rgba, x, y, rgb) {
  const i = (y * W + x) * 4;
  rgba[i] = rgb >> 16;
  rgba[i + 1] = (rgb >> 8) & 255;
  rgba[i + 2] = rgb & 255;
  rgba[i + 3] = 255;
}

function rect(rgba, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++)
    put(rgba, x + dx, y + dy, color);
}

function blit(rgba, art, x, y, scale = 1) {
  for (let dy = 0; dy < art.height; dy++) for (let dx = 0; dx < art.width; dx++) {
    const i = (dy * art.width + dx) * 4;
    if (!art.rgba[i + 3]) continue;
    const rgb = (art.rgba[i] << 16) | (art.rgba[i + 1] << 8) | art.rgba[i + 2];
    rect(rgba, x + dx * scale, y + dy * scale, scale, scale, rgb);
  }
}

module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'signal-fall', name: 'Signal Fall', seed: 49,
  build(seed) {
    const stamps = K.pixelStamps;
    const font = K.inspection.font({});
    const chips = glyphs.map(([variant]) => {
      const clip = stamps.clip('glyph-' + variant);
      let time = 0;
      return clip.frames.map(({ duration }) => {
        const art = stamps.image(clip, { time: time + duration / 2 });
        time += duration;
        return art;
      });
    });
    const plate = new Uint8Array(W * H * 4);

    function label(text, x, y, color, scale = 1) {
      for (const ch of text) {
        const bits = font.get(ch);
        for (let v = 0; v < 8; v++) for (let u = 0; u < 6; u++)
          if (bits[v * 6 + u]) rect(plate, x + u * scale, y + v * scale, scale, scale, color);
        x += 6 * scale;
      }
    }

    rect(plate, 0, 0, W, H, 0x0c111a);
    label('SIGNAL FALL', 14, 14, 0xe0edef, 2);
    label('GLYPH LIBRARY', 219, 19, 0x9bb9c5);
    rect(plate, 14, 35, 360, 1, 0x2e4657);
    rect(plate, 14, 40, 190, 181, 0x080d17);
    rect(plate, 14, 40, 1, 181, 0x293f53);
    rect(plate, 203, 40, 1, 181, 0x293f53);
    for (let y = 44; y < 219; y += 5) for (let x = 20; x < 203; x += 5)
      put(plate, x, y, 0x172440);
    for (let col = 0; col < COLUMNS; col++) {
      const x = 26 + col * 15;
      rect(plate, x, 42, 1, 178, 0x111b2a);
      rect(plate, x - 2, 222, 5, 2, col % 3 === 0 ? 0x719fae : 0x38556b);
    }
    rect(plate, 14, 220, 190, 1, 0x8eafbc);

    const specimenX = [291, 316, 341, 366];
    for (const [i, header] of ['IN', 'PEAK', 'OUT', 'DIM'].entries())
      label(header, specimenX[i] - 3 * header.length, 43, 0x7594a9);
    for (const [i, [, name]] of glyphs.entries()) {
      const y = 64 + 24 * i;
      label(name, 219, y - 3, 0xc1cfd8);
      rect(plate, 219, y + 13, 155, 1, 0x233647);
      for (const [phase, x] of specimenX.entries()) {
        rect(plate, x - 9, y - 9, 18, 18, phase === 1 ? 0x203243 : 0x131f2e);
        rect(plate, x - 8, y - 8, 16, 16, 0x0b131f);
        blit(plate, chips[i][phase], x - 7, y - 7, 2);
      }
    }

    const random = K.grow.dice(seed);
    const lanes = Array.from({ length: COLUMNS }, (_, col) => {
      const interval = [11, 14, 16, 12, 13][col % 5];
      return {
        interval, offset: random() * interval, crest: 1.5 + random() * 1.2,
        forms: Array.from({ length: ROWS }, () => ({
          glyph: Math.floor(random() * glyphs.length),
          dormant: random() < .42
        }))
      };
    });

    function stream({ time }) {
      const rgba = plate.slice();
      const progress = mod(time, LOOP) / LOOP;
      for (const [col, lane] of lanes.entries()) {
        // Lanes complete three whole cycles in four seconds, with different
        // pulse spacing and phase. The ink stays on its grid.
        const head = lane.offset + progress * lane.interval * 3;
        for (const [row, { glyph, dormant }] of lane.forms.entries()) {
          const age = mod(head - row, lane.interval);
          let phase = -1;
          if (age < lane.crest) phase = 1;
          else if (age < lane.crest + 2.2) phase = 2;
          else if (age < lane.crest + 4 || dormant) phase = 3;
          if (age > lane.interval - .85) phase = 0;
          if (phase >= 0)
            blit(rgba, chips[glyph][phase], 23 + col * 15, 42 + row * PITCH);
        }
      }
      return { w: W, h: H, rgba };
    }

    return makeBuilder(seed, [0x0c111a]).finish({
      dither: 0,
      look: { composite: { world: { resolution: [8, 8] },
        layers: [{ source: stream, resolution: [W, H], filter: 'nearest' }] } }
    });
  }
});
