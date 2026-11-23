/* Hadal Survey. A pose-bound sample lattice over an original deep-sea ray. */
const W = 378, H = 228, length = 7.2;
const body = [
  [1.98,.16],[1.85,.47],[1.64,.91],[1.39,1.39],[1.12,1.92],[.84,2.48],[.54,2.98],
  [.25,3.37],[.02,3.56],[-.24,3.47],[-.55,3.09],[-.84,2.53],[-1.1,1.92],
  [-1.34,1.36],[-1.56,.87],[-1.74,.42],[-1.87,.22]
];
const route = [
  [0,255,76],[.85,262,108],[1.7,217,118],[2.55,183,82],[3.25,146,68],[3.95,98,96],
  [4.74,58,127],[5.34,112,157],[6.12,181,190],[6.67,228,164],[length,255,76]
];
const palette = {
  grid: '#18293b', ticks: '#2f495d', frame: '#344b65', paper: '#e2e9d8', note: '#88a2b7',
  mint: '#7be5c5', lilac: '#a6aaf0', sun: '#ffd49d', dark: '#111c2c'
};
const left = ['#255763','#34747b','#429c9b','#6bd3b5','#9ae7c4'];
const right = ['#303a69','#464c89','#5b70af','#8995df','#acb5f1'];
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x,y,w,h], fill });
const path = (points, stroke, width = 1) => ({ type: 'path', points, stroke, width });
const polygon = (points, fill) => ({ type: 'polygon', points, fill });
const text = (x, y, text, color, scale = 1) => ({ type: 'text', at: [x,y], text, color, scale });

function pose(time, x, y, lift = 0) {
  const t = time / length * Math.PI * 2, wing = Math.min(1, Math.abs(x) / 3.56);
  const flap = Math.sin(2*t - 2.4*wing + .48*y + (x > 0 ? .52 : 0));
  const ridge = .44 * Math.exp(-2 * x*x - .28 * y*y), flex = wing ** 1.7;
  const z = ridge + flex * flap * 1.04 + lift;
  const turn = .20 * Math.cos(t), roll = .20 * Math.sin(t + .25);
  const ox = x * (1 - flex * .12 * flap*flap);
  const oy = y + .20 * flex * flap;
  const u = ox*Math.cos(roll) - oy*Math.sin(roll);
  const v = ox*Math.sin(roll) + oy*Math.cos(roll);
  return [u*Math.cos(turn) + z*Math.sin(turn) - 1.22 + .21*Math.sin(t),
    v + .14*Math.cos(2*t), z*Math.cos(turn) - u*Math.sin(turn)];
}

function tail(time, u, edge = 0) {
  return pose(time, -.12 + .53*u*u*Math.sin(3.5*u - time * Math.PI * 4 / length) + edge,
    -1.71 - 1.28*u, .22*Math.sin(4*u - time * Math.PI * 4 / length)*u);
}

function cursor(time) {
  const t = ((time % length) + length) % length;
  const i = route.findIndex(([s]) => s > t);
  const [a, x, y] = route[i-1], [b, u, v] = route[i];
  const s = (t-a)/(b-a), k = s*s*(3-2*s);
  return [x + (u-x)*k, y + (v-y)*k];
}

