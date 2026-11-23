/* The Tuning Gate. A lantern keeper sends waves through a ruined arch. */
const width = 320, height = 214, length = 6;
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const poly = (fill, ...points) => ({ type: 'polygon', points, fill });
const path = (stroke, points, width = 1) => ({ type: 'path', points, stroke, width });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x,y,w,h], fill });

function ruins(seed, K) {
  const shadow = '#0c0d1c', mortar = '#242039', indigo = '#19192e', rim = '#383051';
  const tiles = [mortar, '#201d34', '#2b233c', '#342944', '#211b30'];
  const brick = (i,j) => tiles[Math.floor(K.hash(i, j, seed) * tiles.length)];
  const masonry = [];
  for (const side of [-1,1]) {
    const X = x => side < 0 ? x : width - x;
    const line = (c,...points) => path(c,points.map(([x,y]) => [X(x),y]));
    const fill = (c,...points) => poly(c,...points.map(([x,y]) => [X(x),y]));
    masonry.push(fill(shadow,[0,0],[88,0],[79,5],[66,10],[56,10],[49,18],[37,22],[29,35],
      [26,48],[21,57],[21,72],[16,81],[15,94],[11,113],[14,144],[19,154],[20,165],
      [31,181],[57,187],[70,191],[89,196],[0,214]));
    masonry.push(line(indigo,[87,2],[70,9],[56,10],[49,18],[37,22],[29,35],[26,48],[21,57],[21,72],
      [16,81],[15,94],[11,113],[14,144],[19,154],[20,165],[31,181],[57,187],[70,191]));
    masonry.push(line(rim,[38,22],[48,18],[55,11],[65,11]), line(rim,[22,53],[27,43],[29,36]),
      line(mortar,[13,102],[12,111],[13,118]), line(mortar,[21,162],[29,174],[35,180]));
    for (let row=0; row<13; row++) {
      const y = row*14 + 9 + (side > 0 ? 3 : 0);
      const reach = y < 45 ? 5 + Math.round((46-y)/1.9) : y > 155 ? Math.round((y-155)/1.9) : 3;
      for (let j=0; j<Math.floor(reach/7)+1; j++) {
        const x = j*7 + (row%2 ? 1 : 4), w = 4 + (row + j)%4;
        masonry.push(rect(Math.min(X(x),X(x+w)),y,w,3+(j*5+row)%4,brick(side*(row+1),j)));
      }
    }
    for (const [x,y,h] of [[27,185,12],[33,190,8],[45,193,9],[61,198,6]]) {
      masonry.push(rect(Math.min(X(x),X(x+2)),y,2,h,indigo));
    }
  }
  return masonry;
}

function keeper(time, warm) {
  const t = time * Math.PI * 2 / length;
  const drift = Math.round(1.05*Math.sin(t)), swing = Math.round(1.9*Math.sin(2*t-.3));
  const mantle = [[-10,-29],[-17,-22],[-19,-9],[-14,1],[-13,14],[-19,29],[-26,39],[-26,43],
    [-19,41],[-12,43],[-8,40],[4,44],[9,41],[17,43],[27+swing,40],[22+swing,33],[16,24],
    [13,10],[14,0],[18,-8],[15,-24],[8,-30]];
  const art = [], X = x => 160+x, Y = y => 108+y+drift;
  const fill = (c,...points) => art.push(poly(c,...points.map(([x,y]) => [X(x),Y(y)])));
  const line = (c,points,w) => art.push(path(c,points.map(([x,y]) => [X(x),Y(y)]),w));
  const block = (x,y,w,h,c) => art.push(rect(X(x),Y(y),w,h,c));
  // A sharply painted silhouette with warm lining near the carried lamp.
  fill('#090a16',...mantle);
  line('#54436a',[[-10,-28],[-16,-23],[-18,-10],[-15,-3],[-14,8],[-17,23],[-21,32],[-25,39]]);
  line('#4e405d',[[9,-28],[14,-22],[17,-10],[13,-1],[14,11],[16,26],[24+swing,38]]);
  fill('#151425',[-10,-22],[-15,-12],[-12,4],[-11,16],[-17,32],[-13,35],[-5,29],[-2,13],
    [-4,4],[-4,-16]);
  fill('#211a2b',[4,-21],[10,-24],[14,-11],[11,0],[11,13],[14,25],[21+swing,36],[16+swing,36],[9,29],[8,12],[5,3]);
  line('#262139',[[-6,13],[-7,23],[-10,34],[-13,38]],2);
  line('#3f2a47',[[4,9],[7,25],[7,33],[12,38]]);
  line('#3b2b48',[[-18,39],[-15,39],[-11,37]]);
  line('#443050',[[15,38],[20+swing,39],[22+swing,39]]);
  fill('#10101e',[-12,-26],[-12,-33],[-9,-40],[-4,-43],[3,-43],[9,-39],[12,-32],[11,-25],
    [6,-19],[-3,-19],[-9,-23]);
  line('#64506b',[[-12,-26],[-12,-33],[-9,-39],[-4,-43],[3,-43],[9,-39]],1);
  line('#302841',[[10,-37],[12,-31],[11,-25],[6,-19]]);
  fill('#080810',[-8,-31],[-5,-36],[3,-36],[7,-31],[6,-24],[2,-22],[-3,-24]);
  line(warm ? '#f1ae7b' : '#9b7281',[[-3,-29],[0,-28],[3,-29]]);
  line('#805365',[[-11,-20],[-8,-16],[-5,-12],[-4,-7]],2);
  line('#806070',[[10,-20],[7,-16],[5,-12],[4,-7]],2);
  line('#b27975',[[-13,-13],[-10,-9],[-6,-8],[0,-5]],1);
  line('#b27975',[[13,-12],[10,-9],[7,-8],[1,-5]],1);
  block(-7,-9,3,2,'#f1b479'); block(5,-8,3,2,'#f1b479');
  line('#a06e67',[[-5,2],[-3,7],[-1,10],[0,20]],1);
  block(-6,41,4,3,'#0a0a17'); block(5,43,4,2,'#0a0a17');
  return art;
}

