/* The Rain Court. Painted glasshouse planes over a rain-dark stage. */
const { rect,fill,line,pixel } = require('./pixel-stamp-studies.js');
const W=256,H=152, period=8, tau=2*Math.PI;
const palette=[
  '#0c1521','#142330','#1e303b','#29434c','#375962','#51717b','#6c8c8a','#8fac9e',
  '#12312f','#204740','#2e5c4e','#47775e','#6b9e7a','#8fb08b','#aac593','#d3d5a0',
  '#272131','#413141','#62404c','#80534f','#a66852','#c78b61','#e8ac73','#f3c487','#ffe0a0',
  '#202d4b','#354365','#505679','#6e6784','#87768a','#b18c99','#dbad9f',
  '#c1e0bc','#e9edd0','#233d3b','#3a444b','#546268','#77706b','#a18878'
];
const image=(width,height,strokes)=>({width,height,strokes,palette});
const border=(slot,x,y,w,h)=>[rect(slot,x,y,w,1),rect(slot,x,y+h-1,w,1),rect(slot,x,y,1,h),rect(slot,x+w-1,y,1,h)];

function sky(K,seed) {
  const marks=[];
  const w=320,h=118;
  for (let y=0;y<h;y++) {
    const color=y<26?25:y<45?26:y<62?27:y<79?28:y<90?29:30;
    marks.push(rect(color,0,y,w,1));
  }
  for (const [x,y,w,h] of [[0,52,67,3],[134,39,56,3],[216,47,95,2],[232,32,62,2],[4,27,61,2],[143,65,69,3]]) {
    marks.push(rect(27,x,y,w,h),rect(28,x+5,y+h,w-12,1));
  }
  const moonX=244, moonY=37;
  for (let y=-12;y<=12;y++) {
    const s=Math.floor(Math.sqrt(151-y*y));
    marks.push(rect(y<-4?33:y<7?24:31,moonX-s,moonY+y,2*s+1,1));
  }
  marks.push(rect(28,moonX-13,moonY-2,35,1),rect(29,moonX-8,moonY-1,22,1),rect(28,moonX+3,moonY+7,23,2));
  for(let i=0;i<90;i++) {
    const x=Math.floor(K.hash(i,seed,2)*w),y=Math.floor(K.hash(i,seed,9)*66);
    if(Math.hypot(x-moonX,y-moonY)>15) marks.push(pixel(i%17===0?31:29,x,y));
  }
  marks.push(fill(26,[[0,90],[24,76],[51,81],[78,68],[99,80],[135,73],[166,84],[195,70],[221,76],
    [248,66],[272,78],[295,73],[320,81],[320,118],[0,118]]),
    fill(25,[[0,103],[21,87],[47,94],[67,80],[101,94],[126,82],[147,93],[181,83],[209,100],
      [229,85],[258,98],[281,81],[320,100],[320,118],[0,118]]));
  return image(w,h,marks);
}

function glasshouse(K,seed) {
  const w=322,h=101;
  const marks=[
    fill(0,[[0,97],[0,31],[9,27],[19,23],[33,23],[51,10],[69,10],[82,20],
      [118,20],[138,11],[144,3],[178,3],[185,12],[200,20],[238,20],[254,10],[273,10],
      [290,23],[307,23],[322,33],[322,101],[0,101]]),
    rect(2,0,37,w,52),rect(4,0,40,w,2),rect(3,0,91,w,7),
    line(20,[[0,31],[19,24],[33,24],[51,11],[68,11],[82,21],[119,21],[139,12],
      [145,4],[177,4],[185,13],[200,21],[239,21],[254,11],[273,11],[290,24],[307,24],[322,33]])
  ];
  for (const [i,x] of [32,96,161,226,290].entries()) {
    const top=i===2?14:29, arch=[
      [x-28,93],[x-28,top+22],[x-24,top+12],[x-16,top+4],[x-7,top],[x+7,top],
      [x+16,top+4],[x+24,top+12],[x+28,top+22],[x+28,93]
    ];
    marks.push(fill(1,arch),fill(i===2?17:2,arch.map(([x0,y])=>[x+(x0-x)*.84,y+3])),
      line(19,arch,2),line(21,arch.slice(0,6)),line(4,arch.slice(5)),rect(8,x-22,69,44,20),
      fill(4,[[x-19,61],[x-5,top+13],[x+16,top+10],[x+11,top+15],[x-8,top+36],[x-17,66]]),
      fill(3,[[x-19,77],[x+18,top+27],[x+23,top+32],[x+19,top+37],[x-9,78]]),
      rect(3,x-13,top+10,1,83-top),rect(1,x+11,top+10,2,81-top),
      rect(1,x,top+3,3,90-top),rect(5,x-1,top+5,1,87-top),rect(4,x-25,top+38,50,2),
      rect(19,x-26,89,52,3),rect(20,x-23,89,45,1),
      rect(1,x-33,39,4,57),rect(21,x-33,43,1,47));
    for (let j=0;j<38;j++) {
      const xx=x-21+Math.floor(K.hash(j,seed+i,12)*43),yy=78+Math.floor(K.hash(j,seed+i,4)*10);
      marks.push(rect(j%3?8:10,xx,yy,1+j%4,1));
      if (j%10===0) marks.push(pixel(22,xx,yy-2));
    }
    marks.push(pixel(22,x-13,top+37),pixel(24,x,top+34),pixel(20,x+16,top+39));
  }
  marks.push(rect(1,0,96,w,5),rect(4,0,96,w,1));
  return image(w,h,marks);
}

