/* The same native-size relay picture, routed to RGB and composite displays. */
const studio = require('..');
const WIDTH = 166, HEIGHT = 110;
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const poly = (points, fill) => ({ type: 'polygon', points, fill });
const text = (x, y, label, color, scale = 1) => ({ type: 'text', at: [x, y], text: label, color, scale });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });

function relay({ render }, time) {
  const bob = Math.round(Math.sin(time * Math.PI) * 2);
  const tide = Math.floor(time * 6 + 1e-5) % 24;
  const sky = [
    rect(0, 0, WIDTH, HEIGHT, '#1c273d'),
    rect(0, 18, WIDTH, 13, '#30334f'), rect(0, 31, WIDTH, 10, '#473c59'),
    rect(0, 41, WIDTH, 10, '#694758'), rect(0, 51, WIDTH, 10, '#8e5362'),
    poly([[0, 20], [45, 20], [58, 22], [86, 22], [102, 24], [43, 24], [30, 22], [0, 22]], '#283047'),
    ellipse(108, 26, 32, 34, '#ffac78'),
    rect(107, 44, 34, 2, '#b86562'), rect(109, 51, 30, 2, '#c87264'), rect(111, 56, 26, 2, '#905664'),
    poly([[0, 52], [11, 51], [34, 53], [58, 53], [74, 55], [94, 55], [97, 57], [0, 57]], '#554662'),
    poly([[67, 59], [88, 57], [143, 57], [151, 54], [166, 54], [166, 62], [67, 62]], '#594966'),
    rect(0, 61, WIDTH, 31, '#253b51'), rect(0, 72, WIDTH, 21, '#1d3449'),
    rect(0, 83, WIDTH, 10, '#172c41'), rect(73, 61, 87, 1, '#bd7175')
  ];
  const water = Array.from({ length: 42 }, (_, i) => {
    const x = (i * 71 + (i % 3 + 1) * tide) % WIDTH;
    const y = 63 + (i * 11) % 28, width = 2 + (i * 5) % (5 + Math.floor((y - 62) / 3));
    return rect(x, y, width, 1, ['#526275', '#394f69', '#324761', '#795e72'][i % 4]);
  });
  const mist = [];
  for (let y = 54; y < 82; y++) {
    const edge = [48, 37, 30, 27, 30, 39, 53][Math.floor((y - 54) / 4)];
    for (let x = edge + Math.floor((y + tide) % 24 / 8); x < 158 - Math.floor((y - 63) ** 2 / 13); x++) {
      if ((x + y) % 2 === 0)
        mist.push(rect(x, y, 1, 1, y < 61 ? '#c0868a' : y < 75 ? '#7693aa' : '#526c84'));
    }
  }
  const headland = [
    poly([[0, 53], [15, 53], [22, 57], [34, 60], [41, 64], [48, 66], [53, 69],
      [60, 70], [63, 74], [54, 78], [42, 77], [32, 84], [15, 84], [0, 87]], '#151e31'),
    poly([[0, 55], [17, 55], [25, 59], [38, 62], [41, 65], [50, 68], [56, 71],
      [45, 70], [37, 67], [30, 68], [16, 63], [0, 64]], '#384253'),
    poly([[0, 72], [12, 71], [23, 73], [30, 78], [22, 81], [8, 79], [0, 80]], '#252e44'),
    rect(10, 76, 10, 1, '#464157'), rect(34, 69, 8, 1, '#575264'), rect(45, 73, 10, 1, '#70586c'),
    poly([[18, 58], [23, 32], [32, 32], [38, 61], [26, 60]], '#222639'),
    poly([[25, 33], [30, 33], [34, 58], [24, 57]], '#949399'),
    poly([[24, 45], [32, 45], [33, 50], [23, 49]], '#b75f64'),
    rect(22, 25, 12, 7, '#372c3c'), rect(24, 26, 8, 4, '#ffc57d'),
    poly([[20, 25], [27, 20], [35, 25]], '#202336'), rect(27, 17, 1, 5, '#b77b72'),
    rect(22, 32, 13, 1, '#d19685'), rect(26, 54, 3, 4, '#32334a')
  ];
  const vessel = [
    poly([[119, 75 + bob], [138, 75 + bob], [135, 78 + bob], [124, 78 + bob]], '#172337'),
    rect(126, 72 + bob, 8, 3, '#c58078'), rect(130, 70 + bob, 1, 3, '#564459'),
    rect(127, 73 + bob, 2, 1, '#ffe5a3'), rect(134, 79 + bob, 11, 1, '#8a8e9f')
  ];
  const hud = [
    rect(0, 0, WIDTH, 13, '#10192a'), rect(0, 13, WIDTH, 1, '#4b5064'),
    rect(6, 4, 4, 4, '#fb634e'), text(14, 3, 'CAM 07', '#83f7e5'),
    text(109, 3, 'LIVE', '#ff665c'), text(137, 3, '17:42', '#eee3be'),
    rect(8, 88, 150, 17, '#111d2b'), rect(8, 88, 150, 1, '#806470'),
    rect(8, 89, 3, 16, '#fc5658'), text(16, 93, 'SWELL', '#ff535e'),
    text(115, 93, '04.2M', '#9bffe6')
  ];
  for (let i = 0; i < 27; i++) {
    const bar = 2 + Math.round((.5 + .5 * Math.sin(i * .71 + time * Math.PI * 2)) * 8);
    hud.push(rect(54 + i * 2, 101 - bar, 1, bar, i % 3 ? '#47cbb4' : '#ed765d'));
  }
  return render({ width: WIDTH, height: HEIGHT, edges: 'hard',
    commands: [...sky, ...water, ...mist, ...headland, ...vessel, ...hud] });
}

