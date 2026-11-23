/* The Lantern Archive. An illustrated tilemap, sliding copper shutter and four moth views. */
const { line, fill, rect, pixel } = require('./pixel-stamp-studies.js');
const W = 216, H = 136;
const palette = [
  '#0c1520','#12212b','#192f38','#25404a','#35555c','#507277','#729388','#a1b5a0',
  '#211921','#3a2931','#593e41','#85564e','#b17a5d','#d69e72','#f2c38a','#ffe4ad',
  '#1a2b38','#243f50','#325665','#477985','#60a4a1','#81c7b6','#a7e0c7','#d7ecda',
  '#401e32','#6f2f42','#a24748','#d46a53','#ff9d61','#ffd093'
];
const image = (width,height,strokes) => ({width,height,strokes});
const map = [
  '#############',
  '#....L.A....#',
  '#...........#',
  '#...........#',
  '#...........#',
  '#AL##J.J##LA#',
  '#...........#',
  '#...........#',
  '#...........#',
  '#...........#',
  '#############'
];

function limestone(K,seed) {
  const paint = [rect(2,0,0,40,56),rect(3,0,4,40,44),rect(1,0,50,40,6)];
  for (const [i,y] of [4,13,22,34,44].entries()) {
    paint.push(rect(4,0,y,40,1),rect(2,0,y+7,40,2));
    for (const x of i%2 ? [11,30] : [1,19,39])
      paint.push(rect(2,x,y,1,8),rect(4,x+1,y+1,1,5));
  }
  for (let i=0;i<105;i++) {
    const x=Math.floor(K.hash(i,seed,2)*40),y=5+Math.floor(K.hash(i,seed,3)*43);
    paint.push(rect(i%10===0?5:i%3===0?2:4,x,y,1+i%3,1));
  }
  paint.push(rect(1,0,0,40,3),rect(4,0,3,40,1),rect(4,0,49,40,1),rect(3,0,54,40,1),
    pixel(5,7,12),pixel(5,29,39));
  return paint;
}

function archiveTile(K,seed,kind) {
  const paint=limestone(K,seed);
  if (kind==='jamb') {
    paint.push(
      rect(1,5,2,30,51),rect(10,7,2,26,51),rect(11,9,3,22,48),
      rect(10,12,5,16,44),rect(3,14,6,12,43),
      rect(12,8,3,2,47),rect(12,30,3,1,47),rect(13,11,5,1,43),rect(9,28,5,1,44),
      rect(11,16,10,8,35),rect(12,17,10,2,35),rect(10,21,10,2,35),
      rect(13,12,7,16,2),rect(13,12,46,16,2),rect(8,7,51,26,3));
  } else if (kind==='books') {
    paint.push(rect(1,3,6,34,43),rect(10,4,7,32,41),rect(0,6,9,28,37));
    for (const y of [17,28,39]) {
      paint.push(rect(9,5,y,30,3),rect(12,6,y,28,1));
      for (let n=0;n<7;n++) {
        const h=3+(n*7+y)%5;
        paint.push(rect([17,4,10,3,5,11,18][n],7+n*4,y-h,3,h),pixel(n%4?6:12,7+n*4,y-2));
      }
    }
    paint.push(line(14,[[5,9],[5,42]]),line(13,[[6,7],[34,7]]),rect(11,13,43,13,2),rect(16,13,46,14,1));
  } else if (kind==='lamp') {
    paint.push(fill(4,[[5,34],[8,18],[14,9],[24,8],[32,15],[35,33],[28,45],[14,46]]),
      fill(5,[[10,32],[11,21],[17,13],[24,13],[30,23],[29,36],[22,42],[16,40]]),
      rect(1,15,15,11,26),rect(10,16,20,9,15),rect(11,18,22,5,11),
      rect(12,17,21,7,13),rect(28,18,23,5,9),rect(14,19,24,3,7),rect(15,20,25,1,5),
      rect(13,17,20,7,1),rect(13,17,34,7,1),rect(10,17,35,7,3),
      pixel(29,19,24),pixel(7,14,17),pixel(6,26,37));
  }
  return image(40,56,paint);
}

