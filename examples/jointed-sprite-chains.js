/* Tidegate Pump. Two sprite chains share the drive of a painted lockhouse. */
const {rect, fill, line, pixel} = require('./pixel-stamp-studies.js');
const W = 272, H = 160;
const metal = ['#19202a','#2b3136','#574344','#80564c','#ae7355','#da9d65','#f1c990','#ffe6b0','#388077','#67aa8f','#94ccb0'];
const cel = (rows, start, end) => ({
  stamp: { width: rows[0].length, height: rows.length, rows },
  sockets: [start, end]
});
const cableStraight = cel([
  '...000000000...',
  '..01221221210..',
  '.0135535535310.',
  '013576576575310',
  '024565465465420',
  '013454354354310',
  '.0122322322310.',
  '..00000000000..'
], [1,4], [13,4]);
const cableDiagonal = cel([
  '.000..........',
  '024500........',
  '02356600......',
  '.012356500....',
  '..0134656500..',
  '....024365650.',
  '......02346550',
  '........024440',
  '..........011.',
  '............0.'
], [1,2], [12,7]);
const cableBent = cel([
  '...............',
  '.00000...00000.',
  '025552000255520',
  '024666545666420',
  '013456767654310',
  '.0123456543210.',
  '..00123332100..',
  '....0000000....'
], [1,3], [13,3]);
const cableContact = cel([
  '..00000000000..',
  '.0289889889820.',
  '0289A9A9A9A9820',
  '026595695695620',
  '014585485485410',
  '.0134343434310.',
  '..00000000000..'
], [1,3], [13,3]);
const cablePinch = cel([
  '..000000..',
  '.01343130.',
  '0256545620',
  '0245345420',
  '0133234310',
  '.00123200.',
  '...0000...'
], [1,3], [8,3]);
const brassBellows = cel([
  '...0000000...',
  '..034454430..',
  '.03566766530.',
  '0367447447630',
  '0467547547640',
  '0477547547740',
  '0367447447630',
  '0256336336520',
  '0144214214410',
  '.01332233310.',
  '..000000000..'
], [1,5], [11,5]);
const tightBellows = cel([
  '.000000..',
  '03345300.',
  '035664530',
  '046756740',
  '046756740',
  '035645630',
  '024534520',
  '013423410',
  '.0000000.'
], [1,4], [7,4]);

const stroke = time => .5 - .5 * Math.cos(time * Math.PI / 2);
const carriage = time => [230 - 34 * stroke(time), 62 + 5 * stroke(time), 0];
const plunger = time => [248 - 30 * stroke(time), 126, 0];
const roller = [133,106], rollerRadius = 24;

function makePump(K) {
  const hoseStyle = K.spriteChains.style({
    palette: metal, bendAt: .36, compressAt: .78,
    straight: [cableStraight,cableDiagonal], bent: [cableBent], contact: [cableContact], compressed: [cablePinch]
  });
  const bellowsStyle = K.spriteChains.style({
    palette: metal, compressAt: .83, straight: [brassBellows], compressed: [tightBellows]
  });
  const hose = K.spriteChains.create({
    points: Array.from({length:14}, (_, i) => {
      const t = i / 13;
      return [43 + 187 * t, 62 + 8 * Math.sin(Math.PI * t), 0];
    }),
    pins: [0, {index:13,at:carriage}], style: hoseStyle, gravity: [0,110,0],
    damp: 5, stretch: .016, bend: .085, radius: 3.2, friction: .18,
    sdf: (x,y) => Math.hypot(x - roller[0], y - roller[1]) - rollerRadius
  });
  const bellows = K.spriteChains.create({
    points: Array.from({length:7}, (_, i) => [176 + i * 12,126,0]),
    pins: [0, {index:6,at:plunger}], style: bellowsStyle, gravity: [0,0,0],
    stretch: .008, bend: 0, damp: 5, radius: 4.5
  });
  return { hose, bellows };
}

const room = [
  '#121d27','#1b2c35','#253941','#334b4e','#42615d','#608176','#90a18a','#cad1a0',
  '#273046','#394158','#55516b','#736079','#947582','#b78987','#e0a68e','#f4cd9d',
  '#28222b','#473039','#694044','#945347','#b77955','#d99b67','#f1c88a','#ffe3a6',
  '#17272f','#24404a','#2d4e56','#426e6e','#638a80','#7d9c8b','#9fbd9e','#c3cda9',
  '#104951','#296259','#428477','#76af90','#a5c5a2','#435350','#24292d'
];
const image = (K, strokes, w = W, h = H) =>
  K.pixelStamps.image({ width:w,height:h,palette:room,strokes }).rgba;
