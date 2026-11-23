/* Wicker Sluice. The pending gate release is forecast on two isolated water runs. */
const fs=require('node:fs');
const path=require('node:path');
const {gzipSync}=require('node:zlib');
const ink=require('..');
const composite=require('../src/frame-composite.js');
const png=require('../cli/png.js');

function createStudy(K,composite) {
  const {world:W,procedural:P}=K;
  const width=328,height=178, sheet={width:348,height:240}, viewAt=[10,37], fps=14, frames=78;
  const amber='#f0b57a', pale='#e8edd3', mint='#c4ffdf', steel='#9ab1ad', gold='#ffe9b3';
  const origin=[-7.2,-3.6], cell=.4, nx=36,nz=18, dt=.055;
  const bounds=(minX,minZ,maxX,maxZ)=>({min:[minX,minZ],max:[maxX,maxZ]});
  const box=(minX,minZ,maxX,maxZ,value)=>({bounds:bounds(minX,minZ,maxX,maxZ),value});
  const config={width:nx,height:nz,cell,origin,base:1.15,
    bed:[box(-7.2,-2.65,0,2.65,-.65),box(-1,-.9,7.2,.9,-.68),box(4.4,-1.55,7.2,1.55,-.53)],
    initial:[box(-6.9,-2.5,0,2.5,1.11)],gates:{sluice:{bounds:bounds(-.015,-3.6,.015,3.6),axis:0,opening:0}},friction:.06};
  const drift=()=>({initial:()=>[-1.17,.51,-.21],step:(p,{query,dt})=>{
    const current=query.probe('canal/flow',p),surface=query.probe('canal/surface-height',p);
    if (current.status!=='ok'||surface.status!=='ok') return p;
    return [p[0]+current.value[0]*dt,surface.value+.08,p[2]+current.value[1]*dt];
  },fields:{position:{type:'vector',read:({state})=>W.query.ok(state)}}});
  const run=W.runtime.create({id:'wicker-sluice',dt,systems:{canal:{kind:'water',config},buoy:{kind:'drift'}}},
    {implementations:{drift}});
  run.advance(8);
  const checkpoint=run.checkpoint();

  const yaw=.34,pitch=.72,focal=17.5, c=Math.cos(yaw),s=Math.sin(yaw),u=Math.sin(pitch),v=Math.cos(pitch);
  const right=[c,0,-s],up=[-s*u,v,-c*u],back=[s*v,u,c*v];
  const target=[0,.1,0], dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
  const camera={ortho:true,tangent:height/(2*focal),aspect:width/height,clipNear:.01,clipFar:100,
    view:[right[0],up[0],back[0],0,right[1],up[1],back[1],0,right[2],up[2],back[2],0,
      -dot(right,target),-dot(up,target),-30-dot(back,target),1]};
  function project(p) {
    return [width/2+(dot(right,p)-dot(right,target))*focal,height/2-(dot(up,p)-dot(up,target))*focal];
  }

  const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
  const poly=(points,fill)=>({type:'polygon',points,fill});
  const path2=(points,color,width=1)=>({type:'path',points,color,width});
  const text=(x,y,text,color,scale=1)=>({type:'text',at:[x,y],text,color,scale});
  const draw=(width,height,commands)=>P.drawing2d.render({width,height,commands,edges:'hard'});
  const plane=(x0,z0,x1,z1,y,color)=>poly([[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]].map(project),color);
  const shape=(points,color)=>poly(points.map(project),color);
  const line=(points,color,width=1)=>path2(points.map(project),color,width);
  function slab(x0,z0,x1,z1,lo,hi,[top,front,side]) {
    return [
      shape([[x1,lo,z0],[x1,hi,z0],[x1,hi,z1],[x1,lo,z1]],side),
      shape([[x0,lo,z1],[x0,hi,z1],[x1,hi,z1],[x1,lo,z1]],front),
      plane(x0,z0,x1,z1,hi,top)
    ];
  }
  function reed(x,z,y,tone) {
    return [line([[x,y,z],[x-.09,y+.26,z-.05],[x-.24,y+.37,z-.08]],tone),
      line([[x,y,z],[x+.09,y+.20,z-.07],[x+.19,y+.28,z-.18]],tone),
      line([[x,y,z],[x+.01,y+.35,z+.09]],'#698675')];
  }
  function wall(x0,z0,x1,z1,seed) {
    const a=slab(x0,z0,x1,z1,-.66,.52,['#627b78','#334f57','#41616a']);
    a.push(line([[x0,.52,z1],[x1,.52,z1]],'#9ba58c'),line([[x0,.27,z1],[x1,.27,z1]],'#577471'),
      line([[x0,-.13,z1],[x1,-.13,z1]],'#263f4a'));
    const n=Math.floor((x1-x0)*2);
    for(let i=1;i<n;i++){
      const x=x0+(x1-x0)*i/n;
      a.push(line([[x,.49,z1],[x,.28,z1]],'#405a62'),
        line([[x+.14,.25,z1],[x+.14,-.10,z1]],'#283f48'));
      if (K.hash(i,seed,11)>.55) a.push(line([[x+.08,.57,z1-.02],[x+.26,.56,z1-.02]],'#afaf87'));
    }
    return a;
  }

  const ground=[
    rect(0,0,width,height,'#182633'),rect(0,20,width,113,'#1d303b'),rect(0,135,width,height-135,'#172733'),
    shape([[-7.6,-1.1,-3.83],[7.35,-1.1,-3.83],[7.76,-1.1,3.72],[-7.3,-1.1,3.81]],'#101d29'),
    ...slab(-7.2,-3.6,7.2,3.6,-1.12,-.68,['#506b68','#283e49','#334f55']),
    plane(-7.12,-2.65,0,2.65,-.65,'#1c4858'),
    shape([[0,-.66,-.88],[4.4,-.66,-.87],[4.84,-.66,-1.49],[7.2,-.66,-1.49],[7.2,-.66,1.49],
      [4.46,-.66,1.49],[4.2,-.66,.88],[0,-.66,.88]],'#1c414d'),
    ...slab(.14,-3.57,7.15,-.92,-.69,-.12,['#526d64','#36545b','#456763']),
    ...slab(.14,.92,7.15,3.56,-.69,-.12,['#4c6862','#324d56','#3a585d']),
    ...wall(-7.21,-3.44,.02,-2.63,81),
    ...slab(-7.2,-2.63,-6.95,2.64,-.68,.53,['#6d8278','#496268','#35525b']),
    ...slab(-6.87,-2.36,-5.80,-1.64,-.48,.20,['#71a3a2','#386c75','#407681']),
    ...slab(-6.87,-2.36,-6.14,-1.72,-.48,.29,['#849f94','#586f70','#645e55'])
  ];
  for(let i=0;i<49;i++) {
    const x=.3+6.65*K.hash(i,18,21),z=(i%2?1:-1)*(1.07+2.35*K.hash(i,31,17));
    const y=-.107,len=.055+.18*K.hash(i,34,6);
    ground.push(line([[x,y,z],[x+len,y,z]],i%4===0?'#9aa68c':i%3?'#607a69':'#3b5853'));
  }
  for (const [x,z] of [[.63,1.30],[1.11,1.67],[2.06,1.52],[4.10,1.32],[4.31,1.61],[5.7,-1.81],[6.62,1.67],
    [1.60,-1.22],[3.48,-1.20],[5.91,2.38],[-6.82,-3.44]]) ground.push(...reed(x,z,-.09,'#8c9b73'));
  for (const [x,z,len] of [[.3,.21,.48],[1.15,.44,.48],[2.11,-.20,.38],[2.6,.26,.69],[4.1,-.39,.67],
    [4.51,.37,.73],[5.31,.6,.44],[6.2,-.65,.6],[6.55,.91,.32],[5.91,-1.2,.34]]) {
    ground.push(line([[x,-.65,z],[x+len,-.65,z]],'#2b5661'));
  }
  const under=draw(width,height,ground);

  const house=[
    ...slab(-6.3,-3.5,-4.35,-2.25,.52,1.53,['#90665b','#5a4e51','#594551']),
    shape([[-6.48,1.51,-3.64],[-4.15,1.51,-3.64],[-4.15,2.07,-2.86],[-6.48,2.07,-2.86]],'#75475a'),
    shape([[-6.48,2.07,-2.86],[-4.15,2.07,-2.86],[-4.15,1.51,-2.08],[-6.48,1.51,-2.08]],'#aa625e'),
    shape([[-4.15,1.51,-3.64],[-4.15,2.07,-2.86],[-4.15,1.51,-2.08]],'#6e4956'),
    line([[-6.46,2.08,-2.86],[-4.15,2.08,-2.86]],'#da9873',2),
    line([[-6.47,1.54,-2.10],[-4.15,1.54,-2.10]],'#e0a175'),
    ...slab(-5.94,-3.44,-5.62,-3.08,1.58,2.19,['#b39073','#6d6057','#555052']),
    shape([[-6.06,.96,-2.247],[-5.55,.96,-2.247],[-5.55,1.36,-2.247],[-6.06,1.36,-2.247]],'#f6cb80'),
    line([[-6.03,1.13,-2.246],[-5.58,1.13,-2.246]],'#e78a66'),
    line([[-5.8,1.34,-2.246],[-5.8,.99,-2.246]],'#aa7061'),
    shape([[-5.16,.55,-2.247],[-4.73,.55,-2.247],[-4.73,1.29,-2.247],[-5.16,1.29,-2.247]],'#30363e'),
    line([[-5.15,1.31,-2.245],[-4.7,1.31,-2.245]],'#c58c68')
  ];
  for (let i=0;i<8;i++) {
    const x=-6.35+i*.27;
    house.push(line([[x,2.035,-2.83],[x,1.54,-2.11]],i%2?'#c47a67':'#9b575e'));
  }
  const front=[
    ...house,...wall(-7.2,2.61,.08,3.57,17),...wall(-.15,-1.30,.28,-.84,12),
    ...wall(-.15,.84,.28,1.30,19),
    ...slab(-.12,-1.20,.29,-.89,.40,1.42,['#635d65','#485460','#374653']),
    ...slab(-.12,.89,.29,1.20,.40,1.42,['#827477','#5a6470','#4b515e']),
    ...slab(-.17,-1.24,.35,1.24,1.39,1.65,['#c5926c','#80635e','#694d52']),
    line([[.36,1.65,-1.21],[.36,1.65,1.2]],'#e3ba85'),
    line([[.32,1.41,-.85],[.32,.37,-.85]],'#263d4b',2),line([[.32,1.41,.85],[.32,.37,.85]],'#273d4b',2),
    ...slab(-.26,-.42,.21,.42,1.64,1.82,['#675961','#705854','#5b4b50']),
    line([[.22,1.82,-.31],[.22,1.82,.34]],amber)
  ];
  front.push(...slab(2.87,-1.36,3.53,1.36,.29,.52,['#b48563','#76564f','#715552']));
  for(let i=0;i<16;i++){
    const z=-1.3+i*.166;
    front.push(line([[2.90,.531,z],[3.50,.531,z]],i%3?'#935f50':'#d0a076'));
  }
  for (const x of [2.91,3.46]) {
    front.push(line([[x,1.03,-1.31],[x,1.03,1.31]],'#e1bc8a'),
      line([[x,.85,-1.29],[x,.85,1.29]],'#bd946c'));
    for (const z of [-1.32,-.60,.60,1.32])
      front.push(line([[x,.34,z],[x,1.04,z]],'#a97958',2));
  }
  const over=draw(width,height,front);
  const ramps=['#265263','#2a6172','#2e7581','#338589','#459c9a','#59adaa','#76bbb1','#9fd0ba'];
  function water(view,query) {
    const {depth,bed}=view.states.canal.fluid, a=[];
    // Adjacent wet cells share the same projected corner so their painted surfaces meet.
    const vertices=new Float64Array((nx+1)*(nz+1));
    for (let z=0;z<=nz;z++) for (let x=0;x<=nx;x++) {
      let sum=0,count=0;
      for (let v=Math.max(0,z-1);v<=Math.min(nz-1,z);v++) for (let u=Math.max(0,x-1);u<=Math.min(nx-1,x);u++) {
        const p=v*nx+u;
        if (depth[p]<.025) continue;
        sum+=bed[p]+depth[p];
        count++;
      }
      if (count) vertices[z*(nx+1)+x]=sum/count;
    }
    const wetPoint=(x,z)=>[origin[0]+x*cell,vertices[z*(nx+1)+x],origin[1]+z*cell];
    for(let z=0;z<nz;z++) for(let x=0;x<nx;x++){
      const i=z*nx+x,d=depth[i];
      if (d<.025) continue;
      const X=origin[0]+x*cell,Z=origin[1]+z*cell,Y=bed[i]+d;
      const slot=Math.min(ramps.length-1,Math.floor(2+d*4)+(i%11===0?1:0));
      a.push(shape([wetPoint(x,z),wetPoint(x+1,z),wetPoint(x+1,z+1),wetPoint(x,z+1)],ramps[slot]));
      if (x%5===0&&(z+x)%4===0&&d>.15)
        a.push(line([[X+.06,Y+.01,Z+.18],[X+.28,Y+.01,Z+.18]],ramps[Math.min(7,slot+1)]));
    }
    const at=query.probe('buoy/position').value,[x,y]=project(at).map(Math.round);
    a.push(rect(x-4,y-1,9,3,'#223643'),rect(x-3,y-2,7,3,'#b77251'),
      rect(x-2,y-2,5,1,'#f3bc76'),rect(x,y-4,1,2,'#fff1bd'));
    return draw(width,height,a);
  }

  function scene(view,query) {
    return P.raster.stack({width,height,layers:[{source:under},{source:water(view,query)},{source:over}]}).value;
  }
  const present=scene(run.view(),run.query());
  const action={action:'canal/gate',args:{gate:'sluice',opening:1}};
  const flows=Array.from({length:11},(_,i)=>({id:'current-'+i,field:'canal/flow',
    at:[-1.58+i*.63,0,i%2?.21:-.19],heightField:'canal/surface-height',lift:.035,seconds:.29,maxLength:.64,minSpeed:.09}));
  let pair={};
  const forecast=W.forecast.run(run,{steps:68,every:8,actions:[action],
    tracks:[{id:'cork-drifter',field:'buoy/position',offset:[0,.035,0]}],flows,
    compareView:{threshold:14,minPixels:5,render({view,query,branch}) {
      const value=scene(view,query);
      pair[branch]=value;
      return value;
    }}
  });
  if (run.checkpoint()!==checkpoint||!forecast.firstVisible) throw new Error('The forecast needs an intact checkpoint and visible water change');

  const panel=draw(sheet.width,sheet.height,[
    rect(0,0,sheet.width,sheet.height,'#101c25'),
    rect(10,8,2,14,amber),text(19,7,'WICKER SLUICE',pale,2),
    text(10,25,'CHECKPOINT 08',steel),
    rect(viewAt[0]-1,viewAt[1]-1,width+2,height+2,'#42606a'),
    rect(10,221,4,4,amber),text(18,219,'HOLD',steel),
    rect(70,221,4,4,mint),text(78,219,'OPEN',steel)
  ]);

  function viewAtTick(tick,branches=['baseline','proposal']) {
    const layer=W.forecast.layer(forecast,{tick,branches,radius:.25,ghosts:10,screenMarker:[width,height],
      colors:{baseline:amber,proposal:mint,first:gold}});
    const settings=composite.prepare({layers:[layer]},width,height);
    const overlays=composite.layers(settings,null,0,K.poly2.text,camera);
    const rgba=composite.compose({w:width,h:height,rgba:present.data},overlays,width,height,'nearest');
    return {width,height,channels:3,data:rgba.rgb};
  }

  function compare(tick,branches) {
    const elapsed=(tick-forecast.startTick)*dt;
    const first=forecast.firstVisible, changed=tick>=first.tick;
    const summary=draw(sheet.width,sheet.height,[
      text(217,25,'FORECAST +'+elapsed.toFixed(2)+' S',pale),
      ...(changed?[rect(147,221,4,4,gold),text(155,219,'FIRST CHANGE +'+((first.tick-forecast.startTick)*dt).toFixed(2)+' S',steel)]:[])
    ]);
    return P.raster.stack({...sheet,layers:[{source:panel},{source:viewAtTick(tick,branches),x:viewAt[0],y:viewAt[1]},
      {source:summary}]}).value;
  }

  function detail() {
    const {viewport,pixel:[x,y]}=forecast.firstVisible;
    const w=38,h=23, left=Math.min(viewport[0]-w,Math.max(0,x-19)), top=Math.min(viewport[1]-h,Math.max(0,y-11));
    const regions=['baseline','proposal'].map(branch=>P.raster.resize(P.raster.crop(pair[branch],{x:left,y:top,width:w,height:h}),
      {width:w*4,height:h*4,filter:'nearest'}));
    const width=332,height=129;
    const display=draw(width,height,[
      rect(0,0,width,height,'#101c25'),text(9,7,'FIRST CHANGED WATER PIXELS',pale),
      text(9,20,'HOLD GATE',amber),text(170,20,'OPEN SLUICE',mint)
    ]);
    return P.raster.stack({width,height,layers:[{source:display},{source:regions[0],x:9,y:33},{source:regions[1],x:170,y:33}]}).value;
  }
  return {forecast,sheet,fps,frames,compare,detail};
}

