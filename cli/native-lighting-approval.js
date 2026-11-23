const { render } = require('./render.js');
const { prepareLightSearch } = require('./shot-light-search.js');
const { prepareReview, labCache } = require('./readability-review.js');
const { prepareChecks, measureChecks } = require('./palette-checks.js');

const format = 'ink-studio/native-lighting-approval';
const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => keys.includes(key));
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
const named = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function prepare(plan, view = {}) {
  if (!fields(plan, ['format', 'version', 'title', 'scene', 'rig', 'seed', 'controls', 'time', 'aim', 'grids',
      'subjects', 'checks', 'thresholds', 'evaluations']) || plan.format !== format || plan.version !== 1 ||
      (plan.title !== undefined && !named(plan.title)))
    throw new TypeError('Expected a version 1 native lighting approval plan');
  const { time = 0, evaluations = 40 } = plan;
  if (!Number.isFinite(time) || time < 0 || time > 120 || !integer(evaluations, 1, 128))
    throw new RangeError('Approval needs a valid frame time and 1–128 candidate evaluations');
  if (view.raw) throw new RangeError('Native lighting approval needs the palette-enabled render');
  if (!Array.isArray(plan.grids) || !integer(plan.grids.length, 2, 6))
    throw new RangeError('Approve lighting on two to six native art grids');
  const grids = Array.from(plan.grids, grid => {
    if (!fields(grid, ['id', 'label', 'width', 'height']) || !id(grid.id) ||
        !integer(grid.width, 1, 1024) || !integer(grid.height, 1, 1024) || grid.width * grid.height > 262144 ||
        (grid.label !== undefined && !named(grid.label)))
      throw new RangeError('Each art grid needs a lowercase ID and valid native dimensions');
    return { id: grid.id, label: grid.label ?? grid.id, width: grid.width, height: grid.height };
  });
  const gridIds = new Set(grids.map(grid => grid.id));
  if (gridIds.size !== grids.length || new Set(grids.map(grid => grid.width + 'x' + grid.height)).size !== grids.length)
    throw new RangeError('Native art grid IDs and sizes must be distinct');
  const pixelsPerTrial = grids.reduce((sum, grid) => sum + grid.width * grid.height, 0);
  if (pixelsPerTrial * evaluations > 24e6) throw new RangeError('Native lighting approval exceeds its render pixel budget');
  if (!Array.isArray(plan.checks) || !integer(plan.checks.length, 1, 32))
    throw new TypeError('Native lighting approval needs 1–32 contour or swatch checks');

  const { subjects, thresholds, views, states } = prepareReview({ subjects: plan.subjects, thresholds: plan.thresholds }, time);
  const checks = prepareChecks(Array.from(plan.checks, row => {
    if (!row || Object.getPrototypeOf(row) !== Object.prototype) throw new TypeError('Expected a lighting check');
    const { grids, label, weight, ...check } = row;
    if (!id(check.id) || (label !== undefined && !named(label)) ||
        (weight !== undefined && (!Number.isFinite(weight) || weight < .1 || weight > 10)) ||
        Object.hasOwn(check, 'views') || Object.hasOwn(check, 'states') ||
        grids !== undefined && (!Array.isArray(grids) || !grids.length || new Set(grids).size !== grids.length ||
          !Array.from(grids).every(grid => gridIds.has(grid))))
      throw new TypeError('Lighting checks need a lowercase ID and optional known grids, label and weight');
    return check;
  }), { subjects, thresholds, views, states }).map((check, i) => {
    const source = plan.checks[i];
    return { ...check, label: source.label ?? check.definition.id, grids: source.grids ?? Array.from(gridIds), weight: source.weight ?? 1 };
  });
  return { time, evaluations, grids, subjects, thresholds, checks };
}