function rail() {
  const strokes=[];
  const w=232,h=40;
  for (const y of [13,34]) strokes.push(rect(0,0,y,w,3),rect(19,0,y,w,1),rect(4,0,y+2,w,1));
  for (let i=0;i<=16;i++) {
    const x=3+14*i;
    strokes.push(rect(0,x,12,3,27),rect(4,x,16,1,20),pixel(21,x+1,13));
    if (i%4===0) strokes.push(fill(1,[[x-3,18],[x-4,9],[x,4],[x+4,9],[x+3,18]]),
      line(20,[[x-3,14],[x-3,9],[x,5],[x+3,9]]),pixel(23,x,9),rect(3,x-4,34,9,4));
  }
  return image(w,h,strokes);
}

function stone(K,seed) {
  const strokes=[rect(3,0,0,48,48),rect(1,0,0,48,2),rect(2,0,24,48,2),
    rect(2,0,0,2,25),rect(2,24,25,2,23),rect(4,2,2,45,1),rect(4,26,26,20,1)];
  for(let i=0;i<165;i++) {
    const x=2+Math.floor(K.hash(i,seed,2)*44),y=2+Math.floor(K.hash(i,seed,3)*44);
    if (y===24 || y===25 || x===24 && y>24) continue;
    strokes.push(rect(i%11===0?5:i%3===0?2:4,x,y,1+i%4,1));
  }
  for (const [x,y] of [[3,3],[27,27],[42,5],[5,44]]) {
    strokes.push(rect(6,x,y,2,1),pixel(5,x+3,y),pixel(1,x,y+1));
  }
  return image(48,48,strokes);
}

function wet() {
  return image(160,110,[
    fill(0,[[23,5],[42,7],[56,2],[81,5],[91,3],[108,6],[128,8],[135,15],[129,20],[135,28],
      [121,35],[125,42],[109,45],[98,48],[81,44],[67,45],[53,40],[44,42],[30,35],[24,38],
      [16,33],[26,27],[21,22],[13,18],[18,12]]),
    fill(0,[[1,3],[19,2],[14,9],[18,13],[5,16],[0,12]]),
    fill(0,[[144,13],[153,12],[158,17],[152,21],[138,20]]),
    fill(0,[[129,38],[145,37],[151,42],[143,48],[132,45]]),
    fill(0,[[37,48],[49,46],[57,48],[53,54],[39,54],[33,51]]),
    ...[[12,24,4],[143,28,6],[62,49,4],[112,54,9],[26,48,6],[111,48,3]].map(([x,y,w])=>rect(0,x,y,w,1))
  ]);
}

function lamp(hot) {
  const width=23,height=57;
  const frames=[0,1,2,1].map(phase=>{
    const glow=hot?[18,20,21,23,24]:[8,9,10,13,32];
    return {strokes:[
      fill(glow[0],[[0,13],[2,8],[6,5],[16,5],[20,10],[22,16],[21,24],[16,29],[7,29],[2,24]]),
      fill(glow[1],[[2,13],[6,8],[16,8],[20,14],[20,23],[15,27],[8,27],[4,23]]),
      fill(0,[[2,56],[3,53],[8,51],[9,27],[6,23],[4,20],[5,11],[9,6],[14,6],[18,11],
        [19,22],[15,27],[14,51],[20,53],[21,56]]),
      rect(19,10,25,3,29),rect(22,10,27,1,25),rect(17,7,51,9,3),rect(20,5,54,13,2),
      fill(glow[2],[[5,15],[7,10],[11,7],[15,10],[18,15],[18,22],[14,26],[9,26],[5,22]]),
      fill(glow[3],[[8,20],[8,phase+13],[11,phase+10],[14,phase+13],[15,19],[13,23],[10,23]]),
      rect(glow[4],10,phase+14,2,7-phase),pixel(33,11,phase+15),
      line(21,[[6,15],[8,10],[11,8],[15,11]]),rect(17,6,22,10,2),
      pixel(glow[3],8,12),pixel(22,8,54),pixel(20,11,45)
    ]};
  });
  return {width,height,palette,fps:7,frames};
}