function lamp(time) {
  const t = time * Math.PI * 2 / length, y = 99 + Math.round(1.05*Math.sin(t));
  const flare = .5 + .5 * Math.cos(t * 4);
  const gold = flare > .6 ? '#fff4bd' : '#f7c181';
  return [
    ellipse(147,y-12,26,24,'#da683625'), ellipse(151,y-8,18,16,'#fa8c4e46'),
    poly('#ed9b6d',[160,y-8],[166,y],[160,y+8],[154,y]),
    poly('#53314b',[160,y-6],[164,y],[160,y+5],[156,y]),
    rect(159,y-3,3,7,gold), rect(157,y,7,1,gold),
    rect(159,y,2,2,'#fffae8'),
    ...(flare > .83 ? [rect(150,y-1,2,1,'#f7c181'),rect(169,y-1,2,1,'#f7c181'),
      rect(160,y-12,1,2,'#ffd19a')] : [])
  ];
}

module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'tuning-gate',
  name: 'The Tuning Gate',
  seed: 92,
  build(seed, { controls: { study = 'prism', glow = true } = {} } = {}) {
    if (!['prism','ember','reverse'].includes(study) || typeof glow !== 'boolean')
      throw new TypeError('Choose prism, ember or reverse and a boolean glow switch');
    const bands = K.emissionBands.create({
      palette: study === 'reverse' ? 'prism' : study,
      origin: [160,98], scale: [1.26,.87], start: 24, speed: study === 'reverse' ? -16 : 16,
      crest: 1, body: 13, gap: 10, phase: 5.2,
      jagged: { amount: 20, spokes: 23, twist: .038, seed },
      halo: glow && { radius: 4, sigma: 1.75, strength: 1.65 }
    });
    const resolution = [width,height];
    const stage = [
      rect(0,0,width,height,'#100d20'),
      ellipse(54,-38,211,272,'#141127'), ellipse(91,27,142,151,'#110f20'),
      ellipse(121,57,80,79,'#0c0d1b'),
      ...Array.from({ length: 140 }, (_,i) => {
        const x = Math.floor(K.hash(i,seed,20)*width), y = Math.floor(K.hash(i,seed,21)*height);
        return rect(x,y,1,1, i%11 ? '#26203c' : '#45304a');
      })
    ];
    const rock = ruins(seed,K);
    const layer = callback => ({ resolution, source({ time }) {
      const { data } = K.procedural.drawing2d.render({ width,height,edges:'hard',commands:callback(time) });
      return { w:width,h:height,rgba:data };
    } });
    const floor = [
      ellipse(117,154,87,24,'#13102380'), ellipse(133,150,54,12,'#151324'),
      poly('#161425',[146,148],[171,148],[181,156],[181,160],[174,163],[146,163],[139,159],[139,156]),
      poly('#302740',[146,148],[171,148],[180,155],[172,158],[146,158],[140,155]),
      path('#695068',[[145,151],[141,155],[149,156],[168,156],[173,155]]),
      path('#45354b',[[139,159],[147,160],[172,160],[180,158]])
    ];
    const particles = time => Array.from({ length: 28 }, (_,i) => {
      const age = (time / 3 + K.hash(i,seed,54)) % 1, angle = K.hash(i,seed,35)*Math.PI*2;
      const distance = 30+age*76, x = Math.floor(160+Math.cos(angle)*distance*1.22);
      const y = Math.floor(98+Math.sin(angle)*distance*.83);
      const colors = ['#f7d38b','#ce81a4','#a6e7d6','#819bdd'];
      return age>.71 ? rect(x,y,1,1,'#30243a') : rect(x,y,i%7===0?2:1,1,colors[i%4]);
    });
    const passes = [
      { id: 'chamber', type: 'composite', layer: layer(() => stage) },
      { id: 'wavefronts', type: 'composite', layer: bands.layer({ resolution }) },
      { id: 'keeper', type: 'composite', layer: layer(time => [
        ...particles(time), ...rock, ...floor, ...keeper(time,Math.cos(time*2*Math.PI/1.5)>.1), ...lamp(time)
      ]) }
    ];
    return makeBuilder(seed,[0x100d20]).finish({
      cam: { target:[0,0,0],dist:4,yaw:0,pitch:0 }, look: { pixelSize: 1, renderGraph: { passes } }
    });
  }
});
