/* Native pixel coverage for thin, moving Gaussian splats. */
const MotionalCoverage = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const limits = { strength:[0,1,1], maxWidth:[.25,3,1.4], maxMotion:[.25,4,1.5], depthTolerance:[0,.5,.04] };
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = n => { const u = clamp(n); return u*u*(3-2*u); };

  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    if (!record(value) || Object.keys(value).some(key => key !== 'rules' && !Object.hasOwn(limits,key)))
      throw new TypeError('Invalid motional coverage settings');
    const settings = {};
    for (const [key,[lo,hi,fallback]] of Object.entries(limits)) {
      const n = Object.hasOwn(value,key) ? value[key] : fallback;
      if (!Number.isFinite(n) || n < lo || n > hi)
        throw new RangeError('Motional coverage '+key+' must be in ['+lo+', '+hi+']');
      settings[key] = n;
    }
    if (value.rules !== undefined && (!Array.isArray(value.rules) || !value.rules.length || value.rules.length > 64))
      throw new TypeError('Motional coverage needs 1–64 rules when supplied');
    const rules = Array.from(value.rules ?? [], rule => {
      if (!record(rule) || Object.keys(rule).some(key => key !== 'select' && key !== 'strength'))
        throw new TypeError('Invalid motional coverage rule');
      const select = selectors.prepare(rule.select);
      if ('medium' in select || 'mediumKind' in select)
        throw new TypeError('Motional coverage selectors must identify splats');
      const strength = Object.hasOwn(rule,'strength') ? rule.strength : 1;
      if (!Number.isFinite(strength) || strength < 0 || strength > 1)
        throw new RangeError('Motional coverage rule strength must be in [0, 1]');
      return { select, strength };
    });
    return { ...settings, key:JSON.stringify([settings,rules]),
      bind(world) {
        if (!rules.length) return () => settings.strength;
        const index = selectors.index(world), cache = new WeakMap();
        return i => {
          const target = index.row(i);
          if (!cache.has(target))
            cache.set(target, settings.strength * (rules.find(rule => selectors.matches(rule.select,target))?.strength ?? 0));
          return cache.get(target);
        };
      }
    };
  }

  function history() {
    const lanes = new Map();
    return Object.freeze({
      clear() { lanes.clear(); },
      begin(lane, source, signature, time, reset) {
        const last = lanes.get(lane);
        const previous = !reset && last && source === last.source && signature === last.signature && time >= last.time ? last.rows : null;
        const rows = new Map();
        return {
          track(i, row) {
            rows.set(i, row);
            return previous?.get(i);
          },
          commit() { lanes.set(lane, { source, signature, time, rows }); }
        };
      }
    });
  }

  function thin(a,b,c,scale,maxWidth) {
    const spread = Math.hypot(a-c,2*b), major = (a+c+spread)*.5;
    if (major < (scale/2)**2 || spread <= 0) return null;
    const minor = Math.max(0,(a*c-b*b)/major);
    if (minor*4 > major) return null;
    const width = Math.sqrt(8*Math.LN2*minor)/scale;
    if (width >= maxWidth) return null;
    const angle = Math.atan2(2*b,a-c)*.5;
    return { nx:-Math.sin(angle), ny:Math.cos(angle), radius:Math.sqrt(major)/scale,
      weight:smooth((maxWidth-width)/(.25*maxWidth)) };
  }

  // Reconstruct a symmetric aperture in the current frame. History supplies
  // only the projected movement of this row, including small rotations.
  function aperture(settings, current, prior) {
    if (!prior || Math.abs(current.depth-prior.depth) > settings.depthTolerance*Math.min(current.depth,prior.depth))
      return null;
    const { x, y, nx, ny, radius } = current;
    const dx = x-prior.x, dy = y-prior.y;
    const turn = Math.abs(nx*prior.ny-ny*prior.nx)*Math.min(radius,prior.radius);
    const travel = Math.hypot(dx,dy)+turn;
    const transverse = Math.abs(nx*dx+ny*dy)+turn;
    if (travel >= settings.maxMotion || transverse < 1e-5) return null;
    const gain = .65*smooth(transverse/.35)*smooth((settings.maxMotion-travel)/(.35*settings.maxMotion));
    return [1+gain*nx*nx, gain*nx*ny, 1+gain*ny*ny];
  }

  return Object.freeze({ prepare, history, thin, aperture });
})();
if (typeof module !== 'undefined') module.exports = MotionalCoverage;
