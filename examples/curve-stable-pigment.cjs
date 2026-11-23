/* Show the same bending cable with two anchors and an enamel band on a chart. */
const path = require('node:path'), ink = require('..'), kit = ink.load(), K = kit.KIT, C = K.curveSplats;
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/curve-stable-pigment');
const artWidth = 168, artHeight = 118, scale = 2, width = 1100, height = 598;
const fps = 12, frameCount = 48, top = 184;
const background = '#182636', dim = '#a7bacd', rule = '#3d566e', title = '#f2ece1';
const gold = '#f4c279', green = '#a7e4c6', rose = '#e5acaa';
const colors = [
  background, '#273948', '#304758', '#466377', '#5d7a86', '#914a4f', '#b6614d',
  '#d18459', '#d9a36f', gold, '#fce3a7', '#f8ead6', '#21545e', '#34747a',
  '#519b96', '#75bba8', green, '#c5efd4', '#af717b', rose
];
const packed = color => parseInt(color.slice(1), 16);
const camera = { target: [0,0,0], dist: 6.02, yaw: 0, pitch: .05, ortho: true };
const source = (id, points) => ({ kind: 'path', id, points });
const makeRecipe = (id, strands, settings = {}) => ({
  format: C.format, version: 1, id, background, palette: colors.slice(1), camera,
  look: { edgeFilter: true }, strands, ...settings
});

const guide = Array.from({ length: 41 }, (_, i) => {
  const u = i / 40, x = 4.46 * (u - .5);
  return [x, .32 * Math.cos(x * 1.28) - .14 * x, .16 * Math.sin(x * .92)];
});
function position([x,y,z], phase) {
  return [x + .28 * Math.sin(phase) + .11 * x * Math.sin(phase + .6),
    y + .47 * Math.sin(x * 1.06 - phase) + .19 * Math.cos(phase), z + .28 * Math.cos(x + phase)];
}
function cable(anchor) {
  const screen = anchor === 'screen', pattern = {
    dash: { anchor, spacing: screen ? 17 : .65, duty: .71, phase: screen ? 4 : .045 },
    grain: { anchor, spacing: screen ? [2,1] : .052, strength: .26, seed: 75 },
    dither: { anchor, spacing: screen ? [2,2] : .101, colors: ['#b6614d', gold], mix: .53 }
  };
  const strands = [
    { source: source('cable-core', guide.map(([x,y,z]) => [x,y,z - .12])), width: .27, color: '#466377', edge: 'hard' },
    { source: source('cable-pigment', guide), width: .189, color: gold, edge: 'hard', pattern }
  ];
  for (const index of [2, 14, 28, 38]) {
    const [x,y,z] = guide[index];
    strands.push({ source: source('cable-pin-' + index, [[x,y-.14,z+.16],[x,y+.14,z+.16]]),
      width: .064, edge: 'hard', caps: 'blunt', color: '#f8ead6' });
  }
  let phase = 0;
  const builder = kit.makeBuilder(7, colors.map(packed));
  const look = { edgeFilter: { rules: [{ select: { object: 'cable-pigment' } }] } };
  const styles = strands.map(strand => ({ ...strand, object: strand.source.id }));
  const bindings = styles.map(({ source, ...style }) => C.bind(builder, source,
    ({ points }) => points.map(point => position(point, phase)), style));
  const world = builder.finish({ cam: camera, radius: 6, look,
    fog: { c: 0, start: 1, max: 0 }, dither: 0 });
  return {
    recipe: makeRecipe('signal-cable-' + anchor, styles, { look }),
    render(view, angle) {
      phase = angle;
      for (const binding of bindings) binding.pose(world);
      return ink.render(world, view);
    }
  };
}

