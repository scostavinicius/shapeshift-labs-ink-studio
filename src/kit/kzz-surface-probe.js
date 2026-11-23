/* Inspect current, named surface samples with pixel marks and stable callouts. */
(function (K) {
  const cels = Object.freeze({
    dot: ['#'],
    dash: ['##'],
    cross: ['.#.', '###', '.#.'],
    ring: ['.#.', '#.#', '.#.']
  });
  const defaults = {
    idle: '#3d7887', hit: '#e1ffd4', held: '#77bdad', leader: '#509592',
    bracket: '#a0dbba', cursor: '#fbe8b6'
  };
  const tuple = (value, n) => (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    value.length === n && Array.from(value).every(Number.isFinite);
  function check(ok, message) {
    if (!ok) throw new TypeError('Surface probe: ' + message);
  }
  function record(value, keys, label) {
    check(value && Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).every(key => keys.includes(key)), 'invalid ' + label);
  }
  function color(value) {
    check(typeof value === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value), 'expected an RGB or RGBA hex swatch');
    return value;
  }
  function anchor(value, space) {
    if (typeof value === 'function') return value;
    if (space === 'screen' || tuple(value, 3)) {
      check(tuple(value, space === 'screen' ? 2 : 3), 'expected screen XY or world XYZ');
      return Array.from(value);
    }
    if (value?.node !== undefined) {
      record(value, ['node', 'socket', 'point'], 'hierarchy anchor');
      check(typeof value.node === 'string' && value.node.trim() &&
        (value.socket === undefined || typeof value.socket === 'string' && value.socket.trim()) &&
        (value.point === undefined || tuple(value.point, 3)), 'invalid hierarchy anchor');
      return { ...value, ...(value.point && { point: Array.from(value.point) }) };
    }
    return ViewAnnotations.anchor(value);
  }
  function cel(value) {
    const rows = typeof value === 'string' && Object.hasOwn(cels, value) ? cels[value] : value;
    check(Array.isArray(rows) && rows.length >= 1 && rows.length <= 9 &&
      Array.from(rows).every(row => typeof row === 'string' && row.length === rows[0]?.length &&
        /^[.#]{1,9}$/.test(row)) && rows.some(row => row.includes('#')), 'expected a mark name or a 1–9 pixel cel');
    const pixels = [];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++)
      if (rows[y][x] === '#') pixels.push([x - Math.floor(rows[y].length / 2), y - Math.floor(rows.length / 2)]);
    return pixels;
  }

  function create(definition) {
    record(definition, ['samples', 'at', 'space', 'radius', 'hold', 'maxLeaders', 'style'], 'definition');
    const { samples, space = 'world', radius = 1, hold = .18, maxLeaders = 6, style = {} } = definition;
    check(space === 'world' || space === 'screen', 'space must be world or screen');
    check(Number.isFinite(radius) && radius > 0 && Number.isFinite(hold) && hold >= 0 &&
      Number.isInteger(maxLeaders) && maxLeaders >= 0 && maxLeaders <= 16, 'invalid radius, hold or leader limit');
    check(Array.isArray(samples) && samples.length > 0 && samples.length <= 4096, 'expected one to 4096 samples');
    record(style, Object.keys(defaults), 'style');
    const ink = { ...defaults, ...style };
    Object.values(ink).forEach(color);
    const center = anchor(definition.at, space);
    const ids = new Set();
    const rows = Array.from(samples, entry => {
      record(entry, ['id', 'at', 'mark', 'color', 'leader', 'label'], 'sample');
      const { id, mark = 'dot', color: idle = ink.idle, leader = true, label = id } = entry;
      check(typeof id === 'string' && id.trim() && !ids.has(id) &&
        typeof label === 'string' && typeof leader === 'boolean', 'samples need distinct IDs, labels and a boolean leader option');
      ids.add(id);
      return { id, label, at: anchor(entry.at, 'world'), pixels: cel(mark), idle: color(idle), leader };
    });

    check(rows.reduce((count, row) => count + row.pixels.length, 0) <= 8000, 'marks exceed the 8,000 drawn-pixel budget');
    const lastHit = new Float64Array(rows.length);
    let lastTime, links;
    function reset() {
      lastHit.fill(-Infinity);
      lastTime = -Infinity;
      links = [];
    }
    reset();

    function sample({ world, camera, width, height, time = 0, sceneTime = world?.timeDomains?.read('animation').sampleTime ?? world?.lookSnapshot?.time ?? time } = {}) {
      check(Number.isFinite(time) && Number.isFinite(sceneTime) && Number.isInteger(width) && width > 0 &&
        Number.isInteger(height) && height > 0, 'sampling needs finite clocks and a positive pixel viewport');
      if (time < lastTime) reset();
      lastTime = time;
      const view = DrawingPrimitives.projector(camera, width, height);
      function project(point) {
        const local = view.toView(point);
        return view.visible(local) ? view.point(local) : null;
      }
      const context = { world, camera, time, sceneTime, width, height, project };
      let posed;
      function resolve(value, units) {
        let at = typeof value === 'function' ? value(context) : value;
        if (at == null) return null;
        if (tuple(at, units === 'screen' ? 2 : 3)) return Array.from(at);
        check(units === 'world' && typeof at === 'object' && !Array.isArray(at) && !ArrayBuffer.isView(at),
          'an anchor callback must return a point, world binding or null');
        if (typeof value === 'function') at = anchor(at, 'world');
        if (!world) return null;
        if (at.splat !== undefined) {
          if (at.splat >= world.count) return null;
          posed ??= K.splatFrames.create(world, sceneTime, K.M);
          const position = posed(at.splat).position();
          return at.offset ? K.V.add(position, at.offset) : position;
        }
        return (at.node === undefined ? K.annotations.anchor(at, context) : K.inspection.anchor(at, context)?.at) ?? null;
      }
      function inside(p) {
        return p?.[0] >= 0 && p[0] < width && p[1] >= 0 && p[1] < height;
      }
      const origin = resolve(center, space);
      const pin = origin && (space === 'screen' ? origin : project(origin));
      const visible = [], available = new Map();
      for (const [index, row] of rows.entries()) {
        const position = resolve(row.at, 'world');
        const at = position && project(position);
        if (!inside(at)) {
          lastHit[index] = -Infinity;
          continue;
        }
        const point = space === 'screen' ? at : position;
        const distance = origin && pin ? Math.hypot(...point.map((v, axis) => v - origin[axis])) : Infinity;
        const hit = distance <= radius;
        if (hit) lastHit[index] = time;
        const state = hit ? 'hit' : hold > 0 && time - lastHit[index] <= hold ? 'held' : 'idle';
        const item = { index, id: row.id, label: row.label, position, at, distance, state };
        visible.push(item);
        if (maxLeaders && inside(pin) && row.leader && state !== 'idle') available.set(index, item);
      }
      links = links.filter(index => available.has(index));
      if (links.length < maxLeaders && available.size > links.length) {
        const retained = new Set(links);
        const nearest = [...available.values()].filter(item => !retained.has(item.index)).sort((a, b) =>
          Number(a.state === 'held') - Number(b.state === 'held') || a.distance - b.distance || a.index - b.index);
        links.push(...nearest.slice(0, maxLeaders - links.length).map(item => item.index));
      }
      return { at: inside(pin) ? pin : null, samples: visible, leaders: links.map(index => available.get(index)) };
    }

    const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
    const pixel = point => point.map(Math.floor);
    function brackets([x, y], r, length, swatch) {
      return [-1, 1].flatMap(dx => [-1, 1].flatMap(dy => {
        const left = x + dx * r, top = y + dy * r;
        return [rect(left - (dx > 0 ? length - 1 : 0), top, length, 1, swatch),
          rect(left, top - (dy > 0 ? length - 1 : 0), 1, length, swatch)];
      }));
    }

    function commands(frame) {
      const center = frame.at && pixel(frame.at);
      const result = [];
      for (const item of frame.leaders) {
        const tip = pixel(item.at);
        if (tip.some((n, i) => n !== center[i]))
          result.push({ type: 'path', points: [center, tip].map(point => point.map(n => n + .5)), stroke: ink.leader, width: 1 });
      }
      // Keep shared pixel sites readable even when the surface foreshortens.
      for (const state of ['idle', 'held', 'hit']) {
        for (const item of frame.samples) if (item.state === state) {
          const [x, y] = pixel(item.at), row = rows[item.index], swatch = state === 'idle' ? row.idle : ink[state];
          for (const [dx, dy] of row.pixels) result.push(rect(x + dx, y + dy, 1, 1, swatch));
        }
      }
      for (const item of frame.leaders) result.push(...brackets(pixel(item.at), 3, 2, ink.bracket));
      if (center) result.push(...brackets(center, 5, 3, ink.cursor), rect(...center, 1, 1, ink.cursor));
      return result;
    }

    function layer() {
      return {
        needsCamera: true,
        source({ w, h, ...context }) {
          const frame = sample({ ...context, width: w, height: h });
          const { data } = K.procedural.drawing2d.render({ width: w, height: h, edges: 'hard', commands: commands(frame) });
          return { w, h, rgba: data };
        }
      };
    }
    return Object.freeze({ sample, commands, layer, reset });
  }
  K.surfaceProbe = Object.freeze({ create });
})(KIT);
