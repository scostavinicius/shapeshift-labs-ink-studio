/* Tideglass Observatory. A polygon floor plan and a guided native-pixel tour. */
const fs=require('node:fs');
const path=require('node:path');
const {gzipSync}=require('node:zlib');
const ink=require('..');
const png=require('../cli/png.js');

function createStudy(K) {
  const {drawing2d,raster}=K.procedural;
  const width=224,height=140, fps=14, frames=108, sheet={width:372,height:202};
  const viewAt=[10,38], planAt=[246,38], planWidth=116, planHeight=140;
  const swatches=[
    '#171827','#2a2537','#453145','#684352','#925858','#be7862','#e8a579','#ffe2aa',
    '#102533','#1a3743','#295263','#397386','#55a2a4','#8ac9b6','#c2e4c7','#eef2cc',
    '#171b3a','#29294b','#42385f','#594a77','#7c6394','#b183aa','#e6aec1','#ffe2ca',
    '#101621','#14243a','#2b4d69','#3e7a96','#66a8b4','#96cbd0','#ccdfd3','#df9b6b'
  ];
  const paper='#101824', oil='#192535', edge='#344e60', mint='#a3d4bf', ochre='#ecc391', steel='#91abb8';
  const rect=(s,x,y,w,h)=>({slot:s,shape:{type:'rect',rect:[x,y,w,h]}});
  const poly=(s,points)=>({slot:s,shape:{type:'polygon',points}});
  const line=(s,points,w=1)=>({slot:s,shape:{type:'path',points:points.map(([x,y])=>[x+.5,y+.5]),width:w}});
  const stamp=(width,height,strokes)=>({width,height,strokes});
  const block=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
  const fill=(points,fill)=>({type:'polygon',points,fill});
  const pathLine=(points,color,width=1)=>({type:'path',points,color,width});
  const label=(x,y,text,color,scale=1)=>({type:'text',at:[x,y],text,color,scale});
  const draw=(width,height,commands)=>drawing2d.render({width,height,commands,edges:'hard'});

  function stone(start,seed) {
    const c=i=>start+i,w=112,h=96;
    const a=[rect(c(2),0,0,w,h),rect(c(1),0,0,w,5),rect(c(3),0,5,w,2),
      rect(c(1),0,89,w,7),rect(c(3),0,87,w,2)];
    for (const [row,y] of [7,20,33,46,59,72].entries()) {
      a.push(rect(c(1),0,y+12,w,1),rect(c(3),0,y+1,w,1));
      for (let x=row%2?8:23;x<w;x+=29) a.push(rect(c(1),x,y+2,1,10),rect(c(3),x+1,y+2,1,9));
    }
    for (let i=0;i<120;i++) {
      const x=Math.floor(K.hash(i,seed,3)*w),y=9+Math.floor(K.hash(i,seed,5)*76);
      a.push(rect(c(i%9===0?4:i%3===0?1:3),x,y,1+(i%3===0),1));
    }
    return a;
  }

  function columns(start,kind) {
    const c=i=>start+i,a=stone(start,19+start);
    for (const x of [8,52,96]) {
      a.push(rect(c(0),x-2,6,10,81),rect(c(3),x,9,5,75),rect(c(4),x+1,10,1,70),
        rect(c(1),x-4,7,13,5),rect(c(4),x-3,8,11,1),
        rect(c(1),x-3,80,11,5),rect(c(4),x-3,82,10,1));
    }
    for (const x of [30,76]) {
      a.push(poly(c(1),[[x-11,65],[x-11,38],[x-6,26],[x,22],[x+7,27],[x+11,38],[x+11,65]]),
        poly(c(3),[[x-8,62],[x-8,39],[x-4,31],[x,28],[x+5,33],[x+8,39],[x+8,62]]));
      if (kind==='gauge') {
        a.push(rect(c(0),x-6,42,13,15),rect(c(3),x-5,43,10,1),rect(c(4),x-5,54,11,1),
          line(c(5),[[x-4,51],[x-1,47],[x,49],[x+3,46],[x+5,47]]),rect(c(6),x-2,44,2,1));
      } else {
        a.push(rect(c(0),x-4,41,9,15),rect(c(4),x-3,42,7,13),rect(c(6),x-2,43,4,10),
          rect(c(7),x-1,43,2,4),rect(c(5),x-7,55,16,2),rect(c(2),x-6,57,14,2));
      }
    }
    return stamp(112,96,a);
  }

  function tiles(start, ceiling=false) {
    const c=i=>start+i,w=30,h=30;
    const a=[rect(c(1),0,0,w,h),rect(c(2),1,1,w-2,h-2),line(c(3),[[2,27],[2,2],[27,2]]),
      line(c(1),[[3,28],[28,28],[28,3]])];
    if (ceiling) {
      a.push(poly(c(0),[[4,14],[14,4],[25,14],[14,25]]),poly(c(3),[[5,14],[14,5],[24,14],[14,24]]),
        poly(c(2),[[8,14],[14,8],[21,14],[14,21]]),rect(c(4),14,14,2,2));
    } else {
      a.push(poly(c(3),[[2,14],[14,2],[28,14],[14,28]]),poly(c(2),[[5,14],[14,5],[24,14],[14,24]]),
        poly(c(4),[[10,14],[14,10],[19,14],[14,19]]),poly(c(1),[[12,14],[14,12],[17,14],[14,17]]));
    }
    return stamp(w,h,a);
  }

  function metal(start) {
    const c=i=>start+i;
    return stamp(44,48,[rect(c(1),0,0,44,48),rect(c(3),1,2,42,44),rect(c(5),2,4,40,2),
      rect(c(2),2,42,40,3),rect(c(4),3,9,38,28),rect(c(2),6,12,32,22),rect(c(3),7,14,30,17),
      rect(c(6),9,15,2,2),rect(c(6),33,15,2,2),rect(c(6),9,29,2,2),rect(c(6),33,29,2,2)]);
  }

  function shutter() {
    const a=[rect(1,0,0,92,96),rect(4,2,2,88,92),rect(2,5,4,82,88),rect(3,7,6,78,84),
      rect(5,8,7,75,2),rect(5,8,87,75,2),rect(1,12,12,68,72)];
    for (let x=14;x<80;x+=6) a.push(rect(3,x,13,3,70),rect(4,x,14,1,68));
    a.push(poly(1,[[22,49],[31,29],[45,21],[60,28],[70,49],[60,68],[45,75],[31,67]]),
      poly(4,[[24,49],[33,31],[45,24],[58,31],[67,49],[58,66],[45,72],[33,65]]),
      poly(9,[[28,49],[36,34],[45,29],[55,34],[63,49],[55,62],[45,67],[36,62]]),
      poly(11,[[33,49],[40,37],[45,34],[51,37],[58,49],[51,59],[45,63],[40,59]]),
      line(7,[[32,49],[45,28],[59,49],[45,69],[32,49]]),line(14,[[41,50],[45,40],[50,49],[45,58],[41,50]]),
      rect(15,45,48,2,2),rect(5,13,17,4,5),rect(7,14,18,2,1),rect(5,73,17,4,5),rect(7,74,18,2,1));
    return stamp(92,96,a);
  }

  function orrery() {
    const w=112,h=96,a=stone(16,76),cx=56,cy=46;
    a.push(poly(16,[[11,89],[11,43],[20,23],[36,11],[76,11],[92,23],[101,43],[101,89]]),
      poly(26,[[15,87],[15,44],[23,27],[38,15],[74,15],[89,27],[97,44],[97,87]]),
      poly(24,[[18,86],[18,45],[26,29],[40,18],[73,18],[86,29],[94,45],[94,86]]));
    for (const [x,y] of [[24,51],[27,30],[39,20],[56,17],[76,23],[87,34],[91,55],[89,72]]) {
      a.push(rect(27,x,y,2,1),rect(28,x,y,1,1));
    }
    function ring(rx,ry,tilt,color,width) {
      const points=Array.from({length:49},(_,i)=>{
        const t=i*Math.PI/24,x=Math.cos(t)*rx,y=Math.sin(t)*ry;
        return [cx+x*Math.cos(tilt)-y*Math.sin(tilt),cy+x*Math.sin(tilt)+y*Math.cos(tilt)];
      });
      a.push(line(color,points,width));
    }
    ring(30,23,-.32,27,2);ring(33,10,.33,28,1);ring(34,11,-.48,29,1);ring(21,16,.6,26,1);
    a.push(poly(3,[[47,47],[54,36],[62,37],[67,44],[63,53],[54,55],[47,51]]),
      poly(6,[[50,45],[55,38],[61,39],[64,45],[60,51],[53,52]]),
      poly(7,[[53,43],[56,39],[59,40],[61,43],[57,46],[53,46]]),
      rect(15,72,35,3,3),rect(14,73,34,1,5),rect(21,37,57,3,2),rect(6,32,38,2,2),
      rect(8,36,77,41,7),rect(27,36,76,41,2),rect(29,42,77,25,1),rect(25,38,82,37,1));
    return stamp(w,h,a);
  }

  const shell=columns(0,'lamps'), conduit=columns(8,'gauge'), gallery=columns(16,'lamps');
  const rim=metal(0), greenRim=metal(8), chart=orrery();
  const shades=Object.fromEntries(swatches.flatMap((_,i)=>{
    if (i>=24 || i%8===7) return [];
    const n=i%8,b=i-n;
    return [[i,[i,b+Math.max(0,n-1),b+Math.max(0,n-2),b+Math.max(0,n-3)]]];
  }));
  function smooth(t) { const x=Math.max(0,Math.min(1,t)); return x*x*(3-2*x); }
  const open=t=>smooth((t-.20)/1.65);
  const sectors=[
    {id:'Copper Vestibule',polygon:[[-3.4,0],[3.4,0],[3.4,5],[-3.4,5]],floor:0,ceiling:3.5,
      wall:shell,edgePaint:{2:columns(0,'gauge')},floorPaint:tiles(0),ceilingPaint:tiles(0,true),planeScale:[1.35,1.35]},
    {id:'Jade Gallery',polygon:[[-1.85,5],[1.85,5],[1.85,9.6],[-1.85,9.6]],floor:.44,ceiling:2.64,
      wall:conduit,lightBand:1,floorPaint:tiles(8),ceilingPaint:tiles(8,true),planeScale:[1.2,1.2]},
    {id:'Tideglass Rotunda',polygon:[[-2.05,9.6],[2.05,9.6],[3.55,11.15],[3.55,14.8],[1.85,16.2],
      [-1.85,16.2],[-3.55,14.8],[-3.55,11.15]],floor:-.18,ceiling:4.45,wall:gallery,
      edgePaint:{3:columns(16,'gauge'),4:chart,5:chart},floorPaint:tiles(16),ceilingPaint:tiles(16,true),planeScale:[1.5,1.5]},
    {id:'Chart Annex',polygon:[[3.55,11.15],[6.3,11.6],[6.7,14.3],[3.55,14.8]],floor:.1,ceiling:2.75,
      wall:columns(8,'lamps'),edgePaint:{1:chart},floorPaint:tiles(8),ceilingPaint:tiles(8,true),planeScale:[1,1]}
  ];
  const portals=[
    {id:'copper-shutter',between:['Copper Vestibule','Jade Gallery'],segment:[[-1.35,5],[1.35,5]],lintel:2.48,
      trim:rim,door:{paint:shutter(),open}},
    {id:'rotunda-arch',between:['Jade Gallery','Tideglass Rotunda'],segment:[[-1.32,9.6],[1.42,9.6]],lintel:2.54,trim:greenRim},
    {id:'annex-arch',between:['Tideglass Rotunda','Chart Annex'],segment:[[3.55,12.05],[3.55,14.0]],lintel:2.65,trim:greenRim}
  ];
  function lantern(reverse) {
    const glass=reverse?12:13, border=reverse?4:6,w=24,h=39;
    return stamp(w,h,[line(1,[[12,0],[12,11],[9,15]],2),rect(border,11,2,2,9),
      poly(8,[[11,10],[16,13],[20,20],[19,30],[14,34],[10,37],[6,32],[3,26],[6,16]]),
      poly(12,[[11,13],[15,15],[18,20],[17,29],[14,31],[10,33],[7,30],[5,25],[8,17]]),
      poly(glass,[[9,18],[13,16],[16,21],[14,28],[9,31],[7,25]]),
      line(15,[[8,26],[8,20],[11,17],[14,19]]),rect(15,10,23,3,1),rect(15,11,22,1,4),
      rect(border,9,11,6,2),rect(border,8,33,7,2),rect(7,11,36,2,2)]);
  }
  const compass=stamp(29,32,[
    poly(24,[[3,10],[12,1],[19,4],[25,10],[27,22],[18,30],[9,30],[2,23]]),
    poly(28,[[5,10],[12,4],[19,6],[24,12],[25,21],[18,28],[9,28],[4,22]]),
    poly(25,[[7,12],[13,6],[18,8],[22,13],[23,20],[18,26],[10,26],[6,20]]),
    poly(12,[[14,8],[20,19],[14,17],[9,23],[10,17]]),
    poly(15,[[14,9],[16,16],[14,15],[11,19],[12,15]]),
    rect(31,13,22,3,2),rect(29,13,2,2,2),rect(29,3,17,3,1),rect(29,25,16,2,1)
  ]);
  const scene=K.tileRaycaster.create({mode:'sectors',palette:swatches,sectors,portals,
    shade:{distances:[2.4,5.2,8.5],ramps:shades,sideBias:{x:0,z:0}},sprites:[
      {id:'Jade lantern',at:t=>[-.66+Math.sin(t*1.35)*.13,1.32,7.5],height:1.02,
        views:[{yaw:0,paint:lantern(true)},{yaw:Math.PI,paint:lantern(false)}]},
      {id:'Tidal compass',at:t=>[.4+Math.sin(t*1.2)*.1,.65,13.63],height:1.45,views:[{paint:compass}]}
    ]
  });

  const route=[
    [0,.42,1.43,1.86,-.095], [1.62,.18,1.46,2.79,-.025],
    [3.03,.16,1.76,5.88,-.025], [4.62,.22,1.72,8.58,-.035],
    [6.05,.15,1.34,11.88,.04], [7.63,.98,1.29,12.92,1.17]
  ];
  function camera(time) {
    const i=route.findIndex(key=>key[0]>time);
    const a=route[i<0?route.length-1:Math.max(0,i-1)],b=route[i<0?route.length-1:i];
    const p=b[0]>a[0]?smooth((time-a[0])/(b[0]-a[0])):0;
    const [x,y,z,yaw]=a.slice(1).map((n,j)=>n+(b[j+1]-n)*p);
    return {at:[x,y,z],yaw,fov:1.11};
  }

  const plate=draw(sheet.width,sheet.height,[
    block(0,0,sheet.width,sheet.height,paper),block(10,7,2,15,ochre),
    label(19,7,'TIDEGLASS OBSERVATORY',mint,2),
    label(10,26,'CAMERA',steel),label(246,26,'FLOOR PLAN',steel),
    block(viewAt[0]-1,viewAt[1]-1,width+2,height+2,edge),
    block(planAt[0]-1,planAt[1]-1,planWidth+2,planHeight+2,edge),
    block(...planAt,planWidth,planHeight,oil)
  ]);
  const map=([x,z])=>[planAt[0]+25+6.75*(x+3.55),planAt[1]+126-6.63*z];
  const mapColors=['#704950','#356771','#574c7d','#466565'];
  const outlines=['#c78974','#71b6ac','#a693bd','#81a49a'];
  const fmt = n => (n < 0 ? '-' : '+') + Math.abs(n).toFixed(2);

  function compare(frame, aperture, probe) {
    const time=frame/fps, pose=camera(time), amount=aperture??open(time);
    const doors={'copper-shutter':amount};
    const image=scene.render({width,height,camera:pose,time,doors});
    const [x,,z]=pose.at, eye=map([x,z]), current=scene.locate([x,z]);
    const roomNumber=scene.sectors.indexOf(current), hit=probe && K.renderOutputs.pick(image,...probe);
    const layer=[
      label(10,184,current.id.toUpperCase(),outlines[roomNumber]),
      label(10,193,'FLOOR '+fmt(current.floor)+'  CEIL '+fmt(current.ceiling),steel),
      label(246,184,'SHUTTER '+Math.round(amount*100)+'%',ochre)
    ];
    for (const [i,sector] of scene.sectors.entries()) {
      const corners=sector.polygon.map(map);
      layer.push(fill(corners,mapColors[i]),pathLine([...corners,corners[0]],outlines[i]));
      const center=map(sector.polygon.reduce(([x,z],[a,b])=>[x+a/sector.polygon.length,z+b/sector.polygon.length],[0,0]));
      layer.push(label(Math.round(center[0])-2,Math.round(center[1])-4,String(i+1),outlines[i]));
    }
    for (const [i,portal] of scene.portals.entries()) {
      layer.push(pathLine(portal.segment.map(map),'#a7c9a5',2));
      if (i===0 && amount<1) {
        const [a,b]=portal.segment;
        const start=a.map((n,j)=>n+(b[j]-n)*amount);
        layer.push(pathLine([start,b].map(map),ochre,2));
      }
    }
    const fan=[-.35,.35].map(delta=>{
      const yaw=pose.yaw+delta,direction=[Math.sin(yaw),Math.cos(yaw)];
      const sample=scene.cast({at:pose.at,direction,time,doors,far:3.2});
      return sample?map([sample.point[0],sample.point[2]]):map([x+direction[0]*3.2,z+direction[1]*3.2]);
    });
    layer.push(pathLine([fan[0],eye,fan[1]],'#e9c69c'),block(Math.round(eye[0])-1,Math.round(eye[1])-1,3,3,'#fff2c4'));
    if (probe) {
      const [sx,sy]=probe.map((value,axis)=>value+viewAt[axis]);
      layer.push(block(sx-4,sy,3,1,mint),block(sx+2,sy,3,1,mint),block(sx,sy-4,1,3,mint),block(sx,sy+2,1,3,mint));
    }
    const {value}=raster.stack({...sheet,layers:[{source:plate},
      {source:image,x:viewAt[0],y:viewAt[1]},{source:draw(sheet.width,sheet.height,layer)}]});
    return {value,image,hit,current,amount};
  }
  return {width,height,sheet,viewAt,fps,frames,compare};
}

