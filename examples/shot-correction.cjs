/* Kingfisher's Turn. An authored micro-fix holds the gloss on a turning enamel pin. */
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const ink = require('..');
const PNG = require('../cli/png.js');

function study({ KIT: K, makeBuilder, SpriteSurface }) {
  const w = 194, h = 132, fps = 12, count = 48, enamelW = 96, enamelH = 80, step = .040;
  const D = K.procedural.drawing2d;
  const rect = (x,y,w,h,fill) => ({ type:'rect',rect:[x,y,w,h],fill });
  const oval = (x,y,w,h,fill) => ({ type:'ellipse',rect:[x,y,w,h],fill });
  const poly = (points,fill) => ({ type:'polygon',points,fill });
  const line = (points,color,width=1) => ({ type:'path',points,color,width });
  const art = (width,height,commands) => D.render({ width,height,commands,edges:'hard' });
  const swatches = ['#fff1bc','#bdddc8','#77bab6','#427f88','#265465'];
  const hook = [[0,-1,swatches[0]],[0,0,swatches[0]],[1,0,swatches[0]]];
  const shell = [[45,3],[56,3],[68,9],[81,16],[88,28],[92,41],[84,57],[75,66],
    [60,72],[49,78],[39,74],[27,69],[15,60],[8,50],[4,39],[9,25],[19,15],[35,8]];
  const commands = [
    poly(shell,'#382836'),
    poly([[45,4],[56,4],[67,10],[80,17],[87,29],[91,40],[83,55],[74,65],[60,71],
      [49,76],[39,73],[28,67],[16,58],[9,49],[5,39],[10,26],[20,16],[37,8]],'#82524e'),
    poly([[44,5],[55,5],[67,10],[79,17],[86,28],[89,39],[81,53],[72,63],
      [59,69],[48,74],[39,70],[27,64],[16,56],[10,47],[7,38],[12,26],[21,17],[36,11]],'#cb966b'),
    poly([[44,7],[54,7],[66,12],[78,19],[84,30],[87,38],[79,52],[70,62],
      [58,68],[48,72],[38,67],[27,63],[17,55],[11,46],[9,38],[14,27],[23,19],[36,12]],'#70494b'),
    poly([[44,9],[54,9],[65,14],[75,20],[81,30],[84,38],[78,51],[68,60],
      [57,66],[48,69],[39,65],[28,61],[18,54],[13,46],[12,37],[16,28],[24,21],[37,14]],'#e2b37d'),
    poly([[44,11],[54,11],[64,16],[73,22],[79,32],[81,38],[76,49],[66,57],
      [56,63],[48,67],[40,63],[29,59],[20,52],[15,44],[14,38],[18,29],[26,22],[38,16]],'#223c52'),
    poly([[45,12],[54,13],[64,18],[72,23],[78,32],[79,37],[74,48],[65,56],
      [55,62],[47,65],[40,61],[29,57],[21,50],[17,43],[16,37],[20,29],[27,23],[38,17]],'#285667'),
    poly([[18,34],[27,25],[38,19],[45,14],[56,16],[64,23],[70,33],[67,42],[59,47],
      [45,48],[32,52],[25,48],[19,42]],'#326875'),
    poly([[16,41],[24,46],[34,51],[47,48],[61,46],[75,40],[76,46],[67,55],
      [55,61],[48,64],[40,61],[29,57],[21,50]],'#23495d'),
    line([[20,52],[29,57],[39,61],[50,61],[64,56]],'#467d81'),
    line([[25,55],[33,58],[41,60]],'#5d8e88'),
    rect(37,56,12,1,'#3e7481'),rect(24,46,6,1,'#45808a'),rect(64,46,10,1,'#376b78'),
    rect(57,55,11,1,'#427982'),rect(53,59,6,1,'#679b91')
  ];
  // Wing and crown plate colors. The warmer breast separates the teal feathers.
  commands.push(
    poly([[23,49],[32,44],[39,39],[47,35],[49,27],[56,22],[64,20],[69,22],[72,27],
      [82,30],[70,32],[68,37],[65,46],[57,52],[45,54],[31,55]],'#182e43'),
    poly([[25,49],[34,44],[40,40],[48,36],[52,31],[58,28],[64,29],[71,31],[67,37],
      [65,44],[58,50],[46,52],[36,52],[29,54]],'#bb795d'),
    poly([[53,31],[58,29],[63,30],[66,33],[63,36],[64,40],[59,46],[50,51],[41,52],
      [50,44],[52,37]],'#d99365'),
    poly([[55,33],[59,32],[62,33],[59,37],[60,41],[55,45],[50,47],[53,41]],'#f0b677'),
    poly([[26,49],[31,46],[41,41],[46,37],[51,35],[55,38],[52,44],[45,49],[36,49],[30,52]],'#307d89'),
    poly([[31,48],[41,42],[47,37],[52,37],[50,40],[43,45],[37,46]],'#4f9eaa'),
    poly([[26,50],[32,48],[38,49],[34,51],[30,52]],'#286275'),
    poly([[48,33],[50,27],[56,23],[64,21],[68,23],[70,27],[68,31],[63,34],[57,34],
      [54,37],[50,37]],'#36858e'),
    poly([[51,28],[56,24],[64,22],[67,24],[68,25],[62,26],[58,28],[54,31],[50,31]],'#8ac4bb'),
    poly([[55,30],[60,26],[66,26],[69,28],[65,31],[61,32]],'#6bb2ad'),
    poly([[66,28],[71,27],[79,29],[81,30],[69,31]],'#dbab78'),
    line([[70,29],[78,29]],'#f0c890'),
    rect(65,26,2,2,'#24394a'),rect(66,26,1,1,'#edcf98'),rect(50,36,3,1,'#6cb1ad'),
    rect(42,43,3,1,'#8dc3b9'),rect(36,46,4,1,'#68a9a9'),
    line([[34,55],[43,55],[52,53],[58,49]],'#7c6b68'),
    line([[34,54],[44,54],[52,52],[58,49]],'#c6a171'),
    poly([[47,53],[49,53],[50,56],[46,56],[44,55]],'#c08b67'),
    rect(56,49,2,2,'#e6b981')
  );
  for (const [x,y,a,b] of [[11,38,4,2],[18,51,3,2],[31,61,5,2],[44,67,7,2],[57,63,4,2],
    [69,57,4,2],[77,47,2,3],[82,36,2,3],[69,17,4,2],[52,10,3,2],[31,15,4,2],[19,23,3,2]]) {
    commands.push(oval(x,y,a,b,'#513b43'),rect(x,y,Math.max(1,a-2),1,'#e7c18e'));
  }
  for (const [x,y,a,b] of [[37,8,8,1],[22,15,5,1],[47,5,6,1],[67,12,3,1],[74,16,3,1],
    [8,32,1,4],[11,25,2,3],[16,21,2,2],[14,51,1,3],[71,65,3,1],[83,53,2,2],
    [88,38,1,3],[56,69,5,1],[34,66,3,1],[48,72,4,1]]) commands.push(rect(x,y,a,b,'#e9bb86'));
  for (const [x,y] of [[38,23],[27,30],[28,34],[35,26],[21,42],[61,53],[67,49],[42,57],[33,58],[45,18],[47,15]]) {
    commands.push(rect(x,y,1,1,'#609393'));
  }

  const painting=art(enamelW,enamelH,commands), backing=art(enamelW,enamelH,[poly(shell,'#ffffff')]);
  const B=makeBuilder(61,[0x191b2c,0x253444,0x386e7b,0x65a99f,0xbdddc8,0xcb966b,0xfff1bc]);
  const at = (x,y,z=.190) => [(x+.5-enamelW/2)*step,(enamelH/2-y-.5)*step,z];
  const paintedAt=[60,29], hookWorld=at(...paintedAt);
  const silhouette=(x,y)=>x>=0&&y>=0&&x<enamelW&&y<enamelH&&backing.data[(y*enamelW+x)*4+3]>0;
  for (const [z,col] of [[-.02,[68,42,48]],[.038,[103,63,57]],[.095,[164,105,74]],[.137,[124,79,62]]]) {
    for (let y=1;y<enamelH-1;y++) for (let x=1;x<enamelW-1;x++) {
      if (!silhouette(x,y)||[[-1,0],[0,-1],[1,0],[0,1],[-2,0],[0,2]].every(([a,b])=>silhouette(x+a,y+b))) continue;
      B.disc(...at(x,y,z),[0,0,1],step*.86,.011,col,2.35);
    }
  }
  B.describeSplats(0,B.count(),{object:'kingfisher',material:'brass'});
  const first=B.count();
  let pinRow;
  for (let y=0;y<enamelH;y++) for(let x=0;x<enamelW;x++) {
    const i=(y*enamelW+x)*4;
    if (!painting.data[i+3]) continue;
    if (x===paintedAt[0]&&y===paintedAt[1]) pinRow=B.count();
    B.disc(...at(x,y),[0,0,1],step*.69,.005,
      [painting.data[i],painting.data[i+1],painting.data[i+2]],2.5);
  }
  B.describeSplats(first,B.count(),{object:'kingfisher',material:'enamel',target:{surface:'enamel-face'}});
  if(pinRow===undefined)throw Error('The glint needs a real enamel anchor');

  const tray = SpriteSurface.make(260);
  const velvet = [
    rect(0,0,238,164,'#272637'),rect(0,5,238,154,'#31283a'),
    poly([[0,12],[238,0],[238,26],[0,44]],'#392c42'),
    poly([[0,41],[238,16],[238,32],[0,64]],'#30273b'),
    poly([[0,116],[238,85],[238,104],[0,135]],'#3d3044'),
    poly([[0,126],[238,100],[238,118],[0,158]],'#332b3f'),
    rect(0,149,238,15,'#292638')
  ];
  for(let i=0;i<235;i++){
    const x=Math.floor(K.hash(i,8,73)*235),y=Math.floor(K.hash(i,29,11)*163);
    velvet.push(rect(x,y,i%7===0?3:1,1,i%3===0?'#48384a':'#3d3043'));
  }
  for(const [y,tone] of [[10,'#4d3948'],[12,'#705052'],[143,'#4a3846'],[145,'#664b4e']])
    velvet.push(rect(0,y,238,1,tone));
  for(const [x,y] of [[16,13],[218,13],[17,148],[218,148]]) {
    velvet.push(poly([[x-5,y],[x,y-3],[x+5,y],[x,y+3]],'#8a635f'),
      rect(x-2,y,5,1,'#bf9376'),rect(x,y-1,1,3,'#d3aa85'));
  }
  const cloth=art(238,164,velvet);
  tray.face([-5,-3.30,-.48],[10,0,0],[0,6.60,0],cloth.width,cloth.height,(x,y)=>{
    const i=(y*cloth.width+x)*4,{data}=cloth;
    return data[i]*65536+data[i+1]*256+data[i+2];
  });

  const pale=swatches[0], view=[[-.21,0,1],[.21,0,1]];
  const family = { minLight:0, sizes:[{ id:'painted-gloss',minPixels:0,cels:[
    {id:'linked',view:view[0],pivot:[0,1],stamp:{width:2,height:2,rows:['0.','00'],palette:[pale]}},
    {id:'split',view:view[1],pivot:[0,1],stamp:{width:2,height:2,rows:['0.','.0'],palette:[pale]}}
  ]}]};
  const camera={target:[0,.01,.10],dist:6.55,fov:.65,ortho:true,yaw:-.32,pitch:.085};
  const yawAt=i=>-.32+.64*i/(count-1);
  function glossPoint(time) {
    const yaw=yawAt(time*fps), pitch=camera.pitch;
    // Lift toward the orthographic eye to clear the enamel without changing the native XY pin.
    return K.V.mad(hookWorld,[Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch),Math.cos(pitch)*Math.cos(yaw)],.03);
  }
  const world=B.finish({cam:camera,radius:8,detail:27,dither:0,spriteSurfaces:tray.finish(),
    highlightCels:[{id:'crown-gloss',family,light:'jeweler',at:glossPoint,span:.23,bias:0}],
    areaLights:[K.lightEmitters.disc({id:'jeweler',at:[hookWorld[0],hookWorld[1],3],normal:[0,0,-1],
      size:[.13,.13],sampleGrid:1,radius:7,intensity:1.2,color:'#ffe1ae',shadows:false,visible:false})]
  });
  world.splatIds=Array.from({length:world.count},(_,i)=>i===pinRow?'kingfisher/crown-gloss':'kingfisher/texel/'+i);
  const anchor={splat:'kingfisher/crown-gloss',offset:[0,0],target:{object:'kingfisher',surface:'enamel-face',material:'enamel'}};
  const blank={size:[w,h],fps,corrections:[]};
  const guide={id:'pin-guide',frames:[0,count-1],anchor,pixels:[]};
  function options(i) {
    const phase=i/(count-1);
    return { w,h,width:w,height:h,px:1,raw:true,shotCorrectionFrame:i,t:i/fps,
      camera:{...camera,yaw:yawAt(i),target:[.14-.26*phase,.015,.10]} };
  }
  return { w,h,fps,count, world, options,blank,anchor,hook,guide,swatches };
}