function shutter() {
  return image(48,64,[
    rect(8,0,0,48,64),rect(10,1,2,46,58),rect(9,4,4,40,56),rect(10,8,8,32,48),
    rect(9,11,10,26,44),rect(11,2,3,1,55),rect(12,4,5,2,54),rect(11,44,4,2,54),
    rect(12,6,10,2,44),rect(8,9,9,1,48),rect(11,40,9,1,48),
    rect(13,6,7,35,1),rect(8,6,57,35,2),rect(12,6,56,35,1),
    fill(8,[[23,10],[34,20],[38,31],[36,40],[24,53],[13,43],[9,31],[12,21]]),
    fill(10,[[23,13],[32,22],[35,31],[31,41],[24,49],[16,41],[12,31],[16,21]]),
    fill(16,[[23,16],[29,22],[32,31],[28,39],[24,46],[17,38],[15,31],[19,22]]),
    line(12,[[23,14],[20,21],[15,31],[19,40],[23,46]]),
    line(11,[[24,16],[29,23],[32,31],[28,40],[25,46]]),
    fill(18,[[24,21],[30,31],[24,42],[18,31]]),
    fill(20,[[24,24],[28,31],[24,38],[20,31]]),
    fill(22,[[24,27],[26,31],[24,35],[22,31]]),pixel(23,24,31),
    rect(11,12,12,3,2),rect(11,34,12,3,2),rect(11,12,51,3,2),rect(11,34,51,3,2),
    pixel(13,13,12),pixel(13,35,12),pixel(13,13,51),pixel(13,35,51),
    rect(9,1,0,46,2),rect(9,0,61,48,3)
  ]);
}

function floorTile(K,seed) {
  const marks = [rect(2,0,0,32,32),rect(1,0,0,32,1),rect(1,0,16,32,1),
    rect(1,0,0,1,16),rect(1,16,16,1,16),rect(3,1,1,31,1),rect(3,1,17,31,1),
    rect(3,1,1,1,15),rect(3,17,17,1,15)];
  for (let i=0;i<41;i++) {
    const x=Math.floor(K.hash(i,seed,12)*30)+1, y=Math.floor(K.hash(i,seed,13)*28)+2;
    if (y!==16 && y!==17) marks.push(rect(i%8===0?4:i%2?2:3,x,y,1+i%3,1));
  }
  marks.push(pixel(5,2,2),pixel(5,18,18));
  return image(32,32,marks);
}

function frontWings(delta,back) {
  const w=25, k=delta;
  const wing = sign => {
    const p=(x,y)=>[w+sign*x,y];
    return [
      fill(0,[p(2,20),p(10,12),p(19,5+k),p(24,4+k),p(24,10+k),p(22,17),p(19,23),
        p(23,27),p(22,33),p(17,38),p(11,39),p(6,33),p(2,27)]),
      fill(17,[p(2,22),p(10,14),p(22,6+k),p(21,16),p(17,23),p(21,27),p(20,33),
        p(16,36),p(11,37),p(7,31)]),
      fill(19,[p(4,22),p(12,13),p(20,8+k),p(19,16),p(14,25),p(20,28),p(18,32),p(12,34),p(8,29)]),
      fill(21,[p(6,21),p(13,13),p(19,9+k),p(17,16),p(12,22),p(10,23)]),
      fill(back?5:18,[p(12,19),p(17,17),p(15,23),p(11,25),p(8,24)]),
      fill(back?7:12,[p(11,24),p(15,23),p(14,27),p(10,29),p(8,27)]),
      line(22,[p(16,12),p(19,9+k),p(21,8+k)]),
      line(20,[p(8,31),p(11,34),p(15,33),p(18,30)]),
      line(3,[p(5,24),p(9,23),p(16,20),p(19,15)]),
      pixel(22,...p(16,27)),pixel(14,...p(10,26)),pixel(6,...p(19,31))
    ];
  };
  return [...wing(-1),...wing(1)];
}

