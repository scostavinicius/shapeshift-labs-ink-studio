/* Fragment coordinates for authored curve paint and coverage. */
const CurvePattern = (() => {
  const pixel = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  const stride = 16, axisOffset = 8, sideOffset = 11;
  const finite = (value, lo, hi) => Number.isFinite(value) && lo <= value && value <= hi;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const mix = (a, b, t) => a + (b - a) * t;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function check(ok, message) {
    if (!ok) throw new RangeError('Curve pattern: ' + message);
  }
  function paintColor(value, palette, roles) {
    if (typeof value === 'string' && !value.startsWith('#')) {
      const packed = pixel.roleColor(value, palette, roles);
      return [packed >> 16, packed >> 8 & 255, packed & 255];
    }
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
      return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    check(Array.isArray(value) && value.length === 3 &&
      Array.from(value).every(n => Number.isInteger(n) && finite(n, 0, 255)), 'dither colors need RGB bytes, hex, or palette roles');
    return value.slice();
  }

  function prepare(value, palette, roles) {
    if (value === undefined || value === false) return;
    check(record(value) && Object.keys(value).every(key => ['dash', 'grain', 'dither'].includes(key)),
      'expected dash, grain or dither settings');
    const program = {};
    for (const [kind, settings] of Object.entries(value)) {
      if (settings === false) continue;
      const extra = kind === 'dash' ? ['duty', 'phase', 'axis', 'offOpacity'] :
        kind === 'grain' ? ['strength', 'seed'] : ['colors', 'mix'];
      check(record(settings) && Object.keys(settings).every(key => ['anchor', 'spacing', ...extra].includes(key)),
        'invalid ' + kind + ' settings');
      const { anchor = 'arc', spacing = anchor === 'screen' ? 1 : anchor === 'chart' ? .05 : .12 } = settings;
      check(['arc', 'chart', 'screen'].includes(anchor), 'anchor must be arc, chart or screen');
      const pair = typeof spacing === 'number' ? [spacing, spacing] : spacing;
      check(Array.isArray(pair) && pair.length === 2 && Array.from(pair).every(n => finite(n, 1e-5, 1e5)) &&
        (kind !== 'dash' && anchor !== 'arc' || typeof spacing === 'number'), 'invalid ' + kind + ' spacing');
      if (kind === 'dash') {
        const { duty = .5, phase = 0, axis = 'u', offOpacity = 0 } = settings;
        check(finite(duty, 0, 1) && finite(phase, -1e5, 1e5) && finite(offOpacity, 0, 1) &&
          (axis === 'u' || axis === 'v' && anchor !== 'arc'), 'invalid dash duty, phase, axis or opacity');
        if (duty < 1 && offOpacity < 1) program.dash = { anchor, spacing, duty, phase, axis, offOpacity };
      } else if (kind === 'grain') {
        const { seed = 0, strength = .25 } = settings;
        check(Number.isSafeInteger(seed) && finite(strength, 0, 1), 'invalid grain seed or strength');
        if (strength) program.grain = { anchor, spacing: pair.slice(), seed, strength };
      } else {
        const { colors, mix: amount = .5 } = settings;
        check(Array.isArray(colors) && colors.length === 2 && finite(amount, 0, 1), 'dither needs two colors and a mix from 0 to 1');
        const swatches = Array.from(colors, color => paintColor(color, palette, roles));
        program.dither = { anchor, spacing: pair.slice(), colors: swatches.map(color => color.map(n => n / 255)), amount, swatches };
      }
    }
    const channels = Object.values(program);
    if (!channels.length) return;
    program.chart = channels.some(layer => layer.anchor === 'chart');
    program.surface = channels.some(layer => layer.anchor !== 'screen');
    return program;
  }

  function cell(value, spacing) {
    return Math.floor(value / spacing + 1e-8);
  }
  function chartCoordinates(u, v, topology) {
    if (!topology) return [u, v];
    if (topology.periodicU) {
      const lap = Math.floor(u + 1e-9);
      u = Math.max(0, u - lap);
      if (topology.twistedU && Math.abs(lap % 2) === 1) v = topology.periodicV ? -v : 1 - v;
    }
    if (topology.periodicV) v = Math.max(0, v - Math.floor(v + 1e-9));
    return [u, v];
  }
  function noise(x, y, seed) {
    let hash = Math.imul(x ^ seed, 0x8da6b343) ^ Math.imul(y ^ Math.floor(seed / 0x100000000), 0xd8163841);
    hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d);
    hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b);
    return ((hash ^ hash >>> 16) >>> 0) / 0x100000000;
  }

  function attach(world, index, frame, camera, forShadow) {
    const rows = world.curvePattern, at = index * stride;
    const program = rows?.[at] && world.curvePatternPrograms?.[rows[at] - 1];
    if (!program || forShadow && (!program.dash || program.dash.anchor === 'screen')) return;
    const row = rows.subarray(at, at + stride), matrix = frame?.basis().anchor;
    const vector = offset => {
      const [x, y, z] = row.subarray(offset, offset + 3);
      return matrix ? [0, 3, 6].map(i => matrix[i] * x + matrix[i + 1] * y + matrix[i + 2] * z) : [x, y, z];
    };
    const { artScale = 1, height } = camera;
    return (axis, center, half, scale) => {
      const reverse = program.surface && dot(axis, vector(axisOffset)) < 0;
      const side = program.chart && vector(sideOffset);
      const sideLength = side && Math.hypot(...side);
      const across = sideLength ? side.map(n => n / (sideLength * sideLength * scale)) : null;
      const normal = sideLength ? cross(axis, side.map(n => n / sideLength)) : null;
      const [, low, high, end, u0, v0, u1, v1] = row;
      const delta = high - low;
      function coordinates(ray, distance, x, y) {
        const screen = [Math.floor(x / artScale), Math.floor((height - y) / artScale)];
        if (!program.surface) return { screen };
        const { origin, direction } = ray;
        const start = center.map((n, i) => n - origin[i]);
        const facing = dot(axis, direction), perpendicular = 1 - facing * facing;
        const centerDepth = dot(start, direction), along = dot(start, axis);
        // Project onto the infinite line. Internal capsule caps then use the
        // same coordinates as their neighbours on a subdivided straight span.
        const t = perpendicular > 1e-5 ? (centerDepth - along * facing) / perpendicular : distance;
        const alongAt = t => {
          const u = (t * facing - along + half) / (2 * half);
          return Math.max(0, Math.min(end, low + (reverse ? 1 - u : u) * delta));
        };
        const arc = alongAt(t);
        if (!program.chart) return { screen, arc: [arc, 0] };
        // Intersect the chart's local tangent plane so pigment across a
        // broad ribbon keeps the same UVs when the camera turns.
        const slope = normal && dot(normal, direction);
        const crossing = Math.abs(slope) > .06 ? dot(normal, start) / slope : distance;
        const chartDepth = normal ? (crossing > 0 ? crossing : distance) : t;
        const fraction = (alongAt(chartDepth) - low) / delta;
        const offset = across ? chartDepth * dot(across, direction) - dot(across, start) : 0;
        return { screen, arc: [arc, 0], chart: chartCoordinates(
          mix(u0, u1, fraction) + offset * row[14],
          mix(v0, v1, fraction) + offset * row[15], program.topology
        ) };
      }
      return {
        dash: program.dash, pigment: Boolean(program.grain || program.dither), coordinates,
        opacity(site) {
          const { anchor, spacing, phase, duty, axis, offOpacity } = program.dash;
          const period = (site[anchor][axis === 'u' ? 0 : 1] + phase) / spacing;
          const stable = period + 1e-8;
          return stable - Math.floor(stable) < duty ? 1 : offOpacity;
        },
        paint(site, out) {
          out[0] = 1;
          const { grain, dither } = program;
          if (grain) {
            const [x, y] = site[grain.anchor];
            out[0] = 1 + (2 * noise(cell(x, grain.spacing[0]), cell(y, grain.spacing[1]), grain.seed) - 1) * grain.strength;
          }
          let color;
          if (dither) {
            const [x, y] = site[dither.anchor], i = cell(x, dither.spacing[0]);
            const j = dither.anchor === 'arc' ? Math.floor(i / 4) : cell(y, dither.spacing[1]);
            color = dither.colors[Number(pixel.bayerRank(i, j) < dither.amount)];
          }
          return color;
        }
      };
    };
  }

  return Object.freeze({ prepare, attach, stride, axisOffset, sideOffset });
})();
if (typeof module !== 'undefined') module.exports = CurvePattern;
