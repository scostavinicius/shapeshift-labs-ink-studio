// Writes a small textured GLB, a wooden crate (1 x 1 x 1, a 16 x 16 plank texture embedded as PNG), made from nothing
// but code: the engine's own sample model for the GLB import (stage 24), free of any licence.
//   node engine/scripts/make-crate-glb.cjs engine/assets/crate.glb
const fs = require('node:fs');
const path = require('node:path');
const PNG = require(path.join(__dirname, '..', '..', 'cli', 'png.js'));

// the texture: planks with dark seams and a cross brace, warm browns
const T = 16,
  px = new Uint8Array(T * T * 3);
for (let y = 0; y < T; y++)
  for (let x = 0; x < T; x++) {
    const plank = Math.floor(y / 4),
      seam = y % 4 === 0,
      edge = x === 0 || x === T - 1 || y === 0 || y === T - 1,
      brace = Math.abs(x - y) <= 0 || Math.abs(x - (T - 1 - y)) <= 0,
      grain = ((x * 7 + plank * 13) % 5) / 5;
    let c = [138, 92, 50];
    c = c.map(v => v * (0.85 + 0.15 * grain) * (plank % 2 ? 0.92 : 1));
    if (seam) c = [74, 46, 24];
    if (brace) c = [168, 118, 64];
    if (edge) c = [92, 60, 34];
    px.set(c.map(Math.round), (y * T + x) * 3);
  }
const png = PNG.encode(T, T, px);

// a cube from 0 to 1 in y, centred on x and z: 6 faces x 4 vertices, each face the whole texture
const P = [],
  N = [],
  UV = [],
  I = [];
const faces = [
  [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, -1]],
  [[0, -1, 0], [0, 0, 1]], [[0, 0, 1], [0, 1, 0]], [[0, 0, -1], [0, 1, 0]]
];
for (const [n, up] of faces) {
  const r = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const base = P.length / 3;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    P.push(0.5 * (n[0] + a * r[0] + b * up[0]), 0.5 + 0.5 * (n[1] + a * r[1] + b * up[1]), 0.5 * (n[2] + a * r[2] + b * up[2]));
    N.push(...n);
    UV.push((a + 1) / 2, 1 - (b + 1) / 2);
  }
  I.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const f32 = a => Buffer.from(new Float32Array(a).buffer),
  u16 = a => Buffer.from(new Uint16Array(a).buffer);
const parts = [f32(P), f32(N), f32(UV), u16(I), png];
const offs = [];
let o = 0;
for (const p of parts) {
  offs.push(o);
  o += p.length;
  o = (o + 3) & ~3;
}
const bin = Buffer.alloc(o);
parts.forEach((p, i) => p.copy(bin, offs[i]));
const min = [-0.5, 0, -0.5],
  max = [0.5, 1, 0.5];
const gltf = {
  asset: { version: '2.0', generator: 'ink-engine make-crate-glb' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'crate', mesh: 0 }],
  meshes: [{ name: 'crate', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
  materials: [{ name: 'planks', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 } }],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ magFilter: 9728, minFilter: 9728 }],
  images: [{ bufferView: 4, mimeType: 'image/png' }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: N.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: UV.length / 2, type: 'VEC2' },
    { bufferView: 3, componentType: 5123, count: I.length, type: 'SCALAR' }
  ],
  bufferViews: parts.map((p, i) => ({ buffer: 0, byteOffset: offs[i], byteLength: p.length, ...(i < 3 ? { target: 34962 } : i === 3 ? { target: 34963 } : {}) })),
  buffers: [{ byteLength: bin.length }]
};
let json = Buffer.from(JSON.stringify(gltf));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12),
  jh = Buffer.alloc(8),
  bh = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
jh.writeUInt32LE(json.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);
bh.writeUInt32LE(bin.length, 0);
bh.writeUInt32LE(0x004e4942, 4);
const out = process.argv[2] || 'crate.glb';
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, jh, json, bh, bin]));
console.log(JSON.stringify({ glb: path.resolve(out), bytes: 12 + 16 + json.length + bin.length }));
