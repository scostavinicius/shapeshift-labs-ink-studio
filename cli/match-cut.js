// Match adjacent motion in each source independently, then rank possible cut seams.
const { measureScreenSubjects } = require('./screen-subjects.js');

const format = 'ink-studio/match-cut';
const maxHandleFrames = 240;
const within = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && within(value, min, max);
const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => keys.includes(key));
const named = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const round = value => Math.round(value * 100) / 100 || 0;
const takes = ['outgoing', 'incoming'];

function settings(options, lengths) {
  const { width, height, fps = 24, motionFrames = 3, previewFrames = Math.round(fps * .75),
    limit = 5, separationFrames = Math.max(1, Math.round(fps / 4)), restSpeed = .35, matches,
    outgoingStart = 0, incomingStart = 0 } = options;
  if (!integer(width, 1, 2048) || !integer(height, 1, 2048) || width * height > 262144 ||
      !integer(fps, 1, 120) || !integer(motionFrames, 2, 12) || !integer(previewFrames, 1, 120) ||
      !integer(limit, 1, 12) || !integer(separationFrames, 0, 120) || !within(restSpeed, .01, 4))
    throw new RangeError('Invalid match-cut art grid, frame rate, motion or shortlist settings');
  for (const [i, start] of [outgoingStart, incomingStart].entries()) {
    if (!integer(start, 0, 120 * fps) || !integer(lengths[i], motionFrames, maxHandleFrames) ||
        start + lengths[i] - 1 > 120 * fps)
      throw new RangeError('Each shot handle needs ' + motionFrames + '–' + maxHandleFrames + ' frames within the first 120 seconds');
  }
  if (!Array.isArray(matches) || !integer(matches.length, 1, 8))
    throw new TypeError('Match cuts need one to eight pairs of named shapes');
  const pairs = Array.from(matches, match => {
    if (!fields(match, ['id', 'label', 'outgoing', 'incoming', 'weight']) || typeof match.id !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,47}$/.test(match.id))
      throw new TypeError('Each shape pair needs a lowercase ID and selectors from both shots');
    const { id, label = id, weight = 1 } = match;
    if (!named(label) || !within(weight, .1, 10)) throw new RangeError('Invalid shape label or weight');
    for (const side of takes) {
      const select = match[side];
      if (!fields(select, ['object', 'material']) || !Object.keys(select).length ||
          Object.values(select).some(value => !named(value, 256) && !Number.isSafeInteger(value)))
        throw new TypeError('Select each shape by object, material or both');
    }
    return { id, label, weight, outgoing: { ...match.outgoing }, incoming: { ...match.incoming } };
  });
  if (new Set(pairs.map(pair => pair.id)).size !== pairs.length) throw new TypeError('Shape pair IDs must be unique');
  return { width, height, fps, motionFrames, previewFrames, limit, separationFrames, restSpeed,
    matches: pairs, outgoingStart, incomingStart };
}

const center = box => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
const extent = box => [box[2] - box[0], box[3] - box[1]];

function analyze(frames, side, options) {
  const { width, height, matches, motionFrames } = options;
  const selectors = matches.map(pair => ({ id: pair.id, select: pair[side] }));
  const samples = Array.from(frames, frame => measureScreenSubjects(frame, selectors, width, height));
  const half = (motionFrames - 1) / 2;
  const coefficients = Array.from({ length: motionFrames }, (_, i) => i - half);
  const denominator = coefficients.reduce((sum, value) => sum + value * value, 0);
  const rows = [];
  let unmeasurable = 0;
  for (let i = 0; i < samples.length; i++) {
    const start = side === 'outgoing' ? i - motionFrames + 1 : i;
    if (start < 0 || start + motionFrames > samples.length) continue;
    const window = samples.slice(start, start + motionFrames);
    if (window.some(frame => frame.some(shape => !shape.box || shape.sourceEdge))) {
      unmeasurable++;
      continue;
    }
    const shapes = samples[i].map(({ box }, j) => {
      const velocity = [0, 0];
      for (let k = 0; k < motionFrames; k++) {
        const [x, y] = center(window[k][j].box);
        velocity[0] += coefficients[k] * x / denominator;
        velocity[1] += coefficients[k] * y / denominator;
      }
      return { box, center: center(box), size: extent(box), velocity };
    });
    rows.push({ index: i, shapes });
  }
  return { rows, unmeasurable };
}

