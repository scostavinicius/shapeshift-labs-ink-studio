/* Signal at Aster Ridge. A night ride built from painted ribbons and size-specific props. */
const { line, fill, rect, pixel } = require('./pixel-stamp-studies.js');
const W = 240, H = 144;
const colors = [
  '#101221','#181b31','#22263f','#2f344e','#404463','#525578','#69688b','#8980a0',
  '#af859b','#d7939d','#ecc3b3','#fff0ce','#172934','#243a46','#335161','#476c76',
  '#696266','#978077','#ba9a7e','#e5b489','#612b43','#a83c51','#e96160','#ffb77d',
  '#0d1921','#1f2838','#2d4656','#4d7177','#6d9592','#9db4a0'
];
const propColors = ['#101221','#253344','#364c5c','#59747a','#a28173','#612b43','#b23d50','#f36259','#ffb77d','#fff0ce'];
const image = (width,height,strokes,palette=colors) => ({width,height,strokes,palette});
const cel = (minPixels,rows) => ({
  minPixels,native:true,paint:{width:rows[0].length,height:rows.length,rows,palette:propColors}
});
const signals = [
  cel(0,['.7.','262','.1.','.2.','.1.','001']),
  cel(8,['.666.','26872','.676.','..2..','..3..','..2..','..2..','.122.','.101.']),
  cel(12,['..333..','.36663.','2698872','.67876.','..565..','...3...','...2...','...3...','...2...',
    '...2...','...3...','..122..','..220..','.11101.']),
  cel(19,['...2332..','..355552.','.35666651','.56888751','269988761','.57887651','..566652.',
    '...3552..','....3....','....2....','....3....','....3....','....2....','....2....','....3....',
    '...122...','...222...','..12201..','..11101..','..10001..']),
  cel(28,['....12221....','...2355531...','..235665531..','.23567766531.','.35678876631.','2367998876531',
    '.35789977631.','.35678876531.','..356776531..','...3565531...','....35531....','.....232.....',
    '......3......','......3......','......2......','......3......','......2......','......3......',
    '......3......','......2......','......3......','......2......','......3......','.....233.....',
    '.....233.....','....12321....','....12221....','...1122201...','...1122001...','...1112001...'])
];

function ballast(K, seed) {
  const strokes = [rect(12,0,0,48,32),rect(13,0,0,5,32),rect(13,43,0,5,32)];
  for (let i=0;i<170;i++) {
    const x = Math.floor(K.hash(i,seed,11)*48), y = Math.floor(K.hash(i,seed,17)*32);
    strokes.push(rect(13+Number(i%7===0),x,y,1+i%3,1));
  }
  for (const row of [0,8,17,25]) {
    strokes.push(rect(0,4,row,40,4),rect(16,5,row,38,2),rect(17,6,row,35,1));
    for (const x of [8,14,22,30,39]) strokes.push(pixel(5,x+(row%3),row+1));
  }
  for (const x of [10,35]) strokes.push(rect(24,x-2,0,6,32),rect(18,x,0,2,32),
    rect(x===10?19:17,x,0,1,32),rect(16,x+2,0,1,32));
  return image(48,32,strokes);
}

function rock(K,seed) {
  const strokes = [rect(1,0,0,30,32),rect(2,0,0,5,32),rect(3,0,0,2,32),rect(25,23,0,7,32)];
  for (let i=0;i<120;i++) {
    const x=Math.floor(K.hash(seed,i,1)*30), y=Math.floor(K.hash(seed,i,4)*32);
    strokes.push(rect(i%6?2:3,x,y,1+i%4,1));
  }
  for (const y of [2,12,22]) strokes.push(line(4,[[1,y],[4,y],[6,y+1],[8,y+1]]),
    pixel(16,2,y),pixel(3,12,y+2));
  return image(30,32,strokes);
}

function stripe() {
  return image(8,12,[rect(12,0,0,8,12),rect(14,1,0,1,12),rect(13,5,0,3,12),
    rect(3,6,2,2,2),pixel(15,5,2),rect(4,6,8,2,1)]);
}

function gantry() {
  return image(77,42,[
    fill(0,[[1,42],[4,14],[11,5],[20,1],[58,1],[68,5],[73,13],[76,42],[69,42],[66,16],
      [62,12],[15,12],[11,17],[9,42]]),
    line(15,[[3,39],[6,17],[11,9],[21,4],[57,4],[65,8],[70,14],[73,39]]),
    line(13,[[7,29],[9,16],[14,10],[62,10],[67,17],[69,25]]),
    line(4,[[12,7],[22,3],[58,3],[64,5]]),
    rect(0,29,7,21,12),rect(13,31,8,17,8),rect(16,32,8,15,1),rect(1,32,10,15,5),
    rect(15,33,12,3,2),rect(14,38,12,3,2),rect(20,43,12,3,2),pixel(22,44,12),
    rect(16,5,33,3,2),rect(17,70,33,3,2)
  ]);
}

function barrier() {
  return image(13,17,[
    rect(0,1,3,2,14),rect(0,9,3,2,14),rect(0,0,5,13,5),rect(16,0,5,13,2),
    rect(3,0,8,13,2),rect(2,2,7,2,4),rect(2,10,7,2,4),rect(20,2,5,3,2),
    pixel(22,3,5),rect(20,9,5,3,2),pixel(22,10,5)
  ]);
}

