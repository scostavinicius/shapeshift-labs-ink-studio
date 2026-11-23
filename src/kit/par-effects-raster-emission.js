/* Pixel-sharp traveling bands and their independent colored emission. */
(function (K) {
  const P = K.procedural;
  const palettes = P.data.freeze({
    prism: [
      { crest: '#fff4bc', body: ['#ffc36b','#fb805d','#c84b61','#853450','#482641'] },
      { crest: '#e4ffd4', body: ['#b7f0ad','#64cda7','#3eacaa','#24758b','#233d60'] },
      { crest: '#e0efff', body: ['#a5d6fe','#7499ef','#565dc8','#47388b','#2b255c'] },
      { crest: '#ffe1f4', body: ['#f4abd5','#dc6fb9','#aa4796','#73356f','#432952'] }
    ],
    ember: [
      { crest: '#fff7c9', body: ['#ffdc83','#fca263','#dc624d','#8d3d4c','#462a3d'] },
      { crest: '#ffd4b8', body: ['#ff9e79','#db674e','#ae454a','#693142','#3d2534'] }
    ]
  });
  const finite = Number.isFinite, tau = Math.PI * 2;
  const tuple = (v, n) => Array.isArray(v) && v.length === n && Array.from(v).every(finite);
  const wrap = (n, p) => { const remainder = n % p; return remainder < 0 ? remainder + p : remainder; };
  const clamp = n => Math.max(0, Math.min(1, n));
  const raster = (width, height, channels, data) => ({ width, height, channels, data });
  function check(ok, message) {
    if (!ok) throw new TypeError('Emission bands: ' + message);
  }
  function record(v, keys, message) {
    check(v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).every(k => keys.includes(k)), message);
  }
  function plane(source, name) {
    const { width, height, channels = (source?.data?.length ?? 0) / (width * height), data } = source ?? {};
    check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
      channels === 1 && (ArrayBuffer.isView(data) || Array.isArray(data)) && data.length === width * height,
      name + ' needs a one-channel raster');
    return source;
  }
  function swatch(value) {
    check(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value), 'palette swatches must be #rrggbb');
    return DrawingPrimitives.color(value);
  }

  function radial({ origin, scale, jagged }) {
    if (jagged === false) return (x, y, ctx) => Math.hypot((x - (origin?.[0] ?? ctx.width / 2)) / scale[0],
      (y - (origin?.[1] ?? ctx.height / 2)) / scale[1]);
    record(jagged, ['amount','spokes','twist','seed'], 'invalid jagged settings');
    const { amount = 7, spokes = 19, twist = .029, seed = 0 } = jagged;
    check(finite(amount) && amount >= 0 && amount <= 512 && Number.isInteger(spokes) &&
      spokes >= 3 && spokes <= 128 && finite(twist) && Number.isSafeInteger(seed), 'invalid jagged amount, spokes, twist or seed');
    const random = K.grow.dice(P.data.hash('emission bands', seed)), teeth = Array.from({ length: spokes }, () => random() * 2 - 1);
    function tooth(u) {
      const point = wrap(u, spokes), near = Math.floor(point);
      return K.mix(teeth[near], teeth[(near + 1) % spokes], point - near);
    }
    return (x, y, ctx) => {
      const dx = (x - (origin?.[0] ?? ctx.width / 2)) / scale[0], dy = (y - (origin?.[1] ?? ctx.height / 2)) / scale[1];
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * spokes / tau;
      const teeth = .77 * tooth(angle + twist * distance) + .23 * tooth(2 * angle - .023 * distance);
      return distance + amount * teeth * Math.min(1, distance / Math.max(12, amount * 1.65));
    };
  }

  function create(settings = {}) {
    record(settings, ['palette','crest','body','gap','speed','phase','start','end','origin','scale','jagged','field','mask','halo'],
      'invalid preset settings');
    const { palette = 'prism', crest = 1, body = 12, gap = 9, speed = 26, phase = 0,
      start = settings.field === undefined ? 16 : -Infinity, end = Infinity, origin, scale = [1,1], jagged = {}, halo = {} } = settings;
    check(finite(crest) && crest > 0 && finite(body) && body > 0 && finite(gap) && gap >= 0 &&
      finite(speed) && finite(phase) && start < end && (start === -Infinity || finite(start)) &&
      (end === Infinity || finite(end)), 'invalid band widths, distance interval or motion');
    check((origin === undefined || tuple(origin, 2)) && tuple(scale, 2) && scale.every(n => n > 0),
      'radial origin and scale need pixel XY and positive XY scale');
    const pitch = crest + body + gap, direction = speed < 0 ? -1 : 1, crestStart = gap + body;
    check(finite(pitch) && crestStart < pitch && gap < crestStart, 'band widths exceed numeric precision');
    const ramp = typeof palette === 'string' && Object.hasOwn(palettes, palette) ? palettes[palette] : palette;
    check(Array.isArray(ramp) && ramp.length > 0 && ramp.length <= 16, 'expected a preset or 1–16 wave palettes');
    const waves = Array.from(ramp, entry => {
      record(entry, ['crest','body'], 'invalid wave palette');
      check(Array.isArray(entry.body) && entry.body.length > 0 && entry.body.length <= 16, 'expected 1–16 body swatches');
      return { crest: swatch(entry.crest), body: Array.from(entry.body, swatch) };
    });
    let glow;
    if (halo !== false) {
      record(halo, ['radius','sigma','strength'], 'invalid halo settings');
      const { radius = 4, sigma = Math.max(.5, radius / 2), strength = .8 } = halo;
      check(Number.isInteger(radius) && radius >= 1 && radius <= 16 && finite(sigma) && sigma > 0 &&
        finite(strength) && strength >= 0 && strength <= 8, 'invalid halo radius, sigma or strength');
      glow = { radius, sigma, strength };
    }
    const field = settings.field === undefined ? radial({ origin: origin?.slice(), scale: scale.slice(), jagged }) :
      typeof settings.field === 'function' ? settings.field : plane(settings.field, 'distance field');
    const mask = settings.mask === undefined || typeof settings.mask === 'function' ? settings.mask : plane(settings.mask, 'mask');

    const fieldSize = field.width === undefined ? mask : field;
    function draw(context, withHalo) {
      const { time = 0, width = fieldSize?.width, height = fieldSize?.height } = context;
      const area = width * height, travel = phase + speed * time;
      check(Number.isSafeInteger(width) && width >= 1 && width <= 8192 &&
        Number.isSafeInteger(height) && height >= 1 && height <= 8192 && area <= 4e6 &&
        finite(time) && finite(travel), 'expected a finite clock and a pixel grid up to four million pixels');
      for (const source of [field, mask]) if (source && typeof source !== 'function')
        check(source.width === width && source.height === height, 'field and mask must match the art grid');

      const ctx = { ...context, time, width, height };
      const value = raster(width,height,4,new Uint8Array(area*4));
      const emitter = raster(width,height,4,new Uint8Array(area*4));
      const coverage = raster(width,height,1,new Uint8Array(area));
      const gate = withHalo && glow?.strength ? new Uint8Array(area) : null;
      const fieldAt = typeof field === 'function' ? (x,y,i) => field(x,y,ctx) : (_x,_y,i) => field.data[i];
      const alphaAt = typeof mask === 'function' ? (x,y) => mask(x,y,ctx) : mask ? (_x,_y,i) => mask.data[i] / 255 : () => 1;
      for (let y = .5, i = 0; y < height; y++) for (let x = .5; x < width; x++, i++) {
        const distance = fieldAt(x,y,i);
        check(finite(distance), 'distance samples must be finite');
        if (distance < start || distance >= end) continue;
        const opacity = alphaAt(x,y,i);
        check(finite(opacity) && opacity >= 0 && opacity <= 1, 'mask samples must be within the coverage range');
        const alpha = Math.round(opacity * 255);
        if (gate) gate[i] = alpha;
        if (!alpha) continue;
        const position = direction * (distance - travel);
        const index = Math.floor(position / pitch);
        check(Number.isSafeInteger(index), 'wave index exceeds numeric precision');
        const within = wrap(position, pitch);
        if (within < gap) continue;
        const front = within >= crestStart, ink = waves[wrap(index, waves.length)];
        const rgb = front ? ink.crest : ink.body[Math.min(ink.body.length - 1,
          Math.floor((crestStart - within) * ink.body.length / body))];
        const j = i*4;
        value.data.set(rgb, j);
        value.data[j+3] = alpha;
        if (front) {
          emitter.data.set(rgb, j);
          emitter.data[j+3] = alpha;
          coverage.data[i] = alpha;
        }
      }
      let blurred = raster(width,height,4,new Uint8Array(area*4));
      if (gate) {
        blurred = P.pixelEffects.kernelBlur(emitter, { radius: glow.radius, sigma: glow.sigma, edge: 'transparent' });
        for (let i = 0; i < area; i++) {
          const a = Math.round(clamp(blurred.data[i*4+3] * glow.strength / 255) * gate[i]);
          blurred.data[i*4+3] = a;
          if (!a) blurred.data.fill(0,i*4,i*4+3);
        }
      }
      return { value, crest: emitter, mask: coverage, halo: blurred };
    }

    function frame(context = {}) { return draw(context, true); }
    function layer({ part = 'combined', resolution = fieldSize?.width === undefined ? undefined : [fieldSize.width,fieldSize.height],
      rect, opacity = 1, blend = 'over', needsCamera = false } = {}) {
      check(['combined','value','crest','halo'].includes(part), 'layer part must be combined, value, crest or halo');
      return { resolution, rect, opacity, blend, needsCamera, filter: 'nearest',
        source({ w, h, ...context }) {
          const bands = draw({ ...context, width: w, height: h }, part === 'halo' || part === 'combined');
          const result = part !== 'combined' ? bands[part] : glow?.strength ? P.raster.stack({ width: w, height: h,
            layers: [{ source: bands.halo }, { source: bands.value }] }).value : bands.value;
          return { w, h, rgba: result.data };
        }
      };
    }
    return Object.freeze({ frame, layer, period: speed ? pitch * waves.length / Math.abs(speed) : null });
  }

  K.emissionBands = Object.freeze({ create, palettes });
})(KIT);
