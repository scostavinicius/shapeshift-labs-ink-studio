/* A cold spillway releases a sheet of ice into a warmer channel. */
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');

const cell = .28, origin = [-4.76, 0, -.84], size = [34, 7, 6];
const rim = [[8,1,2], [9,1,2], [10,1,2], [8,1,3], [9,1,3]];
const duration = 122;

function definition() {
  const start = [];
  for (let z=1; z<=4; z++) for (let x=5; x<=32; x++) {
    const target = rim.some(([u,,v]) => x===u && z===v);
    const feed = x>=6 && x<=8 && (z===2 || z===3);
    const liquid = target ? 2.40 : feed ? .65 : .05 + (x%3)*.018;
    start.push({ at:[x,z], liquid, temperature:target || feed ? 2 : 8 });
  }
  const closed = [];
  for (let x=0; x<size[0]; x++) closed.push([x,0],[x,5]);
  const cut = x => origin[0]+x*cell;
  return {
    format:'ink-studio/world', version:1, id:'winter-spillway', seed:26, dt:1/24,
    systems:{ spill:{ kind:'material-cells', config:{
      size, origin, cell, gravity:[0,0,0], drag:.045, ground:0,
      materials:{ ice:{ density:1000, specificHeat:4.18, ramp:[0xaedfe1] } },
      phase:{
        material:'ice', layer:1, waterline:.215, latentHeat:334, liquidCapacity:3,
        leveling:.14, current:[.24,0], closed, initial:start,
        climate:[
          { min:[cut(7.9),-.31],max:[cut(9.9),.30],temperature:-35,rate:1.6 },
          { min:[cut(9.9),-.31],max:[cut(10.95),.015],temperature:-30,rate:1.3 },
          { min:[-.30,-.84],max:[4.76,.84],temperature:44,rate:2.3 }
        ]
      }
    } } },
    visual:{ volume:'spill', camera:{ target:[0,.42,0],dist:10.2,pitch:.34,yaw:.03 }, look:{ pixel:true } },
    commands:[{ tick:37, action:'spill/lift', args:{ body:'ice-lip', cells:rim,
      velocity:[1.72,.002,.02], angular:[.025,.31,-.035] } }]
  };
}

function sequence(kit, visit) {
  const W = kit.KIT.world, source = definition(), run = W.runtime.create(source);
  const events = [], moments = {};
  for (let tick=0; tick<=duration; tick++) {
    if(tick) run.step();
    for(const event of run.events){
      if(!['material-freeze','material-lift','material-melt','material-melt-split'].includes(event.kind))continue;
      events.push(event);
      if(event.kind==='material-freeze')moments.freeze??=tick;
      if(event.kind==='material-lift')moments.lift=tick;
      if(event.kind==='material-melt'&&event.body){moments.melt??=tick; moments.lastMelt=tick;}
    }
    const query=run.query(), read=name=>query.probe('spill/'+name).value;
    if (visit) visit({ tick, time:tick*source.dt, balance:read('balance'), field:read('phases'), cells:read('cells'),
      pieces:read('pieces'), events:events.slice(), moments:{...moments} });
  }
  if(!moments.freeze||!moments.lift||!moments.melt||moments.melt<=moments.lift||moments.lastMelt<=moments.melt)
    throw Error('The spillway needs a frozen patch, a drifting body and a staged melt');
  return { source, recording:run.recording(), moments, events };
}

module.exports = { definition, sequence };

