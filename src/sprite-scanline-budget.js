/* Sprite evaluation on the top-left native art grid. Paint and depth are resolved afterward. */
const SpriteScanlineBudget = (() => {
  const maxSprites = 512;
  const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

  function prepare(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw new TypeError('A sprite scanline budget needs an options object');
    const { limit = 8, rotate = false, holdFrames = 1, fps = 60 } = options;
    if (!integer(limit, 0, maxSprites) || typeof rotate !== 'boolean' ||
        !integer(holdFrames, 1, 4096) || !(Number.isFinite(fps) && fps > 0 && fps <= 240))
      throw new RangeError('Invalid sprite scanline limit, rotation, hold, or frame rate');
    return { limit, rotate, holdFrames, fps };
  }

  function evaluate(sprites, { height, budget = {}, time = 0, frame } = {}) {
    const { limit, rotate, holdFrames, fps } = prepare(budget);
    const tick = frame ?? Math.floor(time * fps + 1e-9);
    if (!integer(height, 1, 8192) || !Number.isSafeInteger(tick) || !Array.isArray(sprites) ||
        sprites.length > maxSprites)
      throw new RangeError('Invalid sprite scanline canvas, frame, or sprite count');
    const ids = new Set(), clamp = y => Math.max(0, Math.min(height, y));
    const entries = Array.from(sprites, (input, index) => {
      const { id = String(index), priority = 0, top, bottom } = input ?? {};
      if (typeof id !== 'string' || !id.trim() || ids.has(id) || !Number.isFinite(priority) ||
          !Number.isInteger(top) || !Number.isInteger(bottom) || top > bottom)
        throw new TypeError('Sprite scanline entries need distinct IDs, integer row bounds, and finite priorities');
      ids.add(id);
      return { id, priority, index, top: clamp(top), bottom: clamp(bottom), dropped: [] };
    });

    const phase = Math.floor(tick / holdFrames), groups = new Map();
    for (const entry of entries) {
      if (!groups.has(entry.priority)) groups.set(entry.priority, []);
      groups.get(entry.priority).push(entry);
    }
    const used = new Uint16Array(height), droppedCounts = new Uint16Array(height);
    const allowed = new Uint8Array(height * entries.length);
    for (const [, group] of [...groups].sort(([a], [b]) => b - a)) {
      const length = group.length;
      const start = rotate ? ((phase % length) + length) % length : 0;
      for (let i = 0; i < length; i++) {
        const { index, top, bottom, dropped } = group[(i + start) % length];
        const base = index * height;
        for (let y = top; y < bottom; y++) {
          if (used[y] < limit) {
            used[y]++;
            allowed[base + y] = 1;
            continue;
          }
          droppedCounts[y]++;
          const last = dropped[dropped.length - 1];
          if (last?.[1] === y) last[1]++;
          else dropped.push([y, y + 1]);
        }
      }
    }
    const report = { limit, frame: tick, phase: rotate ? phase : 0, used, droppedCounts,
      sprites: entries.map(({ id, priority, top, bottom, dropped }) => ({ id, priority, top, bottom, dropped })) };
    return { report, allows: (index, row) => index >= 0 && index < entries.length && row >= 0 && row < height &&
      allowed[index * height + row] === 1 };
  }

  return Object.freeze({ prepare, evaluate });
})();
if (typeof module !== 'undefined') module.exports = SpriteScanlineBudget;