function sideWings(delta,sign) {
  const p=(x,y)=>[25+sign*x,y],k=delta;
  return [
    fill(0,[p(-3,20),p(-15,12),p(-22,7+k),p(-20,16),p(-19,23),p(-22,28),p(-16,34),p(-11,37),p(-3,29)]),
    fill(17,[p(-5,20),p(-17,12),p(-20,10+k),p(-18,21),p(-19,30),p(-13,34),p(-7,28)]),
    fill(0,[p(1,18),p(10,13),p(17,4+k),p(21,5+k),p(21,16),p(18,24),p(20,30),p(17,35),
      p(10,39),p(4,34),p(2,27)]),
    fill(18,[p(3,19),p(11,14),p(19,6+k),p(19,15),p(15,24),p(18,30),p(15,34),
      p(10,36),p(6,32),p(4,26)]),
    fill(20,[p(5,20),p(12,14),p(18,8+k),p(17,16),p(13,24),p(16,30),p(13,33),p(9,33),p(7,28)]),
    fill(21,[p(9,19),p(14,13),p(17,10+k),p(16,15),p(11,21),p(9,22)]),
    fill(12,[p(9,23),p(14,20),p(13,26),p(10,29),p(8,28)]),
    line(22,[p(13,14),p(17,10+k),p(19,8+k)]),line(19,[p(8,30),p(10,33),p(15,32)]),
    pixel(14,...p(11,24)),pixel(7,...p(15,29))
  ];
}

function mothCel(view,delta) {
  const back=view==='back', side=view==='west'?-1:view==='east'?1:0;
  const tip=side*2;
  return [
    ...(side?sideWings(delta,side):frontWings(delta,back)),
    fill(0,[[21,20],[25,16],[29,20],[31,27],[29,33],[25,38],[21,34],[19,28]]),
    fill(9,[[22,20],[25,18],[28,21],[29,26],[27,32],[25,35],[22,33],[21,27]]),
    fill(11,[[23,23],[26,22],[28,25],[26,29],[25,33],[23,31],[22,28]]),
    fill(back?18:10,[[21+tip,19],[22+tip,15],[25+tip,12],[28+tip,15],[29+tip,19],[26+tip,23],[23+tip,22]]),
    line(13,[[23+tip,16],[25+tip,14],[27+tip,16]]),
    line(11,[[23+tip,14],[21+tip,10],[19+tip,8]]),line(12,[[27+tip,14],[29+tip,10],[32+tip,8]]),
    pixel(13,19+tip,8),pixel(14,32+tip,8),
    ...(back ? [line(20,[[24,18],[25,20],[27,20]]),pixel(21,24,22)] :
      [pixel(27,23+tip,18),pixel(27,27+tip,18),pixel(29,side?26+tip:23,18),pixel(14,25+tip,21)])
  ];
}

function lamp() {
  return image(13,25,[
    fill(0,[[2,23],[4,21],[5,12],[1,8],[1,3],[4,1],[9,1],[12,4],[11,9],[8,12],[9,21],[11,23],[11,25],[2,25]]),
    rect(10,5,10,3,13),rect(12,6,12,1,11),rect(9,3,22,7,2),
    fill(10,[[2,4],[4,2],[9,2],[11,5],[10,8],[8,11],[5,11],[2,8]]),
    rect(13,4,3,5,6),rect(28,5,4,3,4),pixel(15,6,5),pixel(12,5,10),pixel(14,4,22)
  ]);
}

function shade() {
  // Several colors share each authored near-to-far family.
  const ramps = {};
  for (const family of [[0,1,2,3,4,5,6,7],[8,9,10,11,12,13,14],[0,16,17,18,19,20,21,22,23],
    [24,25,26,27,28,29]]) {
    for (const [i,id] of family.entries())
      ramps[id]=[0,1,2,3,4].map((shift)=>family[Math.max(0,i-shift)]);
  }
  delete ramps[15]; delete ramps[23]; delete ramps[29];
  return {distances:[1.7,3.4,5.8,9],sideBias:{x:1},ramps};
}