function contradiction(groups, subjects) {
  const exclusive = [];
  for (const { grid, active } of groups) {
    const bySelector = new Map();
    for (const { definition, index } of active) {
      if (definition.type !== 'swatch' || definition.limits.minShare === 0) continue;
      const key = JSON.stringify(Object.entries(subjects[index].select).sort());
      if (!bySelector.has(key)) bySelector.set(key, new Map());
      const colors = bySelector.get(key), old = colors.get(definition.swatch);
      if (!old || definition.limits.minShare > old.limits.minShare) colors.set(definition.swatch, definition);
    }
    for (const colors of bySelector.values()) {
      const demands = [...colors.values()];
      const minimumShare = demands.reduce((sum, item) => sum + item.limits.minShare, 0);
      if (minimumShare > 1 + 1e-9)
        exclusive.push({ grid: grid.id, checks: demands.map(item => item.id), minimumShare });
    }
  }
  return exclusive;
}

function swatchDistance(frame, check, lab) {
  const mask = 1 << check.index, target = lab(check.expected);
  let distance = 0, pixels = 0;
  for (let p = 0; p < frame.readabilityMask.length; p++) {
    if (!(mask & frame.readabilityMask[p]) || frame.alpha?.[p] === 0) continue;
    const at = p * 3, rgb = frame.rgb;
    const a = lab((rgb[at] << 16) | (rgb[at + 1] << 8) | rgb[at + 2]);
    distance += Math.hypot(a[0] - target[0], a[1] - target[1], a[2] - target[2]);
    pixels++;
  }
  return pixels ? distance / pixels : 1;
}

function deficit(result, frame, check, lab) {
  if (result.passed) return 0;
  const errors = result.failures.map(({ metric, limit, actual }) => {
    const unit = ['pixels', 'samples', 'croppedEdges'].includes(metric) ? Math.max(1, limit) :
      metric === 'lightnessP10' || metric === 'colorP10' ? .12 : 1;
    return actual === null ? 1 : Math.abs(actual - limit) / unit;
  });
  const guidance = check.definition.type === 'swatch' ? .65 * swatchDistance(frame, check, lab) : 0;
  return (Math.hypot(...errors) + guidance) * Math.sqrt(check.weight);
}

