/* Breakwater Relay. Two original pixel-art feeds and a live decoder comparison. */
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const ink = require('..');
const png = require('../cli/png.js');

function createStudy(K) {
  const P = K.procedural;
  const width = 448, height = 200, w = 208, h = 120, fps = 12, frames = 66;
  const left = 10, right = 230, top = 39, loss = 12, stopMotion = 25, lock = 49;
  const blockSize = [13, 12], columns = w / blockSize[0], rows = h / blockSize[1];
  const warmInk = ['#1b172b','#3c293e','#65404c','#954e50','#c46a59','#e89668','#ffd291','#ffedae'];
  const coldInk = ['#131d36','#1b2f49','#254763','#33607b','#48898e','#62adb0','#9fd2be','#d8efd1'];
  const ivory = '#e5ebce', mint = '#91ceb7', amber = '#f4b97b', violet = '#a397ce', muted = '#93a8b6';
  const rect = (x,y,w,h,fill) => ({type:'rect',rect:[x,y,w,h],fill});
  const polygon = (points,fill) => ({type:'polygon',points,fill});
  const line = (points,color,width=1) => ({type:'path',points,color,width});
  const text = (x,y,label,color,scale=1) => ({type:'text',at:[x,y],text:label,color,scale});
  const draw = (width,height,commands) => P.drawing2d.render({width,height,commands,edges:'hard'});
  const field = (channels, data) => ({width,height,channels,data});

  function atmosphere(cool) {
    const c = cool ? coldInk : warmInk;
    const bands = [13,27,41,54,65,80,95,120];
    const commands = bands.map((end,i) => {
      const y = bands[i-1] ?? 0;
      return rect(0,y,w,end-y,c[Math.min(i,5)]);
    });
    const [cx,cy,r] = cool ? [146,32,14] : [69,48,24];
    for (let y=-r;y<=r;y++) {
      const side=Math.floor(Math.sqrt(r*r-y*y));
      commands.push(rect(cx-side,cy+y,side*2+1,1,c[y>r*.5?6:7]));
    }
    const clouds = cool ? [[10,17,63,1],[80,31,60,2],[139,35,65,2],[111,49,78,3],[3,52,104,3],
      [64,54,101,3],[149,61,61,4]] : [[9,27,53,2],[28,42,65,3],[65,53,59,4],[31,63,85,5],
      [106,56,61,4],[138,34,62,3],[151,72,54,5]];
    for (const [x,y,n,s] of clouds) {
      commands.push(polygon([[x,y+3],[x+7,y+1],[x+n*.32,y+1],[x+n*.48,y],[x+n-8,y],[x+n,y+2],
        [x+n*.71,y+3],[x+n*.66,y+5],[x+4,y+5]],c[s]),rect(x+n+4,y+2,7,1,c[s]));
    }
    for (const [x,y] of [[9,9],[24,14],[43,8],[83,17],[105,10],[123,19],[172,12],[194,8]]) {
      commands.push(rect(x,y,1,1,c[cool?5:4]));
    }
    return commands;
  }

  function survey() {
    const c = warmInk, a = atmosphere(false);
    a.push(
      polygon([[0,90],[17,85],[27,88],[49,75],[61,77],[79,71],[93,71],[107,82],[126,82],
        [141,74],[157,76],[167,70],[180,71],[196,62],[208,64],[208,120],[0,120]],c[3]),
      polygon([[0,94],[10,95],[21,88],[33,93],[47,85],[61,84],[79,89],[100,86],[112,94],
        [136,94],[159,83],[178,86],[195,79],[208,80],[208,120],[0,120]],c[2]),
      polygon([[0,103],[15,100],[43,100],[71,97],[105,100],[126,96],[159,99],[188,94],[208,96],
        [208,120],[0,120]],'#513340'),
      polygon([[8,117],[35,111],[41,106],[65,104],[73,100],[85,100],[78,104],[93,105],[72,108],
        [57,110],[64,113],[95,114],[105,120],[1,120]],c[3]));
    for (const [x,y,x2] of [[14,110,32],[31,115,47],[51,109,58],[70,106,88],[59,116,83],
      [92,102,107],[116,107,132],[163,101,188],[137,114,151],[180,111,199]]) {
      a.push(rect(x,y,x2-x,1,c[4]));
    }
    a.push(
      polygon([[0,90],[10,84],[28,84],[34,88],[43,90],[40,97],[35,99],[33,107],[20,108],
        [16,113],[0,113]],'#251e31'),
      polygon([[0,93],[10,88],[21,87],[34,90],[37,92],[23,96],[0,101]],'#473040'),
      rect(19,57,25,33,'#2d2336'),rect(22,59,7,30,'#764650'),
      rect(28,59,16,30,'#503240'),rect(16,56,28,3,c[0]),
      polygon([[16,55],[19,49],[24,46],[41,46],[48,55]],'#372839'),
      polygon([[19,53],[24,48],[40,48],[45,53]],c[4]),rect(24,48,14,1,c[5]),rect(23,55,20,1,c[6]),
      rect(24,62,7,3,c[3]),rect(25,62,4,1,c[6]),rect(34,63,7,8,'#211c2e'),
      rect(36,64,4,1,c[5]),rect(23,72,4,10,c[5]),rect(23,72,2,3,c[7]),
      rect(31,80,8,2,c[3]),rect(40,68,3,18,c[2]));
    a.push(line([[31,46],[31,22],[35,13]],c[0]),line([[31,33],[45,31],[50,26]],c[7]),
      line([[21,35],[37,35],[44,28]],c[5]),rect(34,13,3,2,c[7]),rect(32,45,1,4,c[6]),
      line([[26,77],[48,84],[55,84],[66,80]],c[0]));
    for (const [x,y,wide,tall] of [[119,89,9,11],[134,85,11,15],[146,88,8,12],[157,83,8,16],
      [166,86,12,11],[186,83,11,18]]) {
      a.push(rect(x,y,wide,tall,'#39293a'),rect(x,y,wide,1,c[4]),rect(x+2,y+3,2,1,c[6]),
        rect(x+wide-3,y+5,1,tall-6,c[3]));
    }
    return draw(w,h,a);
  }

  function weather() {
    const c = coldInk, a = atmosphere(true);
    a.push(
      polygon([[0,76],[13,65],[27,66],[42,69],[59,62],[71,64],[92,76],[109,70],[129,69],
        [146,71],[156,63],[174,66],[190,61],[208,65],[208,101],[0,101]],c[3]),
      polygon([[0,80],[12,74],[28,79],[41,73],[54,74],[64,68],[79,76],[93,78],[119,77],
        [135,69],[152,73],[175,73],[185,67],[208,70],[208,102],[0,102]],c[2]),
      rect(0,87,w,33,'#234852'),
      polygon([[0,94],[26,92],[49,94],[70,90],[94,90],[116,87],[137,89],[154,88],[208,91],
        [208,97],[0,97]],'#34696f'),
      polygon([[138,91],[150,91],[143,94],[159,97],[134,100],[144,103],[126,104],[116,108],[130,110],
        [119,113],[81,119],[65,117],[89,110],[108,106],[96,103],[121,100],[106,96]],'#438282'),
      polygon([[0,100],[7,95],[21,95],[30,101],[39,101],[44,109],[61,111],[70,118],[0,120]],c[0]),
      polygon([[208,74],[197,76],[192,79],[179,80],[170,89],[175,95],[163,102],[156,109],
        [145,112],[141,120],[208,120]],c[0]));
    for (const [x,y,wide] of [[8,90,19],[34,95,23],[71,97,20],[116,93,20],[121,101,13],[117,105,16],
      [85,110,22],[87,115,25],[145,96,20],[182,88,12],[141,110,13],[37,117,17]]) {
      a.push(rect(x,y,wide,1,y%2?c[5]:c[4]));
    }
    a.push(
      polygon([[155,86],[161,81],[172,80],[183,82],[201,80],[208,79],[208,92],[190,94],[171,93]],c[1]),
      rect(171,63,20,24,c[1]),rect(175,65,6,20,c[3]),rect(168,61,26,3,c[0]),
      rect(172,59,18,2,c[4]),rect(174,66,4,3,c[6]),rect(183,66,5,3,c[5]),rect(184,76,4,6,c[5]),
      line([[180,63],[171,38],[167,25]],c[0],3),line([[178,57],[170,34]],c[4]),
      polygon([[146,38],[151,25],[159,16],[169,14],[181,18],[175,26],[165,37],[156,42]],c[1]),
      polygon([[150,36],[154,27],[160,20],[169,16],[178,18],[172,26],[161,36],[156,39]],c[4]),
      line([[151,37],[155,28],[162,20],[170,17],[178,18]],c[6]),
      line([[154,36],[166,24],[176,20]],c[5]),line([[164,28],[173,37],[181,36]],c[7]),
      rect(181,35,4,3,c[6]),line([[159,85],[145,89],[125,89],[113,92]],c[2]));
    for (const [x,y,wide] of [[14,106,15],[25,111,16],[39,116,13],[165,111,15],[176,102,20],
      [190,96,12],[174,118,22]]) a.push(rect(x,y,wide,1,c[2]));
    return draw(w,h,a);
  }

  const warm = survey(), cool = weather();
  function traffic(frame, wet) {
    const a = [];
    const x = (wet ? 44 : 83) + Math.round((wet ? (frame - loss) : frame) * (wet ? 2.0 : 2.6)) % 91;
    const y = (wet ? 58 : 53) - Math.round(Math.sin(frame * .18) * 4);
    const hull = wet ? ['#244a63','#3d9295','#addec0','#e5ead0'] : ['#402f45','#b76855','#f1b16f','#fff1bd'];
    const shape = (points,slot) => polygon(points.map(([u,v])=>[x+u,y+v]),hull[slot]);
    a.push(shape([[-23,3],[-16,-3],[-10,-5],[-6,-11],[5,-11],[11,-6],[19,-4],[24,0],[21,4],
      [14,7],[-14,7]],0),
    shape([[-19,2],[-13,-3],[13,-4],[21,0],[16,4],[-14,5]],1),
    shape([[-7,-5],[-4,-9],[4,-9],[9,-5],[4,-3],[-5,-3]],2),
    rect(x-13,y-1,31,1,hull[3]),rect(x+9,y+3,7,1,hull[2]),rect(x-15,y+5,7,1,hull[2]),
    rect(x-27-frame%3,y+3,5,1,hull[1]),rect(x-23,y+5,3,1,hull[2]));
    const lamp = frame % 8 < 3 ? hull[3] : hull[1];
    a.push(rect(x+19,y+1,2,1,lamp),rect(wet?182:34,wet?36:13,2,2,lamp));
    return draw(w,h,a);
  }

  const border = '#365057', panel = '#14232d';
  const plate = draw(width,height,[
    rect(0,0,width,height,'#101b25'),rect(10,10,3,14,amber),text(20,10,'BREAKWATER RELAY',ivory,2),
    text(left,28,'DIRECT FEED',mint),text(right,28,'RELAY DECODER',violet),
    ...[left,right].flatMap(x=>[rect(x-1,top-1,w+2,h+2,border),rect(x-2,top+h+2,w+4,3,panel)]),
    rect(207,169,11,1,border),rect(211,171,7,1,border),
    rect(424,169,14,1,border),rect(427,171,11,1,border),
    text(right,180,'FRESH',mint),text(right+40,180,'HELD',amber),text(right+76,180,'PREDICTED',violet)
  ]);

  const recovery = { groupSize: [4,2], fps, every:24, phase:1, step:5 };
  const decoder = P.datamosh.create({ blockSize, halfLife:5, blockMemory:{rect:[right,top,w,h],recovery} });
  function sample(frame) {
    const wet = frame >= loss;
    const source = P.raster.blend(wet?cool:warm, traffic(frame,wet));
    const clean = P.raster.stack({width,height,layers:[
      {source:plate},{source,x:left,y:top},{source,x:right,y:top}
    ]}).value;
    const outage = frame >= loss && frame < lock;
    const drifting = frame >= loss && frame < stopMotion;
    const motion = drifting ? new Float32Array(width*height*2) : null;
    const hold = new Uint8Array(width*height), refresh = new Uint8Array(width*height);
    if (outage) for (let y=0; y<rows; y++) for (let x=0; x<columns; x++) {
      const seed=(x*11+y*7+3)%17;
      const centerX=right+x*blockSize[0]+Math.floor(blockSize[0]/2);
      const centerY=top+y*blockSize[1]+Math.floor(blockSize[1]/2);
      const i=centerY*width+centerX;
      hold[i]=!drifting || seed<6 || x<4 && y>5 ? 255 : 0;
      if (frame===35 && x<3 && y>=7) refresh[i]=255;
      if (motion) {
        motion[i*2]=seed%5===0?-6:3+seed%6;
        motion[i*2+1]=((x+y*2)%5-2)*1.75;
      }
    }
    const {value,carry} = decoder.sample(clean,motion&&field(2,motion),frame/fps,
      {hold:field(1,hold),refresh:field(1,refresh)});
    return {value,carry,clean};
  }

  const cache = [];
  function compare(frame, showGrid = false) {
    while (cache.length <= frame) cache.push(sample(cache.length));
    const {value,carry,clean} = cache[frame];
    const mode = frame < loss || frame >= lock ? 'SIGNAL LOCKED' : frame < stopMotion ? 'PACKET LOSS' : 'GROUP REFRESH';
    const overlay = [
      text(left,171,frame>=loss?'STORM CAMERA':'SUNSET CAMERA',muted),
      text(left,183,'FRAME '+String(frame).padStart(2,'0'),muted),
      text(right,170,mode,frame>=loss&&frame<lock?amber:mint)
    ];
    const state = [];
    for (let by=0; by<rows; by++) for (let bx=0; bx<columns; bx++) {
      const x=right+bx*blockSize[0], y=top+by*blockSize[1];
      const center=(y+Math.floor(blockSize[1]/2))*width+x+Math.floor(blockSize[0]/2);
      let differs=false;
      for (let yy=y; yy<y+blockSize[1]&&!differs; yy++) for (let xx=x; xx<x+blockSize[0]; xx++) {
        const p=(yy*width+xx)*4;
        if (value.data[p]!==clean.data[p]||value.data[p+1]!==clean.data[p+1]||value.data[p+2]!==clean.data[p+2]) {
          differs=true;
          break;
        }
      }
      const kind=!differs?0:carry.data[center]>=.9999?1:2;
      state.push(kind);
      const ink=[mint,amber,violet][kind];
      overlay.push(rect(365+bx*4,168+by*2,3,1,ink));
      if (showGrid && differs) overlay.push(rect(x,y,4,1,ink),rect(x,y,1,3,ink));
    }
    const result=P.raster.blend(value,draw(width,height,overlay));
    return {value:result,state,mode};
  }
  return {width,height,fps,frames,compare};
}

