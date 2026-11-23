/* An original pixel-art vessel seen through three render-graph sources. */
const width = 322, height = 204, fps = 12, delay = 8;
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const text = (x, y, value, color, scale = 1) => ({ type: 'text', at: [x, y], text: value, color, scale });
const path = (points, stroke, width = 1) => ({ type: 'path', points, stroke, width });
const poly = (points, fill) => ({ type: 'polygon', points, fill });

function point(time, x, y) {
  const wave = time * Math.PI / 3;
  return [112 + x + Math.round((15 + y * .13) * Math.sin(wave)),
    107 + y + Math.round(5 * Math.sin(wave * 2))];
}

function vessel(time, style) {
  const tones = {
    glaze: ['#112c34', '#205a61', '#368783', '#6bada2', '#a5d8af', '#fbdf9d', '#c48352', '#93513e'],
    clay: ['#321d28', '#773f43', '#ae6047', '#cf835f', '#ecae7b', '#f3c890', '#a55245', '#813e43'],
    monitor: ['#131d44', '#26336e', '#454889', '#7665a7', '#a77abb', '#efa1b6', '#7b568f', '#584375'],
    scan: ['#102c3d', '#143d4f', '#1d5665', '#287585', '#44a4ad', '#a7ebd3', '#2b8792', '#265366']
  }[style];
  const pt = ([x, y]) => point(time, x, y);
  const shape = (tone, ...points) => poly(points.map(pt), tones[tone]);
  const stroke = (tone, points, w) => path(points.map(pt), tones[tone], w);
  const tile = (tone, x, y, w = 1, h = 1) => rect(...pt([x, y]), w, h, tones[tone]);
  const edge = [[-22,-53],[-23,-42],[-16,-35],[-17,-26],[-37,-18],[-49,-9],[-56,4],[-54,22],
    [-46,36],[-34,46],[-25,50],[-25,57],[-19,62],[20,62],[28,57],[28,50],[37,45],[47,36],
    [55,21],[56,4],[49,-9],[37,-18],[17,-26],[16,-35],[23,-42],[22,-53]];
  const art = [
    // Cast handle, shoulder, body and foot.
    shape(0, [33,-20],[55,-27],[68,-23],[76,-13],[78,0],[73,13],[63,23],[49,28],[43,23],[46,14],
      [58,9],[64,2],[65,-9],[59,-15],[51,-15],[40,-9]),
    shape(2, [39,-19],[56,-25],[67,-21],[74,-12],[76,-2],[72,8],[64,18],[52,24],[50,18],[61,12],
      [67,3],[69,-8],[63,-17],[55,-19],[44,-13]),
    stroke(4, [[45,-18],[56,-22],[66,-19],[71,-10],[72,-4]]),
    shape(0, ...edge),
    shape(1, [-18,-48],[-15,-36],[-14,-25],[-37,-16],[-49,-6],[-53,6],[-52,20],[-44,34],[-31,44],
      [-21,49],[-23,57],[-17,60],[19,60],[25,56],[25,49],[42,36],[51,20],[53,4],[47,-7],[35,-15],
      [14,-24],[13,-36],[19,-48]),
    shape(2, [-12,-47],[-9,-32],[-12,-23],[-34,-13],[-45,-3],[-49,9],[-46,22],[-38,34],[-21,43],
      [4,46],[24,40],[38,27],[44,10],[39,-7],[28,-13],[11,-21],[6,-30],[9,-48]),
    shape(3, [-11,-45],[-7,-32],[-12,-22],[-32,-13],[-41,-6],[-47,4],[-45,14],[-37,20],[-35,9],
      [-22,0],[-8,-5],[18,-7],[24,-12],[8,-20],[0,-28],[1,-44]),
    shape(4, [-34,-10],[-42,-3],[-44,5],[-38,4],[-32,-2],[-21,-6],[-11,-9],[-15,-12],[-23,-11]),
    stroke(1, [[-27,45],[-16,50],[11,51],[26,48]], 2),
    stroke(3, [[-20,55],[-11,57],[9,57],[19,55]], 2),
    shape(0, [-23,-53],[-17,-58],[16,-58],[23,-53],[23,-47],[17,-43],[-17,-43],[-23,-47]),
    shape(3, [-21,-52],[-15,-56],[15,-56],[21,-52],[16,-49],[-16,-49]),
    shape(0, [-15,-53],[-10,-55],[12,-55],[16,-53],[11,-51],[-11,-51]),
    stroke(5, [[-20,-51],[-15,-48],[5,-48]], 1)
  ];
  if (style === 'clay') {
    // Coiled clay and a raised joining seam under the glazed pattern.
    for (let i = 0; i < 9; i++) {
      const y = -7 + i * 5, breadth = i < 6 ? 44 : 44 - (i - 5) * 5;
      art.push(stroke(i % 3 === 0 ? 6 : 1, [[-breadth,y],[-21,y+3],[1,y+4],[23,y+2],[breadth-5,y-4]]));
    }
    art.push(stroke(5, [[-25,-5],[-19,0],[-16,8],[-17,15],[-11,24],[-10,32],[-8,39]], 1),
      stroke(7, [[-24,-6],[-18,0],[-15,8],[-16,15],[-10,24],[-9,32],[-7,39]], 2));
    for (const [x, y] of [[-30,0],[-26,8],[-25,16],[-16,6],[3,12],[8,-4],[23,6],[28,11],[18,25],[-31,20]])
      art.push(tile(6, x, y, 2));
  } else {
    // A lunar disk, reeds, slanting swells and chips in the fired glaze.
    art.push(shape(6, [-22,-4],[-11,-9],[1,-7],[9,0],[11,11],[6,21],[-3,26],[-15,24],[-23,17],[-26,8]),
      shape(5, [-20,-3],[-10,-8],[1,-6],[7,0],[8,9],[3,18],[-6,23],[-15,21],[-22,14],[-24,6]),
      stroke(4, [[-47,18],[-42,19],[-34,17],[-21,14],[-12,15],[1,21],[12,22],[22,18],[34,17],[47,20]], 3),
      stroke(1, [[-47,21],[-40,21],[-31,18],[-19,16],[-11,18],[0,24],[13,25],[24,21],[35,21],[46,23]], 2),
      stroke(3, [[-41,28],[-29,24],[-17,23],[-7,26],[4,31],[17,31],[30,26],[39,27]], 2),
      stroke(5, [[-34,30],[-26,28],[-18,27],[-11,28]], 1),
      stroke(3, [[-30,37],[-15,34],[-8,36],[-1,38],[10,39],[21,35],[29,35]], 1),
      stroke(4, [[16,12],[18,0],[22,-3]], 1), stroke(5, [[20,13],[23,5],[27,3]], 1),
      stroke(4, [[27,13],[30,6],[34,4]], 1),
      shape(7, [17,-27],[25,-23],[27,-18],[18,-16],[11,-19],[13,-24]),
      shape(6, [17,-25],[23,-22],[23,-19],[17,-18],[14,-21]),
      shape(7, [-36,33],[-31,30],[-24,32],[-23,36],[-29,40]),
      shape(6, [-34,33],[-30,32],[-26,34],[-29,37]));
    for (const [x, y] of [[-34,7],[-28,2],[-29,11],[15,-7],[22,-8],[32,0],[39,5],[34,10],[7,34]])
      art.push(tile(4, x, y, 2));
  }
  if (style === 'scan') {
    const current = -10 + Math.floor(time * fps + 1e-8) % 11 * 6;
    for (let y = -40; y <= 48; y += 6) {
      const breadth = y < -23 ? 13 : y < 24 ? 40 : 26;
      art.push(stroke(y === current ? 5 : 4, [[-breadth,y],[-12,y+2],[8,y+2],[breadth,y-2]], y === current ? 2 : 1));
      for (let x = -breadth + 3; x < breadth; x += 7) art.push(tile(5, x, y + (x < 15 ? 1 : 0)));
    }
    art.push(stroke(5, edge.concat([edge[0]])));
  }
  return art;
}