function mount(K,makeStudy) {
  const study=makeStudy(K),$=id=>document.getElementById(id);
  const canvas=$('view'),context=canvas.getContext('2d'),time=$('frame'),shutter=$('door'),play=$('play');
  canvas.width=study.sheet.width;
  canvas.height=study.sheet.height;
  time.max=study.frames-1;
  const pixels=new ImageData(canvas.width,canvas.height);
  let frame=14, aperture=null, probe, playing=false, origin, request;
  function draw() {
    const {value,current,hit,amount}=study.compare(frame,aperture,probe);
    pixels.data.set(value.data);
    context.putImageData(pixels,0,0);
    time.value=frame;
    shutter.value=amount;
    $('door-value').value=Math.round(amount*100)+'%';
    $('follow').disabled=aperture===null;
    $('status').textContent=hit?hit.owner.id+' · depth '+hit.depth.toFixed(2)+' · height '+hit.position[1].toFixed(2):
      current.id+' · floor '+current.floor.toFixed(2)+' · ceiling '+current.ceiling.toFixed(2);
  }
  function tick(now) {
    origin ??= now-frame*1000/study.fps;
    const next=Math.floor((now-origin)*study.fps/1000+1e-9)%study.frames;
    if (next!==frame) {frame=next;draw();}
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
  shutter.addEventListener('input',()=>{aperture=+shutter.value;draw();});
  $('follow').addEventListener('click',()=>{aperture=null;draw();});
  canvas.addEventListener('pointerdown',event=>{
    const bounds=canvas.getBoundingClientRect();
    const x=Math.floor((event.clientX-bounds.left)*canvas.width/bounds.width)-study.viewAt[0];
    const y=Math.floor((event.clientY-bounds.top)*canvas.height/bounds.height)-study.viewAt[1];
    if (x>=0&&x<study.width&&y>=0&&y<study.height) {probe=[x,y];draw();}
  });
  canvas.addEventListener('keydown',event=>{
    const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    const vector=steps[event.key];
    if (!vector) return;
    event.preventDefault();
    const [x,y]=probe??[Math.floor(study.width/2),Math.floor(study.height/2)];
    probe=[Math.max(0,Math.min(study.width-1,x+vector[0])),Math.max(0,Math.min(study.height-1,y+vector[1]))];
    draw();
  });
  draw();
}

if (require.main===module) {
  const out=process.argv[2]??'out/tideglass-observatory';
  fs.mkdirSync(out,{recursive:true});
  const study=createStudy(ink.load().KIT);
  const cels=Array.from({length:study.frames},(_,frame)=>png.packRGBA(study.compare(frame).value));
  fs.writeFileSync(path.join(out,'tideglass-observatory.png'),png.encodeAnimation(cels,study.fps));
  for (const [name,frame] of [['vestibule',14],['gallery',62],['rotunda',87]]) {
    fs.writeFileSync(path.join(out,'tideglass-'+name+'.png'),png.encodeFrame(cels[frame]));
  }
  const packed=gzipSync(ink.bundle()+'\nreturn KIT;',{level:9}).toString('base64');
  const template=fs.readFileSync(path.join(__dirname,'sector-raycaster.html.template'),'utf8');
  fs.writeFileSync(path.join(out,'tideglass-observatory.html'),template.replace('/* DEMO */',()=>`
    const bytes=Uint8Array.from(atob('${packed}'),char=>char.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const KIT=new Function(await new Response(stream).text())();
    (${mount.toString()})(KIT,${createStudy.toString()});
  `));
}