function mount(K, makeStudy) {
  const study=makeStudy(K), $=id=>document.getElementById(id);
  const canvas=$('view'), time=$('frame'), play=$('play'), grid=$('grid');
  canvas.width=study.width;
  canvas.height=study.height;
  time.max=study.frames-1;
  const context=canvas.getContext('2d'), pixels=new ImageData(study.width,study.height);
  let frame=17, playing=false, origin, request;
  function draw() {
    const {value,state,mode}=study.compare(frame,grid.checked);
    pixels.data.set(value.data);
    context.putImageData(pixels,0,0);
    time.value=frame;
    const counts=[0,0,0];
    for (const kind of state) counts[kind]++;
    $('status').textContent=mode+' · '+counts[0]+' fresh · '+counts[1]+' held · '+counts[2]+' predicted';
  }
  function tick(now) {
    origin ??= now-frame*1000/study.fps;
    const next=Math.floor((now-origin)*study.fps/1000+1e-9)%study.frames;
    if (next!==frame) { frame=next;draw(); }
    if (playing) request=requestAnimationFrame(tick);
  }
  function pause() {
    playing=false;
    cancelAnimationFrame(request);
    play.textContent='Play';
  }
  play.addEventListener('click',()=>{
    if (playing) return pause();
    playing=true;
    origin=undefined;
    play.textContent='Pause';
    request=requestAnimationFrame(tick);
  });
  time.addEventListener('input',()=>{pause();frame=+time.value;draw();});
  grid.addEventListener('change',draw);
  draw();
}

