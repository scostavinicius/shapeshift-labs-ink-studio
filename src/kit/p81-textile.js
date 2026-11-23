/* Raised yarn on surface charts, using native patches for depth and material ownership. */
(function (K) {
  const { V, curve: C } = K,
    { interlace, data } = K.procedural;
  const format = 'ink-studio/textile',
    known = new WeakSet();
  const TAU = 2 * Math.PI,
    MAX_POINTS = 60000,
    MAX_MARKS = 500000;
  const modes = ['stitch', 'knit', 'weave'];
  const number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  const vector = (v, n, min, max) =>
    Array.isArray(v) && v.length === n && Array.from(v).every(x => number(x, min, max));
  const point = p => vector(p, 3, -1e5, 1e5);
  const check = (ok, reason) => {
    if (!ok) throw new RangeError('Textile: ' + reason);
  };
  const clamp = t => Math.max(0, Math.min(1, t));
  const uv = (u, v) => [clamp(u), clamp(v)];

  function chartSampler(size, chart) {
    if (chart === undefined) return (u, v) => ({ p: [(u - 0.5) * size[0], (v - 0.5) * size[1], 0], n: [0, 0, 1] });
    function at(u, v) {
      const sample = chart(u, v);
      const result = Array.isArray(sample) ? { p: sample } : sample;
      check(point(result?.p), 'chart must return a finite point or { p, n }');
      return { p: result.p.slice(), n: result.n };
    }
    return (u, v) => {
      const { p, n } = at(u, v);
      const delta = 0.0001;
      const tangent = (a, b) => V.sub(at(...uv(...a)).p, at(...uv(...b)).p);
      const normal =
        n === undefined ? V.cross(tangent([u + delta, v], [u - delta, v]), tangent([u, v + delta], [u, v - delta])) : n;
      check(point(normal) && V.len(normal) > 1e-15, 'chart normal is degenerate');
      return { p, n: V.norm(normal) };
    };
  }

  function make(
    mode,
    {
      size = [4, 3],
      columns = 12,
      rows = 9,
      radius = 0.04,
      lift = 0,
      samples = 4,
      maxPoints = MAX_POINTS,
      chart,
      direction = [1, 0.25],
      mask,
      length = 0.87,
      arch = 0.85,
      flatness = 0.34,
      pattern,
      clearance = 0
    } = {}
  ) {
    check(
      vector(size, 2, 0.01, 1e4) &&
        integer(columns, 1, 128) &&
        integer(rows, 1, 128) &&
        number(radius, 0.0001, 100) &&
        number(lift, -100, 100) &&
        integer(samples, 2, 12) &&
        integer(maxPoints, 2, MAX_POINTS) &&
        (chart === undefined || typeof chart === 'function'),
      'invalid chart size, counts or yarn settings'
    );
    const sample = chartSampler(size, chart),
      threads = [];
    let points = 0,
      crossings = [];
    function strand(family, index, knots, { id = family + ':' + index, depth = radius, tapered = false } = {}) {
      check(points + knots.length <= maxPoints, 'point budget exceeded');
      const stations = knots.map(([u, v, h]) => {
        const { p, n } = sample(u, v);
        const center = V.mad(p, n, h + lift);
        check(point(center), 'yarn station exceeds chart bounds');
        return { uv: [u, v], p: center, n };
      });
      for (let i = 1; i < stations.length; i++)
        check(V.dist(stations[i - 1].p, stations[i].p) > 1e-8, 'chart collapses adjacent yarn stations');
      threads.push({ id, family, index, radius, depth, tapered, stations });
      points += stations.length;
    }

    if (mode === 'stitch') {
      check(
        (typeof direction === 'function' || vector(direction, 2, -1e5, 1e5)) &&
          (mask === undefined || typeof mask === 'function') &&
          number(length, 0.05, 8) &&
          number(arch, 0, 8),
        'invalid stitch direction, mask, length or arch'
      );
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < columns; col++) {
          const u = (col + 0.5) / columns,
            v = (row + 0.5) / rows;
          const d = typeof direction === 'function' ? direction(u, v) : direction;
          check(vector(d, 2, -1e5, 1e5) && Math.hypot(...d) > 1e-8, 'direction must be a nonzero chart-grid vector');
          const scale = length / (2 * Math.hypot(...d)),
            du = (d[0] * scale) / columns,
            dv = (d[1] * scale) / rows;
          const knots = [];
          for (let i = 0; i <= samples; i++) {
            const t = i / samples,
              x = u + du * (2 * t - 1),
              y = v + dv * (2 * t - 1);
            if (x < 0 || x > 1 || y < 0 || y > 1) break;
            if (mask) {
              const distance = mask(x, y);
              check(Number.isFinite(distance), 'mask must return a finite signed value');
              if (distance > 0) break;
            }
            knots.push([x, y, radius * (0.26 + arch * Math.sin(Math.PI * t))]);
          }
          if (knots.length === samples + 1) strand('stitch', row * columns + col, knots, { tapered: true });
        }
    } else if (mode === 'knit') {
      // A single continuous course. The two legs have opposite depth where adjacent rows cross.
      const loop = [
        [0, 0.05, 0],
        [0.4, 0.23, 2.45],
        [0.25, 0.97, -1.65],
        [0.3, 1.18, -1.12],
        [0.5, 1.29, 0],
        [0.7, 1.18, 1.12],
        [0.75, 0.97, 1.65],
        [0.6, 0.23, -2.45]
      ];
      check(rows * (columns * loop.length * samples + 1) <= maxPoints, 'point budget exceeded');
      for (let row = 0; row < rows; row++) {
        const knots = [];
        for (let col = 0; col < columns; col++) for (const [x, y, z] of loop) knots.push([col + x, row + y, z]);
        knots.push([columns, row + 0.05, 0]);
        strand(
          'course',
          row,
          C.spline(knots, samples).map(([x, y, z]) => [
            (x + 0.42) / (columns + 0.84),
            (y + 0.35) / (rows + 0.75),
            radius * (z + 2.6)
          ])
        );
      }
    } else {
      check(number(flatness, 0.08, 1) && number(clearance, 0, 100), 'invalid weave thickness or clearance');
      const spacing = [size[0] / columns, size[1] / rows],
        margin = spacing.map(pitch => pitch / 2);
      const loom = interlace.weave({
        warp: columns,
        weft: rows,
        radius,
        clearance,
        pattern,
        spacing,
        margin,
        transitionSamples: samples,
        u: [1, 0, 0],
        v: [0, 1, 0]
      });
      check(loom.strands.reduce((n, s) => n + s.path.points.length, 0) <= maxPoints, 'point budget exceeded');
      for (const { family, index, id, path } of loom.strands) {
        strand(
          family,
          index,
          path.points.map(([x, y, z]) => [...uv((x + margin[0]) / size[0], (y + margin[1]) / size[1]), z * flatness]),
          { id, depth: radius * flatness }
        );
      }
      crossings = loom.crossings.map(({ row, column, over, under, gap }) => ({
        uv: [(column + 0.5) / columns, (row + 0.5) / rows],
        over,
        under,
        depthGap: gap * flatness
      }));
    }
    const plan = data.freeze({
      format,
      version: 1,
      mode,
      threads,
      crossings,
      stats: { threads: threads.length, points }
    });
    known.add(plan);
    return plan;
  }

  function checkedThreads(plan) {
    if (known.has(plan)) return plan.threads;
    check(
      plan?.format === format &&
        plan.version === 1 &&
        modes.includes(plan.mode) &&
        Array.isArray(plan.threads) &&
        plan.threads.length <= 16384,
      'expected a textile plan'
    );
    let count = 0;
    const ids = new Set();
    for (const strand of plan.threads) {
      const { id, family, index, radius, depth, tapered, stations } = strand ?? {};
      check(
        typeof id === 'string' &&
          id.length > 0 &&
          id.length <= 128 &&
          !ids.has(id) &&
          ['stitch', 'course', 'warp', 'weft'].includes(family) &&
          integer(index, 0, 16384) &&
          number(radius, 0.0001, 100) &&
          number(depth, 0.000008, 100) &&
          typeof tapered === 'boolean' &&
          Array.isArray(stations) &&
          stations.length >= 2,
        'invalid thread in plan'
      );
      check((count += stations.length) <= MAX_POINTS, 'point budget exceeded');
      let previous;
      for (const s of stations) {
        check(
          vector(s?.uv, 2, 0, 1) &&
            point(s.p) &&
            point(s.n) &&
            Math.abs(V.len(s.n) - 1) < 0.001 &&
            (!previous || V.dist(previous, s.p) > 1e-8),
          'invalid yarn station'
        );
        previous = s.p;
      }
      ids.add(id);
    }
    return plan.threads;
  }

  const defaultColors = { stitch: '#edba85', course: '#74b6b7', warp: '#d09564', weft: '#4b9095' };
  function rgb(value) {
    const c =
      typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
        ? [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
        : value;
    check(vector(c, 3, 0, 255), 'yarn color must be #RRGGBB or RGB bytes');
    return c.slice();
  }

  function draw(
    B,
    plan,
    {
      color,
      sides = 6,
      light = [-0.45, 0.65, 1],
      ambient = 0.55,
      sheen = 0.2,
      twist = 0.12,
      threadPitch = 0.16,
      object = 'textile',
      material = 'yarn',
      maxMarks = 180000,
      renderer = 'patches',
      curveProfile
    } = {}
  ) {
    check(
      typeof B?.dab === 'function' &&
        integer(sides, 4, 16) &&
        point(light) &&
        V.len(light) > 0 &&
        number(ambient, 0, 1) &&
        number(sheen, 0, 1) &&
        number(twist, 0, 0.5) &&
        number(threadPitch, 0.001, 100) &&
        integer(maxMarks, 1, MAX_MARKS) &&
        ['patches', 'curve-splats'].includes(renderer) &&
        [object, material].every(s => typeof s === 'string' && s.length > 0 && s.length <= 128),
      'invalid draw settings'
    );
    const explicitColor = color === undefined || typeof color === 'function' ? null : rgb(color);
    const threads = checkedThreads(plan);
    if (renderer === 'curve-splats') return K.curveSplats.draw(B, { kind: 'textile', plan: { threads } }, {
      ...curveProfile, color: color ?? (sample => defaultColors[sample.family]), object, material,
      maxSegments: Math.min(maxMarks, K.curveSplats.segmentLimit)
    });
    const limit = threads.reduce((n, s) => n + s.stations.length * sides * 2, 0);
    check(limit <= maxMarks, 'native mark budget exceeded before drawing');

    const L = V.norm(light),
      arcs = Array.from({ length: sides }, (_, i) => {
        // Place the crown within a facet so a front view does not look down a longitudinal seam.
        const a = (TAU * (i + 0.5)) / sides;
        return [Math.cos(a), Math.sin(a)];
      });
    const tint = (base, normal, wave) => {
      const diffuse = Math.max(0, V.dot(normal, L)),
        gain = ambient + (1 - ambient) * diffuse;
      const highlight = 255 * sheen * diffuse ** 9;
      return base.map(n => Math.max(0, Math.min(255, Math.round(n * gain * (1 + twist * wave) + highlight))));
    };
    // Prepare all shade samples before touching the builder, including callback validation.
    const prepared = threads.map(({ stations, ...info }) => {
      const { id, family, index, depth, radius, tapered } = info;
      const fixed = typeof color === 'function' ? null : (explicitColor ?? rgb(defaultColors[family]));
      const points = stations.map(s => s.p),
        frames = C.frames(points, stations[0].n),
        length = C.length(points);
      const rings = stations.map(({ n }, i) => {
        const frame = frames[i];
        const perpendicular = V.mad(n, frame.T, -V.dot(n, frame.T));
        const normal = V.len(perpendicular) > 1e-6 ? V.norm(perpendicular) : frame.N;
        const across = V.cross(frame.T, normal);
        const scale = tapered ? 0.24 + 0.76 * Math.sin(Math.PI * frame.t) ** 0.7 : 1;
        return arcs.map(([c, s]) => ({
          p: V.add(frame.p, V.mul(V.add(V.mul(normal, depth * c), V.mul(across, radius * s)), scale)),
          n: V.norm(V.add(V.mul(normal, c / depth), V.mul(across, s / radius)))
        }));
      });
      const colors = frames.slice(1).map((frame, i) => {
        if (fixed) return fixed;
        const a = stations[i],
          b = stations[i + 1];
        return rgb(
          color({
            id,
            family,
            index,
            uv: a.uv.map((v, k) => (v + b.uv[k]) / 2),
            point: V.mul(V.add(a.p, b.p), 0.5),
            distance: ((frames[i].t + frame.t) * length) / 2
          })
        );
      });
      return { id, frames, rings, length, colors };
    });

    const first = B.count(),
      ranges = [];
    for (const { id, frames, rings, length, colors } of prepared) {
      const start = B.count(),
        target = { entity: object, surface: id };
      const emit = (a, b, c, base, n, wave) => {
        // A small in-plane overlap covers the sampled polygon footprint's shared edges.
        const center = V.mul(V.add(a, V.add(b, c)), 1 / 3);
        const patch = [a, b, c].map(point => V.mad(point, V.sub(point, center), 0.024));
        return K.surfacePatches.triangle(B, patch, {
          color: tint(base, n, wave),
          albedo: base.map(v => v / 255),
          object,
          material,
          target
        });
      };
      for (let i = 0; i < rings.length - 1; i++)
        for (let j = 0; j < sides; j++) {
          const k = (j + 1) % sides,
            a = rings[i][j],
            b = rings[i][k],
            c = rings[i + 1][k],
            d = rings[i + 1][j];
          const n = V.norm(V.add(V.add(a.n, b.n), V.add(c.n, d.n)));
          const distance = ((frames[i].t + frames[i + 1].t) * length) / 2;
          const wave = Math.cos(TAU * (distance / threadPitch - (j + 1) / sides));
          emit(a.p, b.p, c.p, colors[i], n, wave);
          emit(a.p, c.p, d.p, colors[i], n, wave);
        }
      for (const end of [0, rings.length - 1]) {
        const ring = rings[end],
          center = frames[end].p,
          n = V.mul(frames[end].T, end === 0 ? -1 : 1);
        const base = end === 0 ? colors[0] : colors.at(-1);
        for (let j = 0; j < sides; j++) {
          const a = ring[j].p,
            b = ring[(j + 1) % sides].p;
          if (end === 0) emit(center, b, a, base, n, 0);
          else emit(center, a, b, base, n, 0);
        }
      }
      ranges.push({ id, first: start, end: B.count() });
    }
    return { first, end: B.count(), threads: ranges };
  }

  function world(plan, { appearance, camera, background = '#182232', pal, paletteRoles, ...options } = {}) {
    const c = rgb(background),
      B = makeBuilder(1, pal ?? [c[0] * 65536 + c[1] * 256 + c[2], 0xffffff]);
    draw(B, plan, appearance?.renderer === 'curve-splats' ?
      { ...appearance, curveProfile: { paletteRoles, ...appearance.curveProfile } } : appearance);
    return B.finish({
      cam: { target: [0, 0, 0], dist: 7, yaw: 0.12, pitch: 0.1, ...camera },
      radius: 100,
      dither: 0,
      fog: { c: 0, start: 1, max: 0 },
      look: { pixelSize: 1, clean: 1, splatCoverage: 'continuous' },
      ...(paletteRoles !== undefined && { paletteRoles }),
      ...options
    });
  }
  K.textile = Object.freeze({
    stitch: options => make('stitch', options),
    knit: options => make('knit', options),
    weave: options => make('weave', options),
    draw,
    world
  });
})(KIT);
