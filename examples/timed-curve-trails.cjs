/* Build editable curve scenes for a written mark, a wake and a sweep. */
const path = require('node:path'), ink = require('..'), { KIT: K } = ink.load();
const PNG = require('../cli/png.js'), { write, json } = require('../cli/asset-files.js');
const out = path.resolve(process.argv[2] ?? 'studio/out/timed-curve-trails');
const still = process.argv.includes('--still'), count = 48, fps = 12;
const width = 1104, height = 970, w = 235, h = 80, scale = 3;
const pathSource = (id, points) => ({ kind: 'path', id, points });
const curveScene = (id, background, strands, distance = 4.9) => ({
  id, format: K.curveSplats.format, version: 1, seed: 17, background, strands,
  camera: { target: [0,0,0], dist: distance, yaw: 0, pitch: .03 },
  liveSun: { direction: [-.26,.58,.83], intensity: .9, shadows: false }
});

const inkStrokes = [
  ['top', [[-2.52,.78],[-2.11,.82],[-1.62,.79]], .07, .29],
  ['stem', [[-2.05,.8],[-2.14,.33],[-2.17,-.30],[-2.25,-.78]], .28, .60],
  ['foot', [[-2.57,-.8],[-2.17,-.76],[-1.63,-.78]], .59, .76],
  ['n', [[-1.29,-.78],[-1.10,.84],[.31,-.75],[.45,.84]], .68, 1.16],
  ['k-stem', [[.98,-.79],[1.10,.80]], 1.06, 1.31],
  ['k-arm', [[2.37,.79],[1.83,.45],[1.09,.045]], 1.27, 1.53],
  ['k-leg', [[1.10,.04],[1.52,-.26],[2.34,-.81]], 1.50, 1.78]
];
const lettering = curveScene('drawn-on-ink', '#172030', [
  ...inkStrokes.map(([id, points, start, end], index) => ({
    source: pathSource(id, points.map(([x,y]) => [x,y,.12 * Math.cos(x * .9 + y * .55)])),
    edge: 'hard', width: [[0,.11],[.26,.183],[.80,.162],[1,.092]], profileSamples: 30,
    color: index % 3 === 1 ? '#f4c483' : '#e5a76e',
    lighting: { preset: 'matte-thread', diffuse: .18, sheen: .11 },
    reveal: { end: [[0,0],[start,0,'smooth'],[end,1]], start: [[0,0],[3.22,0,'smooth'],[3.91,1]] }
  })),
  {
    source: { kind: 'spline', id: 'flourish', points: [[-2.39,-1.14,.04],[-1.18,-1.31,.13],[.12,-1.23,.24],
      [1.57,-1.17,.09],[2.46,-1.26,-.13],[2.62,-.98,.08]], samples: 10 },
    edge: 'hard', width: [[0,.024],[.21,.085],[.74,.054],[1,.015]], color: '#79cbbb',
    reveal: { end: [[0,0],[1.72,0,'out-sine'],[2.23,1]], start: [[0,0],[3.28,0],[3.92,1]] }
  }
], 5.72);

const spiral = (time, filament) => {
  const a = time * Math.PI * 2 / 1.67 - .63, u = filament * .118, pulse = Math.sin(a * 2 + filament);
  return [(2.66 + u) * Math.cos(a) + .28 * Math.cos(a * .51), (.84 + u * .64) * Math.sin(a) + u * pulse * .56,
    .65 * Math.sin(a * .92) + u * Math.cos(a * 1.14)];
};
const wake = curveScene('magical-wake', '#101d31', [
  { id: 'aura', filament: 0, width: .24, opacity: .38, lifetime: 1.14, color: '#216a9d' },
  { id: 'colour', filament: 0, width: .126, opacity: .88, lifetime: 1.05, color: '#5ceacb' },
  { id: 'edge-light', filament: .25, width: .057, opacity: .92, lifetime: .68, color: '#c6ffe0' },
  { id: 'runner-left', filament: -1.47, width: .045, opacity: .70, lifetime: .94, color: '#77a8fe' },
  { id: 'runner-right', filament: 1.42, width: .038, opacity: .78, lifetime: .83, color: '#91ffe8' },
  { id: 'ember', filament: 0, width: .115, opacity: .94, lifetime: .096, color: '#ebffe0' }
].map(({ id, filament, width, opacity, lifetime, color }) => ({
  source: { kind: 'trail', samples: Array.from({ length: 121 }, (_, index) => {
    const time = index / 30;
    return { time, point: spiral(time, filament) };
  }) },
  object: id, width, opacity, edge: 'beta', color,
  trail: { lifetime, ageSamples: 18, width: [[0,1],[.3,.84],[.72,.46],[1,.16]],
    fade: [[0,1],[.17,.97],[.60,.54],[1,0]] }
})), 5.50);

