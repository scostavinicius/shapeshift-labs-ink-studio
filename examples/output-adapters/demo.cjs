const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ink=require('../..'),kit=ink.load(),K=kit.KIT,P=K.procedural,W=K.world;
const PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js'),files=require('../../cli/asset-files.js');
const contact=require('../../cli/contact-exciter.js'),waves=require('../../cli/wave-network.js');
const out=path.resolve(process.argv[2]??'studio/out/output-adapters'), file=name=>path.join(out,name);
fs.mkdirSync(file('review'),{recursive:true});
const write=(name,data)=>files.write(file(name),data);
const json=(name,value)=>files.json(file(name),value);
const width=48,height=32,fps=16,frames=32,sampleRate=24000,samples=sampleRate*frames/fps;
const clock=P.takeTime.create({fps,sampleRate,simulationRate:32});
const strikes=[.25,.58,.91,1.47];
const impulse=Object.fromEntries(strikes.map((at,i)=>['tap-'+i,{kind:'impact',at,duration:.0038,
  point:[0,0,0],normal:[1,0,0],impulse:[[.027,.019,.022,.029][i],0,0]}]));
const drive=contact.run(kit,{format:W.contactExciters.runFormat,version:1,samples,excitation:{
  format:W.contactExciters.format,version:1,id:'spillway-taps',sampleRate,tracks:impulse
}},file('taps.json'));
const eventSource={format:drive.format,version:drive.version,info:{sampleRate},events:drive.events};
json('native-events.json',eventSource);
const breath=Array.from({length:samples},(_,i)=>Object.values(drive.tracks).reduce((sum,t)=>sum+.0000021*t.force[i*3],0));
const pulse=waves.run(kit,{format:W.waveNetworks.runFormat,version:1,samples,network:{
  format:W.waveNetworks.format,version:1,id:'spillway-soundboard',nodes:{inlet:{},outlet:{}},
  tubes:{bore:{from:'inlet',to:'outlet',sections:[{length:.39,area:.0038}]}},
  observations:{left:{tube:'bore',t:.35},right:{tube:'bore',t:.83}}
},settings:{method:'delay',sampleRate,loss:.15,sources:{touch:{kind:'flow',node:'inlet'}},
  terminations:{inlet:{kind:'reflect',coefficient:.62},outlet:{kind:'reflect',coefficient:-.5}}},
inputs:{touch:breath}},file('soundboard.json'));
const trace={format:pulse.format,version:pulse.version,start:pulse.start,end:pulse.end,
  info:{sampleRate},pressure:pulse.pressure};
json('native-wave.json',trace);
const peak=Object.values(trace.pressure).reduce((peak,values)=>values.reduce((best,value)=>Math.max(best,Math.abs(value)),peak),0);
assert.ok(peak>0);

