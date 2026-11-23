const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),K=kit.KIT,W=K.world;
const modal=require('../../cli/modal-resonator.js'),PNG=require('../../cli/png.js'),
  WAV=require('../../cli/wav.js'),files=require('../../cli/asset-files.js');
const out=path.resolve(process.argv[2]??'studio/out/aligned-review'),file=name=>path.join(out,name);
const save=(name,value)=>(files.json(file('recipes/'+name),value),name);
const write=(name,bytes)=>files.write(file(name),bytes);
const rate=16000,fps=20,from=5,to=37,count=rate*2;
const base=[6912.25,12240.5,22784.75], variation=[base[0],15040.5,base[2]], strengths=[.66,1,.73];
const asset=modal.bake(kit,{format:W.resonantModes.planFormat,version:1,id:'steel-valve',revision:1,
  source:{kind:'authored',modes:[{id:'body',hz:344,decay:12},{id:'rim',hz:742.5,decay:21},{id:'strike',hz:1237,decay:43}]},
  excitations:{tap:{point:[0,0,0],gains:[1,.68,.45]}},pickups:{pickup:{point:[.4,0,0],gains:[1,.56,.43]}}},
file('recipes/valve.modes.json'));
const modes=save('valve.modes.json',asset);
function runInputs(name,stamps){
  const ring=save(name+'.ring.json',{format:W.resonantModes.runFormat,version:1,asset:modes,
    samples:count,settings:{sampleRate:rate},impulses:stamps.map((at,i)=>({excitation:'tap',sample:Math.floor(at),
      fraction:at-Math.floor(at),value:strengths[i]}))});
  const contact=save(name+'.contact.json',{format:W.contactExciters.runFormat,version:1,samples:count,
    excitation:{format:W.contactExciters.format,version:1,id:'valve-strikes',revision:1,sampleRate:rate,
      tracks:Object.fromEntries(stamps.map((at,i)=>['strike-'+(i+1),{kind:'impact',at:at/rate,duration:.004,
        normal:[0,1,0],point:[.5,.78,-.06],impulse:[0,.016*strengths[i],0]}]))}});
  return {ring:{file:ring},contact:{file:contact}};
}
const reference=runInputs('reference',base),candidate=runInputs('candidate',variation);

const graph={format:'ink-studio/graph-project',version:1,inputs:{controls:{type:'record'}},nodes:{},outputs:{}};
const objects={},link=(node,port='value')=>({node,port});
function add(name,op,inputs){graph.nodes[name]={op,inputs};return link(name);}
function bind(name,template,targets){
  return add(name,'scene.bindControls',{template,controls:{input:'controls'},targets});
}
function meshShell(x0,x1,outer,inner,y,z,sides=26){
  const positions=[],indices=[];
  for(const x of [x0,x1])for(const r of [outer,inner])for(let j=0;j<sides;j++){
    const phi=2*Math.PI*j/sides;
    positions.push(x,y+r*Math.sin(phi),z+r*Math.cos(phi));
  }
  const face=(a,b,c,d)=>indices.push(a,b,c,a,c,d);
  for(let i=0;i<sides;i++){
    const j=(i+1)%sides,n=sides;
    face(i,j,2*n+j,2*n+i);face(n+j,n+i,3*n+i,3*n+j);
    face(j,i,n+i,n+j);face(2*n+i,2*n+j,3*n+j,3*n+i);
  }
  return {positions,indices};
}
const iron='#315266',steel='#48748b',teal='#5596a0',worn='#976746',brass='#d69c60',
  bright='#ffc077',cyan='#80d8c8',shadow='#233a53';
function object(id,source,color,emissive=false){
  objects[id]=add('object-'+id,'scene.object',{source,options:{id,material:id,color,facets:true,emissive}});
}
function box(id,center,half,color){
  object(id,add('mesh-'+id,'geo.box',{options:{center,half,color}}),color);
}
function shell(id,x0,x1,outer,inner,color){
  object(id,add('mesh-'+id,'geo.mesh',{source:meshShell(x0,x1,outer,inner,.98,-.10)}),color);
}
box('base',[0,.12,-.24],[2.92,.13,.72],shadow);
box('rail',[0,.27,-.25],[2.77,.055,.63],steel);
for(const [i,x] of [-1.78,1.58].entries()){
  box('foot-'+i,[x,.39,-.28],[.23,.093,.27],worn);
  box('plate-'+i,[x,.49,-.27],[.27,.032,.30],brass);
}
shell('chamber',-1.90,1.96,.50,.414,teal);
shell('ring-left',-1.92,-1.77,.568,.385,brass);
shell('ring-right',1.78,2.02,.557,.374,brass);
shell('tail',2.02,2.54,.37,.29,iron);
shell('tail-edge',2.50,2.63,.428,.28,cyan);
shell('inlet',-2.51,-1.90,.31,.227,steel);
shell('inlet-edge',-2.64,-2.50,.377,.227,brass);
shell('inner-seal',-.67,-.55,.427,.333,worn);

