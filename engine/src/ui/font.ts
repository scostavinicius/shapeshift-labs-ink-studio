// A 5 x 7 pixel font, drawn by the engine itself (no font file to fetch): capitals, digits and the punctuation a HUD
// needs. Each glyph is 7 rows of 5 bits, the leftmost pixel the highest bit. Lower case is drawn as capitals; anything
// else as a blank. Glyphs are 5 wide with 1 pixel between them: a line of n characters is 6n - 1 pixels wide.

export const GLYPH_W = 5,
  GLYPH_H = 7,
  ADVANCE = 6;

const G: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 17, 25, 21, 19, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 12, 4, 8],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '=': [0, 0, 31, 0, 31, 0, 0],
  '/': [1, 1, 2, 4, 8, 16, 16],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '<': [2, 4, 8, 16, 8, 4, 2],
  '>': [8, 4, 2, 1, 2, 4, 8],
  '%': [24, 25, 2, 4, 8, 19, 3],
  "'": [4, 4, 8, 0, 0, 0, 0],
  '#': [10, 10, 31, 10, 31, 10, 10],
  '*': [0, 4, 21, 14, 21, 4, 0]
};

/** the rows of a character's glyph (a blank for one the font does not have) */
export function glyph(ch: string): number[] {
  return G[ch.toUpperCase()] || G[' '];
}

/** how wide a line of text is, in font pixels */
export const textWidth = (s: string) => (s.length ? s.length * ADVANCE - 1 : 0);

/** a heart, 7 x 6, the leftmost pixel the highest of 7 bits */
export const HEART = [54, 127, 127, 62, 28, 8];

/**
 * The pixels of a line of text, as a mask: w x h bytes, 1 where the text is. Used by the HUD to paint text in any colour,
 * and by tests to read what was written.
 */
export function rasterize(s: string): { w: number; h: number; mask: Uint8Array } {
  const w = Math.max(1, textWidth(s)),
    h = GLYPH_H,
    mask = new Uint8Array(w * h);
  for (let c = 0; c < s.length; c++) {
    const rows = glyph(s[c]),
      x0 = c * ADVANCE;
    for (let y = 0; y < GLYPH_H; y++)
      for (let x = 0; x < GLYPH_W; x++) if (rows[y] & (1 << (GLYPH_W - 1 - x))) mask[y * w + x0 + x] = 1;
  }
  return { w, h, mask };
}

/** Read text back from a mask (the inverse of rasterize, for tests): the characters whose glyph matches each cell. */
export function readMask(m: { w: number; h: number; mask: Uint8Array }): string {
  let out = '';
  for (let x0 = 0; x0 + GLYPH_W <= m.w; x0 += ADVANCE) {
    const rows: number[] = [];
    for (let y = 0; y < GLYPH_H; y++) {
      let r = 0;
      for (let x = 0; x < GLYPH_W; x++) r = (r << 1) | m.mask[y * m.w + x0 + x];
      rows.push(r);
    }
    const hit = Object.entries(G).find(([, g]) => g.every((v, i) => v === rows[i]));
    out += hit ? hit[0] : '?';
  }
  return out;
}