function courier(reverse) {
  const flip=shape=>{
    const {slot,shape:part}=shape;
    if (!reverse) return shape;
    return {slot,shape:part.rect ? {...part,rect:[32-part.rect[0]-part.rect[2],...part.rect.slice(1)]} :
      {...part,points:part.points.map(([x,y])=>[32-x,y])}};
  };
  const dark=reverse?8:16, mid=reverse?9:18, main=reverse?10:19, light=reverse?12:21;
  const frames=[0,1,0,-1].map(stride=>({strokes:[
    fill(0,[[3,43],[7,34],[7,23],[11,18],[9,13],[11,8],[17,4],[22,9],[24,15],[19,21],
      [25,25],[29,33],[25,41],[22,45],[11,44],[5,46]]),
    fill(dark,[[6,42],[9,34],[10,23],[15,18],[19,18],[24,25],[27,33],[24,40],[21,43],[12,42],[8,45]]),
    fill(mid,[[8,42],[12,30],[12,20],[17,19],[20,23],[23,34],[24,40],[18,42],[10,45]]),
    fill(main,[[12,36],[14,24],[17,21],[19,24],[21,33],[20,39],[15,40],[11,43]]),
    line(light,[[9,39],[12,33],[13,27],[16,22]]),line(mid,[[18,24],[23,28],[23,35]]),
    fill(mid,[[10,13],[12,8],[17,5],[21,9],[23,15],[19,17],[13,18]]),
    fill(main,[[11,12],[14,8],[17,6],[20,9],[21,12],[16,11],[13,15]]),
    fill(20,[[16,13],[21,13],[22,16],[19,19],[16,18],[15,15]]),
    line(23,[[19,13],[21,14],[21,15]]),pixel(0,20,15),pixel(24,16,12),
    rect(0,12+stride,43,5,4),rect(0,20-stride,43,5,4),pixel(38,13+stride,45),pixel(37,21-stride,45),
    line(22,[[23,28],[26,30],[27,33]]),rect(17,25,32,5,6),rect(20,26,33,3,5),
    rect(23,27,34,2,3),pixel(24,27,34)
  ].map(flip)}));
  return {width:32,height:48,palette,fps:5,frames};
}

function makeCourt(K,seed) {
  return K.projectedStage.create({
    layers:[
      {id:'violet-sky',type:'upright',at:[-56,-11,40],size:[112,44],paint:sky(K,seed)},
      {id:'glass-arches',type:'upright',at:[-18,0,13],size:[36,8.2],paint:glasshouse(K,seed),reflect:true},
      {id:'iron-balustrade',type:'upright',at:[-13,0,8.2],size:[26,1.35],paint:rail(),reflect:true},
      {id:'slate-paving',at:[-16,0,-2.8],size:[32,26],paint:stone(K,seed),repeat:[2.2,2.4],
        reflection:{strength:.67,mask:wet(),tint:[.75,.94,1],ripple:{amplitude:1.4,frequency:.66,speed:.45}}},
      {id:'court-inlay',at:[-6.6,0,4.65],size:[13.2,.62],repeat:[2.2,.62],paint:image(42,8,[
        rect(1,0,0,42,8),rect(6,0,1,42,1),rect(5,0,6,42,1),rect(3,0,2,42,4),
        fill(20,[[1,4],[8,2],[21,3],[33,2],[40,4],[33,6],[21,5],[8,6]]),
        line(22,[[7,4],[15,3],[23,4],[32,3]]),...border(2,0,0,42,8)
      ])}
    ],
    props:[
      {id:'east-lantern',ground:'slate-paving',at:[4.25,4.3],height:3.95,paint:lamp(true)},
      {id:'west-lantern',ground:'slate-paving',at:[-4.8,3.72],height:4.03,paint:lamp(false)},
      {id:'amber-courier',ground:'slate-paving',at:t=>[-1.85+.58*Math.sin(t*tau/period),2.65],height:2.17,paint:courier(false)},
      {id:'jade-courier',ground:'slate-paving',at:t=>[1.83-.52*Math.sin(t*tau/period),2.9],height:2.12,paint:courier(true)}
    ]
  });
}

function camera(time) {
  const beat=time*tau/period;
  return {at:[1.42*Math.sin(beat-.78),2.30+.14*Math.cos(beat),-5.15+.31*Math.cos(beat)],
    yaw:.05*Math.sin(beat-.32),horizon:64+4*Math.cos(beat-.35),fov:1.04,far:80};
}

module.exports=({KIT:K,makeBuilder})=>({
  id:'projected-stage',name:'The Rain Court',seed:57,
  build(seed,{controls:{reflections=true}={}}={}) {
    const stage=makeCourt(K,seed);
    return makeBuilder(seed,[0x0c1521]).finish({
      look:{composite:{world:{resolution:[8,8]},layers:[{
        resolution:[W,H],filter:'nearest',
        source:({time})=>K.renderOutputs.image(stage.render({width:W,height:H,camera:camera(time),time,reflections}))
      }]}}
    });
  }
});
module.exports.makeCourt=makeCourt;
module.exports.camera=camera;
module.exports.dimensions=[W,H];