const mix = (a,b,t) => a+(b-a)*t;
const ease = t => t*t*(3-2*t);
const clamp = v => Math.max(0,Math.min(1,v));
const doorCell = [6,5];
const doorOpen = time => ease(clamp((time-.72)/2.97));
const shots = [
  [0,6.18,8.72,6.52,4.08],[1.6,6.38,7.64,6.49,4.08],[3.2,6.42,6.46,6.46,4.08],
  [4.45,6.47,5.21,6.42,3.68],[5.42,7.21,4.88,6.24,3.63],[6.45,8.03,4.23,6.13,3.47],
  [7.4,8.12,3.59,6.00,3.34]
];
function camera(time) {
  const i=shots.findIndex((frame,i)=>i<shots.length-1 && time<shots[i+1][0]);
  const a=shots[i<0?shots.length-2:i],b=shots[i<0?shots.length-1:i+1];
  const t=clamp((time-a[0])/(b[0]-a[0]));
  const [x,z,lookX,lookZ]=a.slice(1).map((v,i)=>mix(v,b[i+1],t));
  return {at:[x,.79+.025*Math.sin(time*3.2),z],yaw:Math.atan2(lookX-x,lookZ-z),fov:1.14,far:22};
}

function makeArchive(K,seed) {
  const wings=['front','east','back','west'].map((view,i)=>({yaw:i*Math.PI/2,
    paint:{width:51,height:43,frames:[-1,-4,-1,2,4,2].map((delta,index)=>({
      duration:index===1?.13:.09,strokes:mothCel(view,delta)
    }))}}));
  const lantern=lamp();
  return K.tileRaycaster.create({map,palette,wallHeight:1.55,shade:shade(),
    tiles:{
      '#':{paint:archiveTile(K,seed)}, J:{paint:archiveTile(K,seed+12,'jamb')},
      A:{paint:archiveTile(K,seed+5,'books')}, L:{paint:archiveTile(K,seed+7,'lamp')}
    },
    floor:floorTile(K,seed),ceiling:image(32,32,[rect(1,0,0,32,32),rect(2,0,0,32,6),
      rect(0,0,7,32,2),rect(3,0,5,32,1),rect(2,13,7,1,25),rect(0,14,8,1,23),
      pixel(4,4,4),pixel(4,25,4)]),
    doors:[{id:'copper-shutter',at:doorCell,axis:'z',slide:'positive',open:doorOpen,paint:shutter()}],
    sprites:[
      {id:'paper-moth',at:t=>[6.46-.56*ease(clamp((t-3.5)/3)),.23+.055*Math.sin(t*4.6),3.52+.08*Math.sin(t*2.1)],
        height:.99,yaw:.08,views:wings},
      ...[[5.4,6.44],[7.61,6.44],[4.4,2.62],[8.6,2.62]].map(([x,z],i)=>
        ({id:'votive-'+i,at:[x,0,z],height:.64,views:[{paint:lantern}]}))
    ]});
}

module.exports = ({KIT:K,makeBuilder}) => ({
  id:'tile-raycaster',name:'The Lantern Archive',seed:22,
  build(seed) {
    const archive=makeArchive(K,seed);
    return makeBuilder(seed,[0x0c1520]).finish({
      look:{composite:{world:{resolution:[8,8]},layers:[{
        resolution:[W,H],filter:'nearest',
        source:({time})=>K.renderOutputs.image(archive.render({width:W,height:H,camera:camera(time),time}))
      }]}}
    });
  }
});
module.exports.makeArchive=makeArchive;
module.exports.camera=camera;
module.exports.dimensions=[W,H];
module.exports.layout={map,doorCell,doorOpen,duration:shots.at(-1)[0]};