function makeRoute(K,seed) {
  const points = K.curve.spline([
    [0,0,0],[0,.25,10],[1,.8,22],[1,5,35],[-2,7.4,44],[-6,5.4,54],[-6,1.2,65],
    [-1,1.1,76],[7,2.2,89],[8,5.4,105],[2,6.1,116],[-5,3,130],[-8,.8,151]
  ],8);
  const path = K.procedural.routes.polyline(points);
  const signal = (id,z,offset,height) => ({
    id,distance:path.closest([0,0,z]).t*path.length,offset,height,sizes:signals
  });
  const props = [
    signal('first-signal',49,3.6,4.6), signal('lower-signal',68,-3.6,5.1),
    signal('switch-signal',91,3.8,4.6), signal('distant-signal',117,-3.6,5),
    {id:'gantry',distance:62,offset:0,height:6.8,sizes:[{paint:gantry()}]}
  ];
  const plank = barrier(), sameCel = [{paint:plank}];
  for (let i=0;i<11;i++) {
    const distance=16+i*11.1, offset=9.1*(i%3===2?1:-1);
    props.push({id:'guard-'+i,distance,offset,height:1.56,sizes:sameCel});
  }
  const bed=ballast(K,seed), edge=rock(K,seed), curb=stripe();
  return K.procedural.routes.projected.create({
    path,width:[[0,28],[31,28],[57,32],[85,29],[145,28]],
    strips:[
      {id:'track',across:[-.26,.26],paint:bed,repeat:6.4},
      {id:'left-shoulder',across:[-.39,-.26],paint:curb,repeat:5},
      {id:'right-shoulder',across:[.26,.39],paint:curb,repeat:5},
      {id:'left-scree',across:[-1,-.39],lift:[-.75,0],paint:edge,repeat:14.5},
      {id:'right-scree',across:[.39,1],lift:[0,-.75],paint:edge,repeat:11.7}
    ],props
  });
}

function scenery(K, seed, yaw, pitch) {
  const commands = [], panorama = yaw*57, horizon = Math.round(65+pitch*126);
  const skyline = (offset, scale, a, b) => x => horizon+offset-Math.round(scale*(
    .4*Math.sin((x+panorama)*a)+.36*Math.cos((x+panorama)*b)+.24*Math.sin((x+panorama)*.08)
  ));
  const far=skyline(-7,28,.025,.013), middle=skyline(17,23,.028,.008), near=skyline(39,18,.04,.024);
  for (let y=0;y<H;y++) {
    const blend = K.clamp(y/Math.max(1,horizon),0,1);
    const band = Math.min(8,1+Math.floor(blend*8));
    commands.push(rect(band,0,y,W,1));
  }
  const moonX = Math.round(176-panorama*.66), moonY=Math.round(horizon-36);
  for (let y=-9;y<=9;y++) {
    const radius = Math.floor(Math.sqrt(91-y*y));
    commands.push(rect(y<1?11:10,moonX-radius,moonY+y,2*radius+1,1));
  }
  for (let i=0;i<80;i++) {
    const x=Math.floor(K.hash(i,seed,30)*315-panorama*.62), y=Math.floor(K.hash(i,seed,32)*(horizon-10));
    if (Math.hypot(x-moonX,y-moonY)>14) commands.push(pixel(i%9===0?10:7,x,y));
  }
  for (const [y,span] of [[7,56],[1,36],[-7,74],[-20,23]]) {
    const x=Math.round(192-span/2-panorama*.8);
    commands.push(rect(8,x,moonY+y,span,1),rect(7,x-7,moonY+y+1,span+16,2));
  }
  for (let x=0;x<W;x++) {
    const a=far(x), b=middle(x), c=near(x);
    commands.push(rect(5,x,a,1,H-a),rect(4,x,b,1,H-b),rect(2,x,c,1,H-c));
  }
  for (let i=0;i<116;i++) {
    const x=Math.floor(K.hash(i,seed,51)*329-panorama);
    const y=Math.round(middle(x)+7+K.hash(i,seed,59)*19), height=1+i%5, width=2+i%5;
    if (y+height>=near(x)) continue;
    commands.push(rect(3,x,y,width,height),rect(i%9===0?18:16,x+1,y+1,i%5===0?3:1,1));
    if (i%13===0) commands.push(pixel(22,x,y),pixel(17,x+2,y+2));
  }
  return K.pixelStamps.image(image(W,H,commands)).rgba;
}

function makeStudy(K,seed) {
  const route=makeRoute(K,seed);
  function render(time) {
    const distance=8+K.clamp(time,0,8)*7.7;
    const at=route.sample(distance,{elevation:3.15}).point;
    const forward=route.sample(distance+21).point;
    const target=[forward[0],at[1]-.42,forward[2]];
    const yaw=Math.atan2(target[0]-at[0],target[2]-at[2]);
    const pitch=Math.atan2(at[1]-target[1],Math.hypot(target[0]-at[0],target[2]-at[2]));
    const frame=route.render({width:W,height:H,time,camera:{at,target,fov:1.03,far:148}});
    const rgba=scenery(K,seed,yaw,pitch);
    for (let i=0;i<frame.ids.length;i++) {
      if (!frame.ids[i]) continue;
      const p=i*4, depth=frame.depth[i];
      rgba.set(depth>100 ? [58,54,77,255] : frame.data.subarray(p,p+4),p);
    }
    return {w:W,h:H,rgba,route:frame};
  }
  return {route,render};
}

module.exports = ({ KIT:K, makeBuilder }) => ({
  id:'projected-routes',name:'Signal at Aster Ridge',seed:39,
  build(seed) {
    const study=makeStudy(K,seed);
    return makeBuilder(seed,[0x101221]).finish({
      look:{composite:{world:{resolution:[8,8]},layers:[
        {source:({time})=>study.render(time),resolution:[W,H],filter:'nearest'}
      ]}}
    });
  }
});
module.exports.makeStudy = makeStudy;
