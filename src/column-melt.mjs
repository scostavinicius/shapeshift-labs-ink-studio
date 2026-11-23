const clamp = (value) => Math.max(0, Math.min(1, value));

function checkSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 8192 || height > 8192 || width * height > 16777216) {
    throw new RangeError('Expected positive column melt image dimensions within 8192 × 8192 and 16 megapixels');
  }
}

function checkImage(image) {
  const { width, height, data } = image;
  checkSize(width, height);
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new TypeError('Expected a column melt image with width, height, and RGBA bytes');
  }
}

/** Reduce a painted control image to one timing texel per vertical strip. */
export function createColumnMeltMap(paint, { strips = paint.width, spread = 0.55 } = {}) {
  checkImage(paint);
  if (!Number.isInteger(strips) || strips < 1 || strips > paint.width ||
      !Number.isFinite(spread) || spread < 0 || spread > 1) {
    throw new RangeError('Expected a strip count within the paint width and spread within [0, 1]');
  }
  const data = new Uint8Array(strips * 4);
  for (let x = 0; x < paint.width; x++) {
    const strip = Math.floor((x + 0.5) * strips / paint.width);
    const output = strip * 4;
    for (let y = 0; y < paint.height; y++) {
      const input = (y * paint.width + x) * 4;
      const alpha = paint.data[input + 3] / 255;
      for (let channel = 0; channel < 3; channel++) {
        data[output + channel] = Math.max(data[output + channel], Math.round(paint.data[input + channel] * alpha));
      }
    }
  }

  const arrival = new Float64Array(strips);
  for (let i = 0; i < strips; i++) arrival[i] = data[i * 4] ? 1 - data[i * 4] / 255 : Infinity;
  if (arrival.every((time) => time === Infinity)) arrival[Math.floor((strips - 1) / 2)] = 0;

  const rate = spread / Math.max(1, strips - 1);
  const travel = (a, b) => rate * (1 + 4 * Math.max(data[a * 4 + 1], data[b * 4 + 1]) / 255);
  // Every shortest path to a strip arrives from its left or its right.
  for (let i = 1; i < strips; i++) arrival[i] = Math.min(arrival[i], arrival[i - 1] + travel(i, i - 1));
  for (let i = strips - 2; i >= 0; i--) arrival[i] = Math.min(arrival[i], arrival[i + 1] + travel(i, i + 1));
  for (let i = 0; i < strips; i++) {
    data[i * 4] = Math.round(clamp(arrival[i]) * 255);
    data[i * 4 + 3] = 255;
  }
  return { width: strips, height: 1, data };
}

// Matches the standard transition shader's unsigned hash.
function hash(x, y, seed) {
  let n = (Math.imul(x + seed, 1664525) + Math.imul(y + seed * 11, 1013904223)) ^ 2246822519;
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return (n >>> 8) / 16777216;
}

function dropAt(progress, arrival, stick, height) {
  const start = 0.60 * arrival;
  const phase = clamp((progress - start) / (1 - start));
  const slip = 0.14 * stick;
  const hold = 0.52 * stick;
  const sag = 0.10 * stick;
  if (phase < slip) return Math.round(height * sag * phase / slip);
  const fall = Math.max(0, (phase - slip - hold) / (1 - slip - hold));
  return Math.round(height * (sag + (1 - sag) * fall * fall));
}

/** Render a column melt into top-left, nearest-neighbor RGBA pixels. */
export function renderColumnMelt(from, to, {
  progress = 0, map, cellSize = 3, seed = 27, width = from.width, height = from.height
} = {}) {
  checkImage(from);
  checkImage(to);
  checkSize(width, height);
  if (!Number.isFinite(progress) || !Number.isFinite(cellSize) || cellSize < 1 || cellSize > 512 ||
      !Number.isFinite(seed) || seed < 0 || seed > 16777215) {
    throw new RangeError('Expected finite progress, cellSize within [1, 512], and seed within [0, 16777215]');
  }
  if (map !== undefined) {
    checkImage(map);
    if (map.height !== 1) throw new RangeError('Expected a one-row column melt map');
  }

  const data = new Uint8Array(width * height * 4);
  const size = Math.round(cellSize);
  const patternSeed = Math.floor(seed);
  for (let x = 0; x < width; x++) {
    const strip = map ? Math.floor((x + 0.5) * map.width / width) : Math.floor(x / size);
    const arrival = map ? map.data[strip * 4] / 255 : hash(strip, 3, patternSeed);
    const stick = map ? map.data[strip * 4 + 2] / 255 : (hash(strip, 19, patternSeed) > 0.82 ? 0.62 : 0);
    const drop = progress <= 0 ? 0 : progress >= 1 ? height : dropAt(progress, arrival, stick, height);
    const fromX = Math.floor((x + 0.5) * from.width / width);
    const toX = Math.floor((x + 0.5) * to.width / width);
    for (let y = 0; y < height; y++) {
      const incoming = y < drop;
      const source = incoming ? to : from;
      const sourceX = incoming ? toX : fromX;
      const row = incoming ? y : y - drop;
      const sourceY = Math.floor((row + 0.5) * source.height / height);
      const src = (sourceY * source.width + sourceX) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = source.data[src];
      data[dst + 1] = source.data[src + 1];
      data[dst + 2] = source.data[src + 2];
      data[dst + 3] = source.data[src + 3];
    }
  }
  return { width, height, data };
}
