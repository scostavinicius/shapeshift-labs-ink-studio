const fs=require('node:fs'), path=require('node:path');
const {KIT:K}=require('../..').load(), PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const W=K.world, R=W.reduction, P=K.procedural;
const out=path.resolve(process.argv[2]??'studio/out/model-reduction');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
function bake(kind,id,source,file,settings) {
  const plan={format:R.format,version:1,kind,id,source:file,settings};
  json(kind+'.plan.json',plan);
  const asset=R.bake({...plan,source,reference:{file}});
  json(kind+'.model.json',asset);
  return asset;
}

const manifest=require('../simulation-branched-domains/bench.domain.json');
const run=W.runtime.create(require('../simulation-branched-domains/bench.world.json'));
const domain=W.domains.compile(manifest,{query:run.query(),snapshot:{world:run.view().world.id,tick:0}});
json('manifold.compiled.json',domain);
const network=bake('network','manifold-network',domain,'manifold.compiled.json',{segments:3});
const tube=domain.tubes.upper;
const sectionReport=P.pathSections.measure({path:tube.points,samples:tube.sections.length,
  source:manifest.geometries['throat-bore'].source});
json('nozzle.sections.json',sectionReport);
const profile=bake('profile','nozzle-profile',sectionReport,'nozzle.sections.json',{segments:3});

const sampleRate=12000, width=70, height=36, cell=.05;
const mask=(x,z)=>Math.hypot((x-.89)/.8,(z-.94)/.79)<1||
  Math.hypot((x-2.64)/.79,(z-.84)/.64)<1||(x>1.4&&x<2.15&&Math.abs(z-.88)<.18);
const distancePerSecond=60,damping=8,at=[.89,.94],probe=[.95,.89],radius=.72;
const wave=P.motion.scalarWave({width,height,cell,mask,maxDt:1/sampleRate,speed:distancePerSecond,damping,wall:'fixed'});
wave.kick({at,radius,amount:1,channel:'pressure'});
const open=wave.frame().mask(), active=open.reduce((sum,value)=>sum+value,0), snapshots=[];
const samples=Array.from({length:6000},(_,i)=>{
  if(i)wave.step();
  const frame=wave.frame();
  if(i<1440&&i%48===0)snapshots.push(frame.data('pressure'));
  return frame.sample('pressure',...probe);
});
const source={sampleRate,samples,origin:{method:'scalar-wave',geometry:'twin-chamber',
  grid:[width,height],cell,active,speed:distancePerSecond,damping,wall:'fixed',excitation:{at,radius},probe}};
json('chamber.response.json',source);
const fir=bake('response','chamber-impulse',source,'chamber.response.json',
  {fit:[0,3000],fadeSamples:720,validation:[3000,6000]});
const modal=bake('modes','chamber-modes',source,'chamber.response.json',
  {fit:[0,3600],validation:[3600,6000],band:[10,450],maxModes:10,decay:[7,9]});
const firSamples=R.render(fir), modalSamples=R.render(modal);
const peak=Math.max(...[samples,firSamples,modalSamples].map(row=>Math.max(...row.map(Math.abs))));
for(const [name,signal] of [['reference',samples],['impulse',firSamples],['modes',modalSamples]]){
  write('chamber-'+name+'.wav',WAV.encode({sampleRate,channels:1,samples:Array.from(signal,v=>v*.86/peak)}));
}

const bg='#111b25', paper='#f4f1db', panel='#1b2c3b', field='#132230', muted='#b0c2ca',
  grid='#374d5e', mint='#71dcb6', amber='#ffb374', blue='#8eb9e9', purple='#c2abfa';