const link=(node,port='value')=>({node,port});
const project={format:'ink-studio/graph-project',version:1,
  assets:{wave:{format:'json',file:'native-wave.json'},hits:{format:'json',file:'native-events.json'}},
  nodes:{
    liquid:{op:'sim.define',inputs:{kind:'flip',settings:{
      width,height,fill:[[4,3,14,18]],walls:[[0,30,48,2],[24,23,5,7],[35,27,5,3]],
      velocity:[26,0],gravity:[0,64],pressureIterations:22,particlesPerCell:4,flip:.94
    },clock:{dt:1/32,seed:11}}},
    flow:{op:'sim.run',inputs:{recipe:link('liquid')}},
    density:{op:'sim.fieldRaster',inputs:{source:link('flow','grid')}},
    surface:{op:'sim.fieldMesh',inputs:{source:link('flow','grid'),options:{heightScale:6}}},
    mesh:{op:'sim.outputMesh',inputs:{source:link('surface')}},
    positions:{op:'sim.pointRecords',inputs:{source:link('flow','pointBuffer')}},
    picture:{op:'sim.outputRaster',inputs:{source:link('flow')}},
    loadWave:{op:'jsonAsset',inputs:{name:'wave'}},
    trace:{op:'sim.outputTrace',inputs:{source:link('loadWave')}},
    sound:{op:'sim.outputAudio',inputs:{source:link('trace'),options:{channels:['left','right'],gain:.72/peak}}},
    loadEvents:{op:'jsonAsset',inputs:{name:'hits'}},
    eventLog:{op:'sim.outputEvents',inputs:{source:link('loadEvents')}},
    beat:{op:'sim.eventWindow',inputs:{source:link('eventLog'),options:{from:0,to:frames/fps}}}
  },
  outputs:{grid:link('flow','grid'),density:link('density'),pointBuffer:link('flow','pointBuffer'),
    points:link('positions'),mesh:link('mesh'),picture:link('picture'),trace:link('trace'),
    events:link('eventLog'),windowed:link('beat','events'),sound:link('sound'),audioClock:link('sound','report')},
  exports:{grid:{output:'grid',format:'json'},points:{output:'pointBuffer',format:'json'},
    mesh:{output:'mesh',format:'json'},picture:{output:'picture',format:'png'},
    trace:{output:'trace',format:'json'},sound:{output:'sound',format:'wav',encoding:'pcm24'},
    events:{output:'events',format:'json'}}
};
json('bench.graph.json',project);
const graph=ink.readGraphProject(file('bench.graph.json'),{kit});
const representative=graph.run({take:clock.at(13)}), example=representative.outputs;
assert.equal(example.pointBuffer.count,14*18*4);
assert.equal(example.mesh.pos.length,width*height*3);
assert.ok(example.events.entries.length>=strikes.length);
for(const {file,bytes} of representative.artifacts)write(file,bytes);
const exported=WAV.read(file('artifacts/sound.wav'));
assert.equal(exported.samples.length,2*samples);
json('graph-report.json',representative.report);

const color=level=>level>.82?'#83dcc4':level>.56?'#56aead':level>.28?'#316c8a':level>.055?'#224762':'#172b3b';
const bg='#12232e',panel='#193443',well='#102a36',grid='#375364',paper='#ebf1df',dim='#b6cada',
  mint='#83dec4',gold='#fac07d',blue='#8cb8e8',pink='#d5a5dc';
