const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),K=kit.KIT,W=K.world;
const PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js'),AV=require('../../cli/audiovisual-take.js');
const out=path.resolve(process.argv[2]??'studio/out/audiovisual-take'), file=name=>path.join(out,name);
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(file(name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const rate=48000,waveRate=24000,fps=20,seconds=2.8,total=Math.round(seconds*fps);
const taps=[.06,.30,.58,.92], names=['inlet','throat','bore','bell'];
const pipe={format:W.waveNetworks.format,version:1,id:'pressure-organ',nodes:{inlet:{},outlet:{}},
  tubes:{bore:{from:'inlet',to:'outlet',sections:[{length:66,area:.0055}]}},
  observations:Object.fromEntries(names.map((name,i)=>[name,{tube:'bore',t:taps[i]}]))};
json('organ.network.json',pipe);
const pulses=[[.20,.32,146],[1.01,.36,196],[1.79,.46,131]];
const breath=Array.from({length:Math.round(seconds*waveRate)},(_,i)=>pulses.reduce((sum,[start,length,hz],k)=>{
  const dt=i/waveRate-start;
  if(dt<0||dt>=length)return sum;
  const phase=2*Math.PI*dt*(hz+[55,-45,28][k]*dt), env=Math.sin(Math.PI*dt/length)**.85;
  return sum+env*.000041*(Math.sin(phase)+.34*Math.sin(phase*2)+.12*Math.sin(phase*3));
},0));
json('organ.wave.json',{format:W.waveNetworks.runFormat,version:1,network:'organ.network.json',samples:breath.length,
  settings:{method:'delay',sampleRate:waveRate,loss:.002,sources:{breath:{kind:'flow',node:'inlet'}},
    terminations:{inlet:{kind:'reflect',coefficient:.39},outlet:{kind:'reflect',coefficient:-.58}}},
  inputs:{breath}});
json('organ.physical.json',{
  format:'ink-studio/physical-audio-run',version:1,
  plan:{format:W.physicalAudio.format,version:1,id:'organ-audition',sampleRate:rate,frames:total*rate/fps,
    sources:{intake:{signal:'inlet',pcmPerUnit:.038,pan:-.56},output:{signal:'bell',pcmPerUnit:.11,pan:.25}},
    paths:{room:{source:'output',delaySamples:240.5,gain:.82,pan:.08},
      leftWall:{source:'output',delaySeconds:.083,gain:.29,pan:-.78},
      rightWall:{source:'output',delaySeconds:.144,gain:.20,pan:.81}},
    mix:{dry:.38,wet:1}},
  inputs:Object.fromEntries(names.map(name=>[name,{trace:'organ.wave.json',selection:{name}}]))
});

const graph={format:'ink-studio/graph-project',version:1,inputs:{controls:{type:'record'}},nodes:{},outputs:{}};
const link=(node,port='value')=>({node,port});
const add=(name,op,inputs)=>{
  graph.nodes[name]={op,inputs};
  return link(name);
};
const bindings={};
const control=(name,source,input,output,shape='linear')=>{
  bindings[name]={source,input,output,shape};
  return name;
};
const physical=(name,stat='rms')=>({kind:'physical',name,stat});
const target=(control,path)=>({control,path});
const bind=(id,template,targets)=>add(id,'scene.bindControls',{template,controls:{input:'controls'},targets});
function shell(first,last,outer,inner,y,z,sides=28){
  const positions=[],indices=[];
  for(const x of [first,last])for(const r of [outer,inner])for(let i=0;i<sides;i++){
    const a=2*Math.PI*i/sides;
    positions.push(x,y+r*Math.sin(a),z+r*Math.cos(a));
  }
  const quad=(a,b,c,d)=>indices.push(a,b,c,a,c,d);
  for(let i=0;i<sides;i++){
    const j=(i+1)%sides,n=sides;
    quad(i,j,2*n+j,2*n+i);
    quad(n+j,n+i,3*n+i,3*n+j);
    quad(j,i,n+i,n+j);
    quad(2*n+i,2*n+j,3*n+j,3*n+i);
  }
  return {positions,indices};
}
const body='#456d79', steel='#355263', trim='#b27752', dark='#22374e', pale='#79b8b9', amber='#ffb55d';
const objects={};
function object(id,source,color,emissive=false){
  const settings={id,material:id,color,facets:true,emissive};
  objects[id]=add('object-'+id,'scene.object',{source,options:settings});
}
function box(id,center,half,color,emissive){
  object(id,add('mesh-'+id,'geo.box',{options:{center,half,color}}),color,emissive);
}
function tube(id,first,last,outer,inner,color){
  object(id,add('mesh-'+id,'geo.mesh',{source:shell(first,last,outer,inner,1.05,-.15)}),color);
}
box('foundation',[0,.02,-.27],[2.96,.14,.69],dark);
box('plinth',[0,.19,-.26],[2.91,.055,.64],steel);
box('rail',[0,.26,-.28],[2.82,.024,.59],pale);
for(const [i,x] of [-1.64,1.57].entries()){
  box('support-'+i,[x,.42,-.22],[.19,.18,.25],trim);
  box('bracket-'+i,[x,.55,-.22],[.28,.035,.34],steel);
}
tube('wall',-2.18,2.18,.50,.405,body);
tube('manifold',-2.51,-2.22,.34,.20,steel);
tube('flange-left',-2.29,-2.14,.57,.367,trim);
tube('flange-mid',-.10,.04,.529,.40,steel);
tube('flange-right',2.14,2.30,.57,.365,trim);
tube('bell',2.29,2.58,.40,.31,steel);
tube('bell-rim',2.56,2.7,.46,.36,pale);
box('console',[0,.12,.10],[1.91,.12,.045],steel);
for(const [i,x] of [-1.85,-.77,.51,1.85].entries()){
  const key=names[i], level=control('level-'+key,physical(key),[.05,1.65],[.12,1.05],'smoothstep');
  const mark=add('lamp-'+key,'geo.box',{options:{center:[0,.14,0],half:[.095,.104,.018]}});
  const at=bind('lamp-pose-'+key,{position:[x,.25,-.01],scale:[1,1,1]},[target(level,'/scale/1')]);
  object('lamp-'+key,add('lamp-geometry-'+key,'geo.transform',{source:mark,options:at}),i===3?amber:'#6af2d4',true);
}
const disc=add('disc','geo.tube',{start:[-.034,0,0],end:[.034,0,0],options:{radius:.35,sides:24}});
const piston=control('piston',physical('bell'),[.04,1.65],[1.57,2.01],'smoothstep');
const radius=control('radius',physical('bell','peak'),[.05,2.1],[.78,1.06],'smoothstep');
const pose=bind('piston-pose',{position:[1.57,1.05,-.15],scale:[1,.78,.78]},[
  target(piston,'/position/0'),target(radius,'/scale/1'),target(radius,'/scale/2')]);
object('diaphragm',add('moving-piston','geo.transform',{source:disc,options:pose}),amber,true);
const collect=add('objects','data.record',objects);
const list=add('list','data.collect',{source:collect,keys:Object.keys(objects)});
const built=add('machine','scene.world',{objects:list,options:{
  seed:211,background:'#12212d',style:{direction:[-.55,.85,.61],ambient:.52,sky:.17,sunStrength:.72},
  camera:{target:[0,.88,0],dist:6.15,yaw:-.34,pitch:.29,ortho:true}
}});
const reveal=control('section',physical('inlet'),[.015,1.80],[.275,-.24],'smoothstep');
const glow=control('glow',{kind:'audio',name:'mix',stat:'rms'},[.002,.15],[.12,2.15],'smoothstep');
const render=bind('render-settings',{width:224,height:128,raw:true,cutaway:{
  planes:[{normal:[0,0,1],offset:.275,keep:'negative'}],edge:{color:'#e3aa71',width:.032,strength:.75}
},renderGraph:{passes:[{id:'halo',type:'bloom',radius:6,threshold:.42,intensity:.12,tint:[151,253,216]}]}},[
  target(reveal,'/cutaway/planes/0/offset'),target(glow,'/renderGraph/passes/0/intensity')]);
graph.outputs.picture=add('picture','scene.render',{source:built,options:render,channels:[]});
json('organ.picture.json',graph);
json('organ.take.json',{format:'ink-studio/take',version:1,id:'pressure-organ',
  clock:{fps,sampleRate:rate},graph:'organ.picture.json'});
json('organ.av.json',{format:AV.format,version:1,take:'organ.take.json',from:0,to:total,
  picture:{output:'picture'},audio:{physical:'organ.physical.json'},bindings});
const published=spawnSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
  'take','render-av',file('organ.av.json'),'--out',file('published')],{encoding:'utf8'});
