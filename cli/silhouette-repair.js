// Independent projected masks reveal contacts even when one actor is fully occluded.
const format = 'ink-studio/silhouette-repair';
const within = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high) => Number.isSafeInteger(value) && within(value, low, high);
const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => keys.includes(key));
const named = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const round = value => Math.round(value * 10000) / 10000;

function settings(options) {
  const { width, height, fps = 12, fromFrame = 0, toFrame, subjects, coverage = .5,
    gapPixels = 1, minVisible = .85, stepDegrees = 4, maxDegrees = 16, contextFrames = 5 } = options;
  if (!integer(width, 1, 2048) || !integer(height, 1, 2048) || width * height > 262144 ||
      !integer(fps, 1, 120) || !integer(fromFrame, 0, 120 * fps) || !integer(toFrame, fromFrame + 2, 120 * fps + 1) ||
      toFrame - fromFrame > 120 || width * height * (toFrame - fromFrame) > 4e6)
    throw new RangeError('Silhouette repair needs a bounded native art grid and a handle of 2–120 frames');
  if (!within(coverage, .1, .95) || !integer(gapPixels, 1, 4) || !within(minVisible, .5, 1) ||
      !integer(stepDegrees, 1, 12) || !integer(maxDegrees, stepDegrees, 24) ||
      Math.floor(maxDegrees / stepDegrees) > 4 || !integer(contextFrames, 0, 120))
    throw new RangeError('Invalid silhouette clearance, visibility, context or orbit search settings');
  if (!Array.isArray(subjects) || subjects.length !== 2) throw new TypeError('Silhouette repair needs two named objects');
  const targets = Array.from(subjects, subject => {
    if (!fields(subject, ['object', 'label']) ||
        !(named(subject.object, 256) || integer(subject.object, 1, 0xffffffff)) ||
        (subject.label !== undefined && !named(subject.label)))
      throw new TypeError('Each silhouette needs an object name or ID and an optional label');
    return { object: subject.object, label: subject.label ?? String(subject.object) };
  });
  if (targets[0].object === targets[1].object) throw new TypeError('Choose two different silhouette objects');
  return { width, height, fps, fromFrame, toFrame, subjects: targets, coverage, gapPixels, minVisible,
    stepDegrees, maxDegrees, contextFrames };
}

function inspectSilhouetteFrame(frame, options, frameNumber) {
  const { width, height, coverage, gapPixels, minVisible, subjects } = options;
  const { objectMattes: mattes } = frame;
  const length = width * height;
  if (frame.w !== width || frame.h !== height || mattes?.width !== width || mattes.height !== height ||
      !Array.isArray(mattes.objects) || mattes.objects.length !== 2 ||
      mattes.objects.some((name, i) => name !== subjects[i].object) ||
      mattes.projected?.length !== 2 * length || mattes.camera?.length !== 2 * length)
    throw new TypeError('Silhouette inspection requires two aligned projected and visible object mattes');
  const mask = new Uint8Array(length), area = [0, 0], visible = [0, 0], edge = [false, false];
  let overlapPixels = 0;
  const bBox = [width, height, -1, -1];
  for (let p = 0; p < length; p++) {
    const x = p % width, y = Math.floor(p / width);
    for (let i = 0; i < 2; i++) {
      if (mattes.projected[p * 2 + i] < coverage) continue;
      mask[p] |= 1 << i;
      area[i]++;
      if (mattes.camera[p * 2 + i] >= coverage) visible[i]++;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge[i] = true;
    }
    if (mask[p] === 3) overlapPixels++;
    if (mask[p] & 2) {
      bBox[0] = Math.min(bBox[0], x);
      bBox[1] = Math.min(bBox[1], y);
      bBox[2] = Math.max(bBox[2], x);
      bBox[3] = Math.max(bBox[3], y);
    }
  }
  let gapConflictPixels = 0;
  for (let y = Math.max(0, bBox[1] - gapPixels); y <= Math.min(height - 1, bBox[3] + gapPixels); y++) {
    for (let x = Math.max(0, bBox[0] - gapPixels); x <= Math.min(width - 1, bBox[2] + gapPixels); x++) {
      const p = y * width + x;
      if (!(mask[p] & 1) || mask[p] === 3) continue;
      let adjacent = false;
      for (let dy = Math.max(0, y - gapPixels); !adjacent && dy <= Math.min(height - 1, y + gapPixels); dy++) {
        for (let dx = Math.max(0, x - gapPixels); dx <= Math.min(width - 1, x + gapPixels); dx++) {
          if (mask[dy * width + dx] & 2) { adjacent = true; break; }
        }
      }
      if (adjacent) gapConflictPixels++;
    }
  }
  const visibility = area.map((pixels, i) => pixels ? visible[i] / pixels : 0);
  const seen = area.every(pixels => pixels >= 6), complete = seen && !edge.some(Boolean) &&
    visibility.every(fraction => fraction >= minVisible);
  const status = seen && (overlapPixels || gapConflictPixels) ? 'collision' : complete ? 'clear' : 'unverified';
  return { mask, metrics: { frame: frameNumber, status, overlapPixels, gapConflictPixels,
    subjects: area.map((pixels, i) => ({ projectedPixels: pixels, visiblePixels: visible[i], visibleFraction: round(visibility[i]), edge: edge[i] })) } };
}