function compare(a, b, scale, restSpeed) {
  const position = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
  const size = Math.hypot(Math.log(a.size[0] / b.size[0]), Math.log(a.size[1] / b.size[1])) / Math.SQRT2;
  const speedA = Math.hypot(...a.velocity), speedB = Math.hypot(...b.velocity);
  const stoppedA = speedA < restSpeed, stoppedB = speedB < restSpeed;
  let heading = null, motion = stoppedA === stoppedB ? 0 : 1;
  if (!stoppedA && !stoppedB) {
    const dot = a.velocity[0] * b.velocity[0] + a.velocity[1] * b.velocity[1];
    const cosine = Math.max(-1, Math.min(1, dot / (speedA * speedB)));
    heading = Math.acos(cosine) * 180 / Math.PI;
    motion = 1 - cosine;
  }
  const error = .45 * position / scale + .28 * size / Math.log(1.25) + .75 * motion;
  return { error, position, size, heading, moving: [!stoppedA, !stoppedB] };
}

function findMatchCuts(outgoing, incoming, options) {
  if (!Array.isArray(outgoing) || !Array.isArray(incoming))
    throw new TypeError('Match cuts need two arrays of native frames with ownership passes');
  const cfg = settings(options, [outgoing.length, incoming.length]);
  const { width, height, fps, matches, restSpeed, limit, separationFrames, previewFrames, motionFrames,
    outgoingStart, incomingStart } = cfg;
  const a = analyze(outgoing, 'outgoing', cfg), b = analyze(incoming, 'incoming', cfg);
  const totalWeight = matches.reduce((sum, pair) => sum + pair.weight, 0);
  const scale = .08 * Math.hypot(width, height), scores = [];
  for (const left of a.rows) for (const right of b.rows) {
    let error = 0;
    for (let i = 0; i < matches.length; i++)
      error += matches[i].weight * compare(left.shapes[i], right.shapes[i], scale, restSpeed).error;
    scores.push({ left, right, error: error / totalWeight });
  }
  scores.sort((a, b) => a.error - b.error || a.left.index - b.left.index || a.right.index - b.right.index);
  const candidates = [];
  for (const { left, right, error } of scores) {
    const outFrame = outgoingStart + left.index, inFrame = incomingStart + right.index;
    if (candidates.some(cut => Math.abs(cut.outgoing.frame - outFrame) < separationFrames &&
        Math.abs(cut.incoming.frame - inFrame) < separationFrames)) continue;
    const shapes = matches.map(({ id }, i) => {
      const a = left.shapes[i], b = right.shapes[i];
      const result = compare(a, b, scale, restSpeed);
      return { id, positionPixels: round(result.position), sizeDeltaPercent: round(100 * Math.expm1(result.size)),
        headingDegrees: result.heading === null ? null : round(result.heading), moving: result.moving,
        outgoing: { box: a.box, center: a.center, velocity: a.velocity.map(round) },
        incoming: { box: b.box, center: b.center, velocity: b.velocity.map(round) } };
    });
    candidates.push({
      rank: candidates.length + 1, score: round(100 * Math.exp(-error)),
      outgoing: { frame: outFrame, time: outFrame / fps },
      incoming: { frame: inFrame, time: inFrame / fps },
      preview: { outgoing: [Math.max(outgoingStart, outFrame - previewFrames + 1), outFrame + 1],
        incoming: [inFrame, Math.min(incomingStart + incoming.length, inFrame + previewFrames)] },
      shapes
    });
    if (candidates.length === limit) break;
  }
  return {
    format, version: 1, width, height, fps, matches, motionFrames, restSpeed, previewFrames, separationFrames,
    outgoing: { fromFrame: outgoingStart, toFrame: outgoingStart + outgoing.length, usable: a.rows.length, unmeasurable: a.unmeasurable },
    incoming: { fromFrame: incomingStart, toFrame: incomingStart + incoming.length, usable: b.rows.length, unmeasurable: b.unmeasurable },
    comparedPairs: scores.length, candidates
  };
}

module.exports = { format, fields, named, settings, findMatchCuts };