if (require.main===module) {
  const out=process.argv[2]??'out/breakwater-relay';
  fs.mkdirSync(out,{recursive:true});
  const study=createStudy(ink.load().KIT);
  const states=[];
  const cels=Array.from({length:study.frames},(_,frame)=>{
    const {value,state,mode}=study.compare(frame);
    states.push({mode,state});
    return png.packRGBA(value);
  });
  fs.writeFileSync(path.join(out,'breakwater-relay.png'),png.encodeAnimation(cels,study.fps));
  fs.writeFileSync(path.join(out,'breakwater-relay-still.png'),png.encodeFrame(cels[17]));
  fs.writeFileSync(path.join(out,'breakwater-relay-blocks.json'),JSON.stringify({fps:study.fps,frames:states}));
  const packed=gzipSync(ink.bundle()+'\nreturn KIT;',{level:9}).toString('base64');
  const template=fs.readFileSync(path.join(__dirname,'block-video-corruption.html.template'),'utf8');
  fs.writeFileSync(path.join(out,'breakwater-relay.html'),template.replace('/* DEMO */',()=>`
    const bytes=Uint8Array.from(atob('${packed}'),char=>char.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const KIT=new Function(await new Response(stream).text())();
    (${mount.toString()})(KIT,${createStudy.toString()});
  `));
}
