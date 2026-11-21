/* Rest-space brush marks and the broader pigment shapes they resolve to. */
const Brushwork = (() => {
  let Brush;
  try {
    Brush = SurfaceBrush;
  } catch {
    Brush = require('./surface-brush.js');
  }
  const clamp = v => Math.max(0, Math.min(1, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = v => {
    const length = Math.hypot(...v);
    return v.map(n => n / length);
  };
  const range = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;

  function prepare(value) {
    if (value === undefined || value === false) return undefined;
    if (value === true) value = {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(key => !['direction', 'axis', 'probe', 'width', 'groupScale', 'groupContrast', 'detailPixels'].includes(key)))
      throw new TypeError('Brushwork: invalid settings');
    const {
      direction = 'curvature', axis = [0, 1, 0], probe, width = .29,
      groupScale = 3.5, groupContrast = .4, detailPixels = [.65, 2]
    } = value;
    if (!['curvature', 'contour', 'axis'].includes(direction))
      throw new TypeError('Brushwork: direction must be curvature, contour or axis');
    const flow = Brush.prepare({ direction, axis, probe });
    if (!range(width, .08, .58) || !range(groupScale, 1.5, 16) || !range(groupContrast, 0, 1) ||
        !Array.isArray(detailPixels) || detailPixels.length !== 2 ||
        !Array.from(detailPixels).every(n => range(n, 0, 16)) || detailPixels[0] >= detailPixels[1])
      throw new RangeError('Brushwork: invalid width, groupScale, groupContrast or detailPixels');
    return Object.freeze({ direction, axis: flow.axis, ...(probe !== undefined && { probe }),
      width, groupScale, groupContrast, detailPixels: Object.freeze(detailPixels.slice()) });
  }

  const frames = new WeakMap();
  function frame(settings, point, normal, options) {
    if (!frames.has(settings)) {
      const { direction, axis, probe } = settings;
      frames.set(settings, Brush.prepare({ direction, axis, probe }));
    }
    const { tangent, bitangent } = Brush.direction(frames.get(settings), point, normal, options);
    return [...tangent, ...bitangent];
  }

  // The integer hash and compact support are shared with the WebGL paint sampler.
  function hash(x, y, z, seed) {
    let n = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed;
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return (n ^ (n >>> 16)) >>> 0;
  }
  const byte = (hash, shift) => ((hash >>> shift) & 255) / 255;

  function pigment([x, y, z], seed) {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const u = smooth(0, 1, x - i), v = smooth(0, 1, y - j), w = smooth(0, 1, z - k);
    const at = (a, b, c) => byte(hash(i + a, j + b, k + c, seed), 24);
    const layer = c => mix(mix(at(0, 0, c), at(1, 0, c), u), mix(at(0, 1, c), at(1, 1, c), u), v);
    return mix(layer(0), layer(1), w);
  }

  function detail([x, y, z], tangent, normal, width, seed) {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const across = cross(normal, tangent);
    let pigment = 0, total = 0;
    // Even after jitter, each brush fits inside a unit sphere around its lattice point.
    // At most the eight enclosing corners can contribute, including at tile seams.
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++)
        for (let c = 0; c < 2; c++) {
          const h = hash(i + a, j + b, k + c, seed);
          const d = [x - i - a - .12 * (byte(h, 0) - .5),
            y - j - b - .12 * (byte(h, 8) - .5), z - k - c - .12 * (byte(h, 16) - .5)];
          const along = dot(d, tangent) / (.68 + .2 * byte(h, 8));
          if (Math.abs(along) >= 1) continue;
          const waist = dot(d, across) / (width * (.8 + .4 * byte(h, 16)));
          const depth = dot(d, normal) / .68;
          const weight = 1 - smooth(.54, 1, along * along + waist * waist + depth * depth);
          pigment += weight * (byte(h, 24) - .5);
          total += weight;
        }
    return pigment / Math.max(1, total);
  }

  function coverage(p, point, normal, tangent, tone, footprint) {
    const { brushwork: b, scale, origin, seed } = p;
    const q = point.map((n, i) => (n - origin[i]) / scale), pixels = scale / Math.max(1e-8, footprint);
    const groupSize = smooth(.65, 1.8, pixels * b.groupScale);
    const grouping = groupSize && b.groupContrast
      ? b.groupContrast * groupSize * (smooth(.24, .76, pigment(q.map(n => n / b.groupScale), seed ^ 0x9e3779b9)) - .5)
      : 0;
    const grain = smooth(...b.detailPixels, 2 * b.width * pixels);
    if (!grain) return clamp(tone + grouping);
    const n = unit(normal), u = tangent ? unit(tangent) : frame(b, [0, 0, 0], n).slice(0, 3);
    return clamp(tone + grouping + grain * .9 * detail(q, u, n, b.width, seed));
  }

  return Object.freeze({ prepare, frame, coverage });
})();
if (typeof module !== 'undefined') module.exports = Brushwork;
