/* Gale Signal. A red pennant has its own exposure while the lookout keeps moving. */
const { rect,fill,line,pixel } = require('./pixel-stamp-studies.js');
const W=232,H=144, tileW=86,tileH=64, period=3.2, bodyFps=10;
const palette=[
  '#172336','#25364e','#364e64','#54737e','#759a96','#a9bb9b','#d2d8b0','#fcdfae',
  '#242236','#473048','#743a50','#a14956','#d66558','#ed875d','#ffb075','#ffdf9c',
  '#384b4e','#56726a','#688883','#9aa78a','#603f45','#986151','#c78d65','#efd2a0',
  '#25233b','#3f3653','#594967','#795871','#a96f7c','#d7918b','#efa98f','#f5c793',
  '#453b4f','#66505c','#8e6370','#b07675','#d69886','#eab998'
];
const sprite=(K,width,height,strokes)=>K.pixelStamps.image({width,height,palette,strokes}).rgba;
const shift=(strokes,dx,dy)=>strokes.map(({slot,shape})=>({slot,shape:shape.rect?
  {...shape,rect:[shape.rect[0]+dx,shape.rect[1]+dy,...shape.rect.slice(2)]}:
  {...shape,points:shape.points.map(([x,y])=>[x+dx,y+dy])}}));
const wrap=t=>((t%period)+period)%period;

function scarf(pose) {
  // All coordinates are relative to the same four-pixel neck socket.
  const gestures={
    loose:[
      [[2,7],[8,5],[14,8],[19,13],[26,15],[32,14],[37,16],[33,19],[30,20],[22,19],
        [17,16],[12,11],[7,10],[3,11]],
      [[4,7],[9,6],[14,9],[19,14],[26,16],[32,15],[35,16],[30,18],[23,17],[18,15],[12,10],[7,9],[4,10]],
      [[6,7],[12,8],[16,11],[20,14],[24,15]],[[22,17],[26,18],[31,18]]
    ],
    hold:[
      [[2,7],[8,4],[16,4],[25,6],[32,4],[41,3],[47,6],[43,9],[40,9],[42,12],
        [35,11],[28,13],[21,14],[15,11],[9,10],[4,12]],
      [[4,7],[9,5],[16,5],[25,7],[33,5],[41,4],[45,6],[39,8],[38,10],[33,9],
        [26,12],[21,12],[15,9],[9,9],[5,10]],
      [[6,7],[12,6],[18,7],[23,8],[28,8],[32,7]],[[32,6],[38,5],[42,5]]
    ],
    cut:[
      [[1,8],[8,4],[17,3],[28,6],[37,5],[46,0],[55,0],[52,3],[57,4],[50,6],
        [45,10],[38,12],[32,11],[22,16],[15,18],[8,15],[3,13]],
      [[4,8],[9,5],[17,4],[28,7],[37,6],[47,1],[53,1],[48,5],[52,5],[44,9],
        [37,10],[31,9],[22,14],[15,16],[8,13],[5,12]],
      [[5,8],[10,6],[17,5],[27,8],[33,8],[39,6],[47,2],[51,2]],
      [[15,14],[21,13],[25,11],[30,11]]
    ],
    whip:[
      [[2,8],[9,5],[18,7],[26,13],[31,15],[40,15],[53,10],[57,10],[51,13],[55,14],
        [47,17],[39,21],[32,21],[25,18],[17,11],[9,10],[4,13]],
      [[4,8],[9,6],[17,8],[25,14],[32,17],[40,17],[52,12],[48,15],[51,15],
        [39,19],[33,19],[26,16],[17,10],[10,9],[5,11]],
      [[6,8],[10,7],[16,8],[20,10],[25,14],[32,17],[39,17],[46,15]],
      [[29,18],[34,19],[40,18]]
    ],
    drop:[
      [[2,7],[9,7],[16,11],[20,17],[25,20],[33,20],[38,23],[36,26],[29,26],
        [21,23],[15,19],[11,13],[6,11],[3,11]],
      [[4,8],[9,8],[15,12],[19,17],[25,22],[32,22],[36,23],[34,25],[28,24],[21,22],[16,18],[11,12],[6,10]],
      [[6,8],[10,9],[14,12],[20,19],[24,21]],[[25,23],[30,24],[33,24]]
    ]
  };
  const [shadow,cloth,bright,seam]=gestures[pose];
  const art=[fill(9,shadow),fill(11,cloth),line(12,bright,2),line(13,bright),
    line(10,seam),pixel(14,bright[1][0],bright[1][1]),pixel(9,3,11),pixel(14,5,8)];
  if (pose==='cut') art.push(line(10,[[13,19],[21,19],[31,15],[39,15],[48,12]]),
    line(12,[[20,18],[26,17],[31,15]]),line(13,[[47,8],[51,7],[55,5]]),pixel(14,56,5));
  if (pose==='whip') art.push(line(10,[[26,20],[35,24],[43,23],[51,19]]),
    line(12,[[41,22],[47,20],[53,17]]),pixel(13,55,17));
  return { strokes:art };
}