assert.equal(published.status,0,published.stderr);
const review=JSON.parse(fs.readFileSync(file('published/export.json'),'utf8')), rows=review.picture.frames;
const onset=key=>rows.find(row=>row.measurements[key].raw>.09);
const early=onset('level-inlet'), late=onset('level-bell');
assert.ok(early.frame<late.frame&&late.frame-early.frame>=2);
assert.ok(Math.max(...rows.map(row=>row.controls.piston))>1.63);
assert.ok(Math.max(...rows.map(row=>row.controls.glow))>.25);
const sound=WAV.read(file('published/sound.wav'),{metadata:true});
const stats=rows.map(row=>{
  const exact=sound.samples.subarray(row.firstSample*sound.channels,row.endSample*sound.channels);
  const rms=Math.sqrt(exact.reduce((sum,value)=>sum+value*value,0)/exact.length);
  return Math.abs(rms-row.measurements.glow.raw);
});
assert.ok(Math.max(...stats)<1/2**23);

fs.mkdirSync(file('scope'),{recursive:true});
const bg='#12212d',panel='#1a3340',grid='#3a5260',paper='#edf1e4',muted='#adc2c9';
const colors=['#65e3c0','#8ed8cc','#93bce9','#ffbf7c'];
const layout=[['section','CUTAWAY', '#e9aa81',[.275,-.24]],['piston','DIAPHRAGM','#a8d5ef',[1.57,2.01]],
  ['glow','WAV / BLOOM','#f5cd88',[.12,2.15]]];
