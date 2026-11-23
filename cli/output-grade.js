const ColorStack = require('../src/color-stack.js');

const packedAt = (rgb, index) => rgb[index] * 65536 + rgb[index + 1] * 256 + rgb[index + 2];
const channels = packed => [packed >> 16, (packed >> 8) & 255, packed & 255];
const normalized = packed => channels(packed).map(value => value / 255);
const pack = rgb => rgb.reduce((sum, value) => sum * 256 + Math.round(Math.max(0, Math.min(1, value)) * 255), 0);

function prepareOutputGrade(stack) {
  const plan = ColorStack.prepare(stack);
  if (!plan || plan.requiresIndex) throw new TypeError('Output grading needs a color stack without indexed palette remaps');
  const table = new Map(), color = [0, 0, 0];
  function applyColor(packed) {
    if (!table.has(packed)) {
      if (table.size >= 65_536) table.clear();
      table.set(packed, pack(plan.sample(normalized(packed), color)));
    }
    return table.get(packed);
  }
  function apply(image) {
    const rgb = new Uint8Array(image.rgb);
    for (let p = 0, i = 0; i < rgb.length; p++, i += 3) {
      if (image.alpha?.[p] === 0) continue;
      const packed = applyColor(packedAt(rgb, i));
      rgb[i] = packed >> 16;
      rgb[i + 1] = (packed >> 8) & 255;
      rgb[i + 2] = packed & 255;
    }
    return { ...image, rgb, palette: undefined, use: undefined };
  }
  return { apply, applyColor };
}

module.exports = { prepareOutputGrade, packedAt, pack, normalized };