function pose(frame) {
  const beat=frame*Math.PI*2/(period*bodyFps);
  return { dx:Math.round(1.8*Math.sin(2*beat-.4)),dy:Math.round(1.7*Math.cos(2*beat)),
    arm:Math.round(2.6*Math.sin(beat+.4)), step:Math.round(2.5*Math.sin(2*beat-.2)) };
}

function lookout(frame) {
  const { dx,dy,arm,step }=pose(frame);
  const cloak=[
    fill(0,[[17,35],[32,33],[38,39],[39,43],[37,50],[30,56],[18,55],[13,51],[9,53],[10,46],[12,40]]),
    fill(1,[[17,36],[31,35],[36,40],[36,48],[30,54],[18,53],[13,49],[11,50],[13,42]]),
    fill(2,[[16,38],[22,36],[32,36],[35,41],[29,43],[27,48],[20,49],[15,52],[16,47],[13,47]]),
    fill(3,[[17,38],[23,37],[27,38],[22,41],[18,45],[15,46]]),
    line(4,[[17,38],[22,36],[28,37]]),line(0,[[15,51],[21,47],[28,48],[34,45]],2),
    line(5,[[23,47],[28,47],[33,44]]),pixel(7,26,47),pixel(22,31,46)
  ];
  const feet=[
    fill(0,[[16,49],[24,48],[24+step,58],[27+step,60],[27+step,62],[17+step,62],[15+step,59]]),
    line(2,[[20,51],[20+step,58],[24+step,60]],2),pixel(4,19+step,60),
    fill(0,[[27,47],[33,47],[33-step,56],[39-step,59],[39-step,61],[28-step,61],[26-step,57]]),
    line(2,[[30,51],[30-step,56],[35-step,59]],2),line(3,[[30-step,59],[36-step,59]])
  ];
  const hood=[
    fill(0,[[18,33],[12,29],[9,22],[11,13],[17,8],[24,7],[30,11],[34,15],[35,22],[33,27],[34,30],
      [28,35],[21,37]]),
    fill(1,[[17,32],[13,27],[11,22],[13,14],[18,10],[23,9],[30,12],[33,18],[32,24],[30,28],[32,30],[27,33]]),
    fill(2,[[12,20],[14,14],[18,11],[25,10],[31,14],[31,17],[28,17],[23,14],[17,16],[16,20]]),
    line(4,[[14,17],[16,13],[20,11],[24,11],[28,12]]),line(3,[[28,14],[30,17],[31,21]]),
    fill(0,[[13,21],[21,18],[28,19],[31,25],[26,30],[20,31],[16,29],[13,29],[10,26]]),
    fill(16,[[14,23],[19,20],[25,21],[28,24],[26,27],[19,29],[15,27]]),
    line(17,[[15,23],[19,21],[24,22],[26,24]]),line(6,[[16,24],[19,23],[22,23]]),
    rect(7,14+(frame%6===2?1:0),24,3,1),pixel(15,14,24),pixel(3,20,27),
    line(0,[[18,31],[22,33],[26,33],[31,30]],3),line(10,[[18,31],[22,32],[27,32],[32,30]],2),
    line(12,[[23,32],[28,32],[32,30]]),rect(10,33,24,5,6),line(13,[[31,26],[35,26],[37,25]]),
    pixel(14,36,25),pixel(15,36,26),pixel(3,11,20),line(21,[[22,9],[25,7],[28,9]]),pixel(7,25,7)
  ];
  const hand=[
    line(0,[[17,36],[14,40],[10,42+arm]],5),line(3,[[17,36],[14,39],[10,41+arm]],2),pixel(6,10,41+arm),
    line(21,[[9,42+arm],[7,43+arm],[7,45+arm],[11,45+arm],[11,43+arm]]),
    fill(0,[[6,45+arm],[12,45+arm],[14,50+arm],[12,55+arm],[6,55+arm],[4,50+arm]]),
    fill(21,[[7,46+arm],[11,46+arm],[13,50+arm],[11,54+arm],[7,54+arm],[5,50+arm]]),
    rect(13,7,48+arm,4,5),rect(15,8,48+arm,2,4),pixel(7,9,49+arm),
    rect(20,6,53+arm,6,1),pixel(22,12,49+arm)
  ];
  // The bake already contains a shorter rust scarf at every moving shoulder.
  const baked=shift([fill(9,[[2,6],[10,5],[19,7],[26,13],[32,15],[27,17],[20,15],[13,11],[7,9],[3,10]]),
    fill(10,[[5,7],[11,6],[18,8],[23,12],[29,15],[22,14],[17,11],[11,8],[5,9]]),
    line(11,[[8,7],[14,7],[19,9],[23,12]])],33+dx,18+dy);
  return [...baked,...feet,...shift([...cloak,...hood,...hand],dx,dy)];
}