function calibration({ render }) {
  const patches = ['#f2dea0', '#ff554f', '#863cff', '#317cff', '#4ceac1', '#ea6fd5', '#213449'];
  return render({ width: WIDTH, height: HEIGHT, edges: 'hard', commands: [
    rect(0, 0, WIDTH, HEIGHT, '#182338'), text(9, 6, 'RELAY CALIBRATION', '#f2dea0'),
    ...patches.map((color, i) => rect(i * 22 + 6, 20, 22, 26, color)),
    text(9, 52, '1 PX CHECKER', '#a9c7ce'), text(92, 52, '1 PX BARS', '#a9c7ce'),
    ...Array.from({ length: 28 }, (_, y) => Array.from({ length: 70 }, (_, x) =>
      rect(x + 8, y + 64, 1, 1, (x + y) % 2 ? '#b6dbd8' : '#292e54'))).flat(),
    ...Array.from({ length: 69 }, (_, x) => rect(x + 90, 64, 1, 28, patches[1 + (x % 4)])),
    text(9, 98, 'SYNC', '#ff554f'), text(119, 98, '75 OHM', '#4ceac1')
  ] });
}

function cabinet({ render }, study) {
  const commands = [
    rect(0, 0, 376, 181, '#101621'),
    rect(8, 9, 360, 162, '#080e17'), rect(8, 7, 360, 160, '#253244'),
    rect(9, 8, 358, 1, '#687282'), rect(10, 10, 356, 19, '#344355'),
    rect(10, 28, 356, 1, '#71919a'), rect(10, 168, 356, 2, '#192331'),
    text(19, 16, study === 'relay' ? 'BREAKWATER RELAY' : 'BREAKWATER SERVICE BAY', '#f0dcb6'),
    text(310, 16, 'PANEL 07', '#abc2c8'),
    rect(290, 18, 4, 3, '#65d8a3'), rect(297, 18, 4, 3, '#e7a464'),
    rect(18, 36, 340, 1, '#465972')
  ];
  for (const [i, x] of [16, 184].entries()) {
    const west = x + i * 10;
    commands.push(
      rect(west, 40, 172, 122, '#0c1421'),
      rect(west + 1, 41, 170, 113, '#344657'),
      rect(west + 2, 42, 168, 111, '#688385'),
      rect(west + 2, 153, 168, 1, '#171e2c'),
      text(west + 7, 154, i ? 'COMPOSITE' : 'RGB', i ? '#eeb880' : '#99e1c8'),
      rect(west + 122, 156, 26, 2, '#334053'),
      rect(west + 154, 155, 4, 4, i ? '#f78e55' : '#7ddeaa'),
      rect(west + 162, 155, 3, 4, '#7a8b9e'));
  }
  return render({ width: 376, height: 181, edges: 'hard', commands });
}

const raster = ({ width: w, height: h, data: rgba }) => ({ w, h, rgba });

module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'composite-video', name: 'Breakwater Relay', seed: 71,
  build(seed, { controls: { study = 'relay' } = {} } = {}) {
    if (!['relay', 'calibration'].includes(study)) throw new RangeError('Choose relay or calibration');
    const draw = K.procedural.drawing2d, west = 19, east = 197, screenY = 43;
    const finish = () => makeBuilder(seed, [0x101621, 0x223344]).finish({
      cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, detail: 24, dither: 0
    });
    const feed = finish(), world = finish();
    let picture = raster(study === 'relay' ? relay(draw, 0) : calibration(draw));
    const frame = { raw: true, composite: { layers: [{ source: () => picture, resolution: [WIDTH, HEIGHT] }] } };
    const atlas = studio.createCameraAtlas({ width: WIDTH * 2, height: HEIGHT, views: [
      { id: 'rgb', rect: [0, 0, WIDTH, HEIGHT], frame },
      { id: 'composite', rect: [WIDTH, 0, WIDTH, HEIGHT], frame,
        compositeVideo: { lumaBandwidth: .57, chromaBandwidth: .17, artifacts: .85, phaseRate: 1.5 } }
    ] });
    world.look = { composite: { layers: [
      { source: raster(cabinet(draw, study)), rect: [0, 0, 376, 181] },
      atlas.layer('rgb', { rect: [west, screenY, WIDTH, HEIGHT] }),
      atlas.layer('composite', { rect: [east, screenY, WIDTH, HEIGHT] })
    ] } };
    const stage = K.stage(world);
    stage.add({ update(_dt, time) {
      if (study === 'relay') picture = raster(relay(draw, time));
      atlas.capture(feed, { time });
    } });
    stage.stateful = false;
    stage.update(0, 0);
    return world;
  }
});
