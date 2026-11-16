// Scoring two pictures on the art grid, and laying them side by side. Used by run.mjs; tested by test/parity.test.mjs.

/**
 * ref: { w, h, rgb } the reference; got: rgb bytes of the engine's picture (same size) or null; bg: the background colour.
 * Foreground parity is the share of matching pixels among those where either picture is not background, so an empty
 * picture scores 0% whatever the scene. Returns { all, fg, diff } (percentages, and a difference picture).
 */
export function compare(ref, got, bg) {
  const n = ref.w * ref.h;
  let same = 0,
    fg = 0,
    fgSame = 0;
  const diff = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    const q = p * 3,
      r0 = ref.rgb[q],
      g0 = ref.rgb[q + 1],
      b0 = ref.rgb[q + 2];
    const r1 = got ? got[q] : -1,
      g1 = got ? got[q + 1] : -1,
      b1 = got ? got[q + 2] : -1;
    const eq = r0 === r1 && g0 === g1 && b0 === b1;
    const refFg = !(r0 === bg[0] && g0 === bg[1] && b0 === bg[2]),
      gotFg = !!got && !(r1 === bg[0] && g1 === bg[1] && b1 === bg[2]);
    if (eq) same++;
    if (refFg || gotFg) {
      fg++;
      if (eq) fgSame++;
    }
    // the difference picture: the reference dimmed to grey, red where they differ
    const grey = Math.round((r0 * 0.3 + g0 * 0.55 + b0 * 0.15) * 0.45);
    diff[q] = eq ? grey : 255;
    diff[q + 1] = eq ? grey : 32;
    diff[q + 2] = eq ? grey : 32;
  }
  return { all: (100 * same) / n, fg: fg ? (100 * fgSame) / fg : 100, diff };
}

/** Pictures of w x h side by side, each scaled up 2x; a missing one (null) is drawn as a dark checker. */
export function sheet(w, h, parts) {
  const k = 2,
    gap = 4,
    SW = (w * k + gap) * parts.length - gap,
    SH = h * k,
    rgb = new Uint8Array(SW * SH * 3);
  parts.forEach((src, i) => {
    const ox = i * (w * k + gap);
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < w * k; x++) {
        const s = (((y / k) | 0) * w + ((x / k) | 0)) * 3,
          d = (y * SW + ox + x) * 3;
        if (src) {
          rgb[d] = src[s];
          rgb[d + 1] = src[s + 1];
          rgb[d + 2] = src[s + 2];
        } else {
          const c = ((x >> 4) + (y >> 4)) & 1 ? 40 : 24;
          rgb[d] = rgb[d + 1] = rgb[d + 2] = c;
        }
      }
  });
  return { w: SW, h: SH, rgb };
}