module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'hadal-surface-probe',
  name: 'Hadal Survey',
  seed: 25,
  build(seed) {
    const samples = [];
    const endpoint = (x,y,z) => ({ sceneTime }) => pose(sceneTime,x,y,z);
    for (const [row, [y, width]] of body.entries()) {
      const half = Math.max(1, Math.round(width / .164));
      for (let col = -half; col <= half; col++) {
        const x = width*col/half, v = Math.abs(col/half), edge = Math.abs(col) === half;
        const vein = Math.abs(x - .22*Math.sin(row*.78+x) - 1.3*y) < .30 ||
          Math.abs(x - 1.22*Math.sin(row*.25+.4)) < .23;
        const band = edge ? 3 : v < .27 ? (row%3 ? 2 : 3) :
          vein ? 3 : 1 + Number((col*11 + row*8 + 80) % 9 < 3);
        const tip = edge && row % 3 === 0;
        const mark = tip ? ['.#.', '##.'] : vein && (col+row)%3 === 0 ? 'dash' : 'dot';
        samples.push({ id: 'r'+row+'c'+col, at: endpoint(x, y, 0), leader: false,
          color: (col < 0 ? left : right)[band], mark });
        if (row < body.length - 1 && row % 2) {
          const [ny, nw] = body[row+1];
          const a = (col+.45)/half;
          if (Math.abs(a) < .97)
            samples.push({ id: 'f'+row+'c'+col, at: endpoint(a*(width+nw)/2, (y+ny)/2, 0),
              leader: false, color: (a < 0 ? left : right)[band > 2 ? 2 : 0] });
        }
      }
    }
    for (let n=0; n<18; n++) {
      const u=n/17;
      for (const edge of n < 8 ? [-1,0,1] : [0])
        samples.push({ id: 'tail'+n+'/'+edge, at: ({ sceneTime }) => tail(sceneTime,u,edge*.07*(1-u)),
          color: right[edge ? 2 : 4], leader: false });
    }
    const features = [
      ['SNOUT',-.09,1.85], ['LEFT EYE',-.48,1.14], ['RIGHT EYE',.48,1.14],
      ['L ROOT',-1.07,.59], ['L VEIN',-1.85,.45], ['L EDGE',-2.62,.48], ['L TIP',-3.47,-.02],
      ['L REAR',-2.04,-.81], ['L FIN',-.91,-1.31], ['SPINE',.02,.14], ['MIDLINE',.14,-.57],
      ['R ROOT',1.02,.63], ['R VEIN',1.83,.49], ['R EDGE',2.60,.44], ['R TIP',3.46,-.08],
      ['R REAR',2.08,-.74], ['R FIN',.91,-1.31], ['PELVIS',0,-1.61]
    ];
    for (const [id,x,y] of features)
      samples.push({ id, at: endpoint(x,y,.025), color: x < 0 ? left[4] : right[4], mark: 'cross' });
    for (const [id,u] of [['TAIL BASE',.19],['TAIL BEND',.56],['TAIL TIP',1]])
      samples.push({ id, at: ({ sceneTime }) => tail(sceneTime,u), color: right[4], mark: 'ring' });
    const probe = K.surfaceProbe.create({
      samples, space: 'screen', at: ({ time }) => cursor(time), radius: 41, maxLeaders: 6, hold: .24,
      style: {
        hit: '#e5ffe0', held: '#84baba', leader: '#487780', bracket: '#9ed6cc', cursor: palette.sun
      }
    });

    const { grid, ticks, frame, paper, note, mint, lilac, sun, dark } = palette;
    const base = [
      rect(0,0,W,H,'#0d1421'), rect(0,0,W,31,'#172537'), rect(0,30,W,1,frame),
      rect(14,9,4,12,mint), text(26,7,'HADAL SURVEY',paper,2), text(258,12,'FAUNA RECORD  R07',note),
      rect(12,42,275,163,'#111b2c'),
      ...Array.from({ length: 16 }, (_,i) => rect(14+i*17,43,1,161,grid)),
      ...Array.from({ length: 10 }, (_,i) => rect(13,44+i*17,273,1,grid)),
      rect(12,42,275,1,frame), rect(12,204,275,1,frame), rect(12,42,1,163,frame), rect(286,42,1,163,frame),
      rect(295,42,1,163,frame),
      text(16,211,'DORSAL',note), text(220,211,'RAY 07',note),
      text(304,45,'PROBE',mint), text(304,91,'LINKS',sun),
      text(304,174,'DWELL',note),
      text(304,196,'POSE LIVE',lilac), rect(367,197,2,3,lilac)
    ];
    function underlay({ project, sceneTime }) {
      const p = (x,y,z) => project(pose(sceneTime,x,y,z));
      const silhouette = [
        ...body.map(([y,w]) => p(-w,y)), ...body.slice().reverse().map(([y,w]) => p(w,y))
      ];
      const scan = [];
      for (const [start,end,color] of [[0,7,'#173644'],[7,11,'#183645'],[11,16,'#162f40']]) {
        const strip = body.slice(start,end+1);
        scan.push(polygon([
          ...strip.map(([y,w]) => p(-w,y)), ...strip.slice().reverse().map(([y,w]) => p(-w*.29,y))
        ], color));
      }
      for (const [i, band] of body.entries()) {
        if (i%3 !== 1) continue;
        const [y,w] = band;
        scan.push(path([-1,-.75,-.38,.0,.38,.75,1].map(u => p(w*u,y)), '#2f54646b'));
      }
      const trunk = [[1.91,.12],[1.63,.29],[1.18,.51],[.72,.66],[.20,.59],[-.34,.50],[-.93,.39],[-1.43,.24],[-1.82,.12]];
      const ridge = [...trunk.map(([y,w]) => p(-w,y)), ...trunk.slice().reverse().map(([y,w]) => p(w,y))];
      const gills = [-1,1].flatMap(side => [
        ...[0,.19,.38].map(u => path([p(.66*side,.77-u),p(.86*side,.69-u),p(1.03*side,.70-u)], '#45838e')),
        path([p(.35*side,1.32), p(.54*side,1.19), p(.63*side,1.04)], '#6d949a'),
        path([p(.45*side,1.23), p(.48*side,1.17)], '#ffd4a2', 2)
      ]);
      return [
        polygon(silhouette, '#20294b'),
        ...scan, path([...silhouette,silhouette[0]],'#3a5477'),
        polygon(ridge, '#1b3150'), path([...ridge,ridge[0]], '#41658d'), ...gills,
        path(body.map(([y]) => p(0,y)),'#5395a17a'),
        path(Array.from({ length: 18 }, (_,i) => project(tail(sceneTime,i/17))),'#3d4278',2)
      ];
    }
    const layer = {
      resolution: [W,H], needsCamera: true,
      source({ w,h,camera,time,sceneTime = time,world }) {
        const result = probe.sample({ world,camera,width:w,height:h,time,sceneTime });
        const view = K.inspection.projector(camera);
        const project = p => { const v = view(p); return v && [v[0]*w,v[1]*h]; };
        const hits = result.samples.filter(p => p.state === 'hit').length;
        const held = result.samples.filter(p => p.state === 'held').length;
        const links = result.leaders;
        const cursorX = Math.round(result.at?.[0] ?? 0), cursorY = Math.round(result.at?.[1] ?? 0);
        const scan = ((time % length) + length) % length;
        const ready = [
          text(304,59,String(hits).padStart(3,'0')+' LIVE',paper),
          text(304,71,String(held).padStart(3,'0')+' HELD',note),
          ...links.map(({ label, state }, i) =>
            text(304,105+i*10,label,state === 'hit' ? paper : mint)),
          text(304,184,'240 MS',paper),
          rect(79,213,125,3,grid), rect(79,213,Math.max(1,Math.floor(125*scan/length)),3,mint),
          ...[0,1,2,3,4].map(i => rect(79+i*31,211,1,2,ticks)),
          rect(20,48,57,10,dark), text(23,49,`X${cursorX} Y${cursorY}`,note)
        ];
        const { data } = K.procedural.drawing2d.render({ width:w,height:h,edges:'hard',commands: [
          ...base,...underlay({ project,sceneTime }),...probe.commands(result),...ready
        ] });
        return { w,h,rgba:data };
      }
    };
    return makeBuilder(seed, [0x0d1421]).finish({
      radius: 5, cam: { target: [0,-.3,0], dist: 11.75, yaw: .035, pitch: -.025 },
      look: { pixelSize: 1, composite: { layers: [layer] } }
    });
  }
});
