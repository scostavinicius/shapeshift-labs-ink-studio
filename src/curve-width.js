/* Scope projected curve widths with the regular scene selectors. */
const CurveWidth = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const detail = typeof StableDetail === 'undefined' ? require('./stable-detail.js') : StableDetail;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const finite = (value, lo, hi) => Number.isFinite(value) && lo <= value && value <= hi;

  function policy(value = { mode: 'physical' }) {
    if (!record(value) || !['physical', 'minimum', 'fade'].includes(value.mode))
      throw new TypeError('Curve width mode must be physical, minimum, or fade');
    const { mode, pixels, maxScale = Infinity, range } = value;
    const keys = mode === 'minimum' ? ['mode', 'pixels', 'maxScale'] :
      mode === 'fade' ? ['mode', 'range'] : ['mode'];
    if (Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Unexpected curve width policy field');
    if (mode === 'physical') return null;
    if (mode === 'minimum') {
      if (!finite(pixels, .01, 32) || (value.maxScale !== undefined && !finite(maxScale, 1, 1e6)))
        throw new RangeError('Minimum curve width needs pixels in [.01, 32] and an optional finite maxScale of at least 1');
      return { mode, weight: width => Math.max(1, Math.min(maxScale, pixels / width)) };
    }
    if (!Array.isArray(range) || range.length !== 2 || !finite(range[0], 0, 32) ||
        !finite(range[1], 0, 32) || range[0] >= range[1])
      throw new RangeError('Curve width fade needs an increasing art-pixel range within [0, 32]');
    const thresholds = range.slice();
    return { mode, weight: width => detail.weight(thresholds, width) };
  }

  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (!record(value) || Object.keys(value).some(key => !['default', 'rules'].includes(key)))
      throw new TypeError('Curve width needs default and rules settings or false');
    const fallback = policy(value.default), { rules = [] } = value;
    if (!Array.isArray(rules) || rules.length > 64) throw new TypeError('Curve width accepts up to 64 rules');
    const choices = Array.from(rules, rule => {
      if (!record(rule) || !Object.hasOwn(rule, 'policy') || Object.keys(rule).some(key => !['select', 'policy'].includes(key)))
        throw new TypeError('Curve width rules need select and policy');
      const select = selectors.prepare(rule.select);
      if ('medium' in select || 'mediumKind' in select)
        throw new TypeError('Curve width selectors must identify scene geometry');
      return { select, policy: policy(rule.policy) };
    });
    if (!fallback && !choices.some(choice => choice.policy)) return null;
    return { bind(world) {
      if (!choices.length) return () => fallback;
      const index = selectors.index(world), cache = new WeakMap();
      return i => {
        const target = index.row(i);
        if (!cache.has(target)) {
          const choice = choices.find(rule => selectors.matches(rule.select, target));
          cache.set(target, choice ? choice.policy : fallback);
        }
        return cache.get(target);
      };
    } };
  }

  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = CurveWidth;