function mount(K,composite,makeStudy) {
  const study=makeStudy(K,composite),{forecast}=study,$=id=>document.getElementById(id);
  const canvas=$('view'),slider=$('tick'),play=$('play'),context=canvas.getContext('2d');
  canvas.width=study.sheet.width;
  canvas.height=study.sheet.height;
  slider.min=forecast.startTick;
  slider.max=forecast.endTick;
  const pixels=new ImageData(canvas.width,canvas.height);
  let tick=forecast.endTick, origin, request, playing=false;
  function draw() {
    const branches=['baseline','proposal'].filter(branch=>$(branch).checked);
    pixels.data.set(study.compare(tick,branches).data);
    context.putImageData(pixels,0,0);
    slider.value=tick;
    const {firstVisible:first}=forecast;
    $('status').textContent=tick<first.tick?'Both rendered views still match':
      'First visible difference at tick '+first.tick+' · '+first.changed+' changed art pixels';
  }
  function tickFrame(now) {
    origin ??= now-(tick-forecast.startTick)*1000/study.fps;
    const next=Math.min(forecast.endTick,forecast.startTick+Math.floor((now-origin)*study.fps/1000+1e-9));
    if (next!==tick) {tick=next;draw();}
    if (tick===forecast.endTick) pause();
    if (playing) request=requestAnimationFrame(tickFrame);
  }
  function pause() {
    playing=false;
    cancelAnimationFrame(request);
    play.textContent='Play forecast';
  }
  play.addEventListener('click',()=>{
    if (playing) return pause();
    if (tick===forecast.endTick) {tick=forecast.startTick;draw();}
    playing=true;origin=undefined;
    play.textContent='Pause';
    request=requestAnimationFrame(tickFrame);
  });
  slider.addEventListener('input',()=>{pause();tick=+slider.value;draw();});
  $('first').addEventListener('click',()=>{pause();tick=forecast.firstVisible.tick;draw();});
  for (const branch of ['baseline','proposal']) $(branch).addEventListener('change',draw);
  const detail=study.detail(), comparison=$('evidence');
  comparison.width=detail.width;
  comparison.height=detail.height;
  comparison.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(detail.data),detail.width,detail.height),0,0);
  draw();
}