module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'tracked-source-windows',
  name: 'Kiln Archive',
  seed: 14,
  build(seed) {
    const W = width, H = height;
    const grid = '#212a49', rule = '#3e5470', dim = '#879caf', paper = '#e2e9d0';
    const panels = { glaze: '#e3eeb1', clay: '#f5ad86', scan: '#8adcd2' };
    const buffered = time => time >= 1.75 && time < 4.65;
    function raster(commands) {
      const { data } = K.procedural.drawing2d.render({ width: W, height: H, edges: 'hard', commands });
      return { w: W, h: H, rgba: data };
    }
    const art = callback => ({ resolution: [W, H], source: ({ time }) => raster(callback(time)) });
    const isolated = (id, callback) => ({ id, type: 'composite', isolated: true, layer: art(callback) });
    const backdrop = [
      rect(0,0,W,H,'#10182a'), rect(0,0,W,32,'#181e33'), rect(0,31,W,1,rule),
      rect(13,43,193,139,'#131b33'), rect(13,43,193,1,rule), rect(13,181,193,1,rule),
      rect(13,43,1,139,rule), rect(205,43,1,139,rule), rect(214,43,1,139,grid),
      rect(17,10,4,11,panels.glaze), text(28,8,'KILN ARCHIVE',paper,2), text(220,13,'VESSEL  /  014',dim),
      ...Array.from({ length: 15 }, (_, i) => rect(16 + i * 13,48,1,128,grid)),
      ...Array.from({ length: 10 }, (_, i) => rect(17,48 + i * 14,185,1,grid)),
      ...Array.from({ length: 8 }, (_, i) => rect(13 + i * 14,190, i % 4 ? 1 : 2, i % 4 ? 3 : 6, rule)),
      text(131,190,'RELIC SCAN',dim), text(222,190,'12 FPS BUFFER',dim)
    ];
    const base = time => {
      const [x] = point(time, 0, 0), scanY = 49 + Math.floor((time * 48) % 125);
      return [
        ...backdrop, ellipse(x-60,168,120,10,'#18233d'), ellipse(x-35,171,74,5,'#0d1528'),
        ...vessel(time,'monitor'),
        ...Array.from({ length: 64 }, (_, i) => rect(16,48+2*i,187,1,'#0d142544')),
        rect(16,scanY,186,1,'#8ba1d56b'), rect(16,scanY+1,186,2,'#6d6da838'),
        rect(15,scanY-2,3,5,'#a6b6dd'), rect(201,scanY-2,3,5,'#a6b6dd'),
        rect(18,50,33,11,'#111930'), text(21,52,'IR VIEW','#9cadcf')
      ];
    };
    const now = (x, y) => ({ time }) => point(time, x, y);
    const scanPosition = ({ time, source }) => point(source === 'past' ?
      Math.max(0, Math.floor(time * fps + 1e-8) - delay) / fps : time, 20, 32);
    const crosses = time => [
      ...[[27,3,panels.clay],[20,32,panels.scan]].flatMap(([u,v,color]) => {
        const [x,y] = point(time,u,v);
        return [rect(x-4,y,3,1,color),rect(x+2,y,3,1,color),rect(x,y-4,1,3,color),rect(x,y+2,1,3,color)];
      }),
      text(224,45,'01 / GLAZE',panels.glaze), text(224,57,'REGISTERED 1:1',dim),
      text(224,74,'02 / CLAY',panels.clay),
      text(224,129,buffered(time) ? '03 / PRIOR SCAN' : '03 / LIVE SCAN',panels.scan),
      rect(223,176,82,4,grid), rect(223,177,Math.max(1, Math.floor(time % 6 * 13.6)),2,panels.scan),
      rect(246,176,1,4,dim), rect(286,176,1,4,dim)
    ];
    const passes = [
      isolated('glaze', time => vessel(time, 'glaze')),
      isolated('clay', time => [rect(0,0,W,H,'#2a202d'), ...vessel(time, 'clay')]),
      isolated('scan', time => [rect(0,0,W,H,'#122735'), ...vessel(time, 'scan')]),
      { id: 'past', type: 'frameAge', input: 'scan', fps, cameraMotion: 'keep', regions: [{ mode: 'delay', frames: delay }] },
      { id: 'scan-bed', type: 'mask', rect: [16,47,187,130] },
      isolated('monitor', base),
      { id: 'glaze-window', type: 'trackedWindow', source: 'glaze', sourceMask: 'scan-bed', at: now(-10, 9),
        crop: { size: [51, 39] }, chrome: { color: panels.glaze } },
      { id: 'clay-window', type: 'trackedWindow', source: 'clay', at: now(27, 3),
        crop: { size: [49, 22], offset: [-24, 12] }, place: { at: [264,104], size: [82,34] },
        chrome: { color: panels.clay, leader: true } },
      { id: 'scan-window', type: 'trackedWindow', source: 'scan', switches: [[1.75,'past'],[4.65,'scan']],
        at: now(20, 32), crop: { at: scanPosition, size: [56, 21] }, place: { at: [264,154], size: [82,32] },
        chrome: { color: panels.scan, leader: true } },
      { id: 'captions', type: 'composite', layer: art(crosses) }
    ];
    return makeBuilder(seed, [0x10182a]).finish({
      cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, look: { pixelSize: 1, renderGraph: { passes } }
    });
  }
});