function collisionIntervals(samples) {
  const intervals = [];
  let interval, peak;
  for (const sample of samples) {
    if (sample.status !== 'collision') {
      interval = undefined;
      continue;
    }
    if (!interval || interval.toFrame !== sample.frame) {
      interval = { fromFrame: sample.frame, toFrame: sample.frame + 1, peakFrame: sample.frame, peakOverlapPixels: sample.overlapPixels };
      intervals.push(interval);
      peak = sample;
      continue;
    }
    interval.toFrame = sample.frame + 1;
    if (sample.overlapPixels > peak.overlapPixels ||
        (sample.overlapPixels === peak.overlapPixels && sample.gapConflictPixels > peak.gapConflictPixels)) {
      interval.peakFrame = sample.frame;
      interval.peakOverlapPixels = sample.overlapPixels;
      peak = sample;
    }
  }
  return intervals;
}

function orbitOffsets({ stepDegrees, maxDegrees }) {
  const steps = Math.floor(maxDegrees / stepDegrees), candidates = [];
  for (let pitch = -steps; pitch <= steps; pitch++) for (let yaw = -steps; yaw <= steps; yaw++) {
    const magnitude = Math.hypot(yaw, pitch) * stepDegrees;
    if (magnitude > 0 && magnitude <= maxDegrees)
      candidates.push({ offsetDegrees: [yaw * stepDegrees, pitch * stepDegrees], magnitude });
  }
  return candidates.sort((a, b) => a.magnitude - b.magnitude ||
    Math.abs(a.offsetDegrees[0]) - Math.abs(b.offsetDegrees[0]) ||
    b.offsetDegrees[1] - a.offsetDegrees[1] || a.offsetDegrees[0] - b.offsetDegrees[0]);
}

function findSilhouetteRepair(samples, options, probe, verify) {
  const intervals = collisionIntervals(samples);
  const span = new Set(samples.map(row => row.frame));
  const probeFrames = new Set(intervals.map(row => row.peakFrame));
  const hits = samples.filter(row => row.status === 'collision').sort((a, b) =>
    b.overlapPixels - a.overlapPixels || b.gapConflictPixels - a.gapConflictPixels);
  for (const { frame } of hits) probeFrames.add(frame);
  for (const { fromFrame, toFrame } of intervals)
    for (const frame of [fromFrame - 1, toFrame]) if (span.has(frame)) probeFrames.add(frame);
  const checked = [];
  for (const candidate of intervals.length ? orbitOffsets(options) : []) {
    const { offsetDegrees, magnitude } = candidate;
    let qualifies = true;
    for (const frame of probeFrames) if (probe(offsetDegrees, frame) !== 'clear') {
      qualifies = false;
      break;
    }
    const verification = qualifies ? verify(offsetDegrees) : null;
    checked.push({ offsetDegrees, result: verification ? 'verified' : qualifies ? 'failed-full-shot' : 'failed-collision-window' });
    if (verification) return { intervals, checked, repair: { kind: 'camera-orbit-offset', offsetDegrees,
      magnitudeDegrees: round(magnitude), checkedFrames: samples.length }, verification };
  }
  return { intervals, checked, repair: null, verification: null };
}

module.exports = { format, fields, named, settings, inspectSilhouetteFrame, collisionIntervals, findSilhouetteRepair };