function atRGB(frame,x,y) {
  const offset=(y*frame.w+x)*3;
  return Array.from(frame.rgb.subarray(offset,offset+3));
}
function discover(kit,demo) {
  const API=kit.KIT.shotCorrections, tracker=API.paint(demo.blank,demo.guide);
  const base=[];
  for (let i=0;i<demo.count;i++) {
    const frame=ink.render(demo.world,{...demo.options(i),shotCorrections:tracker});
    const at=frame.shotCorrections.corrections[0].at;
    if(!at)throw Error('Lost the crown anchor');
    const samples=demo.hook.map(([x,y])=>atRGB(frame,at[0]+x,at[1]+y).join(',')==='255,241,188');
    base.push({ frame,at,samples });
  }
  const first=base.findIndex(({samples},i)=>i>0&&samples.join()==='true,false,true'&&base[i-1].samples.every(Boolean));
  if(first<1||first+4>=demo.count)throw Error('The stock crown gloss needs a clean three-pixel hook followed by a split');
  return { base, first, last:first+3 };
}

module.exports = { study, discover };

function comparison(kit,demo,samples,out){
  const {KIT:K}=kit, {base,first,last}=samples, API=K.shotCorrections;
  const correction={id:'crown-hook',frames:[first,last],anchor:demo.anchor,pixels:demo.hook};
  const definition=API.paint(demo.blank,correction), plan=API.paint(definition,demo.guide);
  const final=[];
  for(const [i,unpainted] of base.entries()){
    if(i<first||i>last){final.push(unpainted.frame);continue;}
    const corrected=ink.render(demo.world,{...demo.options(i),shotCorrections:plan});
    const row=corrected.shotCorrections.corrections.find(row=>row.id==='crown-hook');
    if(row.painted!==3||!demo.hook.every(([x,y])=>atRGB(corrected,row.at[0]+x,row.at[1]+y).join(',')==='255,241,188'))
      throw Error('The painted crop must keep all three pixels on frame '+i);
    final.push(corrected);
  }
  if(base[last+1].samples.join()!=='true,false,true')throw Error('The stock gloss must stay split on the release frame');
  const width=295,height=132, DG=K.procedural.drawing2d;
  const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
  const text=(x,y,text,color)=>({type:'text',at:[x,y],text,color});
  const crop=([x,y],image)=>{
    const data=new Uint8Array(15*9*3);
    for(let row=0;row<9;row++){
      const p=((y-4+row)*image.w+x-7)*3;
      data.set(image.rgb.subarray(p,p+45),row*45);
    }
    return K.procedural.raster.resize({width:15,height:9,channels:3,data},{width:75,height:45,filter:'nearest'});
  };
  const directory=path.join(out,'frames');
  fs.mkdirSync(directory,{recursive:true});
  for(const [i,{frame,at}] of base.entries()){
    const active=first<=i&&i<=last, note=active?'HOLD '+(i-first+1)+'/4':i>last?'RELEASED':'BEFORE HOLD';
    const card=DG.render({width,height,edges:'hard',commands:[
      rect(0,0,width,height,'#241f2e'),rect(demo.w,0,1,height,'#71545c'),
      rect(201,13,77,47,'#8c6965'),rect(201,73,77,47,active?'#d0b587':'#8c6965'),
      text(202,5,'GLOSS','#dfbc96'),text(202,65,'PAINTED','#dfbc96'),
      text(202,123,note,active?'#d3e9d4':'#c4a6a6')
    ]});
    const {value}=K.procedural.raster.stack({width,height,layers:[
      {source:card},{source:{width:demo.w,height:demo.h,channels:3,data:final[i].rgb}},
      {source:crop(at,frame),x:202,y:14},{source:crop(at,final[i]),x:202,y:74}
    ]});
    fs.writeFileSync(path.join(directory,String(i).padStart(3,'0')+'.png'),PNG.encode(width,height,value.data,4));
  }
  fs.writeFileSync(path.join(out,'kingfisher-shot-corrections.json'),JSON.stringify(definition,null,2)+'\n');
}