if (require.main===module) {
  const out=process.argv[2]??'out/wicker-sluice';
  fs.mkdirSync(out,{recursive:true});
  const study=createStudy(ink.load().KIT,composite),{forecast}=study;
  const cels=Array.from({length:study.frames},(_,i)=>{
    const p=Math.min(1,Math.max(0,(i-6)/60));
    const tick=forecast.startTick+Math.round(p*(forecast.endTick-forecast.startTick));
    return png.packRGBA(study.compare(tick));
  });
  fs.writeFileSync(path.join(out,'wicker-sluice.png'),png.encodeAnimation(cels,study.fps));
  fs.writeFileSync(path.join(out,'wicker-sluice-still.png'),png.encodeFrame(cels.at(-1)));
  fs.writeFileSync(path.join(out,'wicker-sluice-first-difference.png'),png.encodeFrame(png.packRGBA(study.detail())));
  fs.writeFileSync(path.join(out,'wicker-sluice-forecast.json'),JSON.stringify(forecast));
  const packed=gzipSync(ink.bundle()+'\nreturn { KIT, FrameComposite };',{level:9}).toString('base64');
  const template=fs.readFileSync(path.join(__dirname,'simulation-forecast.html.template'),'utf8');
  fs.writeFileSync(path.join(out,'wicker-sluice.html'),template.replace('/* DEMO */',()=>`
    const bytes=Uint8Array.from(atob('${packed}'),char=>char.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const {KIT,FrameComposite}=new Function(await new Response(stream).text())();
    (${mount.toString()})(KIT,FrameComposite,${createStudy.toString()});
  `));
}
