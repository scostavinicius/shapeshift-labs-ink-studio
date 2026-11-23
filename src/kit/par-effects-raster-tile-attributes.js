/* Paint ink and paper registers over a fixed one-bit art grid. */
(function (P) {
  const { view, channel, int, tuple } = P.pixelEffectSupport;
  const paletteType = P.graphTypes.validator('palette');
  const record = P.graphTypes.validator('record');

  function compile(source, palette, { tileSize = 8, defaults = { ink: 1, paper: 0 }, cells = [] } = {}) {
    const { width, height, data, channels = data.length / (width * height), pivot } = view(source);
    if (channels !== 1 || !data.every(bit => bit === 0 || bit === 1))
      throw new RangeError('Tile attributes need a one-channel bitmap of 0 (paper) and 1 (ink)');
    if (pivot !== undefined && !tuple(pivot, 2)) throw new TypeError('Bitmap pivot needs two finite coordinates');
    const bitmap = Uint8Array.from(data), anchor = pivot?.slice();
    const [tileWidth, tileHeight] = Array.isArray(tileSize) && tileSize.length === 2 ? tileSize : [tileSize, tileSize];
    if (![tileWidth, tileHeight].every(size => int(size, 1, 8192)))
      throw new RangeError('Tile size needs positive integer pixel dimensions');
    if (!paletteType(palette)) throw new TypeError('Tile attributes need an indexed palette');
    const swatches = Array.from(palette.palette ?? palette, swatch =>
      [...P.materials.perceptual.parse(swatch).map(value => Math.round(value * 255)), 255]);
    const roles = { ...palette.roles };
    const cols = Math.ceil(width / tileWidth), rows = Math.ceil(height / tileHeight);
    const slot = value => typeof value === 'string' && Object.hasOwn(roles, value) ? roles[value] : value;
    const index = value => {
      if (!tuple(value, 2, Number.isSafeInteger) || !int(value[0], 0, cols - 1) || !int(value[1], 0, rows - 1))
        throw new RangeError('Tile coordinate is outside the attribute map');
      return value[1] * cols + value[0];
    };

    function attributes(input, { partial = false, priority = 0 } = {}) {
      if (!record(input) || Object.keys(input).some(key => !['ink', 'paper', 'priority'].includes(key)))
        throw new TypeError('Expected tile ink and paper attributes');
      const result = {};
      for (const key of ['ink', 'paper']) {
        if (partial && !Object.hasOwn(input, key)) continue;
        const value = input[key];
        if (value !== null && !int(slot(value), 0, swatches.length - 1))
          throw new RangeError('Tile ' + key + ' must be a palette slot, role, or null');
        result[key] = value;
      }
      result.priority = priority;
      if (!Number.isFinite(result.priority)) throw new RangeError('Tile priority must be finite');
      return Object.freeze(result);
    }

    const base = attributes(defaults, { priority: defaults?.priority ?? 0 });
    function edit(map, changes) {
      if (!Array.isArray(changes)) throw new TypeError('Tile paint needs an array of cell edits');
      const next = new Map(map);
      for (const change of changes) {
        const id = index(change?.cell), paint = change.attributes;
        if (paint === null) next.delete(id);
        else {
          const current = next.get(id) ?? base;
          const patch = attributes(paint, { partial: true, priority: paint?.priority ?? current.priority });
          next.set(id, Object.freeze({ ...current, ...patch }));
        }
      }
      return next;
    }

    function hit(write, visit) {
      const { cells, rect, mask, at = [0, 0], channel: maskChannel, threshold = 1 } = write;
      if (Number(cells !== undefined) + Number(rect !== undefined) + Number(mask !== undefined) !== 1)
        throw new TypeError('A tile write needs exactly one footprint: cells, rect, or mask');
      if (cells !== undefined) {
        if (!Array.isArray(cells)) throw new TypeError('Tile write cells need an array of coordinates');
        for (const cell of cells) visit(index(cell));
        return;
      }

      let bounds = rect, samples;
      if (mask !== undefined) {
        if (!tuple(at, 2, Number.isSafeInteger) || !Number.isFinite(threshold))
          throw new TypeError('Tile coverage needs an integer pixel origin and a finite threshold');
        const { width, height } = view(mask);
        bounds = [...at, width, height];
        samples = channel(mask, maskChannel);
      }
      if (!tuple(bounds, 4, Number.isSafeInteger) || bounds[2] <= 0 || bounds[3] <= 0 ||
          !Number.isSafeInteger(bounds[0] + bounds[2]) || !Number.isSafeInteger(bounds[1] + bounds[3]))
        throw new RangeError('Tile footprint needs an integer pixel rectangle with positive size');
      const [x, y, w, h] = bounds;
      const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(width, x + w), bottom = Math.min(height, y + h);
      if (left >= right || top >= bottom) return;

      function covers(x0, y0, x1, y1) {
        if (!samples) return true;
        for (let py = y0; py < y1; py++)
          for (let px = x0; px < x1; px++)
            if (samples[(py - y) * w + px - x] >= threshold) return true;
        return false;
      }
      for (let row = Math.floor(top / tileHeight); row * tileHeight < bottom; row++)
        for (let col = Math.floor(left / tileWidth); col * tileWidth < right; col++) {
          const x0 = col * tileWidth, y0 = row * tileHeight;
          if (covers(Math.max(left, x0), Math.max(top, y0), Math.min(right, x0 + tileWidth), Math.min(bottom, y0 + tileHeight)))
            visit(row * cols + col);
        }
    }

    function surface(map) {
      function frame({ writes = [] } = {}) {
        if (!Array.isArray(writes)) throw new TypeError('Tile attribute writes need an ordered array');
        const winners = new Map();
        for (const write of writes) {
          if (!record(write) || write.id !== undefined && (typeof write.id !== 'string' || !write.id.length))
            throw new TypeError('Tile attribute writes need records with optional nonempty string IDs');
          const patch = attributes(write.attributes, { partial: true, priority: write.priority ?? 1 });
          if (Object.keys(patch).length < 2) throw new TypeError('Tile writes must set ink or paper');
          const candidate = { patch, id: write.id ?? null };
          hit(write, id => {
            if (patch.priority >= (winners.get(id)?.patch ?? map.get(id) ?? base).priority) winners.set(id, candidate);
          });
        }

        const rgba = new Uint8Array(bitmap.length * 4);
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
          const id = row * cols + col, painted = map.get(id) ?? base, patch = winners.get(id)?.patch;
          const ink = swatches[slot(patch && Object.hasOwn(patch, 'ink') ? patch.ink : painted.ink)];
          const paper = swatches[slot(patch && Object.hasOwn(patch, 'paper') ? patch.paper : painted.paper)];
          const x0 = col * tileWidth, y0 = row * tileHeight;
          const x1 = Math.min(width, x0 + tileWidth), y1 = Math.min(height, y0 + tileHeight);
          for (let y = y0; y < y1; y++) for (let x = x0, p = y * width + x0; x < x1; x++, p++) {
            const color = bitmap[p] ? ink : paper;
            if (color) rgba.set(color, p * 4);
          }
        }
        const value = { width, height, channels: 4, data: rgba, ...(anchor && { pivot: anchor.slice() }) };
        function inspect(cell) {
          const id = index(cell), painted = map.get(id) ?? base, winner = winners.get(id);
          return { painted, attributes: { ...painted, ...winner?.patch }, winner: winner?.id ?? null, overridden: !!winner };
        }
        return { value, inspect };
      }

      return Object.freeze({
        width, height, cols, rows, tileSize: Object.freeze([tileWidth, tileHeight]), defaults: base,
        paint: changes => surface(edit(map, changes)),
        tileMap: () => [...map].sort(([a], [b]) => a - b).map(([id, attributes]) => ({
          cell: [id % cols, Math.floor(id / cols)], attributes
        })),
        frame
      });
    }
    return surface(edit(undefined, cells));
  }

  P.pixelEffects.tileAttributes = Object.freeze({ compile });
})(KIT.procedural);
