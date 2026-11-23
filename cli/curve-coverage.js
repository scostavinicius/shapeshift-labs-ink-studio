const CurveSplat = require('../src/curve-splat.js');

// Stagger the positions within the 4×4 strata so horizontal and vertical
// strands see sixteen distinct positions across an art pixel.
const strata = [1, 3, 0, 2];
const offsets = strata.flatMap((u, x) => strata.map((v, y) => [
  (4 * x + ((u + v) & 3) + .5) / 16 - .5,
  (4 * y + ((v - u) & 3) + .5) / 16 - .5
])).sort(([ax, ay], [bx, by]) => ax * ax + ay * ay - bx * bx - by * by);
offsets.unshift([0, 0]);
const samples = offsets.length - 1, margin = .5;

function footprint(strand, rayAt, x, y, near, normal, strength, station) {
  const soft = !strand.group;
  const center = CurveSplat.sampleAt(strand, rayAt, x, y, near, false, soft, !soft);
  const depths = strand.group && new Float64Array(offsets.length);
  const variableOpacity = strand.projectedWidth?.fade && strand.projectedWidth.weight || strand.pattern?.dash?.offOpacity > 0;
  const opacity = depths && variableOpacity && new Float64Array(offsets.length);
  if (depths && center) depths[0] = center.depth;
  if (opacity && center) opacity[0] = center.alpha;
  let front = center?.depth ?? Infinity, back = center?.exitDepth ?? -Infinity;
  let representative = center, offset = offsets[0], density = 0;
  for (let i = 1; i < offsets.length; i++) {
    const [u, v] = offsets[i];
    const sample = CurveSplat.sampleAt(strand, rayAt, x + u, y + v, near, false, soft, !soft);
    if (!sample) continue;
    if (depths) {
      depths[i] = sample.depth;
      front = Math.min(front, sample.depth);
      back = Math.max(back, sample.exitDepth);
    } else density += sample.density;
    if (opacity) opacity[i] = sample.alpha;
    if (!representative) {
      representative = sample;
      offset = offsets[i];
    }
  }
  if (!representative) return null;
  const hit = normal || station ?
    CurveSplat.sampleAt(strand, rayAt, x + offset[0], y + offset[1], near, normal, false, false, station) : representative;
  const centerAlpha = center?.alpha ?? 0;
  // Optical depths add across segments, so splitting a soft curve does not
  // change its filtered density.
  if (soft) hit.alpha = -Math.expm1(-((center?.density ?? 0) * (1 - strength) + density * strength / samples));
  return { hit, offset, centerAlpha, depths, opacity, strength, range: depths && [front, back] };
}

function add(group, entry, { depths, opacity, hit }) {
  const { lanes } = group;
  let added = false;
  for (let i = 0; i < depths.length; i++) {
    if (depths[i] && (!lanes[i] || depths[i] <= group.nearest[i])) {
      lanes[i] = entry;
      group.nearest[i] = depths[i];
      added = true;
    }
  }
  if (added && opacity) entry.rayOpacity = opacity.map(value => value / hit.alpha);
  return added;
}

function mergeLanes(target, other) {
  for (let i = 0; i < target.lanes.length; i++) if (other.lanes[i] &&
      (!target.lanes[i] || other.nearest[i] < target.nearest[i])) {
    target.lanes[i] = other.lanes[i];
    target.nearest[i] = other.nearest[i];
  }
}

function queue(layers, entry, hit, footprint) {
  const filtered = footprint?.depths, strength = filtered ? footprint.strength : undefined;
  const range = filtered ? footprint.range : [hit.depth, hit.exitDepth];
  let previous;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.curveGroup !== entry.curveGroup || layer.strength !== strength ||
        !CurveSplat.overlapsDepth(range, layer.range)) continue;
    // Only the touching parts of a hard strand are one coverage shape.
    // A separate pass through the same pixel keeps its own depth and opacity.
    range[0] = Math.min(range[0], layer.range[0]);
    range[1] = Math.max(range[1], layer.range[1]);
    layers.splice(i, 1);
    if (!previous) previous = layer;
    else if (filtered) mergeLanes(previous, layer);
    else if (layer.sort < previous.sort) previous = layer;
  }
  if (filtered) {
    const group = previous ?? { curveGroup: entry.curveGroup, strength,
      nearest: filtered, lanes: new Array(offsets.length) };
    const added = add(group, entry, footprint);
    group.range = range;
    layers.push(group);
    return added;
  }
  const front = previous && previous.sort < entry.sort ? previous : entry;
  front.range = range;
  layers.push(front);
  return !previous;
}

function resolve({ strength, lanes }, edgeThreshold) {
  let alpha = 0, red = 0, green = 0, blue = 0, winner;
  const areaWeight = strength / samples;
  for (let i = 0; i < lanes.length; i++) {
    const entry = lanes[i], weight = i === 0 ? 1 - strength : areaWeight;
    if (!entry || !weight) continue;
    const [, , , coverage, r, g, b] = entry.sample;
    const a = coverage * (entry.rayOpacity?.[i] ?? 1) * weight;
    alpha += a;
    red += r * a;
    green += g * a;
    blue += b * a;
    winner ??= entry;
  }
  if (alpha < CurveSplat.minimum) return null;
  // Keep an actual hit for depth and ownership. The visible color is the
  // premultiplied mean of the winning rays, including multi-colored joins.
  // The sample payload is in the renderer's composite argument order.
  const { sample } = winner, center = (lanes[0]?.sample[3] ?? 0) * (lanes[0]?.rayOpacity?.[0] ?? 1);
  sample[3] = winner.opacity = Math.abs(alpha - 1) < 1e-12 ? 1 : alpha;
  sample[4] = red / alpha;
  sample[5] = green / alpha;
  sample[6] = blue / alpha;
  sample[7] = sample[7] && winner.opacity === 1;
  sample[21] = Math.abs(winner.opacity - center) >= edgeThreshold;
  winner.transparent ||= !sample[7];
  return winner;
}

module.exports = { footprint, queue, resolve, margin };