function atlas(K,edited=true) {
  const count=Math.round(period*bodyFps), width=tileW*count, pixels=new Uint8Array(width*tileH*4);
  const frames=Array.from({length:count},(_,frame)=>{
    const rgba=sprite(K,tileW,tileH,lookout(frame));
    for (let y=0;y<tileH;y++) pixels.set(rgba.subarray(y*tileW*4,(y+1)*tileW*4),(y*width+frame*tileW)*4);
    return { frame,direction:0,duration:1/bodyFps,rect:{x:frame*tileW,y:0,width:tileW,height:tileH},
      pivot:{x:22,y:60} };
  });
  const maskPaint={strokes:[rect(0,2,0,57,28)]};
  const draw=(duration,name)=>({duration,paint:scarf(name),maskPaint});
  const cels={silhouettes:[{
    id:'Red pennant',direction:0,rect:[33,18,59,28],pin:[4,8],extensionDepth:.01,
    palette,period,anchors:frames.map(({frame})=>{
      const {dx,dy}=pose(frame);
      return {frame,at:[37+dx,26+dy]};
    }),
    frames:[draw(.70,'loose'), draw(.18,'hold'), {hold:1,duration:.52}, draw(.10,'cut'), draw(.10,'whip'),
      draw(.52,'drop'), draw(.64,'loose')]
  }]};
  return K.sprite.atlas({metadata:{width,height:tileH,fps:bodyFps,frames,...(edited&&{cels})},images:{color:pixels}});
}