const chart = { kind: 'cylinder', origin: [0,-1.11,0], radius: 1.22, height: 2.22 };
function ring(id, v, width, color, pattern, section = 'round') {
  return { source: { kind: 'surface', id, chart: 'enamel', points: [[0,v],[1,v]], coordinates: 'lifted', closed: true,
    lift: .025, tolerance: .006 }, width, edge: 'hard', section, material: pattern?.dash ? 'stitches' : 'enamel',
    ...(section === 'flattened' && { aspect: .14, up: [0,1,0] }), color, pattern };
}
const enamel = makeRecipe('enamel-chart-band', [
  { source: source('body', [[0,-1.12,0],[0,1.12,0]]), width: 2.39, color: '#273948', edge: 'hard', caps: 'blunt' },
  ring('upper-lip', .94, .103, '#5d7a86'), ring('lower-lip', .075, .117, '#5d7a86'),
  ring('enamel-glaze', .52, 1.02, green, {
    grain: { anchor: 'chart', spacing: [.024,.034], strength: .2, seed: 63 },
    dither: { anchor: 'chart', spacing: [.04166666667,.086], colors: ['#34747a', green], mix: .5 }
  }, 'flattened'),
  ring('top-stitches', .787, .085, gold, { dash: { anchor: 'chart', spacing: .125, duty: .63, phase: .021 } }),
  ring('bottom-stitches', .257, .085, gold, { dash: { anchor: 'chart', spacing: .125, duty: .63, phase: .021 } }),
  { source: { kind: 'surface', id: 'index-mark', chart: 'enamel', points: [[.26,.285],[.26,.749]], lift: .085 },
    width: .065, edge: 'hard', section: 'round', caps: 'blunt', color: '#f8ead6' }
], { charts: { enamel: chart }, look: { edgeFilter: { rules: [{ select: { material: 'stitches' } }] } } });
const enamelWorld = C.world(enamel);
const arc = cable('arc'), screen = cable('screen');
const panels = [
  { title: 'Arc distance', color: gold, note: 'PAINT BENDS WITH THE CABLE', x: 20, render: arc.render },
  { title: 'Surface chart', color: green, note: 'INK WRAPS WITH THE ENAMEL', x: 382, render: (view, phase) =>
    ink.render(enamelWorld, { ...view, ortho: false, zoom: .98, yaw: -.87 * Math.sin(phase), pitch: .14 }) },
  { title: 'Screen grid', color: rose, note: 'CABLE CROSSES FIXED CELLS', x: 744, render: screen.render }
];

function board(frame) {
  const phase = frame / frameCount * Math.PI * 2, view = { w: artWidth, h: artHeight, px: 1, t: frame / fps };
  const commands = [];
  const rect = (x,y,w,h,fill) => commands.push({ type:'rect', rect:[x,y,w,h], fill });
  const text = (value,x,y,size,color=title) => commands.push({ type:'text', text:value, at:[x,y], scale:size, color });
  rect(0,0,width,height,'#111d2b');
  rect(20,28,28,4,green);
  text('INK STUDIO / CURVE SPLATS',62,23,2,dim);
  text('Stable pigment and dither',20,53,4);
  text('GRAIN, DASHES, AND SWATCHES / 168 X 118 ART PIXELS',20,109,2,dim);
  for (const { title, color, x, note } of panels) {
    text(title,x,149,3,color);
    rect(x-1,top-1,artWidth*scale+2,artHeight*scale+2,rule);
    rect(x,435,artWidth*scale,65,'#1d3041');
    rect(x+15,452,24,3,color);
    text(note,x+15,466,2);
  }
  text('CABLE PINS MARK THE SAME AUTHORED POINTS',20,528,2,dim);
  rect(20,569,1060,4,rule);
  rect(20,569,Math.max(1,1060 * frame / (frameCount - 1)),4,green);
  const board = K.procedural.drawing2d.render({ width,height,commands,edges:'hard' });
  for (const { x, render } of panels) {
    const image = render(view, phase);
    for (let y=0; y<artHeight*scale; y++) for (let u=0; u<artWidth*scale; u++) {
      const a=(Math.floor(y/scale)*artWidth+Math.floor(u/scale))*3, b=((top+y)*width+x+u)*4;
      for (let c=0; c<3; c++) board.data[b+c]=image.rgb[a+c];
    }
  }
  return PNG.packRGBA(board);
}

for (const recipe of [arc.recipe, enamel, screen.recipe]) json(path.join(out, recipe.id + '.json'), recipe);
const animation = [];
for (let f=0; f<frameCount; f++) {
  const image = board(f);
  write(path.join(out,'frames','frame-'+String(f).padStart(3,'0')+'.png'),PNG.encodeFrame(image));
  if (f % 2 === 0) animation.push(image);
  if (f === 10) write(path.join(out,'curve-stable-pigment.png'),PNG.encodeFrame(image));
}
write(path.join(out,'curve-stable-pigment-apng.png'),PNG.encodeAnimation(animation,fps/2));
console.log('Rendered curved pigment studies to ' + out);