if(require.main===module){
  const [rendererFile,directory='studio/shot-correction']=process.argv.slice(2);
  if(!rendererFile)throw Error('Supply a bundled ES module exporting createRenderer');
  fs.mkdirSync(directory,{recursive:true});
  const kit=ink.load(), demo=study(kit), samples=discover(kit,demo);
  const {first,last}=samples;
  comparison(kit,demo,samples,directory);
  const pack=content=>gzipSync(content,{level:9}).toString('base64');
  const toolkit=pack(ink.bundle()+'\nreturn { KIT, PixelLook, SpriteSurface, makeBuilder, ContributionRules, RenderStages };');
  const renderer=pack(fs.readFileSync(rendererFile));
  const template=fs.readFileSync(path.join(__dirname,'shot-correction.html.template'),'utf8');
  fs.writeFileSync(path.join(directory,'kingfisher-turn.html'),template.replace('/* STUDIO */',()=>`
    const toolkit=Function(await unpack('${toolkit}'))();
    const moduleURL=URL.createObjectURL(new Blob([await unpack('${renderer}')],{type:'text/javascript'}));
    let createRenderer;
    try { ({createRenderer}=await import(moduleURL)); } finally { URL.revokeObjectURL(moduleURL); }
    const demo=(${study.toString()})(toolkit), first=${first}, last=${last};
  `));
  console.log('Held frames',first+1,'through',last+1,'and released on',last+2);
}
