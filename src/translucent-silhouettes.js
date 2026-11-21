/* Material policies for coverage on the native export grid. */
const TranslucentSilhouettes = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const presets = Object.freeze({
    steam:   { width:1.50, falloff:.72, opacity:.87, preserve:1, filter:1 },
    glass:   { width:1.13, falloff:1.22, opacity:1, preserve:.22, filter:1 },
    cloth:   { width:1.55, falloff:1.38, opacity:1.08, preserve:.18, filter:1 },
    foliage: { width:.86, falloff:1.95, opacity:1.12, preserve:.48, filter:.80 }
  });
  const ranges = {width:[0,4],falloff:[.35,4],opacity:[0,2],preserve:[0,1],filter:[0,1]};
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const mix = (a,b,t) => a+(b-a)*t;
  const clamp = n => Math.max(0,Math.min(1,n));
  const sigmaPerWidth = 1 / Math.sqrt(8*Math.LN2);

  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (!record(value) || Object.keys(value).some(key=>!['fade','rules'].includes(key)))
      throw new TypeError('Translucent silhouettes need fade and rules');
    const { fade=[64,128], rules } = value;
    if (fade !== false && (!Array.isArray(fade) || fade.length!==2 ||
        !Array.from(fade).every(n=>Number.isFinite(n) && n>=1 && n<=8192) || fade[0]>=fade[1]))
      throw new RangeError('Translucent silhouette fade needs increasing native pixel sizes or false');
    if (!Array.isArray(rules) || !rules.length || rules.length>64)
      throw new TypeError('Translucent silhouettes need 1–64 rules');
    const entries = Array.from(rules, rule => {
      if (!record(rule) || Object.keys(rule).some(key=>!['select','policy',...Object.keys(ranges)].includes(key)))
        throw new TypeError('Invalid translucent silhouette rule');
      const select = selectors.prepare(rule.select);
      if ('medium' in select || 'mediumKind' in select)
        throw new TypeError('Translucent silhouette selectors must identify splats');
      const { policy } = rule;
      if (policy === 'legacy') {
        if (Object.keys(ranges).some(name=>Object.hasOwn(rule,name)))
          throw new TypeError('Legacy silhouette coverage takes no overrides');
        return { select, profile:null };
      }
      if (!Object.hasOwn(presets,policy)) throw new RangeError('Unknown translucent silhouette policy: '+policy);
      const profile = {};
      for (const [key,[lo,hi]] of Object.entries(ranges)) {
        const n = Object.hasOwn(rule,key) ? rule[key] : presets[policy][key];
        if (!Number.isFinite(n) || n<lo || n>hi)
          throw new RangeError('Translucent silhouette '+key+' must be in ['+lo+', '+hi+']');
        profile[key]=n;
      }
      return {select,profile:Object.freeze(profile)};
    });
    const [full,off]=fade || [0,0];
    return {
      weight(shortSide) {
        if (!fade) return 1;
        const u=clamp((off-shortSide)/(off-full));
        return u*u*(3-2*u);
      },
      bind(world) {
        const index=selectors.index(world), cache=new WeakMap();
        return i => {
          const target=index.row(i);
          if (!cache.has(target)) cache.set(target,entries.find(row=>selectors.matches(row.select,target))?.profile ?? null);
          return cache.get(target);
        };
      }
    };
  }

  // Scale the ellipse's own axes. Widening a narrow sheet must not rotate it.
  function fit(profile,a,b,c,scale,weight) {
    const spread=Math.hypot(a-c,2*b), center=(a+c)*.5;
    const major=center+spread*.5, minor=(a*c-b*b)/major;
    const floor=(profile.width*scale*sigmaPerWidth)**2;
    const low=mix(minor,Math.max(floor,minor/profile.falloff),weight);
    const high=mix(major,Math.max(floor,major/profile.falloff),weight);
    const axisScale=spread>1e-12 ? (high-low)/spread : 0;
    const newCenter=(low+high)*.5, halfDifference=(a-c)*axisScale*.5;
    const areaRatio=Math.min(1,Math.sqrt((minor*major)/(low*high)));
    return { a:newCenter+halfDifference, b:b*axisScale, c:newCenter-halfDifference,
      gain:mix(1,profile.opacity,weight)*areaRatio**(profile.preserve*weight) };
  }

  return Object.freeze({prepare,fit});
})();
if (typeof module !== 'undefined') module.exports = TranslucentSilhouettes;