const ring = (slot,x,y,r) => fill(slot,[
  [x-r,y-r*.43],[x-r*.64,y-r*.83],[x-r*.23,y-r],[x+r*.23,y-r],
  [x+r*.64,y-r*.83],[x+r,y-r*.43],[x+r,y+r*.43],[x+r*.64,y+r*.83],
  [x+r*.23,y+r],[x-r*.23,y+r],[x-r*.64,y+r*.83],[x-r,y+r*.43]
]);

function lockhouse(K, seed) {
  const marks = [rect(10,0,0,W,H)];
  for (const [y,h,slot] of [[0,18,9],[18,25,10],[43,18,11],[61,15,12],[76,28,13],[104,56,25]]) {
    marks.push(rect(slot,0,y,W,h));
  }
  marks.push(ring(14,187,56,16),ring(15,187,55,13),rect(11,166,63,50,2),rect(12,178,68,36,2),
    fill(11,[[0,91],[17,84],[24,89],[39,86],[58,72],[73,80],[82,83],[89,91],[99,87],[126,96],
      [154,89],[171,80],[197,92],[218,90],[238,77],[251,77],[272,83],[272,112],[0,112]]),
    fill(9,[[0,100],[25,93],[55,97],[68,92],[77,99],[89,96],[109,101],[137,98],[157,101],
      [180,93],[191,94],[207,99],[220,101],[253,90],[272,97],[272,107],[0,107]]),
    rect(26,0,108,W,16),rect(25,0,124,W,36));
  for (let i = 0; i < 82; i++) {
    const x = K.hash(i,seed,7) * W | 0, y = 108 + (K.hash(i,seed,8) * 29 | 0);
    marks.push(rect(i % 7 ? 27 : 28,x,y,1 + i % 9,1));
  }
  for (const x of [-7,62,131,200]) {
    const arch = [[x,144],[x,61],[x+2,43],[x+8,32],[x+21,21],[x+32,18],[x+44,21],
      [x+57,32],[x+63,43],[x+65,61],[x+65,144]];
    marks.push(line(24,arch,10),line(3,arch,6),line(4,arch.map(([a,b])=>[a-1,b-1]),2),
      line(2,arch.map(([a,b])=>[a+3,b+2]),1),rect(3,x-2,71,68,3),rect(4,x-2,70,68,1),
      rect(24,x-2,112,69,5),rect(3,x-2,112,69,2),rect(2,x+31,20,2,91),rect(4,x+30,26,1,85));
    for (const y of [45,68,73,91,113]) marks.push(pixel(6,x-1,y),pixel(2,x,y+1));
  }
  marks.push(fill(0,[[0,0],[272,0],[272,17],[250,12],[173,14],[114,9],[46,14],[0,29]]),
    line(3,[[0,29],[39,14],[88,12],[114,10],[174,16],[232,12],[271,20]],2),
    rect(0,0,139,W,21),rect(24,0,137,W,5),rect(4,0,136,W,1),rect(3,0,145,W,1));
  for (let i=0; i<56; i++) {
    const x=K.hash(i,seed,2)*W | 0, y=142+(K.hash(i,seed,3)*18 | 0);
    marks.push(rect(i%5?1:2,x,y,2+i%6,1));
  }
  // Pipe cradles and the handrail behind the animated link art.
  marks.push(line(24,[[4,157],[4,115],[17,101],[29,101],[43,111],[71,111]],9),
    line(26,[[5,157],[5,115],[17,103],[30,103],[43,112],[70,112]],5),
    line(28,[[6,134],[6,117],[17,105],[28,105],[41,111]],1),
    line(24,[[136,113],[145,143],[157,148],[272,148]],8),
    line(3,[[136,113],[145,141],[157,146],[272,146]],4),
    rect(24,157,121,115,11),rect(37,157,122,115,3),rect(4,171,133,97,1),
    rect(0,169,116,100,4),rect(3,170,116,98,1),
    rect(24,186,51,82,9),rect(3,188,51,78,2),rect(4,193,53,71,1),rect(1,187,58,84,1));
  for (const x of [193,206,219,232,245,258]) marks.push(rect(24,x,51,2,8),pixel(5,x,52));
  return image(K,marks);
}