const Wd=1116,Hd=660,size=7;
const rgbaFrame=commands=>PNG.packRGBA(P.drawing2d.render({width:Wd,height:Hd,commands,edges:'hard'}));
const layout=()=>{
  const commands=[];
  return {commands,box:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    label:(text,x,y,s=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale:s,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})};
};
const framePoint=(x,y,px,py)=>[x+px*size,y+py*size], frameTimes=[];
const waveColumn=(i,w)=>Math.floor(i*samples/w);
function review(values,frame){
  const d=layout(), {picture,density,points,pointBuffer,events,sound}=values, image=picture.data;
  d.box(0,0,Wd,Hd,bg);d.box(29,29,26,4,mint);d.label('INK STUDIO / SIMULATION OUTPUTS',68,23,2,mint);
  d.label('Spillway bench',25,58,5);
  d.label('ONE GRAPH / SEVEN OUTPUT TYPES',31,119,2,dim);
  const views=[[32,'SOLVER RASTER'],[391,'DENSITY FIELD'],[750,'POINT BUFFER']];
  for(const [x,label] of views){
    d.box(x,159,336,270,panel);d.label(label,x+12,171,2);
    d.box(x,205,336,224,well);
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x, at=i*4;
    if(image[at+3]){
      const hex=Array.from(image.slice(at,at+4),p=>p.toString(16).padStart(2,'0')).join('');
      d.box(...framePoint(32,205,x,y),size,size,'#'+hex);
    }
    d.box(...framePoint(391,205,x,y),size,size,color(density.data[i]));
  }
  for(let x=0;x<=width;x+=4)d.line([[750+x*size,205],[750+x*size,429]],grid);
  for(let y=0;y<=height;y+=4)d.line([[750,205+y*size],[1086,205+y*size]],grid);
  for(const {point,velocity} of points){
    const [x,y]=framePoint(750,205,...point);
    d.box(x,y,2,2,blue);
    if(velocity&&Math.hypot(...velocity)>4)d.line([[x,y],[x+velocity[0]*.13,y+velocity[1]*.13]],mint);
  }
  d.box(32,452,1054,168,panel);
  d.label('SAMPLE TRACE AND EVENT LOG',46,465,2);
  d.label(pointBuffer.count+' PARTICLES / '+events.entries.length+' NATIVE EVENTS',735,469,1,dim);
  const left=47, ww=1024, base=541;
  d.box(left,501,ww,80,well);d.line([[left,base],[left+ww,base]],grid);
  for(let x=0;x<ww;x++){
    const a=waveColumn(x,ww),b=waveColumn(x+1,ww);
    let min=0,max=0;
    for(let i=a*2;i<b*2;i++){
      min=Math.min(min,sound.samples[i]);
      max=Math.max(max,sound.samples[i]);
    }
    if(max-min>.002)d.line([[left+x,base-45*max],[left+x,base-45*min]],gold);
  }
  for(const {at} of events.entries){
    const t=typeof at==='number'?at:at.numerator/at.denominator, x=left+ww*t*fps/frames;
    d.line([[x,501],[x,581]],pink);
  }
  const cursor=left+ww*frame.frame/frames;
  d.line([[cursor,501],[cursor,581]],paper);
  d.label('FRAME '+String(frame.frame).padStart(2,'0')+'   WAV SAMPLE '+frame.firstSample,47,597,1,dim);
  d.label('24 KHZ / STEREO',955,596,1,dim);
  return rgbaFrame(d.commands);
}
const packed=[];
const {exports:delivery,...reviewProject}=project;
const playback=ink.createGraphProject(reviewProject,{kit,baseDir:out});
for(let i=0;i<frames;i++){
  const at=clock.at(i), result=playback.run({take:at});
  const frame=review(result.outputs,at);
  packed.push(frame);
  frameTimes.push({frame:i,firstSample:at.firstSample,endSample:at.endSample,points:result.outputs.pointBuffer.count,
    events:W.outputAdapters.eventWindow(result.outputs.events,at.start,at.end).entries.map(x=>x.event.kind)});
  write('review/frame-'+String(i).padStart(3,'0')+'.png',PNG.encodeFrame(frame));
}
write('spillway-review.png',PNG.encodeFrame(packed[13]));
write('spillway-loop.png',PNG.encodeAnimation(packed,fps));
json('review-timing.json',frameTimes);
assert.equal(frameTimes.at(-1).endSample,samples);

const values=example.grid.data, colors=Float64Array.from({length:values.length*3},(_,i)=>{
  const hue=parseInt(color(values[Math.floor(i/3)]).slice(1),16);
  return (hue>>((2-i%3)*8)&255)/255;
});
const A=P.sceneGraph, colored=A.mesh({...example.mesh,vcol:colors});
const surface=A.transform(colored,{position:[-2.4,0,-1.6],scale:[.105,.125,.105]});
const deck=A.box({center:[.12,-.17,.06],half:[2.6,.15,1.8],color:'#45657e'});
const world=A.world([A.object(surface,{id:'density',facets:true}),A.object(deck,{id:'tray',facets:true})],{
  background:bg,camera:{target:[.18,.72,.10],yaw:.54,pitch:.62,dist:7.9,ortho:true},
  style:{ambient:.58,sunStrength:.58,sky:.18}
});
const meshFrame=ink.render(world,{w:360,h:230,px:1,raw:true});
write('density-mesh.png',PNG.encodeFrame(PNG.packRGBA(A.rasterFrame(meshFrame))));
console.log('Wrote graph outputs, native WAV, and spillway reviews to '+out);
