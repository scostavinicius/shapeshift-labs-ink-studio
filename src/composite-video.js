/* Art-directed composite decoding in display-referred YIQ, sampled along each scanline. */
const CompositeVideo = (() => {
  const frame = typeof FrameComposite === 'undefined' ? require('./frame-composite.js') : FrameComposite;
  const radius = 6;
  const encode = Object.freeze([[.299, .587, .114], [.595716, -.274453, -.321263],
    [.211456, -.522591, .311135]].map(Object.freeze));
  const decode = Object.freeze([[1, .956296, .621024], [1, -.272122, -.647381],
    [1, -1.106989, 1.704615]].map(Object.freeze));
  const crosstalk = Object.freeze([.34, .8]);
  const keys = ['lumaBandwidth', 'chromaBandwidth', 'artifacts', 'phase', 'phaseRate'];
  const inUnit = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const dot = (a, x, y, z) => a[0] * x + a[1] * y + a[2] * z;
  const byte = value => Math.max(0, Math.min(255, Math.round(value)));

  function kernel(bandwidth) {
    const sigma = Math.max(.01, 2.6 * (1 - bandwidth));
    return Object.freeze(Array.from({ length: radius + 1 }, (_, i) => Math.exp(-.5 * (i / sigma) ** 2)));
  }

  function prepare(options = true) {
    if (options === false) return null;
    if (options === true) options = {};
    if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
        Object.keys(options).some(key => !keys.includes(key)))
      throw new TypeError('Composite video needs a record of bandwidth and phase controls');
    const { lumaBandwidth = .62, chromaBandwidth = .28, artifacts = .55, phase = 0, phaseRate = 1 } = options;
    if (![lumaBandwidth, chromaBandwidth, artifacts].every(inUnit) || !Number.isFinite(phase) ||
        !Number.isFinite(phaseRate) || Math.abs(phaseRate) > 240)
      throw new RangeError('Composite bandwidths and artifacts need values from 0 to 1, and phaseRate from -240 to 240');
    if (lumaBandwidth === 1 && chromaBandwidth === 1) return null;
    return Object.freeze({ luma: kernel(lumaBandwidth), chroma: kernel(chromaBandwidth),
      artifacts, phase: phase % 1, phaseRate });
  }

  function carrier({ phase, phaseRate }, time) {
    if (!Number.isFinite(time)) throw new TypeError('Composite video time must be finite');
    const movingPhase = phaseRate ? (time % (1 / Math.abs(phaseRate))) * phaseRate : 0;
    const angle = (phase + movingPhase) * 2 * Math.PI;
    return [Math.cos(angle), Math.sin(angle)];
  }

  function filter(source, settings, time) {
    const { w, h, rgb, rgba, alpha } = frame.image(source);
    const output = rgba ? new Uint8Array(rgba) : new Uint8Array(w * h * 4);
    if (!rgba) for (let i = 0, j = 0; i < output.length; i += 4, j += 3) {
      output[i] = rgb[j];
      output[i + 1] = rgb[j + 1];
      output[i + 2] = rgb[j + 2];
      output[i + 3] = alpha?.[j / 3] ?? 255;
    }
    if (!settings) return { w, h, rgba: output };
    const [cos, sin] = carrier(settings, time);
    const cosPhase = [cos, -sin, -cos, sin], sinPhase = [sin, cos, -sin, -cos];
    const yLine = new Float64Array(w), iLine = new Float64Array(w), qLine = new Float64Array(w);
    const { luma, chroma, artifacts } = settings;
    for (let row = 0; row < h; row++) {
      const start = row * w * 4, sign = row & 1 ? -1 : 1;
      for (let x = 0, p = start; x < w; x++, p += 4) {
        const r = output[p], g = output[p + 1], b = output[p + 2];
        yLine[x] = dot(encode[0], r, g, b);
        iLine[x] = dot(encode[1], r, g, b);
        qLine[x] = dot(encode[2], r, g, b);
      }
      for (let x = 0, p = start; x < w; x++, p += 4) {
        if (!output[p + 3]) continue;
        const centerY = yLine[x];
        let y = 0, i = 0, q = 0, lumaWeight = 0, chromaWeight = 0, falseI = 0, falseQ = 0;
        for (let offset = -radius; offset <= radius; offset++) {
          const at = Math.max(0, Math.min(w - 1, x + offset)), tap = Math.abs(offset);
          const coverage = output[start + at * 4 + 3];
          const lw = luma[tap] * coverage, cw = chroma[tap] * coverage;
          lumaWeight += lw;
          chromaWeight += cw;
          y += yLine[at] * lw;
          i += iLine[at] * cw;
          q += qLine[at] * cw;
          if (artifacts) {
            const detail = (yLine[at] - centerY) * cw;
            falseI += detail * cosPhase[at & 3];
            falseQ += detail * sinPhase[at & 3];
          }
        }
        i /= chromaWeight;
        q /= chromaWeight;
        y = y / lumaWeight + crosstalk[0] * artifacts * sign *
          ((iLine[x] - i) * cosPhase[x & 3] + (qLine[x] - q) * sinPhase[x & 3]);
        i += crosstalk[1] * artifacts * sign * falseI / chromaWeight;
        q += crosstalk[1] * artifacts * sign * falseQ / chromaWeight;
        for (let c = 0; c < 3; c++) output[p + c] = byte(dot(decode[c], y, i, q));
      }
    }
    return { w, h, rgba: output };
  }

  return Object.freeze({ prepare, carrier, filter, radius, encode, decode, crosstalk });
})();
if (typeof module !== 'undefined') module.exports = CompositeVideo;