function slash(points, offset, pass) {
  const timing = {
    start: [[0,0],[offset + .30,0],[offset + .87,.8,'in-sine'],[offset + 1.11,1]],
    end: [[0,0],[offset,0,'out-sine'],[offset + .72,1]],
    width: [[0,.64],[offset + .37,1.13],[offset + .84,.79],[offset + 1.11,.25]],
    opacity: [[0,1],[offset + .46,1],[offset + 1.11,0]]
  };
  return [
    { source: pathSource('solid-' + pass, points), section: 'flattened', aspect: .22, edge: 'hard',
      width: [[0,.018],[.27,.31],[.63,.48],[.90,.26],[1,.026]], profileSamples: 38,
      along: { pigment: { samples: ['#853f62','#f07889','#ffc9a2','#ed697f','#953d63'] } }, reveal: timing },
    { source: pathSource('razor-' + pass, points.map(([x,y,z]) => [x,y-.133,z+.058])),
      width: [[0,.012],[.40,.052],[.82,.083],[1,.013]], profileSamples: 34,
      edge: 'hard', color: '#ffe2a5', reveal: timing },
    { source: pathSource('echo-' + pass, points.map(([x,y,z]) => [x-.08,y+.29,z-.18])),
      width: [[0,.009],[.52,.068],[1,.019]], profileSamples: 28, edge: 'beta', opacity: .65, color: '#b669a1',
      reveal: { ...timing, end: [[0,0],[offset+.13,0,'out-sine'],[offset+.84,1]] } }
  ];
}
const sweep = curveScene('motion-sweep', '#1e1a2b', [.18,1.43,2.71].flatMap((offset, pass) => {
  const points = Array.from({ length: 50 }, (_, i) => {
    const u = i / 49, x = 5.40 * (u - .5);
    return [x, .92 * Math.sin(Math.PI * u) - .66 + .32 * x * (pass === 1 ? -.21 : .44),
      .59 * Math.sin(Math.PI * u * 1.2) - .27 * x];
  });
  return slash(points, offset, pass);
}), 5.3);

const panels = [
  [lettering, 'Drawn-on ink', 'START AND END KEYS', 'DRAW, HOLD, THEN ERASE', '#efc78e'],
  [wake, 'Magical wake', 'TIMESTAMPED SAMPLES', 'AGE-BASED WIDTH AND FADE', '#9de8d7'],
  [sweep, 'Motion sweep', 'A MOVING REVEAL WINDOW', 'KEYED WIDTH AND OPACITY', '#f4acb7']
].map(([recipe, label, first, second, color], i) => ({
  recipe, world: K.curveSplats.world(recipe), label, first, second, color, y: 141 + 259 * i
}));

function board(frame) {
  const commands = [], white = '#f0eee5', dim = '#a5bbc9', trim = '#3b5268', x = 369, time = frame / fps;
  const rect = (x,y,w,h,fill) => commands.push({ type:'rect', rect:[x,y,w,h], fill });
  const text = (value,x,y,size,color=white) =>
    commands.push({ type:'text', text:value, at:[x,y], scale:size, color });
  rect(0,0,width,height,'#141e2d');
  rect(26,24,28,4,'#9de8d7');
  text('INK STUDIO / CURVE SPLATS',66,20,2,'#9de8d7');
  text('Timed reveal and trails',23,50,5);
  text('THREE STUDIES ON THE SAME SCENE CLOCK',26,106,2,dim);
  for (const {label,first,second,color,y} of panels) {
    rect(x-2,y-2,w*scale+4,h*scale+4,trim);
    rect(27,y+65,28,4,color);
    text(label,25,y+80,4,color);
    text(first,27,y+123,2,dim);
    text(second,27,y+145,2,dim);
  }
  rect(27,934,1050,4,trim);
  rect(27,934,Math.max(1,1050 * frame / (count - 1)),4,'#9de8d7');
  text(time.toFixed(2)+' S',27,946,1,dim);
  const plate = K.procedural.drawing2d.render({ width,height,commands,edges:'hard' });
  for (const { world,y } of panels) {
    const scene = ink.render(world,{raw:true,w,h,px:1,t:time,
      yaw:.065*Math.sin(Math.PI*time/2),pitch:.038+.06*Math.sin(Math.PI*time/2)});
    for (let v=0;v<h*scale;v++) for(let u=0;u<w*scale;u++) {
      const j=(Math.floor(v/scale)*w+Math.floor(u/scale))*3, q=((y+v)*width+x+u)*4;
      for(let c=0;c<3;c++)plate.data[q+c]=scene.rgb[j+c];
    }
  }
  return PNG.packRGBA(plate);
}

for(const { recipe } of panels) json(path.join(out,recipe.id+'.json'),recipe);
const poster = 24;
if(still) write(path.join(out,'timed-curve-trails.png'),PNG.encodeFrame(board(poster)));
else {
  const animation = [];
  for(let i=0;i<count;i++) {
    const frame = board(i);
    write(path.join(out,'frames','frame-'+String(i).padStart(3,'0')+'.png'),PNG.encodeFrame(frame));
    if(i===poster)write(path.join(out,'timed-curve-trails.png'),PNG.encodeFrame(frame));
    if(i%2===0)animation.push(frame);
  }
  write(path.join(out,'timed-curve-trails-apng.png'),PNG.encodeAnimation(animation,fps/2));
}
console.log('Rendered timed curves and trails to '+out);