function scope(row,summary=false){
  const commands=[], width=482,height=460;
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const line=(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width});
  const text=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
  rect(0,0,width,height,bg);
  rect(24,26,21,4,colors[0]);text('INK STUDIO / SHARED TAKE',56,21,2,colors[0]);
  text('Pressure organ',22,52,4);
  text('ONE WAVE RUN DRIVES PICTURE AND SOUND',26,94,1,muted);
  rect(24,119,434,116,panel);
  for(const [i,key] of names.entries()){
    const x=43+i*105, evidence=row.measurements['level-'+key];
    text(key.toUpperCase(),x,133,1,colors[i]);
    rect(x,156,74,19,bg);
    rect(x,156,Math.max(1,Math.min(74,74*evidence.raw/1.65)),19,colors[i]);
    text(evidence.raw.toFixed(2)+' PA',x,190,1);
  }
  const x=154,w=281;
  for(const [i,[name,label,color,range]] of layout.entries()){
    const y=252+i*51, value=t=>y+31-(t-range[0])/(range[1]-range[0])*27;
    text(label,25,y+11,1,color);
    rect(x,y,w,35,panel);
    for(const tick of [0,.5,1,1.5,2,2.5])line([[x+w*tick/seconds,y],[x+w*tick/seconds,y+35]],grid);
    line(rows.map(r=>[x+w*r.time/seconds,value(r.controls[name])]),color,2);
    if(!summary)line([[x+w*row.time/seconds,y],[x+w*row.time/seconds,y+35]],paper);
  }
  text('INLET FIRST / BELL '+((late.frame-early.frame)*1000/fps).toFixed(0)+' MS LATER',25,418,1,muted);
  if(!summary)text('SAMPLE '+row.firstSample,328,418,1,muted);
  return PNG.encodeFrame(PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'})));
}
for(const row of rows)write('scope/frame-'+String(row.frame).padStart(6,'0')+'.png',scope(row));
const loud=rows.reduce((a,b)=>a.controls.glow>b.controls.glow?a:b);
write('control-board.png',scope(loud,true));
json('evidence.json',{early:early.frame,late:late.frame,arrivalDelayMs:(late.frame-early.frame)*1000/fps,
  sampleRate:rate,frames:rows.length,wavFrames:sound.samples.length/sound.channels,rmsError:Math.max(...stats),
  idle:'published/'+rows[0].file,active:'published/'+loud.file});
console.log('Wrote a synchronized picture, native WAV and sample report to '+out);
