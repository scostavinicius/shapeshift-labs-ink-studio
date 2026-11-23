/* Independent indexed strands attached to painted texels of a sprite view. */
const SpriteFringe = (() => {
  const record = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    (!keys || Object.keys(value).every(key => keys.includes(key)));
  const int = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const rgb = v => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
  function check(ok, message) {
    if (!ok) throw new RangeError('Sprite fringe: ' + message);
  }
  function xy(value, min, max) {
    return Array.isArray(value) && value.length === 2 && Array.from(value).every(n => int(n, min, max));
  }

  function prepare(definition, groups, select, pixelBudget) {
    if (definition === undefined) return null;
    const stamps = typeof PixelStamps === 'undefined' ? require('./pixel-stamps.js') : PixelStamps;
    check(record(definition, ['clips','brushes','paint','views']), 'expected clips, brushes and painted anchor maps');
    const { clips, brushes, paint, views = [] } = definition;
    check(record(clips) && Object.keys(clips).length > 0 && Object.keys(clips).length <= 62 &&
      Array.isArray(brushes) && brushes.length > 0 && brushes.length <= 62 &&
      Array.isArray(views) && views.length <= 4096 && (paint !== undefined || views.length > 0),
      'use up to 62 clips and brushes with default or view-specific paint');

    const clipsByName = new Map();
    for (const [name, spec] of Object.entries(clips)) {
      check(name.trim() && record(spec, ['width','height','palette','frames','pin','fps','playback']) &&
        int(spec.width,1,64) && int(spec.height,1,64) && Array.isArray(spec.frames) && int(spec.frames.length,1,96) &&
        Array.isArray(spec.palette) && int(spec.palette.length,1,62) && Array.from(spec.palette).every(rgb),
        'clips need 1–64 pixel dimensions, 1–96 cels and hex RGB swatches');
      const { width, height, pin = [Math.floor(width/2),0], ...art } = spec;
      check(xy(pin,0,63) && pin[0] < width && pin[1] < height, 'clip pin must lie inside its cel');
      pixelBudget -= width * height * art.frames.length;
      check(pixelBudget >= 0, 'cel art exceeds the atlas pixel budget');
      const palette = art.palette.map(value => Object.freeze([1,3,5].map(i => parseInt(value.slice(i,i+2),16)/255)));
      const { entries, at } = stamps.prepare({ width,height,...art });
      const frames = entries.map(({ slots }, index) => {
        const cel = art.frames[index], { offset = [0,0] } = cel;
        check(record(cel, ['slots','rows','strokes','duration','offset']) && xy(offset,-64,64),
          'each cel needs an optional integer XY offset within 64 pixels');
        const points = [];
        for (const [i, slot] of slots.entries()) {
          if (slot !== null) points.push([i % width - pin[0] + offset[0],
            Math.floor(i / width) - pin[1] + offset[1], palette[slot]]);
        }
        return points;
      });
      clipsByName.set(name, { frames, at, largest: Math.max(...frames.map(points => points.length)) });
    }

    const tools = Array.from(brushes, spec => {
      check(record(spec,['clip','phase','depth','opacity','emission']), 'invalid brush');
      const { clip, phase = 0, depth = 0, opacity = 1, emission = 0 } = spec;
      check(clipsByName.has(clip) && Number.isFinite(phase) && Number.isFinite(depth) &&
        [opacity,emission].every(n => Number.isFinite(n) && n >= 0 && n <= 1), 'invalid clip, phase, depth, opacity or emission');
      return { clip: clipsByName.get(clip), phase, depth, alpha: opacity, emission };
    });
    function anchors(map, { width, height }) {
      check(record(map, ['rows','slots','strokes']), 'paint needs indexed rows, slots or strokes');
      pixelBudget -= width * height;
      check(pixelBudget >= 0, 'anchor maps exceed the atlas pixel budget');
      const result = [];
      let drawn = 0;
      for (const [i, slot] of stamps.paint(width,height,map).entries()) {
        if (slot === null) continue;
        check(slot < tools.length, 'paint references an unknown brush slot');
        const brush = tools[slot];
        if (!brush.alpha) continue;
        drawn += brush.clip.largest;
        check(drawn <= 65536 && result.length < 512, 'one view can use up to 512 anchors and 65,536 drawn pixels');
        result.push({ x: i % width, y: Math.floor(i / width), brush });
      }
      return result;
    }

    const byView = new Map(), defaults = new Map();
    function mapFor(cache, paint, rect) {
      const size = rect.width + 'x' + rect.height;
      if (!cache.has(size)) cache.set(size, anchors(paint, rect));
      return cache.get(size);
    }
    for (const override of views) {
      check(record(override, ['frame','direction','pitch','paint']) && override.paint !== undefined,
        'a view override needs a baked frame and anchor paint');
      const matches = select(override).views, sizes = new Map();
      for (const view of matches) {
        check(!byView.has(view), 'painted view overrides overlap');
        byView.set(view, mapFor(sizes, override.paint, view.rect));
      }
    }
    if (paint !== undefined) for (const views of groups.values())
      for (const view of views) if (!byView.has(view)) byView.set(view, mapFor(defaults, paint, view.rect));

    function frame(view, time) {
      const sites = byView.get(view);
      if (!sites?.length) return null;
      // Integer lookup remains unique for up to 127 pixels of overhang on either side.
      const stride = view.rect.width + 256;
      const pixels = new Map(), bounds = [Infinity,Infinity,-Infinity,-Infinity];
      for (const { x, y, brush } of sites) {
        const { clip, phase, depth, alpha, emission } = brush;
        const points = clip.frames[clip.at(time + phase)];
        for (const [dx,dy,color] of points) {
          const u = x + dx, v = y + dy, key = v * stride + u;
          if (!pixels.has(key)) pixels.set(key,[]);
          pixels.get(key).push(Object.freeze({ color, alpha, depth, emission }));
          bounds[0] = Math.min(bounds[0],u);
          bounds[1] = Math.min(bounds[1],v);
          bounds[2] = Math.max(bounds[2],u+1);
          bounds[3] = Math.max(bounds[3],v+1);
        }
      }
      if (!pixels.size) return null;
      for (const samples of pixels.values()) Object.freeze(samples);
      Object.freeze(bounds);
      return Object.freeze({ bounds, at(u,v) {
        if (!Number.isSafeInteger(u) || !Number.isSafeInteger(v) ||
            u < bounds[0] || u >= bounds[2] || v < bounds[1] || v >= bounds[3]) return;
        return pixels.get(v * stride + u);
      } });
    }

    const latest = new WeakMap();
    return (view, time = 0) => {
      const known = latest.get(view);
      if (known?.time === time) return known.result;
      const result = frame(view, time);
      latest.set(view, { time, result });
      return result;
    };
  }

  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = SpriteFringe;
