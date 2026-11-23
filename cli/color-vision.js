const Color = require('../src/color-space.js');
const { packedAt, pack, normalized } = require('./output-grade.js');

// Machado, Oliveira and Fernandes (2009), severity 1, applied in linear sRGB.
const matrices = {
  protanopia: [[.152286, 1.052583, -.204868], [.114503, .786281, .099216], [-.003882, -.048116, 1.051998]],
  deuteranopia: [[.367322, .860646, -.227968], [.280085, .672501, .047413], [-.011820, .042940, .968881]],
  tritanopia: [[1.255528, -.076749, -.178779], [-.078411, .930809, .147602], [.004733, .691367, .303900]]
};
const modes = Object.freeze(['normal', ...Object.keys(matrices)]);
const toLinear = Color.prepare('srgb', 'srgb-linear'), toSrgb = Color.prepare('srgb-linear', 'srgb');

function simulateColor(color, mode) {
  if (mode === 'normal') return color;
  if (!Object.hasOwn(matrices, mode)) throw new RangeError('Unknown color vision simulation ' + mode);
  const rgb = toLinear(normalized(color));
  const simulated = matrices[mode].map(row => Math.max(0, Math.min(1, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
  return pack(toSrgb(simulated));
}

function simulateFrame(frame, mode) {
  if (mode === 'normal') return frame;
  const rgb = Uint8Array.from(frame.rgb), cache = new Map();
  for (let p = 0, at = 0; at < rgb.length; p++, at += 3) {
    if (frame.alpha?.[p] === 0) continue;
    const color = packedAt(rgb, at);
    if (!cache.has(color)) cache.set(color, simulateColor(color, mode));
    const sample = cache.get(color);
    rgb[at] = sample >> 16;
    rgb[at + 1] = (sample >> 8) & 255;
    rgb[at + 2] = sample & 255;
  }
  return { ...frame, rgb };
}

module.exports = { modes, simulateColor, simulateFrame };
