/* Shared motion-smear settings, raw motion inputs and CPU history transport. */
const MotionSmear = (() => {
  const composite = typeof FrameComposite === 'undefined' ? require('./frame-composite.js') : FrameComposite;
  const banks = typeof FrameBank === 'undefined' ? require('./frame-bank.js') : FrameBank;
  const tuple = values => Array.isArray(values) && values.length === 2 && Array.from(values).every(Number.isFinite);
  const bounded = vector => tuple(vector) && vector.every(n => Math.abs(n) <= 4096);

  function settings({ halfLife = .45, velocity = [0, 0], fieldScale = [1, 1], blockSize = [1, 1] } = {}) {
    if (!Number.isFinite(halfLife) || halfLife <= 0 || halfLife > 60 ||
        !bounded(velocity) || !bounded(fieldScale) || !tuple(blockSize) ||
        !blockSize.every(n => Number.isInteger(n) && n >= 1 && n <= 4096))
      throw new RangeError('Motion smear needs bounded XY velocity, field scale, block size and halfLife');
    return { halfLife, velocity: velocity.slice(), fieldScale: fieldScale.slice(), blockSize: blockSize.slice() };
  }

  function convention({ direction = 'current-minus-previous', units = 'pixels/frame', minConfidence = 0 } = {}) {
    if (!['current-minus-previous', 'backward'].includes(direction) || !['pixels/frame', 'pixels/second'].includes(units) ||
        !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1)
      throw new RangeError('Invalid motion direction, units or confidence threshold');
    return { direction, units, minConfidence };
  }

  function plane(source, width, height, channels, min, max, label) {
    const data = source?.data;
    if (source?.width !== width || source.height !== height || (source.channels ?? channels) !== channels ||
        (!Array.isArray(data) && !ArrayBuffer.isView(data)) || data.length !== width * height * channels)
      throw new RangeError(label + ' needs ' + channels + ' aligned channel(s)');
    for (let i = 0; i < data.length; i++) {
      const n = data[i];
      if (!Number.isFinite(n) || n < min || n > max)
        throw new RangeError(label + ' needs finite samples in [' + min + ', ' + max + ']');
    }
    return data;
  }

  function raw(source, { width, height, confidence, valid, minConfidence = 0 }) {
    if (source == null) return null;
    if (width * height > 1048576) throw new RangeError('Raw motion exceeds its pixel budget');
    const vectors = plane(source, width, height, 2, -16384, 16384, 'Raw motion');
    const likelihood = confidence == null ? null : plane(confidence, width, height, 1, 0, 1, 'Motion confidence');
    const validity = valid == null ? null : plane(valid, width, height, 1, 0, 255, 'Motion validity');
    const packed = new Float32Array(width * height * 4);
    for (let p = 0, i = 0; p < width * height; p++, i += 4) {
      const strength = likelihood?.[p] ?? 1;
      if (strength < minConfidence || validity && validity[p] === 0) continue;
      packed[i] = vectors[p * 2];
      packed[i + 1] = vectors[p * 2 + 1];
      packed[i + 2] = strength;
      packed[i + 3] = 1;
    }
    return packed;
  }

  function prepareBlocks(value, blockSize) {
    const record = (input, keys) => input && [Object.prototype, null].includes(Object.getPrototypeOf(input)) &&
      Object.keys(input).every(key => keys.includes(key));
    if (value === undefined) return undefined;
    if (!record(value, ['rect', 'recovery'])) throw new TypeError('Invalid datamosh blockMemory settings');
    const { rect, recovery } = value;
    if (rect !== undefined && (!Array.isArray(rect) || rect.length !== 4 ||
        !Array.from(rect).every(n => Number.isInteger(n) && Math.abs(n) <= 32768) || rect[2] <= 0 || rect[3] <= 0))
      throw new RangeError('Datamosh blockMemory rectangle needs integer XY and positive dimensions');
    let cadence;
    if (recovery !== undefined) {
      if (!record(recovery, ['groupSize', 'fps', 'every', 'phase', 'step']))
        throw new TypeError('Invalid datamosh block recovery');
      const { groupSize = [1, 1], fps, every, phase, step } = recovery;
      if (!tuple(groupSize) || !groupSize.every((n, i) => Number.isInteger(n) && n > 0 && n * blockSize[i] <= 32768))
        throw new RangeError('Block recovery groupSize needs two positive block counts within the tile size limit');
      cadence = banks.prepare({ fps, tiles: { size: blockSize.map((n, i) => n * groupSize[i]), every, phase, step } });
    }
    return { rect: rect?.slice(), cadence };
  }

  function blockFrame(settings, w, h, time, prior) {
    if (!settings) return undefined;
    const [x, y, width, height] = settings.rect ?? [0, 0, w, h];
    const clamp = (n, max) => Math.max(0, Math.min(n, max));
    const left = clamp(x, w), top = clamp(y, h);
    const right = clamp(x + width, w), bottom = clamp(y + height, h);
    const step = settings.cadence && banks.schedule(settings.cadence, time, prior);
    return { rect: [left, top, right, bottom], grid: step?.grid, clock: step?.clock };
  }

  // Retained texels are valid inside the feed when their centers land in its rect.
  function sampleBounds(rect, w, h, width, height) {
    if (!rect) return undefined;
    const [left, top, right, bottom] = rect;
    const first = (n, native, stored) => Math.ceil(n * stored / native - .5);
    const x0 = first(left, w, width), y0 = first(top, h, height);
    const x1 = first(right, w, width), y1 = first(bottom, h, height);
    return x0 < x1 && y0 < y1 ? [x0 + .5, y0 + .5, x1 - .5, y1 - .5] : null;
  }

  function sampleHistory(source, x, y, crop, color) {
    if (crop) {
      x = Math.max(crop[0], Math.min(x, crop[2]));
      y = Math.max(crop[1], Math.min(y, crop[3]));
    }
    composite.sample(source, x, y, color);
  }

  function address(node, { width: w, height: h, elapsed, field, raw: isRaw, refresh, hold, blocks, decay }) {
    const [bx, by] = node.blockSize, [vx, vy] = node.velocity, [sx, sy] = node.fieldScale;
    const sign = node.direction === 'backward' ? -1 : 1;
    const interval = node.units === 'pixels/second' ? elapsed : 1;
    const [left, top, right, bottom] = blocks?.rect ?? [0, 0, w, h];
    const grid = blocks?.grid, columns = grid && Math.ceil((right - left) / grid.size[0]);
    return (x, y, donor) => {
      if (x < left || x >= right || y < top || y >= bottom) return 0;
      if (grid && banks.tileDue(grid, x - left, y - top, columns)) return 0;
      let p;
      if (field || blocks) {
        const bx0 = left + Math.floor((x - left) / bx) * bx, by0 = top + Math.floor((y - top) / by) * by;
        const fx = Math.floor(bx0 + Math.min(bx, right - bx0) * .5);
        const fy = Math.floor(by0 + Math.min(by, bottom - by0) * .5);
        p = fy * w + fx;
      }
      const clean = refresh?.[blocks ? p : Math.floor(y) * w + Math.floor(x)] ?? 0;
      const keep = 1 - clean / 255;
      if (!keep) return 0;
      if (blocks && hold?.[p] >= 128) {
        donor[0] = x;
        donor[1] = y;
        return keep;
      }
      if (!decay || isRaw && !field) return 0;
      let dx = vx, dy = vy, strength = 1;
      if (field) {
        const at = p * 4;
        strength = field[at + 2];
        if (!field[at + 3] || !strength) return 0;
        if (isRaw) {
          dx = vx * elapsed + field[at] * sx * sign * interval;
          dy = vy * elapsed + field[at + 1] * sy * sign * interval;
        } else {
          const straight = 255 / field[at + 3];
          dx += sx * Math.max(-1, (Math.round(field[at] * straight) - 128) / 127);
          dy += sy * Math.max(-1, (Math.round(field[at + 1] * straight) - 128) / 127);
          strength /= 255;
        }
      }
      donor[0] = x - (isRaw ? dx : dx * elapsed);
      donor[1] = y - (isRaw ? dy : dy * elapsed);
      if (!(donor[0] >= left && donor[0] < right && donor[1] >= top && donor[1] < bottom)) return 0;
      return strength * keep * decay;
    };
  }

  function write(input, prior, { w, h, width, height, filter, locate, crop }, carry) {
    const result = new Uint8Array(width * height * 4), donor = [0, 0], color = new Float64Array(4);
    const old = { data: prior, w: width, h: height, filter };
    for (let j = 0, q = 0; j < height; j++) for (let i = 0; i < width; i++, q += 4) {
      const x = ((i + .5) * w) / width, y = ((j + .5) * h) / height;
      const from = (Math.floor(y) * w + Math.floor(x)) * 4;
      const amount = prior && crop !== null ? locate(x, y, donor) : 0;
      if (carry) carry[q / 4] = amount;
      if (amount) sampleHistory(old, donor[0] * width / w, donor[1] * height / h, crop, color);
      // Round toward the clean sample so a fading residual can reach zero.
      for (let c = 0; c < 4; c++) {
        const clean = input[from + c], delta = (color[c] - clean) * amount;
        result[q + c] = clean + Math.sign(delta) * Math.floor(Math.abs(delta) + 1e-5);
      }
    }
    return result;
  }

  return Object.freeze({ settings, convention, raw, plane, prepareBlocks, blockFrame, sampleBounds, sampleHistory, address, write });
})();
if (typeof module !== 'undefined') module.exports = MotionSmear;