function painter(K) {
  const width=336, height=184, D=K.procedural.drawing2d, R=K.procedural.raster;
  const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
  const poly=(points,fill)=>({type:'polygon',points,fill});
  const line=(points,color,width=1)=>({type:'path',points,color,width});
  const art=commands=>D.render({width,height,commands,edges:'hard'});
  const p=([x,y,z])=>[Math.round(168+28*x+14*z),Math.round(131-43*y+17*z)];
  const seed=(i,j,k)=>K.hash(i,j,k);
  const bg=[
    rect(0,0,width,height,'#18283f'),rect(0,21,width,89,'#24364c'),
    rect(0,47,width,45,'#354554'),rect(0,66,width,31,'#475862'),
    rect(0,83,width,23,'#5d696c')
  ];
  const disk=(x,y,r,fill)=>poly(Array.from({length:24},(_,i)=>{
    const a=i*Math.PI/12;
    return [Math.round(x+Math.cos(a)*r),Math.round(y+Math.sin(a)*r)];
  }),fill);
  bg.push(disk(260,56,25,'#625f68'),disk(260,56,20,'#806f71'),disk(260,56,15,'#b48c7e'),
    disk(260,56,11,'#f7c192'),rect(256,49,10,2,'#ffe0ad'));
  bg.push(poly([[0,85],[29,64],[53,76],[74,57],[98,63],[131,37],[144,45],[160,65],[174,60],
    [203,50],[233,74],[267,71],[301,55],[335,69],[336,109],[0,109]],'#394654'),
    poly([[88,67],[131,37],[144,45],[163,69],[145,59],[142,61],[134,51],[127,58],[114,57],[107,63]],'#758186'),
    poly([[127,42],[131,37],[144,45],[151,54],[141,49],[137,50]],'#a2a298'),
    poly([[176,61],[203,50],[221,64],[206,59],[199,60],[193,58]],'#68767c'),
    poly([[0,97],[37,83],[61,90],[101,79],[122,87],[141,77],[164,85],[190,72],[214,83],
      [244,76],[269,92],[300,77],[336,84],[336,120],[0,120]],'#344957'),
    poly([[0,105],[37,98],[61,105],[103,98],[136,101],[152,96],[177,100],[213,94],
      [246,102],[291,98],[335,104],[336,133],[0,133]],'#293f50'));
  for(const [x,y,n] of [[212,45,21],[244,33,35],[271,40,28],[182,28,19],[290,74,24],[135,21,38]])
    bg.push(rect(x,y,n,1,'#635b66'),rect(x+6,y+2,n-4,1,'#495364'));
  bg.push(poly([[0,116],[26,112],[49,116],[72,111],[105,114],[130,108],[169,113],[204,109],
    [225,112],[252,108],[282,113],[312,108],[336,110],[336,184],[0,184]],'#265265'),
    poly([[0,124],[58,118],[106,125],[146,117],[185,119],[215,115],[250,120],[293,117],[336,118],
      [336,152],[257,156],[225,160],[178,149],[103,169],[46,167],[0,198]],'#316779'),
    poly([[0,132],[63,124],[103,133],[142,124],[182,129],[219,124],[239,128],[276,122],[336,126],
      [336,145],[296,141],[242,151],[189,141],[132,151],[98,146],[42,157],[0,157]],'#377684'),
    poly([[0,149],[52,142],[82,149],[110,143],[148,151],[173,147],[215,151],[254,148],[298,152],
      [336,142],[336,184],[0,184]],'#285564'));
  for(let i=0;i<145;i++){
    const x=Math.floor(seed(i,5,4)*334),y=114+Math.floor(seed(i,6,6)*56),length=2+i%12;
    bg.push(rect(x,y,Math.min(width-x,length),1,
      ['#3e7e89','#3d717f','#326476','#498693','#57909a'][i%5]));
  }
  function pine(target,x,y,h,tone,shade) {
    target.push(rect(x,y-h+5,1,h-3,shade));
    for(let i=0;i<4;i++){
      const center=y-h+Math.round((i+1)*h/5),w=Math.round((i+2)*h/11);
      target.push(poly([[x,center-7],[x+w,center+4],[x+2,center+4],[x,center+6],
        [x-w-1,center+5]],tone));
    }
  }
  for(const [i,x] of [3,12,19,126,135,143,151,272,281,290,300,308,316,325,332].entries()){
    const y=109-Math.round(seed(i,9,13)*9), h=8+Math.floor(seed(i,11,5)*19);
    pine(bg,x,y,h,i%3?'#243a47':'#334c53','#435d61');
  }
  bg.push(poly([[0,111],[26,102],[34,83],[57,80],[69,108],[57,128],[35,124],[20,129],[0,133]],'#283d49'),
    poly([[0,113],[24,105],[35,88],[48,87],[53,105],[44,111],[28,112],[21,124],[0,123]],'#647373'),
    poly([[0,106],[29,102],[34,85],[52,84],[63,93],[49,94],[45,101],[23,107],[0,112]],'#a8b5a9'),
    poly([[243,114],[251,103],[269,99],[292,102],[313,93],[336,99],[336,129],[279,126]],'#405963'),
    poly([[251,107],[258,101],[268,97],[280,100],[299,99],[313,91],[322,91],[336,98],[336,104],
      [310,99],[290,108],[277,104],[264,106]],'#98a9a3'),
    poly([[256,118],[268,112],[286,115],[303,112],[312,116],[336,109],[336,124],[314,127],[292,123]],'#597177'));

  // Snow-packed masonry and the narrow cold chute.
  bg.push(poly([[16,59],[36,52],[100,51],[121,58],[125,102],[117,112],[18,115]],'#283642'),
    poly([[20,58],[36,50],[100,50],[121,58],[103,65],[25,67]],'#91a09b'),
    poly([[33,50],[99,48],[119,54],[104,59],[23,60]],'#b9c6b6'),
    poly([[27,63],[106,61],[107,109],[25,112]],'#56656b'),
    poly([[107,62],[121,57],[124,101],[116,111],[105,109]],'#364b57'),
    poly([[19,101],[54,98],[98,100],[109,108],[100,120],[22,126]],'#465e64'),
    poly([[18,101],[33,97],[97,98],[112,104],[100,109],[21,112]],'#84948b'),
    poly([[20,100],[35,95],[66,96],[74,98],[99,96],[107,101],[98,104],[58,103],[29,107],[18,105]],'#b5c1ac'));
  for(let row=0;row<5;row++){
    const y=65+row*7;
    bg.push(rect(26,y,77,1,'#3b4f5b'),rect(27,y+1,77,1,'#78877f'));
    for(let x=31+(row%2)*7; x<102; x+=14){
      bg.push(rect(x,y,1,7,'#435764'),rect(x+2,y+2,5+(row%4),1,row%2?'#697b78':'#859287'));
    }
  }
  bg.push(poly([[75,89],[76,69],[80,63],[85,60],[96,61],[104,65],[108,73],[108,90]],'#273a4b'),
    poly([[79,85],[79,71],[84,65],[95,65],[103,70],[104,88]],'#203346'),
    rect(85,68,14,2,'#4f6d74'),rect(83,71,20,3,'#2d5667'),
    rect(78,92,32,3,'#334c59'),rect(78,94,29,1,'#819084'),
    rect(64,55,7,7,'#725a53'),rect(65,56,5,4,'#b98462'),rect(67,57,2,2,'#ffd391'),
    poly([[66,52],[71,54],[71,57],[62,57],[62,54]],'#584b54'));

  // Timber-and-brass thaw conduit on the opposite shore.
  bg.push(poly([[244,96],[250,84],[268,78],[280,83],[282,101],[270,111],[246,106]],'#323d4d'),
    rect(254,85,22,15,'#4f515a'),rect(256,85,18,2,'#927571'),
    rect(248,96,36,3,'#7b5b59'),rect(247,98,37,3,'#4b4756'),
    rect(253,101,4,15,'#463f50'),rect(272,100,4,15,'#463f50'),
    rect(257,102,1,11,'#846958'),rect(275,102,1,11,'#957664'),
    poly([[266,77],[270,76],[275,78],[275,82],[270,85],[265,83]],'#917369'),
    rect(270,81,4,15,'#755b59'),rect(270,90,2,3,'#c79560'),
    rect(242,101,16,3,'#5d5060'),rect(241,101,5,2,'#cd9865'),
    rect(259,90,7,4,'#bd805e'),rect(260,90,5,2,'#ffcd8f'),
    rect(260,95,5,1,'#826660'),rect(279,93,4,1,'#c48f6b'));

  const shore=[
    poly([[0,164],[25,156],[50,157],[67,151],[91,155],[116,153],[141,160],[163,158],
      [180,167],[227,158],[248,162],[273,151],[299,146],[317,148],[336,142],[336,184],[0,184]],'#203a49'),
    poly([[0,168],[23,161],[45,163],[64,156],[77,156],[88,160],[122,158],[143,164],[162,162],
      [179,172],[202,166],[226,163],[250,165],[278,156],[299,151],[316,154],[336,147],[336,184],[0,184]],'#354f59'),
    poly([[0,174],[28,169],[49,172],[69,166],[92,169],[113,164],[129,170],[163,170],[176,178],
      [208,171],[223,170],[243,174],[267,166],[291,163],[313,157],[336,153],[336,184],[0,184]],'#293e4c')
  ];
  for(const [i,[x,y,span]] of [[7,166,27],[44,165,21],[78,160,22],[114,160,13],[160,165,13],
    [206,168,24],[246,167,22],[280,156,21],[313,151,28],[14,178,33],[294,170,35]].entries()){
    shore.push(poly([[x-3,y+2],[x+8,y-2],[x+span-5,y-2],[x+span,y+2],[x+span-5,y+4],[x,y+4]],
      ['#718780','#9aaba0','#a3b2a5'][i%3]));
    shore.push(rect(x+4,y+4,span-5,2,'#4c6769'),rect(x+8,y,span-10,1,'#bcc6ad'));
  }
  for(const [i,x] of [1,9,19,29,40,312,322,331].entries())
    pine(shore,x,i<5?175:171,25+i%3*8,i%2?'#122c3c':'#1d3744','#385460');
  const background=art(bg), foreground=art(shore);

  const view=[-.5,.4,1], sideNormals=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  function iceArt(cells,pieces,commands){
    const faces=[];
    function collect(rows,body){
      const positions=new Set(rows.map(row=>row.at.join()));
      for(const row of rows)for(const [side,n] of sideNormals.entries()){
        if(positions.has(K.V.add(row.at,n).join()))continue;
        const normal=body?K.M.app(body.rotation,n):n;
        if(K.V.dot(normal,view)<=.018)continue;
        const u=side<2?[0,1,0]:[1,0,0], v=K.V.cross(n,u);
        const center=K.V.mad(row.point,normal,cell/2);
        const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>{
          const offset=K.V.mul(K.V.add(K.V.mul(u,a),K.V.mul(v,b)),cell/2);
          return p(K.V.add(center,body?K.M.app(body.rotation,offset):offset));
        });
        faces.push({corners,depth:K.V.dot(center,view),normal,id:row.id,side});
      }
    }
    collect(cells);
    for(const piece of Object.values(pieces))collect(piece.cells,piece.body);
    faces.sort((a,b)=>a.depth-b.depth);
    for(const {corners,normal,side,id} of faces){
      const top=normal[1]>.42;
      const base=top?(id%2?'#a6dbd7':'#b8e8df'):normal[2]>.5?
        (id%2?'#609eac':'#75b0ba'):'#477e94';
      const point=(x,y)=>[
        Math.round(corners[0][0]+(corners[1][0]-corners[0][0])*x+(corners[3][0]-corners[0][0])*y),
        Math.round(corners[0][1]+(corners[1][1]-corners[0][1])*x+(corners[3][1]-corners[0][1])*y)
      ];
      commands.push(poly(corners,base));
      if(top){
        commands.push(poly([point(.03,.30),point(.38,.22),point(.84,.66),point(.62,.99)],'#81bdc3'),
          line([point(.12,.10),point(.60,.13),point(.88,.38)],'#e1f4e2'));
      } else {
        commands.push(poly([point(.46,.14),point(.71,.14),point(.98,.65),point(.99,.86)],'#5792a3'),
          line([point(.14,.09),point(.18,.68),point(.42,.86)],side%2?'#c2e7df':'#c9e8dd'));
      }
    }
  }

  function render({tick,field,cells,pieces,events,moments}){
    const stage=[];
    for(let i=0;i<85;i++){
      const y=115+Math.floor(seed(i,8,56)*41), glide=tick*(.26+(y-114)*.009);
      const x=Math.floor((seed(i,81,36)*336+glide)%336), w=2+i%9;
      stage.push(rect(x,y,Math.min(w,336-x),1,['#4e8994','#42818c','#6fa6a8','#34727e'][i%4]));
    }
    for(const {point,liquid,ice} of field){
      const total=(liquid+ice)/(1000*cell**3);
      if(total<.1)continue;
      const [x,base,z]=point, y=base+.10*Math.min(total,1);
      const stretch=Math.min(.46,.19+.15*total), span=.070+.029*Math.min(total,1.8);
      const top=[p([x-stretch,y,z-span]),p([x+stretch*.76,y,z-span]),
        p([x+stretch,y,z+span*.6]),p([x-stretch*.70,y,z+span])];
      const frozen=ice/(liquid+ice), shine=frozen>.42?'#bae0dc':total>.66?'#7cc1c1':'#579da7';
      stage.push(poly(top,frozen>.42?'#78b5c2':total>.66?'#599eaa':'#417f8c'));
      stage.push(line([top[0],top[1]],shine));
      if(total>.28){
        const rim=p([x+stretch*.55,y,z+.01]);
        stage.push(rect(rim[0],rim[1],2,1,frozen>.42?'#d5eee1':'#72b1b6'));
      }
    }
    // The painted falling sheet provides scene context for the retained pool at its foot.
    stage.push(poly([[82,74],[101,74],[101,83],[106,99],[112,109],[125,117],[122,121],[105,119],
      [95,112],[91,100],[88,83],[82,81]],'#60999f'),
      poly([[87,74],[95,74],[96,87],[99,105],[109,115],[115,116],[111,119],[105,116],[97,108],[92,95],[90,82]],'#9ccccc'),
      poly([[84,75],[88,76],[89,87],[94,101],[93,106],[89,99],[86,85]],'#71b6ba'),
      line([[96,77],[96,89],[101,104],[107,112],[115,116]],'#c4e7dc'));
    for(let lane=0;lane<7;lane++){
      const y=77+((tick*(2+(lane%3))+lane*7)%39), row=(y-77)/39;
      const x=86+lane*2+Math.floor(row*row*13);
      stage.push(rect(x,y,1,2+(lane%3),lane%2?'#d9f1de':'#6fa8ac'));
    }
    for(let i=0;i<21;i++){
      const angle=(tick*.19+i*.51)%1, x=100+Math.floor(seed(i,38,59)*32)+Math.floor(angle*8);
      const y=117-Math.floor(6*Math.sin(angle*Math.PI)*seed(i,19,117));
      stage.push(rect(x,y,angle>.5?2:1,1,angle>.67?'#78b6b8':'#b9e1db'));
    }
    iceArt(cells,pieces,stage);
    if(moments.lift && tick-moments.lift<10){
      const elapsed=tick-moments.lift;
      for(let i=0;i<19;i++){
        const x=100+Math.floor(seed(i,5,45)*19)+Math.floor(elapsed*(.3+seed(i,3,9)*1.5));
        const y=115+Math.floor(seed(i,7,82)*6)-Math.floor(seed(i,1,17)*elapsed)+Math.floor(elapsed**2/12);
        stage.push(rect(x,y,i%5?1:2,1,elapsed<6?'#e0f4df':'#8fc2c4'));
      }
    }
    for(const event of events){
      if(event.kind!=='material-melt'||!event.body||tick-event.tick>=13)continue;
      const age=tick-event.tick, [x,y]=p([origin[0]+(event.destination[0]+.5)*cell,.29,
        origin[2]+(event.destination[2]+.5)*cell]);
      const w=3+Math.floor(age*.56), hue=age<5?'#d3e7da':age<9?'#a4c8c2':'#80aaa9';
      stage.push(rect(x-w-2,y,w,1,hue),rect(x+2,y+1,w+2,1,hue),rect(x-3,y+3,5+age%6,1,'#78acae'));
    }
    // Condensation at the warm vent delineates the thaw front.
    for(let i=0;i<10;i++){
      const t=(tick+i*7)%29;
      const x=245+Math.floor(seed(i,12,71)*11)-Math.floor(t*.67),y=106-Math.floor(t*.59)-i%3;
      if(t<22)stage.push(rect(x,y,2+i%5,1,t<11?'#ab968b':'#77767b'));
    }
    return R.stack({width,height,layers:[{source:background},{source:art(stage)},{source:foreground}]}).value;
  }
  return render;
}