function fitNativeLighting(world, { plan, rig, view = {}, kit = require('../index.js').load() } = {}) {
  const { time, evaluations, grids, subjects, thresholds, checks } = prepare(plan, view);
  const { initial, parameters, candidate } = prepareLightSearch(world, { rig, view, pivot: plan.aim });
  const groups = grids.map(grid => ({ grid, active: checks.filter(check => check.grids.includes(grid.id)) }));
  const selectors = subjects.map(item => item.select);
  const base = { ...view, time: undefined, t: time, px: 1, raw: false, transparent: false,
    renderGraph: false, composite: false, renderGrid: false, inspection: false, shutter: false, afterimages: false,
    passes: ['depth'], readabilitySelectors: selectors, objectMattes: false, cameraGuides: false, samples: false,
    artHistory: undefined, renderHistory: undefined, volumeHistory: undefined, afterimageHistory: undefined,
    transparencyHistory: undefined, motionalCoverageHistory: undefined, partMotionHistory: undefined,
    colorClusterHistory: undefined, strandMotionHistory: undefined, surfaceMotionHistory: undefined, lookInputSession: undefined };
  function evaluate(shotLighting) {
    return groups.map(({ grid, active }) => {
      const { width: w, height: h } = grid;
      const raw = render(world, { ...base, w, h, width: w, height: h, shotLighting });
      if (raw.w !== w || raw.h !== h || raw.readabilityMask?.length !== w * h || raw.passes?.depth?.length !== w * h)
        throw new RangeError('Lighting approval needs aligned subject ownership and color on the ' + grid.id + ' art grid');
      const { frame, marked, results } = measureChecks(raw, subjects, thresholds, undefined, active);
      const lab = labCache();
      return { grid: grid.id, frame, marked, rows: results.map((result, i) => ({
        ...result, grid: grid.id, deficit: deficit(result, raw, active[i], lab)
      })) };
    });
  }

  const trials = [];
  let start, best, before, after;
  const low = parameters.exposure.min, high = parameters.exposure.max;
  const exposureTrials = [.75, .25, 1, 0, .625, .375].map(x => low + x * (high - low));
  const raisedFill = Math.min(parameters.fillIntensity.max, parameters.fillIntensity.initial * 2 + 1);
  const starts = [...exposureTrials.map(exposure => ({ exposure })), ...[-38, 38].flatMap(yaw => [
    { yaw, exposure: exposureTrials[0] }, { yaw, exposure: exposureTrials[1], fillIntensity: raisedFill }
  ]), ...[-24, 24].map(pitch => ({ pitch, exposure: exposureTrials[0] }))];
  const total = groups.reduce((sum, group) => sum + group.active.length, 0);
  const inverse = kit.KIT.world.inverseTargets;
  const fit = inverse.fit({ format: inverse.planFormat, version: 1, id: 'native-lighting-approval', parameters, starts,
    targets: { deficits: { value: Array(total).fill(0), tolerance: 1 } },
    settings: { maxEvaluations: evaluations, initialRadius: .24, differenceStep: .055, parameterTolerance: .008, goal: 'minimize' }
  }, values => {
    const lighting = trials.length ? candidate(values) : { ...initial, format: 'ink-studio/shot-lighting', version: 1 };
    const states = evaluate(lighting);
    const rows = states.flatMap(state => state.rows), errors = rows.map(row => row.deficit);
    const trial = { evaluation: trials.length + 1, parameters: values, rows, lighting,
      passed: rows.filter(row => row.passed).length, cost: errors.reduce((sum, value) => sum + value * value, 0) };
    if (!start) { start = trial; before = states; }
    if (!best || trial.passed > best.passed || (trial.passed === best.passed && trial.cost < best.cost)) {
      best = trial;
      after = states;
    }
    trials.push(trial);
    return { deficits: errors };
  });

  const conflicts = contradiction(groups, subjects);
  const rows = best.rows.map((current, i) => {
    const { id, grid } = current;
    const matching = checks.find(check => check.definition.id === id);
    const reachable = trials.filter(trial => trial.rows[i].passed)
      .sort((a, b) => b.passed - a.passed || a.cost - b.cost || a.evaluation - b.evaluation);
    const closest = trials.reduce((trial, other) => other.rows[i].deficit < trial.rows[i].deficit ? other : trial);
    const caught = conflicts.find(conflict => conflict.grid === grid && conflict.checks.includes(id));
    const alternative = !current.passed && reachable[0];
    const diagnostic = current.passed ? 'passed' : caught ? 'incompatible-swatch-shares' : alternative ? 'trade-off-observed' :
      trials.every(trial => !trial.rows[i].metrics.pixels) ? 'subject-not-visible' :
      trials.every(trial => trial.rows[i].metrics.samples === 0) ? 'no-background-samples' : 'not-met-in-search';
    return { id, grid, label: matching.label, type: matching.definition.type, subject: matching.definition.subject,
      limits: matching.definition.limits, ...(matching.definition.swatch && { swatch: matching.definition.swatch }),
      before: start.rows[i], after: current, diagnostic, bestObserved: closest.rows[i],
      ...(caught && { conflictingChecks: caught.checks.filter(check => check !== id) }),
      ...(alternative && { witness: { evaluation: alternative.evaluation, parameters: alternative.parameters,
        rig: alternative.lighting, metrics: alternative.rows[i].metrics,
        regressed: alternative.rows.flatMap((row, k) => !row.passed && best.rows[k].passed ? [{ id: row.id, grid: row.grid }] : [])
      } }) };
  });
  const report = { format, version: 1, title: plan.title ?? 'Native lighting approval', time, grids, subjects, thresholds,
    passed: best.passed === total, summary: { before: start.passed, after: best.passed, total },
    work: { ...fit.work, nativeRenders: trials.length * groups.length, status: fit.status },
    chosenEvaluation: best.evaluation, parameters: best.parameters, rows, conflicts };
  return { rig: best.lighting, before, after, report };
}

module.exports = { format, named, prepare, fitNativeLighting };
