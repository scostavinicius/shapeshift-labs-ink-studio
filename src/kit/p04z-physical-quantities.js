/* Physical metadata is shared by world signals and procedural graph sockets. */
(function (K) {
  const P = K.procedural, T = P.takeTime;
  const keys = ['unit', 'kind', 'frame', 'positive', 'sampleRate'];
  const axes = ['mass', 'length', 'time', 'current', 'temperature', 'amount', 'luminous', 'angle', 'world'];
  const base = ['kg', 'm', 's', 'A', 'K', 'mol', 'cd', 'rad', 'world'];
  const definitions = new Map(base.map((symbol, index) => [symbol, {scale:1, dimension:{[axes[index]]:1}}]));
  const prefixes = new Map(Object.entries({n:1e-9, u:1e-6, m:1e-3, c:1e-2, d:1e-1, da:1e1, h:1e2, k:1e3, M:1e6, G:1e9}));
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const label = value => typeof value === 'string' && /^[a-zA-Z0-9][\w.:/-]{0,95}$/.test(value);
  const cache = new Map();
  const fail = message => { throw new TypeError(message); };

  function define(symbol, scale, dimension, offset = 0) {
    definitions.set(symbol, {scale, dimension, offset});
  }
  define('1',1,{});
  define('g',1e-3,{mass:1});
  define('Hz',1,{time:-1});
  define('N',1,{mass:1,length:1,time:-2});
  define('Pa',1,{mass:1,length:-1,time:-2});
  define('J',1,{mass:1,length:2,time:-2});
  define('W',1,{mass:1,length:2,time:-3});
  define('C',1,{current:1,time:1});
  define('V',1,{mass:1,length:2,time:-3,current:-1});
  define('Ohm',1,{mass:1,length:2,time:-3,current:-2});
  define('L',1e-3,{length:3});
  define('min',60,{time:1});
  define('h',3600,{time:1});
  define('deg',Math.PI/180,{angle:1});
  define('degC',1,{temperature:1},273.15);
  define('%',.01,{});

  function symbol(name) {
    if (definitions.has(name)) return definitions.get(name);
    const prefix = name.startsWith('da') ? 'da' : name[0], unit = name.slice(prefix.length);
    const definition = definitions.get(unit);
    if (definition && prefixes.has(prefix) && !['kg','world','1','%','min','h','deg','degC'].includes(unit))
      return {...definition, scale:definition.scale*prefixes.get(prefix)};
  }

  function unit(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 96) fail('Expected a physical unit');
    if (cache.has(raw)) return cache.get(raw);
    const name = raw.trim().replace(/[µμ]/g,'u').replace(/Ω/g,'Ohm').replace(/°C/g,'degC')
      .replace(/°/g,'deg').replace(/²/g,'^2').replace(/³/g,'^3').replace(/·/g,'*').replace(/\s+/g,'');
    const parts = name.split(/([*/])/);
    const dimension = {};
    let scale = 1, offset = 0;
    for (let i = 0; i < parts.length; i += 2) {
      const match = /^(1|%|[A-Za-z]+)(?:\^(-?[0-9]+))?$/.exec(parts[i]);
      const term = match && symbol(match[1]);
      const power = Number(match?.[2] ?? 1) * (parts[i-1] === '/' ? -1 : 1);
      if (!term || Math.abs(power) > 12 || term.offset && (parts.length !== 1 || power !== 1))
        fail('Unknown or invalid physical unit "' + raw + '"');
      scale *= term.scale ** power;
      offset = term.offset ?? 0;
      for (const [axis, n] of Object.entries(term.dimension)) dimension[axis] = (dimension[axis] ?? 0) + n*power;
    }
    if (!Number.isFinite(scale) || scale <= 0) fail('Physical unit scale is outside the numeric range: ' + raw);
    const result = P.data.freeze({scale, offset,
      dimension:Object.fromEntries(axes.filter(axis => dimension[axis]).map(axis => [axis, dimension[axis]]))});
    if (cache.size < 256) cache.set(raw,result);
    return result;
  }

  function rate(value) {
    let result;
    try { result = T.read(value); }
    catch { fail('Expected a physical sample rate in hertz or an integer ratio'); }
    if (result[0] <= 0n) fail('Expected a positive physical sample rate');
    return result;
  }
  function rateValue([n,d]) {
    if (d === 1n || n > BigInt(Number.MAX_SAFE_INTEGER) || d > BigInt(Number.MAX_SAFE_INTEGER)) {
      const value = T.seconds([n,d]);
      if (!Number.isFinite(value) || value <= 0) fail('Physical sample rate is outside the numeric range');
      return value;
    }
    return {numerator:Number(n),denominator:Number(d)};
  }
  function rateText(value) {
    return (typeof value === 'number' ? value : value.numerator + '/' + value.denominator) + ' Hz';
  }
  const equalRate = (a,b) => T.compare(rate(a),rate(b)) === 0;
  const equalScale = (a,b) => Math.abs(a-b) <= 8*Number.EPSILON*Math.max(a,b);
  const dimKey = dimension => axes.map(axis => dimension[axis] ?? 0).join(',');
  const dimText = dimension => Object.entries(dimension).map(([k,n]) => k + (n === 1 ? '' : '^' + n)).join(' ') || 'dimensionless';

  function normalize(raw, where = 'Port') {
    if (raw === undefined) return;
    try {
      if (!record(raw) || Object.keys(raw).some(key => !keys.includes(key)) ||
          ['kind','frame','positive'].some(key => raw[key] !== undefined && !label(raw[key])))
        fail('Expected a physical quantity with a unit and optional kind, frame, positive and sampleRate');
      unit(raw.unit);
      const {sampleRate,...metadata} = raw;
      return {...metadata,...(sampleRate !== undefined && {sampleRate:rateValue(rate(sampleRate))})};
    } catch (error) {
      fail(where + ': ' + error.message);
    }
  }

  function assertLink(source, target, from, to, {sampled = false, convert = false} = {}) {
    if (!target) return;
    const reject = reason => fail('Incompatible physical ports ' + from + ' -> ' + to + ': ' + reason);
    if (!source) reject('source has no physical quantity; expected ' + target.unit);
    const a = unit(source.unit), b = unit(target.unit);
    if (dimKey(a.dimension) !== dimKey(b.dimension))
      reject(source.unit + ' (' + dimText(a.dimension) + ') cannot supply ' + target.unit + ' (' + dimText(b.dimension) + ')');
    if (!convert && (!equalScale(a.scale,b.scale) || a.offset !== b.offset))
      reject(source.unit + ' and ' + target.unit + ' have different scales or offsets; use an explicit unit conversion');
    for (const [key, name] of [['kind','quantity kind'], ['frame','coordinate frame'], ['positive','positive direction']]) {
      if (target[key] !== undefined && source[key] !== target[key])
        reject(name + ' ' + (source[key] ?? '(undeclared)') + ' cannot supply ' + target[key]);
    }
    const left = source.sampleRate, right = target.sampleRate;
    if (!sampled && right !== undefined && (left === undefined || !equalRate(left,right)))
      reject('sample rate ' + (left === undefined ? '(undeclared)' : rateText(left)) + ' cannot supply ' +
        rateText(right) + '; use an explicit rate adapter or world sampling policy');
  }

  function converter(from, to) {
    const source = normalize(from, 'Source quantity'), target = normalize(to, 'Target quantity');
    if (!source || !target) fail('Unit conversion needs source and target quantities');
    assertLink(source,target,'conversion input','conversion output',{convert:true});
    // Unit conversion keeps the interpretation of a sample and its cadence.
    assertLink(target,source,'conversion output','conversion input',{convert:true});
    const a = unit(source.unit), b = unit(target.unit);
    function scalar(value) {
      const out = equalScale(a.scale,b.scale) && a.offset === b.offset ? value : (value*a.scale + (a.offset-b.offset))/b.scale;
      if (!Number.isFinite(value) || !Number.isFinite(out)) fail('Physical conversion needs a finite numeric value');
      return out;
    }
    return value => {
      if (!Array.isArray(value)) return scalar(value);
      if (a.offset || b.offset) fail('Offset unit conversion needs a scalar');
      return value.map(scalar);
    };
  }

  P.quantities = Object.freeze({unit, normalize, assertLink, converter, rateValue, equalRate, rateText});
  K.quantities = P.quantities;
})(KIT);