function drawing(){
  const commands=[];
  return {commands, rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})};
}
const frame=(d,width,height)=>PNG.packRGBA(P.drawing2d.render({width,height,commands:d.commands,edges:'hard'}));
function showNetwork(d){
  const x=65,y=218,w=580,h=197;
  d.rect(x,y,w,h,field);
  const project=([px,_py,pz])=>[x+22+(px+7.5)*39,y+17+(pz+3.5)*27];
  for(const row of Object.values(domain.tubes))d.line(row.points.map(project),grid,11);
  for(const row of Object.values(network.links))d.line([network.nodes[row.from].position,network.nodes[row.to].position].map(project),mint,2);
  for(const [id,node] of Object.entries(network.nodes)){
    const [a,b]=project(node.position), size=node.kind==='section'?5:10;
    d.rect(a-size/2,b-size/2,size,size,node.kind==='section'?mint:paper);
    if(node.kind!=='section')d.text(id.toUpperCase(),a-10,b-19,1,muted);
  }
  d.text('SOURCE PATH',x+17,y+h-22,1,muted);
  d.text('REDUCED LINKS',x+130,y+h-22,1,mint);
}
function showProfile(d){
  const x=708,y=218,w=574,h=197, lo=y+h-28;
  d.rect(x,y,w,h,field);
  for(let i=0;i<4;i++)d.line([[x+16,lo-i*39],[x+w-16,lo-i*39]],grid);
  const ruler=([u,v])=>[x+18+u/tube.length*(w-36),lo-v*229];
  for(const [rows,tint,weight] of [[sectionReport.sections,blue,1],[profile.spans,mint,3]]){
    d.line(rows.flatMap(row=>row.span.map(u=>ruler([u,row.area]))),tint,weight);
  }
  d.text('MEASURED AREA',x+18,y+h-17,1,blue);
  d.text('REDUCED AREA',x+146,y+h-17,1,mint);
}
const percent=n=>(n*100).toFixed(1)+'%';
function waveform(d,x,values,tint){
  const y=625,w=382,h=110;
  d.rect(x,y,w,h,field);
  for(const offset of [0,h/4,h/2,h*3/4,h-1])d.line([[x,y+offset],[x+w,y+offset]],grid);
  d.line(Array.from({length:600},(_,i)=>[x+1+(w-2)*i/599,y+h/2-values[i*10]*(h*.46)/peak]),tint,1);
}
function board(){
  const d=drawing(), width=1348,height=846;
  d.rect(0,0,width,height,bg);
  d.rect(44,36,30,4,mint);
  d.text('INK STUDIO / PHYSICAL SIMULATION',86,30,2,mint);
  d.text('Baking a detailed scene',42,64,5);
  d.text('SMALLER GEOMETRY AND ACOUSTIC MODELS WITH MEASURED FIT ERROR',45,130,2,muted);
  d.rect(44,169,621,316,panel);d.rect(688,169,615,316,panel);
  d.text('BRANCHED MANIFOLD',65,189,2,mint);
  d.text('NOZZLE CROSS SECTION',708,189,2,mint);
  showNetwork(d);showProfile(d);
  d.text(network.range.sourceSections+' MEASURED SECTIONS / '+Object.keys(network.links).length+' REDUCED LINKS',65,434,2);
  d.text('NAMED PORTS AND PROBES KEPT / VOLUME PRESERVED',65,462,1,muted);
  d.text(sectionReport.sections.length+' MEASUREMENTS / '+profile.spans.length+' SPANS',708,434,2);
  d.text('AREA ERROR (RMS) '+profile.error.areaRMSE.toFixed(3)+' SQUARE SCENE UNITS',708,462,1,muted);
  d.text('TWIN CHAMBER / PRESSURE AT ONE PROBE',45,516,2,paper);
  for(const [i,[name,label,signal,tint,details]] of [
    ['DETAILED GRID',active+' ACTIVE CELLS / '+samples.length+' SAMPLES',samples,blue,'REFERENCE RESPONSE / 0.50 S'],
    ['WINDOWED IMPULSE',fir.taps.length+' TAPS / 0.25 S',firSamples,amber,'FULL ERROR '+percent(fir.error.full.relativeRMSE)],
    ['DAMPED MODES',modal.modes.length+' MODES / 0.30 S FIT',modalSamples,purple,
      'FIT '+percent(modal.error.fit.relativeRMSE)+' / HELD OUT '+percent(modal.error.validation.relativeRMSE)]
  ].entries()){
    const x=44+i*423;
    d.rect(x,551,413,243,panel);
    d.text(name,x+16,573,2,tint);
    d.text(label,x+16,602,1,muted);
    waveform(d,x+16,signal,tint);
    d.text(details,x+16,755,1,muted);
  }
  d.text('ALL WAVEFORMS SHARE THE SAME AMPLITUDE AND TIME SCALE. ERRORS ARE RELATIVE RMS.',45,816,1,muted);
  return frame(d,width,height);
}
write('model-reduction.png',PNG.encodeFrame(board()));

const pressure=['#4c3c91','#514f9e','#3e578c','#2b466c','#203750','#345772','#4b8491','#87bd9e','#cdd891'];
const images=snapshots.map((snapshot,index)=>{
  const d=drawing();
  d.rect(0,0,500,300,bg);
  d.text('TWIN CHAMBER / PRESSURE WAVE',24,21,2,mint);
  d.text('SLOW MOTION THROUGH THE DETAILED GRID',24,52,1,muted);
  for(let i=0;i<snapshot.length;i++)if(open[i]){
    const intensity=Math.max(-1,Math.min(1,Math.asinh(snapshot[i]*11)/2));
    d.rect(39+i%width*6,70+Math.floor(i/width)*5,6,5,pressure[Math.round(4+4*intensity)]);
  }
  d.rect(147,156,7,7,paper);
  d.text('PROBE',163,155,1,paper);
  d.text((index*4).toFixed(0).padStart(3,'0')+' MS  /  '+active+' ACTIVE CELLS',24,271,2,muted);
  return frame(d,500,300);
});
write('chamber-wave.apng',PNG.encodeAnimation(images,12));