function mechanisms(K) {
  const [x,y] = roller;
  const marks = [
    fill(24,[[111,148],[117,129],[125,119],[141,119],[152,130],[157,147]]),
    fill(2,[[116,146],[121,133],[130,124],[138,124],[145,132],[150,146]]),
    line(4,[[118,143],[123,132],[127,128]],2),
    ring(24,x,y,rollerRadius),ring(25,x,y,22),ring(26,x-1,y-1,20),ring(27,x-1,y-2,18),
    line(30,[[111,104],[113,95],[123,86],[132,84],[141,86]],2),
    line(28,[[111,108],[116,96],[124,90],[134,88],[142,90]]),
    ring(24,x,y,13),ring(4,x-1,y,11),ring(25,x,y,8),
    ring(16,x,y,5),ring(6,x-1,y-1,3),pixel(7,x-2,y-2),
    fill(0,[[0,99],[0,51],[8,40],[26,40],[36,48],[39,57],[39,88],[31,96],[21,102]]),
    fill(2,[[0,94],[0,52],[9,44],[25,44],[32,48],[36,60],[36,84],[28,93]]),
    fill(3,[[0,51],[8,45],[24,45],[31,48],[34,55],[29,59],[24,52],[0,57]]),
    line(5,[[0,50],[9,45],[23,45],[29,48]]),
    fill(16,[[28,54],[41,54],[49,58],[49,66],[42,71],[28,71]]),
    rect(18,31,56,13,13),rect(20,39,56,4,13),rect(22,41,57,2,9),rect(21,45,60,3,5),
    rect(21,7,66,19,12),rect(16,8,67,17,10),rect(25,10,68,13,8),
    rect(35,12,70,5,1),rect(34,12,72,8,1),rect(33,12,74,5,1),pixel(7,23,67),
    rect(1,9,82,16,7),line(3,[[11,84],[23,84]]),line(3,[[11,86],[22,86]]),
    fill(16,[[155,116],[163,112],[175,112],[180,118],[180,134],[173,141],[156,141],[152,137],[152,122]]),
    rect(18,155,118,21,17),rect(20,157,116,17,2),rect(3,156,120,17,3),rect(21,172,116,4,21),
    rect(22,172,117,1,15),rect(1,155,135,17,4),rect(4,153,142,26,3),rect(24,153,146,26,2),
    pixel(7,157,120),pixel(5,157,132),pixel(7,170,121),pixel(5,170,132)
  ];
  for (const [px,py] of [[9,57],[26,56],[9,91],[28,88],[128,96],[143,104],[128,114]]) {
    marks.push(rect(1,px-1,py-1,3,3),pixel(6,px,py-1),pixel(3,px,py));
  }
  return image(K,marks);
}

function movingFittings(K, time) {
  const [x,y] = carriage(time).map(Math.round);
  const [p] = plunger(time).map(Math.round);
  return image(K,[
    fill(16,[[x-8,y-9],[x-1,y-14],[x+10,y-14],[x+16,y-8],[x+16,y+6],[x+7,y+9],[x-7,y+7]]),
    fill(19,[[x-6,y-7],[x-1,y-12],[x+9,y-12],[x+13,y-8],[x+13,y+4],[x+6,y+6],[x-6,y+5]]),
    rect(20,x-6,y-6,19,3),rect(22,x-5,y-6,16,1),rect(21,x-5,y-2,4,7),
    pixel(23,x+9,y-8),pixel(16,x+9,y-7),rect(18,x+3,y,8,3),rect(21,x+4,y+1,6,1),
    rect(24,p+3,123,W-p-4,7),rect(4,p+5,124,W-p-5,1),rect(2,p+4,125,W-p-4,2),
    fill(16,[[p-4,119],[p-1,116],[p+5,116],[p+8,120],[p+8,131],[p+4,136],[p-1,136],[p-4,133]]),
    rect(19,p-2,118,7,15),rect(22,p,118,1,15),rect(20,p+2,120,2,12),
    rect(18,p+5,120,2,12),pixel(23,p+1,120),pixel(21,p+1,131)
  ]);
}

function copyPaint(target, source) {
  for (let i=0; i<source.length; i+=4) {
    if (source[i+3]) target.set(source.subarray(i,i+4),i);
  }
}

function makeStudy(K,seed) {
  const base = lockhouse(K,seed), fixed = mechanisms(K), pump = makePump(K);
  return time => {
    const rgba = new Uint8Array(base);
    copyPaint(rgba,fixed);
    for (const chain of [pump.hose,pump.bellows]) {
      const frame = chain.render({ width:W,height:H,time });
      copyPaint(rgba,frame.rgba);
    }
    copyPaint(rgba,movingFittings(K,time));
    return { w:W,h:H,rgba };
  };
}

module.exports = ({ KIT, makeBuilder }) => ({
  id:'jointed-sprite-chains',name:'Tidegate Pump',seed:79,
  build(seed) {
    const render = makeStudy(KIT,seed);
    return makeBuilder(seed,[0x121d27]).finish({
      look:{ composite:{ world:{resolution:[8,8]},layers:[{
        resolution:[W,H],filter:'nearest',source:({time,sceneTime=time})=>render(Math.max(0,sceneTime))
      }] } }
    });
  }
});
module.exports.makePump = makePump;
module.exports.dimensions = [W,H];
