const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');

const width = 224, height = 144;
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const text = (value, x, y, scale, color) => ({ type: 'text', text: value, at: [x, y], scale, color });
const link = (node, port = 'value') => ({ node, port });

function station({ KIT: K, makeBuilder, makeSculpt }, seed, surface, rain, glass) {
  const B = makeBuilder(seed, [
    0x111b2a, 0x162333, 0x203246, 0x2c4759, 0x466373, 0x648392, 0x92adad, 0xcdcdc1,
    0x32323a, 0x514540, 0x7d6851, 0xb18d58, 0xf3c179, 0xffe2a8,
    0x255979, 0x438db0, 0x82bdc9, 0xb9e2db
  ]);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S, { sun: K.V.norm([-.42, .8, .32]), sky: .28, sunK: .5, amb: .4 });
  const stone = { r: [1, 2, 3, 4, 5] };
  const roof = { r: [0, 1, 2, 3] };
  const brass = { r: [8, 9, 10, 11, 12] };
  const lamp = { r: [11, 12, 13], em: true };
  const box = (at, half, mat, options = {}) => S.box(at, half, mat, { res: .085, rd: .036, ...options });
  box([0, -.25, -.13], [3.4, .225, 2.2], stone, { res: .11, objectId: 'paving' });
  box([0, 1.17, -.87], [2.65, 1.22, .27], roof, { objectId: 'rear-wall' });
  for (const x of [-2.34, 2.34]) {
    box([x, 1.15, -.02], [.22, 1.21, .72], stone);
    box([x, .3, .68], [.28, .3, .1], brass);
  }
  for (const x of [-1.8, 1.8]) {
    box([x, 1.61, -.14], [.065, .23, .22], brass);
    S.ball([x, 1.56, .075], [.084, .137, .083], lamp, { res: .043 });
  }
  box([0, 2.58, -.05], [2.79, .16, .99], roof, { res: .095 });
  box([0, 2.57, .955], [2.76, .054, .04], brass);
  for (const x of [-1.95, -.98, 0, .98, 1.95])
    box([x, 2.46, .355], [.035, .075, .60], brass);
  box([0, 1.50, -.49], [1.51, .573, .055], brass);
  for (const y of [.68, 2.31]) box([0, y, .45], [2.13, .045, .055], brass, { res: .060 });
  for (const x of [-2.1, -.06, 2.1]) box([x, 1.5, .45], [.043, .83, .055], brass, { res: .055 });
  S.bake();

  if (glass) {
    const first = B.count();
    for (let row = 0; row < 11; row++) for (let col = 0; col < 14; col++) {
      const x = .01 + col * .155, y = .74 + row * .151;
      const shine = Math.abs(y - .88 - .62 * x) < .10 || Math.abs(y - 1.09 - .62 * x) < .06;
      B.disc(x, y, .442, [0, 0, 1], .116, .013, B.P[shine ? 17 : 15], shine ? .30 : .21,
        { gl: true, nd: true });
    }
    B.describeSplats(first, B.count(), { object: 'blue-glass', material: 'glass' });
  }
  if (rain) K.weather.fall(B, { kind: 'rain', worldSpace: true, n: 203, seed, top: 3.3, ground: () => .02,
    box: [-3.1, 3.1, -.19, 2.13], cols: [5, 6, 16, 17], len: .091, size: .009, speed: 3.8 });

  return B.finish({ cam: { target: [0, 1.26, -.03], dist: 7.2, yaw: -.095, pitch: .128 }, radius: 6, detail: 18, dither: 0,
    spriteSurfaces: surface, refract: 3, outline: { c: 0, edge: .038 },
    look: { splatCoverage: 'continuous', coverageAware: true },
    lights: [{ p: [-1.8, 1.55, .31], radius: 2, intensity: 1.2, color: [1, .7, .33] }] });
}

