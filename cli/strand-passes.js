const CurveSplat = require('../src/curve-splat.js');
const ArtPasses = require('../src/art-passes.js');

const mix = (a, b, t) => a + (b - a) * t;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function project(camera, point, w, h) {
  const { view, near, ortho, focal } = camera, [x, y, z] = point;
  const depth = -(view[2] * x + view[6] * y + view[10] * z + view[14]);
  if (depth < near) return null;
  const units = (ortho ? 1 : depth) / focal;
  return { x: w / 2 + (view[0] * x + view[4] * y + view[8] * z + view[12]) / units,
    y: h / 2 - (view[1] * x + view[5] * y + view[9] * z + view[13]) / units, depth, units };
}

function create(world, selected, w, h, { pixel, motion, camera, time, source, reset, previous }) {
  let bottom = -1;
  if (pixel !== undefined) {
    if (!Array.isArray(pixel) || pixel.length !== 2 || !pixel.every(Number.isSafeInteger) ||
        pixel[0] < 0 || pixel[0] >= w || pixel[1] < 0 || pixel[1] >= h)
      throw new RangeError('strandPixel needs [x, y] on the native art grid');
    bottom = (h - 1 - pixel[1]) * w + pixel[0];
  }
  const capture = motion || ArtPasses.strands.some(channel => selected.has(channel));
  const size = w * h, spans = new Map(), layers = [];
  const coverage = capture && new Float32Array(size);
  const owner = capture && new Uint32Array(size);
  const station = capture && new Float32Array(size);
  const depths = capture && new Float32Array(size).fill(Infinity);
  const strands = [null, ...(world.curveStrands ?? [])];
  const prior = motion && !reset && previous?.source === source && previous.w === w && previous.h === h &&
    previous.camera.ortho === camera.ortho && previous.time <= time ? previous : null;

  function span(i, carrier, curve, endIndex, orient) {
    const { track, axis } = curve;
    const rows = carrier.curveStations, at = i * CurveSplat.stationStride;
    const authored = rows?.[at];
    const id = authored || (world.curveStrands?.length ?? 0) + i + 1;
    const direction = authored ? orient(rows.subarray(at + 4, at + 7)) : axis;
    const reverse = dot(direction, axis) < 0;
    const { start, end, first, last } = track;
    const lastRow = endIndex * CurveSplat.stationStride;
    const from = authored ? rows[at + 1] : 0;
    const length = authored ? rows[at + 3] : Math.hypot(...end.map((n, k) => n - start[k]));
    const to = authored ? rows[(rows[lastRow] === authored ? lastRow : at) + 2] : length;
    strands[id] ??= { name: null, length };
    const value = { i, id, from, to, length, reverse,
      start: reverse ? end : start, end: reverse ? start : end,
      first: reverse ? 1 - last : first, last: reverse ? 1 - first : last,
      tangent: reverse ? axis.map(value => -value) : axis };
    spans.set(i + 1, value);
    return value;
  }

  function hit(span, station) {
    return { span, t: mix(span.first, span.last, span.reverse ? 1 - station : station) };
  }

  function fragment(p, alpha, z, hit) {
    if (p === bottom) layers.push({ alpha, z, hit });
    if (!capture || !hit && !owner[p]) return;
    coverage[p] = (hit ? alpha : 0) + coverage[p] * (1 - alpha);
    if (hit) {
      owner[p] = hit.span.i + 1;
      depths[p] = z;
      station[p] = hit.t;
    } else if (coverage[p] <= 1e-6) {
      owner[p] = 0;
      depths[p] = Infinity;
    }
  }

  function correspondence(span, t, x, y, depth) {
    const old = prior?.spans.get(span.i + 1);
    if (!old || old.id !== span.id || old.from !== span.from || old.to !== span.to ||
        t < old.first - 1e-6 || t > old.last + 1e-6) return null;
    const center = (pose, camera) => project(camera, pose.start.map((n, k) => mix(n, pose.end[k], t)), w, h);
    const current = center(span, camera), earlier = center(old, prior.camera);
    if (!current || !earlier) return null;
    const dx = current.x - earlier.x, dy = current.y - earlier.y;
    const px = x + .5 - dx, py = y + .5 - dy;
    if (!(px >= 0 && px < w && py >= 0 && py < h)) return null;
    const p = Math.floor(py) * w + Math.floor(px);
    const estimatedDepth = earlier.depth + depth - current.depth;
    if (prior.ids[p] !== span.id || Math.abs(estimatedDepth - prior.depth[p]) > earlier.units * 2) return null;
    return [dx, dy];
  }

  function finalize() {
    const out = { w, h, strands }, snapshot = motion && {
      w, h, source, time, camera, spans, ids: new Uint32Array(size), depth: new Float32Array(size).fill(Infinity)
    };
    const ids = snapshot?.ids ?? (selected.has('strandId') && new Uint32Array(size));
    const depth = snapshot?.depth ?? (selected.has('strandDepth') && new Float32Array(size).fill(Infinity));
    const tangent = selected.has('strandTangent') && new Float32Array(size * 3);
    const u = selected.has('strandU') && new Float32Array(size).fill(-1);
    const opacity = selected.has('strandCoverage') && new Float32Array(size);
    const vectors = selected.has('strandMotion') && new Float32Array(size * 2);
    const valid = ArtPasses.needsStrandMotion([...selected]) && new Uint8Array(size);
    if (capture) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, q = (h - 1 - y) * w + x;
      if (opacity) opacity[p] = coverage[q];
      const span = spans.get(owner[q]);
      if (!span) continue;
      if (ids) ids[p] = span.id;
      if (depth) depth[p] = depths[q];
      if (u) u[p] = mix(span.from, span.to, station[q]) / span.length;
      if (tangent) tangent.set(span.tangent, p * 3);
      const delta = valid && correspondence(span, station[q], x, y, depths[q]);
      if (delta) {
        valid[p] = 255;
        if (vectors) vectors.set(delta, p * 2);
      }
    }
    for (const [channel, values] of Object.entries({ strandId:ids, strandDepth:depth, strandTangent:tangent,
      strandU:u, strandCoverage:opacity, strandMotion:vectors, strandMotionValid:valid })) {
      if (values && (selected.has(channel) || channel === 'strandMotionValid')) out[channel] = values;
    }
    let inspected;
    if (bottom >= 0) {
      const contributors = [], [x, y] = pixel;
      let through = 1, coverage = 0;
      for (let i = layers.length - 1; i >= 0 && through > 1e-6; i--) {
        const { alpha, z, hit } = layers[i], visible = alpha * through;
        through *= 1 - alpha;
        if (!hit || visible <= 1e-6) continue;
        const { span, t } = hit, distance = mix(span.from, span.to, t);
        coverage += visible;
        contributors.push({ id: span.id, strand: strands[span.id], splatId: span.i + 1, u: distance / span.length,
          distance, depth: z, opacity: alpha, visibleCoverage: visible, tangent: span.tangent,
          motion: correspondence(span, t, x, y, z) });
      }
      inspected = { x, y, width:w, height:h, time, coverage, contributors };
    }
    return { passes: out, snapshot, inspected };
  }

  return { span, hit, fragment, finalize, wants: p => capture || p === bottom };
}

module.exports = { create };
