const path = require('node:path');
const CurveSplat = require('../src/curve-splat.js');
const CurveQuality = require('./curve-quality.js');
const { sampleCurveShot } = require('./curve-compare.js');
const R = require('./render.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');

const defaultThresholds = Object.freeze({ coverage: .45, joinLuma: .09, flickerLuma: .075 });
const channels = ['strandId', 'strandU', 'strandCoverage', 'strandMotion'];
const luma = (data, p) => (.2126 * data[p * 3] + .7152 * data[p * 3 + 1] + .0722 * data[p * 3 + 2]) / 255;
const pixel = (p, w) => [p % w, Math.floor(p / w)];
const nearby = (a, b, w) => Math.hypot(a % w - b % w, Math.floor(a / w) - Math.floor(b / w)) <= 2.5;
const ms = value => +value.toFixed(3);

function authoredJoins(world) {
  const result = new Map(), previous = new Map(), rows = world.curveStations;
  const stride = CurveSplat.stationStride;
  for (let i = 0; rows && i < rows.length; i += stride) {
    const id = rows[i], start = rows[i + 1], end = rows[i + 2], length = rows[i + 3];
    if (!id || !(length > 0)) continue;
    const prior = previous.get(id);
    if (prior !== undefined && Math.abs(prior - start) <= length * 1e-8 && start > 0 && start < length) {
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(start / length);
    }
    previous.set(id, end);
  }
  return result;
}

function stationTracks(passes, threshold) {
  const { w, h, strandId: ids, strandU: u, strandCoverage: coverage } = passes;
  const bins = Math.max(w, h) * 2, result = new Map();
  for (let p = 0; p < ids.length; p++) {
    const id = ids[p];
    if (!id || coverage[p] < threshold) continue;
    if (!result.has(id)) result.set(id, new Map());
    const track = result.get(id), bin = Math.round(u[p] * bins), old = track.get(bin);
    if (old === undefined || coverage[p] > coverage[old]) track.set(bin, p);
  }
  return [...result].map(([id, track]) => [id, [...track.entries()].sort((a, b) => a[0] - b[0]).map(row => row[1])]);
}

function measureFrame(reference, candidate, previous, joins, thresholds) {
  const { w, h, passes } = reference, size = w * h;
  const actual = candidate.passes, ids = passes.strandId, u = passes.strandU;
  const { coverage, joinLuma, flickerLuma } = thresholds;
  const error = new Float32Array(size), change = new Float32Array(size).fill(NaN);
  const matched = new Uint8Array(size), marks = new Uint8Array(size), evidence = [], evidenceCounts = new Map();
  const metrics = { referenceSamples:0, missingSamples:0, missingStrands:0, breaks:0,
    joinSamples:0, maxReferenceJoinJump:0, maxJoinJump:0, maxJoinChange:0, joinChanges:0,
    trackedPixels:0, flickerPixels:0, temporalLumaDelta:0 };
  const note = item => {
    const count = evidenceCounts.get(item.kind) ?? 0;
    if (count < 16) {
      evidence.push(item);
      evidenceCounts.set(item.kind, count + 1);
    }
  };
  for (let p = 0; p < size; p++) {
    const id = ids[p];
    if (!id || passes.strandCoverage[p] < coverage) continue;
    matched[p] = Number(actual.strandId[p] === id && actual.strandCoverage[p] >= coverage);
    error[p] = luma(candidate.rgb, p) - luma(reference.rgb, p);
    if (previous && passes.strandMotionValid[p]) {
      const x = Math.floor(p % w + .5 - passes.strandMotion[p * 2]);
      const y = Math.floor(Math.floor(p / w) + .5 - passes.strandMotion[p * 2 + 1]);
      const q = y * w + x;
      if (x >= 0 && x < w && y >= 0 && y < h && previous.ids[q] === id) {
        const delta = error[p] - previous.error[q], prior = previous.change[q];
        change[p] = delta;
        metrics.trackedPixels++;
        metrics.temporalLumaDelta += Math.abs(delta);
        if (delta * prior < 0 && Math.min(Math.abs(delta), Math.abs(prior)) >= flickerLuma) {
          metrics.flickerPixels++;
          marks[p] = 3;
          note({ kind:'flicker', id, at:pixel(p,w), u:u[p], luma:[prior,delta] });
        }
      }
    }
  }
  if (metrics.trackedPixels) metrics.temporalLumaDelta /= metrics.trackedPixels;

  for (const [id, track] of stationTracks(passes, coverage)) {
    metrics.referenceSamples += track.length;
    let lost = 0, before = -1, gap = -1;
    for (const [i, p] of track.entries()) {
      if (i && !nearby(track[i - 1], p, w)) before = gap = -1;
      if (!matched[p]) {
        lost++;
        marks[p] ||= 1;
        if (before !== -1 && gap === -1) gap = p;
      } else {
        if (gap !== -1) {
          metrics.breaks++;
          note({ kind:'break', id, at:pixel(gap,w), u:[u[before],u[p]] });
        }
        gap = -1;
        before = p;
      }
    }
    metrics.missingSamples += lost;
    if (lost === track.length) {
      metrics.missingStrands++;
      note({ kind:'missing-strand', id, at:pixel(track[0],w) });
    }
    const sampled = new Set();
    for (const station of joins.get(id) ?? []) {
      let lo = 0, hi = track.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (u[track[mid]] < station) lo = mid + 1;
        else hi = mid;
      }
      if (!lo || lo === track.length || sampled.has(lo)) continue;
      const a = track[lo - 1], b = track[lo];
      if (!nearby(a,b,w)) continue;
      sampled.add(lo);
      const referenceJump = luma(reference.rgb,b) - luma(reference.rgb,a);
      metrics.maxReferenceJoinJump = Math.max(metrics.maxReferenceJoinJump,Math.abs(referenceJump));
      if (!matched[a] || !matched[b]) continue;
      const jump = luma(candidate.rgb,b) - luma(candidate.rgb,a), added = Math.abs(jump - referenceJump);
      metrics.joinSamples++;
      metrics.maxJoinJump = Math.max(metrics.maxJoinJump,Math.abs(jump));
      metrics.maxJoinChange = Math.max(metrics.maxJoinChange,added);
      if (added >= joinLuma) {
        metrics.joinChanges++;
        marks[b] = Math.max(marks[b],2);
        note({ kind:'join-brightness', id, at:pixel(b,w), u:station, referenceLuma:referenceJump, budgetedLuma:jump });
      }
    }
  }
  const rgb = Uint8Array.from(candidate.rgb,n => Math.round(n * .4));
  const colors = [[225,92,88],[251,197,101],[244,104,208]];
  for (let p = 0; p < size; p++) if (marks[p]) rgb.set(colors[marks[p] - 1], p * 3);
  return { metrics, evidence, map:{w,h,rgb}, state:{ids:Uint32Array.from(ids,(id,p) =>
    passes.strandCoverage[p] >= coverage ? id : 0), error, change} };
}

