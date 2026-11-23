/* Registered sprite patches with their own timing, direction and drawn in-betweens. */
const SpriteTransitions = (() => {
  const record = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const names = ['color', 'depth', 'normal', 'emission', 'mask'];
  const paintKeys = ['rows', 'slots', 'strokes'];
  const maskPalette = ['#ffffff'];
  const finite = Number.isFinite;
  const xy = value => Array.isArray(value) && value.length === 2 &&
    Array.from(value).every(n => Number.isSafeInteger(n) && Math.abs(n) <= 16384);
  const visible = (maps, index) => !maps.mask || maps.mask[index + 3] >= 128;
  const movedRect = (left, top, w, h, [dx, dy]) => [left + dx, top + dy, left + dx + w, top + dy + h];
  function check(ok, message) {
    if (!ok) throw new RangeError('Sprite transition: ' + message);
  }

  function prepare(definition, select, playback, { width, color, depthRange, copyRgba, pixelBudget, edited,
    silhouettes, selectAnchor }) {
    if (definition === undefined && silhouettes === undefined) return null;
    const transitions = definition === undefined ? [] : definition;
    const contours = silhouettes === undefined ? [] : silhouettes;
    check(Array.isArray(transitions) && Array.isArray(contours) && transitions.length + contours.length <= 256,
      'expected up to 256 transition and silhouette clips');
    const ids = new Set(), byView = new Map();
    let hasDepth = false;
    const stamps = typeof PixelStamps === 'undefined' ? require('./pixel-stamps.js') : PixelStamps;
    const clips = [...Array.from(transitions, clip => ({ clip, isContour: false })),
      ...Array.from(contours, clip => ({ clip, isContour: true }))];
    for (const { clip, isContour } of clips) {
      const clipKeys = ['id','frame','direction','pitch','rect','mode','start','period','fps','frames','palette',
        'extensionDepth','inheritEmission'];
      check(record(clip, isContour ? [...clipKeys,'pin','anchors'] : clipKeys), 'invalid clip settings');
      const { id, rect, mode = isContour ? 'replace' : 'patch', start = 0, period, fps = 12, frames, palette,
        extensionDepth, inheritEmission = true, pin = [0,0], anchors = [] } = clip;
      check(typeof id === 'string' && id.trim() && !ids.has(id), 'clips need distinct names');
      ids.add(id);
      check(Array.isArray(rect) && rect.length === 4 && Array.from(rect).every(Number.isSafeInteger) &&
        rect[2] > 0 && rect[3] > 0 && rect[2] * rect[3] <= 65536, 'rect needs an integer origin and up to 65,536 pixels');
      check((mode === 'patch' || mode === 'replace') && finite(start) && finite(fps) && fps > 0 &&
        typeof inheritEmission === 'boolean' && (extensionDepth === undefined || finite(extensionDepth)) &&
        Array.isArray(frames) && frames.length >= 1 &&
        frames.length <= 128, 'invalid mode, time, depth or cel list');
      const [left, top, w, h] = rect;
      const views = select(clip);
      check(xy(pin) && pin[0] >= 0 && pin[0] < w && pin[1] >= 0 && pin[1] < h &&
        Array.isArray(anchors) && anchors.length <= 4096, 'expected a pin inside the cel and a bounded list of anchors');
      const selected = new Set(views), pins = new Map();
      for (const anchor of anchors) {
        check(record(anchor, ['frame','direction','pitch','at']) && xy(anchor.at), 'an anchor needs a baked pose and an integer XY point');
        const matches = selectAnchor(anchor).views.filter(view => selected.has(view));
        check(matches.length, 'an anchor must match a view of its silhouette track');
        for (const view of matches) {
          check(!pins.has(view), 'anchors must match distinct views of their silhouette track');
          pins.set(view, anchor.at.slice());
        }
      }
      function paintMap(drawing, colors) {
        check(record(drawing, paintKeys) && Array.isArray(colors) && colors.length > 0 &&
          Array.from(colors).every(entry => typeof entry === 'string' && /^#[\da-f]{6}$/i.test(entry)),
          'indexed channels need a hex RGB palette and rows, slots or strokes');
        return stamps.image({ width: w, height: h, ...drawing, palette: colors }).rgba;
      }
      const entries = [];
      for (const [frame, cel] of frames.entries()) {
        const celKeys = ['duration','paint','images','maskPaint','emissionPaint'];
        check(record(cel, isContour ? [...celKeys,'hold','offset','mode'] : celKeys), 'invalid cel settings');
        const { duration = 1 / fps, paint, images, maskPaint, emissionPaint, hold,
          offset = entries[hold]?.offset ?? [0,0], mode: celMode = entries[hold]?.mode ?? mode } = cel;
        check(finite(duration) && duration > 0, 'cel duration must be positive');
        check(xy(offset) && offset.every(n => Math.abs(n) <= 128) &&
          (celMode === 'patch' || celMode === 'replace'), 'invalid cel mode or pixel offset');
        const indexed = [['color',paint,palette],['mask',maskPaint,maskPalette],['emission',emissionPaint,palette]]
          .filter(([, drawing]) => drawing !== undefined);
        let maps;
        if (hold !== undefined) {
          check(Number.isSafeInteger(hold) && hold >= 0 && hold < frame && entries[hold].maps &&
            images === undefined && !indexed.length, 'a hold must reference an earlier painted cel without new channels');
          maps = entries[hold].maps;
        } else if (images !== undefined || indexed.length) {
          check(images === undefined || record(images, names), 'invalid registered image channels');
          check((paint !== undefined || images?.color !== undefined) &&
            indexed.every(([name]) => !images || !Object.hasOwn(images,name)),
            'supply one color channel and at most one source per auxiliary channel');
          pixelBudget -= w * h * (indexed.length + Object.keys(images ?? {}).length);
          check(pixelBudget >= 0, 'cel maps exceed the atlas pixel budget');
          maps = Object.fromEntries(Object.entries(images ?? {}).map(([name, image]) =>
            [name, copyRgba(image, w * h * 4, 'Sprite transition ' + name)]));
          for (const [name,drawing,colors] of indexed) maps[name] = paintMap(drawing,colors);
          check(!maps.depth || depthRange, 'a depth cel needs the atlas depth range');
          hasDepth ||= Boolean(maps.depth) || extensionDepth !== undefined;
        }
        entries.push({ frame, duration, maps, offset: offset.slice(), mode: celMode });
      }
      const duration = entries.reduce((sum, entry) => sum + entry.duration, 0);
      const epsilon = Math.min(duration * 1e-7, Math.max(1, Math.abs(start), period ?? 0, duration) * 4 * Number.EPSILON);
      check(finite(start + duration) && start + duration > start &&
        (period === undefined || finite(period) && period > 0 && period >= duration - epsilon),
        'repeat period must be at least the clip duration');
      const pick = playback(entries, fps, 'once');
      function at(time) {
        const age = time - start;
        if (!finite(age) || age < -epsilon) return;
        let local = Math.max(0, age);
        if (period !== undefined) {
          local %= period;
          if (period - local <= epsilon) local = 0;
        }
        return local < duration - epsilon ? entries[pick(local)] : undefined;
      }
      const occupied = new Map();
      if (extensionDepth === undefined) for (const { maps, offset } of entries) {
        if (!maps) continue;
        const key = offset.join(',');
        if (!occupied.has(key)) occupied.set(key, new Set());
        const pixels = occupied.get(key);
        for (let p = 0; p < w * h; p++) {
          const index = p * 4;
          if (visible(maps,index) && maps.color[index + 3] && !maps.depth?.[index + 3]) pixels.add(p);
        }
      }
      const offsets = new Map(entries.filter(cel => cel.maps).map(({ offset }) => [offset.join(','), offset]));
      offsets.set('0,0', [0,0]);
      for (const view of views) {
        const anchor = pins.get(view) ?? [left + pin[0], top + pin[1]];
        const x0 = anchor[0] - pin[0], y0 = anchor[1] - pin[1];
        const patch = edited.get(view)?.maps.color;
        const { width: rw, height: rh } = view.rect;
        for (const [key, offset] of offsets) {
          const [l,t,r,b] = movedRect(x0, y0, w, h, offset);
          check(l >= -128 && t >= -128 && r <= rw + 128 && b <= rh + 128 && l < rw && t < rh && r > 0 && b > 0,
            'rect must overlap the registered view with at most 128 pixels of overhang');
          for (const p of occupied.get(key) ?? []) {
            const x = l + p % w, y = t + Math.floor(p / w);
            check(x >= 0 && y >= 0 && x < rw && y < rh &&
              (patch ? patch[(y * rw + x) * 4 + 3] : color[((view.rect.y + y) * width + view.rect.x + x) * 4 + 3]),
              'paint beyond the displayed silhouette needs extensionDepth or a depth texel');
          }
        }
        if (!byView.has(view)) byView.set(view, []);
        const draws = byView.get(view);
        check(draws.length < 16, 'one view can have up to 16 clips');
        draws.push({ id, isContour, anchor: Object.freeze(anchor), w, h, left: x0, top: y0, extensionDepth, inheritEmission, at });
      }
    }

    const cache = new WeakMap(), drawLists = new WeakMap();
    function frame(view, time, silhouette) {
      const prior = cache.get(view);
      if (silhouette === undefined && prior?.time === time) return prior.packet;
      const active = [];
      const bounds = [Infinity,Infinity,-Infinity,-Infinity];
      let pin;
      for (const clip of byView.get(view) ?? []) {
        if (silhouette !== undefined && (!clip.isContour || clip.id !== silhouette)) continue;
        const cel = clip.at(time);
        if (!cel?.maps) continue;
        const { left, top, w, h, extensionDepth, inheritEmission } = clip;
        const rect = movedRect(left, top, w, h, cel.offset);
        active.push({ bounds: rect, maps: cel.maps, mode: cel.mode, w, extensionDepth, inheritEmission });
        for (let i = 0; i < 4; i++) bounds[i] = (i < 2 ? Math.min : Math.max)(bounds[i], rect[i]);
        if (silhouette !== undefined) pin = clip.anchor;
      }
      const packet = active.length ? Object.freeze({ bounds: Object.freeze(bounds), ...(pin && { pin }) }) : null;
      if (packet) drawLists.set(packet, active);
      if (silhouette === undefined) cache.set(view, { time, packet });
      return packet;
    }
    function read(packet, x, y) {
      const active = drawLists.get(packet);
      for (let i = (active?.length ?? 0) - 1; i >= 0; i--) {
        const cel = active[i], [left,top,right,bottom] = cel.bounds;
        if (x < left || x >= right || y < top || y >= bottom) continue;
        const index = ((y - top) * cel.w + x - left) * 4;
        if (visible(cel.maps,index) && (cel.mode === 'replace' || cel.maps.color[index + 3]))
          return { maps: cel.maps, index, extensionDepth: cel.extensionDepth, inheritEmission: cel.inheritEmission };
      }
    }
    return { frame, read, hasDepth, pixelBudget, silhouetteIds: Object.freeze(contours.map(track => track.id)) };
  }
  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = SpriteTransitions;
