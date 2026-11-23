/* World-space history for first-hit art-pixel scan returns. */
(function (K) {
  const { V } = K;
  const triple = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const between = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const floats = (data, size) => (data instanceof Float32Array || data instanceof Float64Array) && data.length === size;

  function create({
    capacity = 8192, spacing = .07, range = [.4, 25], pixelStep = 1,
    freshFor = .22, settleAfter = 1, retention = Infinity, surfaceBias = .012, width = .023, density = 2,
    fresh = ['#fff7ca', '#adfff2', '#e7d4ff'],
    settled = ['#ffbc7a', '#65dcce', '#afa4f6'],
    old = ['#ba7e65', '#388e9e', '#786fb5']
  } = {}) {
    if (!Number.isSafeInteger(capacity) || !between(capacity, 1, 65536) ||
        !Number.isSafeInteger(pixelStep) || !between(pixelStep, 1, 32) ||
        !Array.isArray(range) || range.length !== 2 || !Array.from(range).every(n => between(n, 0, 400)) || range[1] <= range[0] ||
        !between(spacing, .0001, 100) || !between(width, .0001, 100) || !between(surfaceBias, 0, 1) ||
        !between(density, 0, 32) || !between(freshFor, 0, Number.MAX_VALUE) ||
        !between(settleAfter, freshFor, Number.MAX_VALUE) || typeof retention !== 'number' || !(retention > 0))
      throw new RangeError('Invalid pixel scanner spacing, range, age, or point budget');
    const bands = [fresh, settled, old].map(palette => {
      if (!Array.isArray(palette) || !between(palette.length, 1, 16) || palette.length !== fresh.length)
        throw new RangeError('Scan palettes need matching counts of 1 to 16 near-to-far swatches');
      return Array.from(palette, K.procedural.materials.perceptual.parse);
    });
    const [minRange, maxRange] = range;
    const cells = new Map(), active = new Set(), limitSquared = spacing ** 2;
    let lastTime = 0, captured = false;

    function clear() {
      cells.clear();
      active.clear();
      lastTime = 0;
      captured = false;
    }

    function remove(point) {
      active.delete(point);
      const cell = cells.get(point.cell);
      cell.delete(point);
      if (!cell.size) cells.delete(point.cell);
    }

    function adjacent(x, y, z, at, normal, object) {
      let best, distance = limitSquared;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cell = cells.get([x + dx, y + dy, z + dz].join(','));
        if (!cell) continue;
        for (const point of cell) {
          if (point.object !== object || (point.normal && normal && V.dot(point.normal, normal) < .5)) continue;
          const ab = V.sub(point.at, at), square = V.dot(ab, ab);
          if (square < distance) {
            best = point;
            distance = square;
          }
        }
      }
      return best;
    }

    function ingest(passes, { at, time = 0 } = {}) {
      const { w, h, depth, position, normal: normals, objectId, objects } = passes ?? {};
      const size = w * h;
      if (![w, h].every(n => Number.isSafeInteger(n) && n > 0) || size > 262144 ||
          !floats(depth, size) || !floats(position, size * 3) ||
          (normals !== undefined && !floats(normals, size * 3)) ||
          (objectId !== undefined && (!(objectId instanceof Uint32Array) || objectId.length !== size)) ||
          !triple(at) || !Number.isFinite(time))
        throw new RangeError('A scan needs aligned art-pixel depth and position passes, an XYZ emitter and finite time');

      const rewound = captured && time < lastTime;
      if (rewound) clear();
      captured = true;
      lastTime = time;
      for (const point of active) {
        if (time - point.lastSeen < retention) break;
        remove(point);
      }

      let added = 0, refreshed = 0, evicted = 0;
      for (let y = 0; y < h; y += pixelStep) for (let x = 0; x < w; x += pixelStep) {
        const p = y * w + x, i = p * 3;
        if (!Number.isFinite(depth[p]) || depth[p] <= 0) continue;
        const hit = [position[i], position[i + 1], position[i + 2]], toward = V.sub(at, hit);
        const distance = Math.hypot(...toward);
        if (!between(distance, minRange, maxRange)) continue;
        const n = normals && [normals[i], normals[i + 1], normals[i + 2]];
        const length = n && Math.hypot(...n);
        const facing = length > 1e-6 && Number.isFinite(length) ? V.mul(n, 1 / length) : null;
        const normal = facing && (V.dot(facing, toward) < 0 ? V.mul(facing, -1) : facing);
        const id = objectId?.[p] || 0, object = objects?.[id] ?? id;
        const grid = hit.map(n => Math.floor(n / spacing));
        if (!grid.every(Number.isSafeInteger)) continue;
        const point = adjacent(...grid, hit, normal, object);
        if (point) {
          if (point.lastSeen !== time) {
            point.range = distance;
            point.lastSeen = time;
            active.delete(point);
            active.add(point);
            refreshed++;
          }
          continue;
        }
        if (active.size === capacity) {
          remove(active.values().next().value);
          evicted++;
        }
        const cell = grid.join(',');
        const entry = { at: hit, normal, object, range: distance, firstSeen: time, lastSeen: time, cell };
        active.add(entry);
        if (!cells.has(cell)) cells.set(cell, new Set());
        cells.get(cell).add(entry);
        added++;
      }
      return { count: active.size, added, refreshed, evicted, rewound };
    }

    function visit(time, fn) {
      if (!Number.isFinite(time)) throw new TypeError('Pixel scanner time must be finite');
      for (const point of active) {
        const age = time - point.lastSeen;
        if (age < 0 || age >= retention) continue;
        const band = age < freshFor ? 0 : age < settleAfter ? 1 : 2;
        const colors = bands[band], slot = Math.min(colors.length - 1,
          Math.floor((point.range - minRange) * colors.length / (maxRange - minRange)));
        fn(point, colors[slot], band);
      }
    }

    function points(time = lastTime) {
      const result = [];
      visit(time, ({ at, normal, object, range: distance, firstSeen, lastSeen }, rgb, band) => {
        result.push({ at: at.slice(), normal: normal?.slice() ?? null, object, range: distance, firstSeen,
          lastSeen, rgb: rgb.slice(), age: ['fresh', 'settled', 'old'][band] });
      });
      return result;
    }

    function draw(drawer, time = lastTime) {
      let drawn = 0;
      visit(time, ({ at, normal }, rgb) => {
        const p = normal && surfaceBias ? V.mad(at, normal, surfaceBias) : at.slice();
        if (drawer.point(p, { rgb: rgb.slice(), width, density, emissive: true, depth: false })) drawn++;
      });
      return drawn;
    }

    return Object.freeze({ capacity, ingest, points, draw, clear });
  }

  K.pixelScanner = Object.freeze({ create });
})(KIT);