function reviewCurveQuality(world, { frame = {}, thresholds: overrides = {}, ...options } = {}, receive) {
  const quality = frame.curveQuality ?? world.look?.curveQuality;
  if (!CurveQuality.prepare(quality)) throw new RangeError('Curve review needs curve quality layers');
  const thresholds = { ...defaultThresholds, ...overrides };
  if (Object.entries(thresholds).some(([id,value]) => !Object.hasOwn(defaultThresholds,id) ||
      !Number.isFinite(value) || value <= 0 || value > 1))
    throw new RangeError('Curve review thresholds must be in (0, 1]');
  const captured = { curveMode:'curves', passes:channels, renderStats:true };
  const frames = [], joins = authoredJoins(world);
  let prior, previousTime, worstFrame = 0, worstScore = -1;
  const summary = sampleCurveShot(world, { ...options, frame }, [
    { ...captured, curveQuality:false }, { ...captured, curveQuality:quality }
  ], (sample,[reference,candidate]) => {
    const { index, time, reset } = sample;
    if ([reference,candidate].some(image => image.w !== image.passes?.w || image.h !== image.passes?.h))
      throw new RangeError('Curve review needs color and strand data on the same native art grid');
    const result = measureFrame(reference,candidate, !reset && time > previousTime ? prior : null, joins, thresholds);
    const { metrics, evidence, map, state } = result;
    prior = state;
    previousTime = time;
    const native = candidate.renderStats.curveQuality?.find(pass =>
      pass.pass === 'color' && pass.artScale === 1 && pass.width === candidate.w && pass.height === candidate.h);
    const performance = image => ({ frameMs:ms(image.renderStats.frameMs),
      segments:image.renderStats.curveSegments, fragments:image.renderStats.fragments });
    const row = { ...sample, reference:performance(reference), budgeted:performance(candidate),
      layers:native?.layers ?? [], metrics, evidence };
    frames.push(row);
    const score = metrics.breaks + metrics.missingStrands + metrics.joinChanges + metrics.flickerPixels;
    if (score > worstScore) { worstFrame = index; worstScore = score; }
    receive?.({ row, reference, candidate, map });
  }, 32_000_000);
  return { format:'ink-studio/curve-quality-review', version:1, ...summary, thresholds, worstFrame, frames };
}

function writeCurveQualityReview(world, options, directory) {
  const previews = [];
  const report = reviewCurveQuality(world, options, ({ reference, candidate, map }) => {
    previews.push(PNG.packFrame(R.grid([reference,candidate,map],3)));
  });
  files.write(path.join(directory,'review.png'),PNG.encodeFrame(previews[report.worstFrame]));
  if (previews.length > 1) files.write(path.join(directory,'review.apng'),PNG.encodeAnimation(previews,report.fps));
  report.preview = previews.length > 1 ? 'review.apng' : 'review.png';
  report.panels = ['reference', 'budgeted', 'evidence'];
  report.evidenceColors = { lost:[225,92,88], join:[251,197,101], flicker:[244,104,208] };
  files.json(path.join(directory,'review.json'),report);
  return report;
}

module.exports = { reviewCurveQuality, writeCurveQualityReview, measureFrame };
