/* Surface-space paint marks. Field queries happen at authoring time, never per frame. */
const SurfaceBrush = (() => {
  let F;
  try {
    F = SplatFootprints;
  } catch {
    F = require('./splat-footprints.js');
  }
  const shorthands = new Map();
  const styles = Object.freeze(['gouache', 'bristle', 'wash', 'ink']);
  const prepared = new WeakSet(),
    profiles = new WeakMap();
  const V = {
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  };
  const finite = (n, a, b, label) => {
    if (!Number.isFinite(n) || n < a || n > b) throw new RangeError('Surface brush: invalid ' + label);
    return n;
  };
  const xyz = (a, label) => {
    if (!(Array.isArray(a) || ArrayBuffer.isView(a)) || a.length !== 3)
      throw new TypeError('Surface brush: invalid ' + label);
    return Array.from(a, n => finite(n, -1e6, 1e6, label));
  };
  const normalize = v => {
    const d = Math.hypot(...v);
    return d > 1e-10 ? v.map(n => n / d) : null;
  };
  const project = (v, n) => {
    const d = V.dot(v, n);
    return normalize(v.map((x, i) => x - d * n[i]));
  };
  function reference(n, axis) {
    return project(axis, n) || project(Math.abs(n[0]) < 0.7 ? [1, 0, 0] : [0, 0, 1], n);
  }
  function prepare(spec) {
    if (spec === undefined || spec === false) return null;
    if (prepared.has(spec)) return spec;
    const shorthand = spec === true || typeof spec === 'string' ? spec : null;
    if (shorthand !== null && shorthands.has(shorthand)) return shorthands.get(shorthand);
    if (spec === true) spec = {};
    if (typeof spec === 'string') spec = { style: spec };
    if (
      !spec ||
      Object.getPrototypeOf(spec) !== Object.prototype ||
      Object.keys(spec).some(
        k =>
          ![
            'style',
            'direction',
            'axis',
            'field',
            'length',
            'width',
            'thickness',
            'grain',
            'seed',
            'variants',
            'softness',
            'bendLimit',
            'probe',
            'offset'
          ].includes(k)
      )
    )
      throw new TypeError('Surface brush: invalid settings');
    const {
      style = 'gouache',
      direction = 'curvature',
      axis = [0, 1, 0],
      field,
      length,
      width,
      thickness,
      grain = 0.2,
      seed = 1,
      variants = 4,
      softness = style === 'wash' ? 0.3 : 0.04,
      bendLimit = 0.45,
      probe,
      offset = 0
    } = spec;
    if (!styles.includes(style) || !['curvature', 'contour', 'axis', 'field'].includes(direction))
      throw new TypeError('Surface brush: unknown style or direction');
    const a = normalize(xyz(axis, 'axis'));
    if (!a) throw new RangeError('Surface brush: axis must be nonzero');
    if (direction === 'field' && typeof field !== 'function' && typeof field?.sample !== 'function')
      throw new TypeError('Surface brush: a field direction needs a callback or sampler');
    if (direction !== 'field' && field !== undefined)
      throw new TypeError('Surface brush: field is only used by field direction');
    for (const [key, value] of Object.entries({ length, width, thickness, probe }))
      if (value !== undefined) finite(value, 1e-5, 1000, key);
    finite(grain, 0, 1, 'grain');
    finite(softness, 0, 0.5, 'softness');
    finite(seed, 0, 4294967295, 'seed');
    finite(variants, 1, 8, 'variants');
    finite(bendLimit, 0.02, 1, 'bendLimit');
    finite(offset, -1, 1, 'offset');
    if (!Number.isInteger(seed) || !Number.isInteger(variants))
      throw new RangeError('Surface brush: seed and variants need integers');
    const p = Object.freeze({
      style,
      direction,
      axis: Object.freeze(a),
      ...(field && { field }),
      ...(length !== undefined && { length }),
      ...(width !== undefined && { width }),
      ...(thickness !== undefined && { thickness }),
      grain,
      seed,
      variants,
      softness,
      bendLimit,
      ...(probe !== undefined && { probe }),
      offset
    });
    prepared.add(p);
    if (shorthand !== null) shorthands.set(shorthand, p);
    return p;
  }
  function direction(definition, point, normal, { normalAt, spacing = 0.1 } = {}) {
    const p = prepare(definition);
    if (!p) throw new TypeError('Surface brush: direction needs enabled settings');
    const at = xyz(point, 'point'),
      n = normalize(xyz(normal, 'normal'));
    if (!n) throw new RangeError('Surface brush: normal must be nonzero');
    finite(spacing, 1e-6, 1000, 'spacing');
    const u = reference(n, p.axis),
      v = V.cross(n, u);
    let tangent = u,
      curvature = 0,
      confidence = 0,
      samples = 0;
    if (p.direction === 'axis') confidence = 1;
    if (p.direction === 'contour') {
      tangent = normalize(V.cross(p.axis, n)) || u;
      confidence = 1;
    }
    if (p.direction === 'field') {
      const raw = typeof p.field === 'function' ? p.field(...at, n.slice()) : p.field.sample(...at, n.slice());
      if (raw !== null && raw !== undefined) {
        const aligned = project(xyz(raw, 'field result'), n);
        tangent = aligned || u;
        confidence = aligned ? 1 : 0;
      }
    }
    if (p.direction === 'curvature' && normalAt !== undefined) {
      if (typeof normalAt !== 'function') throw new TypeError('Surface brush: normalAt needs a function');
      const h = p.probe ?? spacing * 0.8;
      const neighbors = [];
      for (const d of [u, v])
        for (const sign of [-1, 1]) {
          const q = at.map((x, i) => x + sign * h * d[i]),
            r = normalAt(...q);
          samples++;
          const t = r && normalize(xyz(r, 'sampled normal'));
          neighbors.push(t && V.dot(t, n) > 0.55 ? t : null);
        }
      if (neighbors.every(Boolean)) {
        const du = neighbors[1].map((x, i) => (x - neighbors[0][i]) / (2 * h)),
          dv = neighbors[3].map((x, i) => (x - neighbors[2][i]) / (2 * h));
        const a = V.dot(du, u),
          b = (V.dot(du, v) + V.dot(dv, u)) * 0.5,
          c = V.dot(dv, v),
          mean = (a + c) * 0.5,
          r = Math.hypot((a - c) * 0.5, b),
          k1 = mean + r,
          k2 = mean - r;
        curvature = Math.max(Math.abs(k1), Math.abs(k2));
        if (r > 1e-7) {
          let angle = 0.5 * Math.atan2(2 * b, a - c) + (Math.abs(k1) <= Math.abs(k2) ? 0 : Math.PI / 2);
          let t = u.map((x, i) => Math.cos(angle) * x + Math.sin(angle) * v[i]);
          if (V.dot(t, u) < 0) t = t.map(x => -x);
          confidence = Math.min(1, (Math.abs(Math.abs(k1) - Math.abs(k2)) / Math.max(0.01, curvature)) * 4);
          tangent = normalize(t.map((x, i) => u[i] * (1 - confidence) + x * confidence)) || u;
        }
      }
    }
    const bitangent = V.cross(n, tangent),
      wanted = p.length ?? spacing * 2.8;
    const length = Math.min(wanted, curvature > 1e-7 ? p.bendLimit / curvature : wanted),
      width = Math.min(p.width ?? spacing * 0.85, length);
    return {
      point: at,
      normal: n,
      tangent,
      bitangent,
      length,
      width,
      thickness: p.thickness ?? spacing * 0.08,
      confidence,
      curvature,
      normalSamples: samples
    };
  }
  function hash(seed, x, y, z) {
    let h = seed | 0;
    for (const v of [x, y, z]) {
      h = Math.imul(h ^ Math.round(v * 4096), 0x45d9f3b);
      h ^= h >>> 16;
    }
    return h >>> 0;
  }
  function profile(definition, variant = 0) {
    const p = prepare(definition);
    if (!p) throw new TypeError('Surface brush: profile needs enabled settings');
    if (!Number.isInteger(variant) || variant < 0 || variant >= p.variants)
      throw new RangeError('Surface brush: invalid variant');
    let variants = profiles.get(p);
    if (!variants) profiles.set(p, (variants = []));
    if (variants[variant]) return variants[variant];
    if (p.style === 'wash') return (variants[variant] = F.prepare({ shape: 'circle', softness: p.softness }));
    if (p.style === 'ink')
      return (variants[variant] = F.prepare({
        shape: 'polygon',
        vertices: [
          [-1, -0.5],
          [-0.8, -0.85],
          [0.7, -0.55],
          [1, 0],
          [0.65, 0.62],
          [-0.8, 0.8]
        ],
        softness: p.softness
      }));
    const width = 64,
      height = 24,
      alpha = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = ((x + 0.5) / width) * 2 - 1,
          v = ((y + 0.5) / height) * 2 - 1;
        const row = hash(p.seed + variant * 71, y, 0, 0) / 4294967296,
          grain = hash(p.seed + variant * 71, x, y, 0) / 4294967296;
        const cap = Math.pow(Math.max(0, 1 - u * u), 0.18),
          edge =
            p.style === 'bristle'
              ? 0.58 + 0.4 * row
              : 0.87 + 0.12 * Math.sin(x * 0.45 + variant) + 0.07 * (grain - 0.5);
        const gaps = p.style === 'bristle' ? row < p.grain * 0.75 : grain < p.grain * 0.12 && Math.abs(v) > 0.15;
        alpha.push(Math.abs(v) < cap * edge && !gaps && Math.abs(u) < 0.82 + 0.18 * row ? 255 : 0);
      }
    return (variants[variant] = F.prepare({ shape: 'mask', mask: { width, height, alpha }, softness: p.softness }));
  }
  function stamp(builder, frame, color, definition, { opacity = 1, animation } = {}) {
    const p = prepare(definition),
      f = frame;
    if (!p || typeof builder?.dab !== 'function' || !f || !Array.isArray(color) || color.length !== 3)
      throw new TypeError('Surface brush: invalid stamp');
    for (const key of ['point', 'normal', 'tangent', 'bitangent']) xyz(f[key], key);
    for (const key of ['length', 'width', 'thickness']) finite(f[key], 1e-8, 1000, key);
    finite(opacity, 0, 1e6, 'opacity');
    for (const c of color) finite(c, 0, 255, 'color');
    for (const key of ['normal', 'tangent', 'bitangent'])
      if (Math.abs(Math.hypot(...f[key]) - 1) > 1e-4)
        throw new RangeError('Surface brush: frame axes must be unit vectors');
    if (
      Math.abs(V.dot(f.normal, f.tangent)) > 1e-4 ||
      V.cross(f.normal, f.tangent).some((v, i) => Math.abs(v - f.bitangent[i]) > 1e-4)
    )
      throw new RangeError('Surface brush: frame must be orthogonal and right handed');
    const first = builder.count(),
      at = f.point.map((x, i) => x + p.offset * f.normal[i]);
    builder.dab(
      ...at,
      f.normal,
      f.tangent,
      f.length / (2 * F.half),
      f.width / (2 * F.half),
      f.thickness,
      color,
      opacity,
      animation
    );
    const u = f.tangent.map(n => n * f.length * 0.5),
      v = f.bitangent.map(n => n * f.width * 0.5),
      variant = hash(p.seed, ...f.point) % p.variants;
    builder.describeFootprint(first, builder.count(), profile(p, variant), [...u, ...v]);
    return first;
  }
  return Object.freeze({ styles, prepare, direction, profile, stamp });
})();
if (typeof module !== 'undefined') module.exports = SurfaceBrush;