const shaft=add('shaft','geo.tube',{start:[-.63,.98,-.10],end:[1.53,.98,-.10],options:{radius:.048,sides:16}});
object('shaft',shaft,cyan,true);
const disc=add('disc','geo.tube',{start:[-.036,0,0],end:[.036,0,0],options:{radius:.344,sides:26}});
const pose=bind('piston-pose',{position:[.32,.98,-.10],scale:[1,1,1]},[
  {control:'piston',path:'/position/0'},{control:'radius',path:'/scale/1'},{control:'radius',path:'/scale/2'}]);
object('piston',add('piston-mesh','geo.transform',{source:disc,options:pose}),bright,true);
const hub=add('hub','geo.tube',{start:[-.083,0,0],end:[.083,0,0],options:{radius:.10,sides:18}});
object('hub',add('hub-mesh','geo.transform',{source:hub,options:pose}),cyan,true);
const list=add('objects','data.collect',{source:add('assembly','data.record',objects),keys:Object.keys(objects)});
const scene=add('valve','scene.world',{objects:list,options:{seed:671,background:'#102330',
  style:{direction:[-.52,.88,.7],ambient:.53,sky:.21,sunStrength:.66},
  camera:{target:[0,.79,-.07],dist:6.1,yaw:-.31,pitch:.29,ortho:true}}});
const settings=bind('render-settings',{width:224,height:128,raw:true,
  cutaway:{planes:[{normal:[0,0,1],offset:.11,keep:'negative'}],edge:{color:'#d8c396',width:.024,strength:.65}},
  renderGraph:{passes:[{id:'halo',type:'bloom',radius:5,threshold:.55,intensity:.12,tint:[248,190,122]}]}},
  [{control:'plane',path:'/cutaway/planes/0/offset'},{control:'glow',path:'/renderGraph/passes/0/intensity'}]);
graph.outputs.picture=add('cutaway','scene.render',{source:scene,options:settings,channels:[]});
const controls=(name,input,output)=>({source:{kind:'trace',name,stat:'peak'},input,output,shape:'smoothstep'});
const recipe={format:'ink-studio/aligned-simulation-review',version:1,id:'valve-strike',clock:{fps,sampleRate:rate},from,to,
  reference,candidate,traces:{pickup:{source:'ring',channel:'pickup',trace:{unit:'m'},tolerance:{absolute:1e-8}}},
  events:{strike:{source:'contact'}},audio:{tracks:['pickup'],gain:850},
  picture:{graph:save('valve.graph.json',graph),output:'picture',format:'both',warmup:3,bindings:{
    piston:controls('pickup',[0,.00045],[.32,.98]),radius:controls('pickup',[0,.00045],[.86,1.05]),
    plane:controls('pickup',[0,.00045],[.11,-.045]),glow:controls('pickup',[0,.0005],[.12,1.28])
  }}};
function publish(name,recipe,exit){
  const request=save(name+'.review.json',recipe), dest=file(name);
  const run=spawnSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
    'sim','review',file('recipes/'+request),'--out',dest,'--require-match'],{encoding:'utf8'});
  assert.equal(run.status,exit,run.stderr);
  return JSON.parse(fs.readFileSync(path.join(dest,'review.json')));
}
const review=publish('matched',recipe,2);
const {picture,first,firstSample,firstEvent,focus}=review;
assert.equal(first.kind,'event');
assert.equal(firstEvent.reason,'event-time');
assert.equal(firstSample.sample,Math.ceil(base[1]));
assert.equal(first.frame,15);
assert.ok(first.time<firstSample.time);
assert.notEqual(picture.reference.frames[focus.frame-from].sha256,picture.candidate.frames[focus.frame-from].sha256);
const control=publish('same',{...recipe,id:'valve-strike-control',candidate:reference,picture:undefined},0);
assert.equal(control.status,'exact');
const sides=['reference','candidate'], pairAudio=sides.map(side=>WAV.read(file('matched/'+review.audio[side].file),{metadata:true}));
assert.equal(pairAudio[0].bwf.timeReference,String(review.clock.startSample));
assert.equal(pairAudio[1].samples.length,pairAudio[0].samples.length);

const WID=1000,HEI=650,bg='#0f1d28',panel='#192f3c',grid='#36515f',quiet='#a9c4ca',paper='#eef4e5',
  mint='#8de4c2',blue='#9bccf2',rose='#ffad94';