function createProject(kit = ink.load()) {
  const signWidth = 88, signHeight = 36;
  const graph = { output: 'wet-paving', passes: [
    { id: 'puddle', type: 'mask', raster: { slot: 'puddleMask', rect: [64, 111, 96, 20], filter: 'linear' } },
    { id: 'ink-reflection', type: 'composite', isolated: true, mask: 'puddle', opacity: .36,
      layer: { source: { slot: 'reflectionInk' }, rect: [65, 111, 95, 18] } },
    { id: 'wet-paving', type: 'distortion', input: 'scene', source: 'ink-reflection',
      mask: 'puddle', blend: 'over', amplitude: [3, 0], period: 5, rate: .5, phase: .12 }
  ] };
  const nodes = {
    sign: { op: 'draw.render', inputs: { width: signWidth, height: signHeight, edges: 'hard', commands: [
      rect(0, 0, 88, 36, '#d08849'), rect(2, 2, 84, 32, '#592f29'), rect(3, 3, 82, 30, '#4c2426'),
      rect(4, 4, 80, 1, '#e2a962'), rect(4, 31, 80, 1, '#e2a962'),
      rect(6, 6, 1, 25, '#be824f'), rect(81, 6, 1, 25, '#be824f'),
      text('NIGHT', 14, 5, 2, '#ffe0a3'), text('FERRY', 29, 25, 1, '#f5c583'),
      rect(12, 27, 10, 1, '#b96f47'), rect(66, 27, 10, 1, '#b96f47')
    ] } },
    surface: { op: 'warp.surface', inputs: { source: link('sign'), mesh: {
      points: [[-1.43, 2.04, -.27], [1.43, 2.04, -.27], [1.43, .97, -.27], [-1.43, .97, -.27]],
      faces: [[0, 1, 2], [0, 2, 3]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]]
    } } },
    puddleMask: { op: 'draw.render', inputs: { width: 48, height: 10, edges: 'hard', commands: [
      rect(9, 1, 27, 1, '#ffffff78'), rect(4, 2, 36, 1, '#ffffffbb'), rect(12, 3, 32, 1, '#ffffffa0'),
      rect(1, 4, 45, 2, '#ffffffc8'), rect(4, 6, 34, 1, '#ffffffa0'), rect(10, 8, 27, 1, '#ffffff65')
    ] } },
    reflectionInk: { op: 'fx.pathBlur', inputs: { source: link('sign'), path: [[-8, 0], [10, 0]],
      options: { samples: 11, anchor: 'center' } } },
    slots: { op: 'data.record', inputs: { reflectionInk: link('reflectionInk'), puddleMask: link('puddleMask') } },
    world: { op: 'bridge.station', inputs: { surface: link('surface'), rain: { input: 'rain' }, glass: { input: 'glass' } } },
    render: { op: 'scene.render', inputs: { source: link('world'), channels: ['precipitation', 'depth'],
      renderGraphInputs: link('slots'), renderGraphCapture: ['puddle', 'ink-reflection'],
      options: { width, height, renderGraph: graph } } },
    rain: { op: 'scene.pass', inputs: { frame: link('render', 'frame'), channel: 'precipitation' } },
    capture: { op: 'scene.pass', inputs: { frame: link('render', 'frame'), channel: 'graph:puddle' } },
    maskOut: { op: 'raster.resize', inputs: { source: link('capture', 'value'), options: { width: 448, height: 288 } } }
  };
  const outputs = { sign: link('sign'), scene: link('render'), rain: link('rain'), matte: link('maskOut'),
    renderReport: link('render', 'report') };
  return ink.createGraphProject({
    format: 'ink-studio/graph-project', version: 1, time: .41, seed: 11, nodes, outputs,
    inputs: { rain: { type: 'boolean', default: true }, glass: { type: 'boolean', default: true } }
  }, { kit, operations: { 'bridge.station': {
    inputs: { surface: 'record', rain: 'boolean', glass: 'boolean' }, outputs: { value: 'world' },
    run: ({ surface, rain, glass }, { seed }) => ({ value: station(kit, seed, surface, rain, glass) })
  } } });
}

function writeRaster(file, { width, height, channels, data }) {
  fs.writeFileSync(file, PNG.encode(width, height, data, channels));
}

if (require.main === module) {
  const directory = path.resolve(process.argv[2] ?? 'render-graph-bridge-review');
  fs.mkdirSync(directory, { recursive: true });
  const project = createProject(), { outputs, report } = project.run();
  for (const name of ['scene', 'sign', 'rain', 'matte']) writeRaster(path.join(directory, name + '.png'), outputs[name]);
  const { outputs: clear } = project.run({ inputs: { rain: false, glass: false } });
  writeRaster(path.join(directory, 'clear.png'), clear.scene);
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('wrote', directory);
}
module.exports = { createProject };