if(require.main===module){
  const directory=path.resolve(process.argv[2]??'studio/spillway-phase');
  const framesPath=path.join(directory,'frames');
  fs.mkdirSync(framesPath,{recursive:true});
  const kit=ink.load(), paint=painter(kit.KIT), frames=[], images=[];
  const {source,recording,moments,events}=sequence(kit,state=>{
    if(state.tick%2) return;
    const {tick,time,balance,pieces}=state;
    const {width,height,data}=paint(state), image=PNG.encode(width,height,data,4);
    fs.writeFileSync(path.join(framesPath,String(frames.length).padStart(3,'0')+'.png'),image);
    images.push('data:image/png;base64,'+image.toString('base64'));
    const {liquidMass,fieldIceMass,solidMass,mass,massError,energyError,phaseEnergy}=balance;
    frames.push({tick,time,liquidMass,fieldIceMass,solidMass,mass,massError,energyError,phaseEnergy,
      afloat:Object.values(pieces).reduce((n,piece)=>n+piece.body.mass,0)});
  });
  for(const [filename,value] of Object.entries({'spillway.world':source,'spillway.run':recording,
    'spillway-trace':{moments,frames,events}}))
    fs.writeFileSync(path.join(directory,filename+'.json'),JSON.stringify(value,null,2)+'\n');
  const template=fs.readFileSync(path.join(__dirname,'spillway-phase.html.template'),'utf8');
  fs.writeFileSync(path.join(directory,'winter-spillway.html'),template.replace('/* STUDY */',()=>
    'const { frames, images, moments } = '+JSON.stringify({frames,images,moments})+';'));
}