function skyline(K,seed) {
  const marks=[];
  let top=0;
  for (const [slot,bottom] of [[25,12],[26,29],[27,44],[28,58],[29,72],[30,86],[31,H]]) {
    marks.push(rect(slot,0,top,W,bottom-top));
    top=bottom;
  }
  const sun=[173,63];
  for (let y=-19;y<=19;y++) {
    const side=Math.floor(Math.sqrt(385-y*y));
    marks.push(rect(y<8?15:31,sun[0]-side,sun[1]+y,side*2+1,1));
  }
  for (const [x,y,w,h,c] of [[8,30,42,4,27],[65,44,54,5,28],[136,39,40,4,27],[189,50,47,6,28],
    [2,61,69,4,29],[32,54,44,2,28],[112,56,59,3,29],[148,67,58,4,29],[151,72,54,2,30],
    [21,72,63,4,29],[182,82,45,3,30]]) {
    marks.push(fill(c,[[x,y+h],[x+4,y+h-2],[x+w*.38,y+h-2],[x+w*.42,y],[x+w-5,y],[x+w,y+2],
      [x+w*.79,y+2],[x+w*.83,y+h]]),rect(c,x-6,y+h-1,4,1),rect(c+1,x+w*.42,y+h+1,w*.42,1));
  }
  for (let i=0;i<45;i++) {
    const x=K.hash(i,seed,61)*W|0,y=K.hash(i,seed,19)*34|0;
    marks.push(pixel(i%9?27:29,x,y));
  }
  const hills=[
    [[0,92],[18,89],[34,91],[52,86],[63,88],[78,83],[102,89],[125,86],[142,93],[165,89],[190,92],[209,87],[232,88]],
    [[0,102],[11,99],[30,100],[42,95],[66,98],[77,94],[96,98],[115,94],[127,99],[150,99],[168,97],[188,101],[208,95],[232,93]]
  ];
  hills.forEach((ridge,i)=>marks.push(fill(34-i,[...ridge,[W,H],[0,H]])));
  for (const [x,y,w,h] of [[3,86,15,44],[21,95,18,39],[187,98,14,45],[203,84,15,60],[220,92,11,50]]) {
    marks.push(fill(25,[[x,y+7],[x+w*.46,y],[x+w*.58,y],[x+w,y+7],[x+w,y+h],[x,y+h]]),
      rect(32,x+1,y+10,w-2,h-11),rect(33,x+2,y+10,1,h-10),rect(29,x+w*.45,y+14,2,5),
      rect(28,x+w*.45,y+25,2,3),rect(24,x-1,y+h-11,w+2,3));
  }
  marks.push(fill(0,[[0,119],[27,111],[46,114],[56,109],[168,109],[184,114],[195,112],[232,123],[232,H],[0,H]]),
    fill(1,[[43,115],[59,111],[165,111],[181,116],[171,119],[55,119]]),
    fill(2,[[56,113],[60,111],[164,111],[175,114],[160,116],[59,116]]),
    line(4,[[58,111],[63,110],[164,110],[174,113]]),
    rect(16,53,119,125,3),rect(3,54,119,125,1),rect(17,52,126,129,2),
    rect(2,55,139,119,1),rect(2,70,128,97,15),rect(1,72,130,92,14));
  for (let i=0;i<78;i++) {
    const x=55+(K.hash(i,seed,3)*120|0), y=123+(K.hash(i,seed,4)*20|0);
    marks.push(rect(i%5?2:3,x,y,1+i%5,1));
  }
  for (const x of [61,157]) {
    marks.push(rect(0,x,107,9,24),rect(2,x+1,109,5,19),line(4,[[x+1,111],[x+1,109],[x+5,109]]),
      rect(2,x-2,129,12,3),rect(4,x-1,129,9,1));
  }
  return sprite(K,W,H,marks);
}

function study(K,edited=true) {
  return { atlas:atlas(K,edited),width:112,height:76,origin:[34,65],mode:'card',fps:20,count:64,
    title:'Gale Signal', note:'Scrub the wind-up and release. Select Red pennant to see its held cels aligned to the neck pin.',
    frame:28,zoom:4, silhouettes:edited?['Red pennant']:[],trackOrigin:[20,30] };
}

module.exports=({KIT:K,makeBuilder})=>({
  id:'silhouette-tracks',name:'Gale Signal',seed:41,
  build(seed,{controls:{edited=true}={}}={}) {
    const backdrop=skyline(K,seed), track=atlas(K,edited);
    const sky=K.sprite.atlas({metadata:{width:W,height:H,frames:[{rect:{x:0,y:0,width:W,height:H}}]},
      images:{color:backdrop}});
    return makeBuilder(seed,[0x25233b]).finish({
      cam:{target:[0,0,0],dist:7,yaw:0,pitch:0,sway:0,ortho:true},
      spriteAtlases:[
        {atlas:sky,mode:'card',nativePixels:true,lighting:false,at:[0,0,-2]},
        {atlas:track,mode:'card',nativePixels:true,lighting:false,at:[0,0,0],playback:'loop',
          pixelOffset:time=>[-20+Math.round(4*Math.sin(wrap(time)*Math.PI*2/period-.4)),38]}
      ],
      look:{pixelSize:1}
    });
  }
});
module.exports.study=study;