const colors=[mint,blue], frames=to-from, graphX=[37,515], graphY=153, x=45,w=910,h=54;
const soundPeak=pairAudio.reduce((p,buffer)=>buffer.samples.reduce((top,v)=>Math.max(top,Math.abs(v)),p),0);
const duration=frames/fps,start=review.clock.start.time;
const candidateEvent=K.procedural.takeTime.seconds(W.outputTiming.eventTime(firstEvent.candidate));
function board(index,paused=false){
  const frame=picture.reference.frames[index],commands=[];
  const draw={
    rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})
  };
  draw.rect(0,0,WID,HEI,bg);draw.rect(38,31,26,4,mint);
  draw.text('INK STUDIO / ALIGNED REVIEW',79,24,2,mint);
  draw.text('The delayed valve strike',36,58,4);
  draw.text('ONE CAMERA, ONE CLOCK / LEVEL-MATCHED PCM',38,102,1,quiet);
  const stamp=frame.time.toFixed(3)+' S / FRAME '+frame.frame;
  draw.text(stamp,714,99,2,paused?rose:quiet);
  draw.rect(28,124,472,298,panel);draw.rect(506,124,466,298,panel);
  draw.text('REFERENCE / LEFT',37,130,2,mint);
  draw.text('CANDIDATE / RIGHT',515,130,2,blue);
  const shift=time=>x+(time-start)/duration*w;
  for(let k=0;k<2;k++){
    const y=451+k*68, signal=pairAudio[k].samples, base=y+h/2;
    draw.rect(x,y,w,h,panel);
    for(let i=0;i<=8;i++)draw.line([[x+w*i/8,y],[x+w*i/8,y+h]],grid);
    for(let j=0;j<w;j++){
      const lo=Math.floor(j*signal.length/w),hi=Math.floor((j+1)*signal.length/w);
      let min=0,max=0;
      for(let i=lo;i<hi;i++){min=Math.min(min,signal[i]);max=Math.max(max,signal[i]);}
      const top=base-max/soundPeak*h*.43,bottom=base-min/soundPeak*h*.43;
      draw.rect(x+j,top,1,Math.max(1,bottom-top),colors[k]);
    }
  }
  const a=shift(first.time),b=shift(candidateEvent),cursor=shift(frame.time);
  draw.line([[a,448],[a,573]],rose,2);draw.line([[b,517],[b,573]],blue,2);
  if(!paused)draw.line([[cursor,451],[cursor,573]],paper);
  draw.text('FIRST EVENT '+(1000*first.time).toFixed(4)+' MS',45,602,2,rose);
  draw.text('FIRST SAMPLE '+firstSample.sample+' / '+(1000*firstSample.time).toFixed(4)+' MS',508,602,2,quiet);
  draw.text('CANDIDATE STRIKE +'+((candidateEvent-first.time)*1000).toFixed(1)+' MS',45,628,1,blue);
  const raster=K.procedural.drawing2d.render({width:WID,height:HEI,commands,edges:'hard'});
  for(const [i,side] of sides.entries()){
    const png=PNG.raster(file('matched/'+picture[side].frames[index].file));
    const img=png.data;
    for(let sy=0;sy<png.h;sy++)for(let sx=0;sx<png.w;sx++){
      const src=(sy*png.w+sx)*4, alpha=img[src+3]/png.max;
      for(let j=0;j<2;j++)for(let k=0;k<2;k++){
        const dst=((graphY+2*sy+j)*WID+graphX[i]+2*sx+k)*4;
        for(let c=0;c<3;c++)raster.data[dst+c]=Math.round(img[src+c]*255/png.max*alpha+raster.data[dst+c]*(1-alpha));
      }
    }
  }
  return PNG.packRGBA(raster);
}
const still=board(focus.frame-from,true), firstBytes=PNG.encodeFrame(still);
write('first-divergence.png',firstBytes);
const repeated=2,hold=30,showFrames=frames*repeated+hold,keep=[];
for(let i=0;i<frames;i++){
  const packed=board(i),bytes=PNG.encodeFrame(packed);
  for(let j=0;j<repeated;j++)write('gallery/frame-'+String(frames*j+i).padStart(3,'0')+'.png',bytes);
  if(i%2===0)keep.push(packed);
}
for(let i=frames*repeated;i<showFrames;i++)write('gallery/frame-'+String(i).padStart(3,'0')+'.png',firstBytes);
write('review-gallery.png',PNG.encodeAnimation([...keep,...keep,...Array(hold/2).fill(still)],fps/2));
const stereo=new Float64Array(showFrames*rate/fps*2), stride=pairAudio[0].samples.length;
for(let j=0;j<repeated;j++)for(let i=0;i<stride;i++)for(let k=0;k<2;k++)
  stereo[(j*stride+i)*2+k]=pairAudio[k].samples[i];
write('review-stereo.wav',WAV.encode({sampleRate:rate,channels:2,samples:stereo},{encoding:'pcm24'}));
console.log('Wrote matched WAVs, plots, cutaways, exact events and a stereo demonstration to '+out);
