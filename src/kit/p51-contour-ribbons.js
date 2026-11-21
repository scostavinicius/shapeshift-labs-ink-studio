/* Bounded contour extraction and native surface ribbons. */
(function (K) {
  const P = K.procedural,
    { V } = K,
    EPS = 1e-9;
  const fail = message => {
    throw new RangeError('Contour: ' + message);
  };
  const number = (n, lo, hi, label) => {
    if (!Number.isFinite(n) || n < lo || n > hi) fail('invalid ' + label);
    return n;
  };
  const integer = (n, lo, hi, label) => {
    number(n, lo, hi, label);
    if (!Number.isSafeInteger(n)) fail('invalid ' + label);
    return n;
  };
  const vector = (p, n = 3) =>
    Array.isArray(p) && p.length === n && p.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6);
  const unit = n => {
    if (!vector(n) || V.len(n) < EPS) fail('expected a finite nonzero direction');
    return V.norm(n);
  };
  const rgb = value => {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value))
      value = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    if (!vector(value) || value.some(x => x < 0 || x > 255)) fail('colors need RGB bytes or #RRGGBB');
    return value.slice();
  };
  const mod = (x, d) => ((x % d) + d) % d;
  function levels({ min, max, step, offset = 0 } = {}) {
    number(min, -1e6, 1e6, 'minimum');
    number(max, min, 1e6, 'maximum');
    number(step, 1e-5, 1e6, 'level step');
    number(offset, -1e6, 1e6, 'offset');
    const first = Math.ceil((min - offset) / step),
      last = Math.floor((max - offset) / step);
    if (last - first + 1 > 256) fail('level budget exceeded');
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => offset + (first + i) * step);
  }
  function settings(raw, bounds, dimensions = 2) {
    if (
      !vector(bounds?.min, dimensions) ||
      !vector(bounds?.max, dimensions) ||
      bounds.min.some((v, i) => v >= bounds.max[i])
    )
      fail('expected ordered bounds');
    const cell = number(raw.cell ?? 0.08, 1e-5, 1e4, 'cell size'),
      maxCells = integer(raw.maxCells ?? 240000, 1, 500000, 'cell budget'),
      maxVertices = integer(raw.maxVertices ?? 100000, 2, 500000, 'vertex budget'),
      maxEvaluations = integer(raw.maxEvaluations ?? 2000000, 1, 10000000, 'evaluation budget'),
      values = raw.levels;
    if (
      !Array.isArray(values) ||
      values.length > 256 ||
      !values.every(Number.isFinite) ||
      new Set(values).size !== values.length
    )
      fail('expected up to 256 distinct finite levels');
    const h = number(raw.normalStep ?? cell * 0.2, 1e-6, 100, 'normal step');
    let evaluations = 0;
    const spend = () => {
      if (++evaluations > maxEvaluations) fail('evaluation budget exceeded');
    };
    const evaluate =
      fn =>
      (...args) => {
        spend();
        const result = fn(...args);
        if (result !== null && !Number.isFinite(result)) fail('field must return a finite value or null');
        return result;
      };
    return { cell, maxCells, maxVertices, h, values: values.slice(), evaluate, spend, count: () => evaluations };
  }
  function gradient(field, p, h) {
    const g = p.map((_, i) => {
      const a = p.slice(),
        b = p.slice();
      a[i] += h;
      b[i] -= h;
      const x = field(...a),
        y = field(...b);
      if (x === null || y === null) fail('normal probes need a defined neighborhood');
      return (x - y) / (2 * h);
    });
    return unit(g);
  }
  function extract(s, bounds, fieldAt, mapAt, shared = false) {
    const nx = Math.ceil((bounds.max[0] - bounds.min[0]) / s.cell),
      ny = Math.ceil((bounds.max[1] - bounds.min[1]) / s.cell),
      cells = nx * ny;
    if (!Number.isSafeInteger(cells) || cells * s.values.length > s.maxCells) fail('cell budget exceeded');
    const stride = nx + 1,
      paths = [];
    let vertices = 0,
      cache;
    // Height and chart scalar samples are reused across all levels.
    function scalar(x, y, level) {
      if (!shared) return fieldAt(x, y, level);
      const i =
        Math.round(((x - bounds.min[0]) * nx) / (bounds.max[0] - bounds.min[0])) +
        stride * Math.round(((y - bounds.min[1]) * ny) / (bounds.max[1] - bounds.min[1]));
      if (cache[i] === undefined) cache[i] = fieldAt(x, y, level);
      return cache[i];
    }
    if (shared && s.values.length) cache = new Array(stride * (ny + 1));
    for (let band = 0; band < s.values.length; band++) {
      const level = s.values[band];
      for (const path of P.contours.march((x, y) => scalar(x, y, level), {
        bounds,
        cell: s.cell,
        iso: shared ? level : 0,
        maxCells: Math.min(500000, s.maxCells)
      })) {
        vertices += path.points.length;
        if (vertices > s.maxVertices || paths.length >= 8192) fail('vertex/path budget exceeded');
        const samples = path.points.map(q => mapAt(q, level));
        if (samples.some(q => !vector(q?.position) || !vector(q?.normal))) fail('invalid surface sample');
        paths.push({
          id: band + ':' + paths.length,
          band,
          level,
          closed: path.closed,
          points: samples.map(q => q.position),
          normals: samples.map(q => unit(q.normal))
        });
      }
    }
    return P.data.freeze({
      format: 'ink-studio/contour-plan',
      version: 1,
      paths,
      stats: { levels: s.values.length, cells: cells * s.values.length, vertices, evaluations: s.count() }
    });
  }
  function heightfield(height, raw = {}) {
    if (typeof height !== 'function') fail('heightfield needs a height function');
    const bounds = raw.bounds,
      s = settings(raw, bounds),
      field = s.evaluate(height);
    return extract(
      s,
      bounds,
      field,
      ([x, z], level) => {
        const a = field(x + s.h, z),
          b = field(x - s.h, z),
          c = field(x, z + s.h),
          d = field(x, z - s.h);
        if ([a, b, c, d].some(x => x === null)) fail('height normals need a defined neighborhood');
        return { position: [x, level, z], normal: [-(a - b) / (2 * s.h), 1, -(c - d) / (2 * s.h)] };
      },
      true
    );
  }
  function slices(signedDistance, raw = {}) {
    if (typeof signedDistance !== 'function') fail('SDF slices need a signed field');
    const bounds = raw.bounds,
      s = settings(raw, bounds, 3),
      axis = ['x', 'y', 'z'].indexOf(raw.axis ?? 'y');
    if (axis < 0 || s.values.some(v => v < bounds.min[axis] || v > bounds.max[axis]))
      fail('slice axis/levels outside bounds');
    const axes = [0, 1, 2].filter(i => i !== axis),
      field = s.evaluate(signedDistance),
      domain = { min: axes.map(i => bounds.min[i]), max: axes.map(i => bounds.max[i]) },
      point = (a, b, level) => {
        const p = [0, 0, 0];
        p[axis] = level;
        p[axes[0]] = a;
        p[axes[1]] = b;
        return p;
      };
    return extract(
      s,
      domain,
      (a, b, l) => field(...point(a, b, l)),
      ([a, b], level) => {
        const position = point(a, b, level);
        return { position, normal: gradient(field, position, s.h) };
      }
    );
  }
  function surface(chart, raw = {}) {
    const read =
      typeof chart === 'function' ? chart : typeof chart?.sample === 'function' ? (u, v) => chart.sample([u, v]) : null;
    if (!read || typeof raw.field !== 'function') fail('surface needs a chart and scalar field');
    const bounds = raw.bounds ?? { min: [0, 0], max: [1, 1] },
      s = settings(raw, bounds),
      scalar = s.evaluate(raw.field);
    const at = (u, v) => {
      s.spend();
      const q = read(u, v);
      if (q === null) return null;
      const p = q?.p ?? q?.point ?? q?.position,
        n = q?.n ?? q?.normal;
      if (!vector(p)) fail('chart needs finite positions');
      return { position: p.slice(), normal: n ? unit(n) : null };
    };
    return extract(
      s,
      bounds,
      (u, v) => {
        const q = at(u, v);
        return q === null ? null : scalar(...q.position, u, v);
      },
      ([u, v]) => {
        const q = at(u, v);
        if (!q) fail('contour crossed an undefined chart region');
        if (!q.normal) {
          const side = (a, b) =>
            at(Math.max(bounds.min[0], Math.min(bounds.max[0], a)), Math.max(bounds.min[1], Math.min(bounds.max[1], b)))
              ?.position;
          const a = side(u + s.h, v),
            b = side(u - s.h, v),
            c = side(u, v + s.h),
            d = side(u, v - s.h);
          if (![a, b, c, d].every(Boolean)) fail('chart normals need a defined neighborhood');
          q.normal = unit(V.cross(V.sub(a, b), V.sub(c, d)));
        }
        return q;
      },
      true
    );
  }
  function ribbons(
    plan,
    {
      width = 0.025,
      step = 0.08,
      lift = 0.003,
      majorEvery = 5,
      majorScale = 1.8,
      dash,
      dashOffset = 0,
      maxMarks = 50000,
      maxWork = 2000000
    } = {}
  ) {
    if (
      plan?.format !== 'ink-studio/contour-plan' ||
      plan.version !== 1 ||
      !Array.isArray(plan.paths) ||
      plan.paths.length > 8192
    )
      fail('expected a contour plan');
    number(step, 0.00001, 1000, 'ribbon step');
    number(lift, -100, 100, 'lift');
    integer(majorEvery, 1, 256, 'major interval');
    number(majorScale, 0.1, 10, 'major width');
    integer(maxMarks, 1, 500000, 'mark budget');
    integer(maxWork, 1, 20000000, 'ribbon work budget');
    number(dashOffset, -1e6, 1e6, 'dash offset');
    if (typeof width !== 'function') number(width, 0.00001, 100, 'width');
    if (
      dash &&
      (!Array.isArray(dash) || dash.length !== 2 || !dash.every(x => Number.isFinite(x) && x >= 0.00001 && x <= 1000))
    )
      fail('invalid dash pattern');
    const marks = [];
    let vertices = 0,
      work = 0;
    for (const path of plan.paths) {
      if ((vertices += path.points?.length ?? 0) > 500000) fail('ribbon vertex budget exceeded');
      if (
        !Array.isArray(path.points) ||
        !Array.isArray(path.normals) ||
        path.points.length !== path.normals.length ||
        path.points.length < 2 ||
        !path.points.every(p => vector(p)) ||
        !path.normals.every(p => vector(p) && V.len(p) > EPS) ||
        !Number.isFinite(path.level) ||
        !Number.isInteger(path.band) ||
        path.band < 0 ||
        typeof path.closed !== 'boolean'
      )
        fail('invalid path geometry');
      if (path.closed && V.dist(path.points[0], path.points.at(-1)) > 1e-6) fail('closed paths need a matching seam');
      let arc = 0;
      for (let j = 0; j < path.points.length - 1; j++) {
        if (++work > maxWork) fail('ribbon work budget exceeded');
        const a = path.points[j],
          b = path.points[j + 1],
          edge = V.sub(b, a),
          length = V.len(edge);
        if (length <= EPS) continue;
        const tangent = V.mul(edge, 1 / length);
        let from = 0;
        while (from < length - EPS) {
          if (++work > maxWork) fail('ribbon work budget exceeded');
          const station = arc + from;
          let phase = dash ? mod(station + dashOffset, dash[0] + dash[1]) : 0;
          if (dash) {
            if (phase < EPS || dash[0] + dash[1] - phase < EPS) phase = 0;
            else if (Math.abs(phase - dash[0]) < EPS) phase = dash[0];
          }
          const on = !dash || phase < dash[0],
            remain = !dash ? step : (on ? dash[0] : dash[0] + dash[1]) - phase,
            span = Math.min(step, length - from, remain > EPS ? remain : step),
            t = (from + span / 2) / length;
          if (on) {
            if (marks.length >= maxMarks) fail('mark budget exceeded');
            const n = unit(V.add(V.mul(path.normals[j], 1 - t), V.mul(path.normals[j + 1], t))),
              projected = V.sub(tangent, V.mul(n, V.dot(tangent, n)));
            if (V.len(projected) < EPS) fail('ribbon tangent must lie on its surface');
            const T = unit(projected),
              major = path.band % majorEvery === 0,
              meta = { path: path.id, band: path.band, level: path.level, arc: station + span / 2, major },
              w =
                number(typeof width === 'function' ? width(Object.freeze({ ...meta })) : width, 0.00001, 100, 'width') *
                (major ? majorScale : 1);
            marks.push({
              ...meta,
              position: V.add(V.add(a, V.mul(edge, t)), V.mul(n, lift)),
              normal: n,
              tangent: T,
              across: V.cross(n, T),
              length: span,
              width: w
            });
          }
          from += span;
        }
        arc += length;
      }
    }
    return P.data.freeze({ format: 'ink-studio/contour-ribbons', version: 1, marks });
  }
  function draw(B, plan, options = {}) {
    if (!B || typeof B.dab !== 'function') fail('draw needs a native builder');
    const rows = plan?.format === 'ink-studio/contour-ribbons' ? plan : ribbons(plan, options);
    if (rows.version !== 1 || !Array.isArray(rows.marks)) fail('invalid ribbon batch');
    // Revalidate external JSON plans, including all color callbacks, before emission.
    if (rows.marks.length > integer(options.maxMarks ?? 50000, 1, 500000, 'mark budget')) fail('mark budget exceeded');
    const colors = rows.marks.map(m => {
      if (
        ![m.position, m.normal, m.tangent, m.across].every(p => vector(p)) ||
        Math.abs(V.len(m.normal) - 1) > 0.001 ||
        Math.abs(V.len(m.tangent) - 1) > 0.001 ||
        Math.abs(V.dot(m.normal, m.tangent)) > 0.001 ||
        V.dist(m.across, V.cross(m.normal, m.tangent)) > 0.001
      )
        fail('invalid ribbon frame');
      number(m.width, 0.00001, 1000, 'width');
      number(m.length, 0.000000001, 1000, 'length');
      return rgb(typeof options.color === 'function' ? options.color(m) : (options.color ?? '#74d3ce'));
    });
    const alpha = number(options.alpha ?? 2.5, 0, 100, 'alpha'),
      crisp = options.footprint === 'flat',
      footprint = crisp ? SplatFootprints.prepare({ shape: 'square', softness: 0.025, depth: 'plane' }) : null;
    if (options.footprint !== undefined && !['flat', 'soft'].includes(options.footprint)) fail('unknown footprint');
    const first = B.count();
    for (let i = 0; i < rows.marks.length; i++) {
      const m = rows.marks[i],
        index = B.count(),
        a = m.length * 0.52,
        b = m.width * 0.5;
      B.dab(...m.position, m.normal, m.tangent, a, b, Math.min(a, b) * 0.08, colors[i], alpha, {
        em: options.emissive === true
      });
      if (crisp)
        B.describeFootprint(index, index + 1, footprint, [...m.tangent.map(v => v * a), ...m.across.map(v => v * b)]);
    }
    const end = B.count();
    if (B.describeSplats)
      B.describeSplats(first, end, {
        object: options.objectId ?? 'contours',
        material: options.materialId ?? 'contour-ink'
      });
    return { first, end, ids: Array.from({ length: end - first }, (_, i) => first + i), ribbons: rows };
  }
  function bands({ field, axis = [0, 1, 0], step = 0.25, offset = 0, colors = ['#173f55', '#3e8d96'] } = {}) {
    number(step, 1e-5, 1e6, 'band step');
    number(offset, -1e6, 1e6, 'band offset');
    if (field !== undefined && typeof field !== 'function') fail('band field needs a function');
    const direction = unit(axis);
    if (!Array.isArray(colors) || !colors.length || colors.length > 256) fail('invalid band palette');
    const palette = colors.map(rgb),
      scalar = field ?? ((x, y, z) => V.dot([x, y, z], direction));
    const sample = position => {
      if (!vector(position)) fail('invalid band position');
      const value = scalar(...position);
      number(value, -1e9, 1e9, 'band value');
      const station = (value - offset) / step,
        index = Math.floor(station);
      return { index, fraction: station - index, color: palette[mod(index, palette.length)].slice() };
    };
    return Object.freeze({
      sample,
      paint: position => sample(position).color,
      material(materials) {
        if (
          !Array.isArray(materials) ||
          !materials.length ||
          materials.length > 256 ||
          materials.some(m => !m || typeof m !== 'object')
        )
          fail('expected band materials');
        const retained = materials.slice();
        return { ...retained[0], materialAt: (x, y, z) => retained[mod(sample([x, y, z]).index, retained.length)] };
      }
    });
  }
  K.contour = Object.freeze({ levels, heightfield, slices, surface, ribbons, draw, bands });
})(KIT);
