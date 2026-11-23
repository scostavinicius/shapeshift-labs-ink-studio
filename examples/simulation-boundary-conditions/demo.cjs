const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const kit=require('../..').load(), PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js');
const {KIT:K}=kit,W=K.world,B=W.boundaryConditions,D=W.discretization;
const out=path.resolve(process.argv[2]??'studio/out/boundary-conditions');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const rate=24000,speed=343,density=1.2,bore=.0031,travel=84,admittance=bore/(density*speed);
const pulse={kind:'pulse',at:.0397,duration:.00104,amplitude:2*admittance*.8};
const seat={seat:{points:[[0,0,0],[.14,0,0],[.14,0,.14],[0,0,.14]],triangles:[[0,2,1],[0,3,2]],normal:[0,1,0]},
  moving:[[0,.001,0],[.14,.001,0],[.14,.001,.14],[0,.001,.14]],referenceVolume:.0196*.001};
const asset={format:B.format,version:1,id:'boundary-bench',revision:3,rules:{
  cold:{kind:'fixed-value',signal:{keys:[{time:0,value:0},{time:.68,value:0},{time:1.12,value:.52}]}},
  feed:{kind:'flux',basis:'total',signal:{kind:'pulse',at:.09,duration:.49,amplitude:.42}},
  local:{kind:'disturbance',signal:{kind:'pulse',at:.43,duration:.43,amplitude:.74}},
  quiet:{kind:'absorbing'},
  load:{kind:'impedance',value:3/admittance},
  ping:{kind:'disturbance',quantity:{unit:'m^3/s'},signal:pulse},
  piston:{kind:'moving-wall',geometry:seat,motion:{keys:[
    {time:0,value:0},{time:.0325,value:0},{time:.0360,value:-.00047},
    {time:.0395,value:-.00047},{time:.0470,value:0}]}}
}};
const file='bench.boundaries.json';
json(file,asset);
const pack=B.prepare(asset);
json('boundary-window.json',pack.sample(.0325,.0035));

const columns=36, rows=18, h=.06, dt=.008, duration=1.36;
const grid=D.compile({format:D.format,version:1,id:'tracer-grid',revision:1,units:'m',
  source:{kind:'grid',size:[columns,rows],spacing:h},
  regions:[{tag:'intake',side:'x0'},{tag:'far',side:'x1'}]});
const region={min:[.79,.29,0],max:[1.22,.69,0]};
const binding={revision:3,boundaries:{intake:'feed',far:'cold'},
  disturbances:{injection:{rule:'local',target:region}}};
const configured=W.gridOperators.prepare(grid,{conditions:{asset,...binding}});
const steps=Math.round(duration/dt), frames=[], budget={in:0,out:0,source:0};
let values=new Float64Array(grid.cells.length);
for(let i=0;i<=steps;i++){
  if(i%5===0)frames.push({time:i*dt,values:values.slice(),...budget});
  if(i===steps)break;
  const out=configured.transport(values,{dt,time:i*dt,diffusivity:.029});
  values=out.values;
  for(const row of Object.values(out.ledger.boundary)){budget.in+=row.in;budget.out+=row.out;}
  budget.source+=out.ledger.source;
}
const stored=values.reduce((sum,value,i)=>sum+value*grid.cells[i].measure,0);
const gridError=stored+budget.out-budget.in-budget.source;
assert.ok(Math.abs(gridError)<1e-12);
const gridPlan={format:W.gridOperators.planFormat,version:1,domain:'tracer.grid.json',operation:'transport',
  values:Array.from(frames[13].values),settings:{time:frames[13].time,dt,diffusivity:.029},
  conditions:{...binding,asset:file}};
json('tracer.grid.json',grid);
json('tracer.step.json',gridPlan);
const gridCli=require('../../cli/grid-operators.js').run(kit,gridPlan,path.join(out,'tracer.step.json'));
json('tracer.step.report.json',gridCli);

const N=W.waveNetworks, cli=require('../../cli/wave-network.js'), picks={launch:{node:'inlet'},receiver:{node:'outlet'}};
const guide={format:N.format,version:1,id:'boundary-bore',nodes:{inlet:{},outlet:{}},observations:picks,
  tubes:{bore:{from:'inlet',to:'outlet',sections:[{length:travel*speed/rate,area:bore}]}}};
json('audition.network.json',guide);
const common={asset:file,revision:3};
function wave(id,{ends,drives},probe){
  const plan={format:N.runFormat,version:1,network:'audition.network.json',samples:5200,
    settings:{method:'delay',soundSpeed:speed,sampleRate:rate,density,loss:.04,conditions:{...common,ends,drives}}};
  const report=cli.run(kit,plan,path.join(out,id+'.run.json'));
  return {id,plan,report,probe};
}
const strike={tap:{rule:'ping',node:'inlet'}};
const bright=wave('loaded',{ends:{inlet:'quiet',outlet:'load'},drives:strike},'launch');
const dry=wave('absorbed',{ends:{inlet:'quiet',outlet:'quiet'},drives:strike},'launch');
const moved=wave('moving-wall',{ends:{outlet:'quiet'},drives:{push:{rule:'piston',node:'inlet'}}},'receiver');
const peak=values=>values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
const sonicGain=.8/peak(bright.report.pressure.launch), wallGain=.8/peak(moved.report.pressure.receiver);
const waves=[dry,bright,moved];
for(const row of waves){
  row.plan.audio={probe:row.probe,gain:row===moved?wallGain:sonicGain};
  json(row.id+'.run.json',row.plan);
  json(row.id+'.trace.json',row.report);
  cli.writeWav(path.join(out,row.id+'.wav'),row.report,row.plan.audio);
}
const first=Math.floor(pulse.at*rate), echo=2*travel;
const early=peak(bright.report.pressure.launch.slice(first,first+32));
const bounced=peak(bright.report.pressure.launch.slice(first+echo,first+echo+32));
const quiet=peak(dry.report.pressure.launch.slice(first+echo,first+echo+32));
const wallVolume=pack.level('piston',.0325,.0035)*.0035;
assert.ok(early>0&&bounced/early>.4&&quiet<1e-12&&wallVolume>0);
const stride=Math.round(.27*rate), tape=new Float64Array(stride*6);
for(const [i,row] of waves.entries()){
  const pcm=Float64Array.from(row.report.pressure[row.probe],v=>v*row.plan.audio.gain);
  tape.set(pcm,(i*2)*stride);
  tape.set(pcm,(i*2+1)*stride);
}
write('boundary-auditions.wav',WAV.encode({sampleRate:rate,channels:1,samples:tape}));
json('comparison.json',{boundarySet:pack.identity,grid:{...budget,stored,error:gridError},
  waves:{echoSamples:echo,echoMs:1000*echo/rate,reflectedRatio:bounced/early,absorbedEcho:quiet},
  piston:{compressionVolume:wallVolume,receiverPeak:peak(moved.report.pressure.receiver)},
  audio:{order:waves.map(row=>row.id),repeats:2,loopSeconds:.27,commonEndGain:sonicGain,wallGain}});

const bg='#122330',panel='#1c3242',well='#142835',line='#3a5666',paper='#eff1df',dim='#a8c3cc',
  mint='#8fe7ba',blue='#8fbdf5',amber='#ffbe83',purple='#c9aef3';
const rasterPeak=Math.max(...frames.map(frame=>peak(frame.values)))||1;
const shades=['#213b4b','#254e66','#2d7287','#469a9c','#73b6a7','#a6d7ad','#dfecb5','#ffe4a1'];
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})};
}
const packFrame=(d,width,height)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands:d.commands,edges:'hard'}));
function raster(d,current,x,y,w,height){
  const {values}=current, xStep=w/columns,yStep=height/rows;
  d.rect(x,y,w,height,well);
  for(const [i,cell] of grid.cells.entries()){
    const [col,row]=cell.address;
    const color=shades[Math.min(shades.length-1,Math.floor(Math.max(0,values[i]/rasterPeak)*shades.length))];
    d.rect(x+col*xStep,y+height-(row+1)*yStep,Math.ceil(xStep),Math.ceil(yStep),color);
  }
  const bx=x+w*region.min[0]/(columns*h),by=y+height*(1-region.max[1]/(rows*h)),
    rx=x+w*region.max[0]/(columns*h),ry=y+height*(1-region.min[1]/(rows*h));
  d.line([[bx,by],[rx,by],[rx,ry],[bx,ry],[bx,by]],purple,1);
  d.line([[x,y],[x,y+height]],mint,2);
  d.line([[x+w,y],[x+w,y+height]],blue,2);
}
function signals(d,x,y,w,h,from,count,series){
  d.rect(x,y,w,h,well);
  const mid=y+h*.5, scale=series.reduce((n,[values])=>Math.max(n,peak(values.slice(from,from+count))),1e-12);
  for(let i=0;i<=4;i++){const at=x+i*w/4;d.line([[at,y+4],[at,y+h-4]],line);}
  d.line([[x,mid],[x+w,mid]],line);
  for(const [values,color] of series)d.line(Array.from({length:count},(_,i)=>[x+i*w/(count-1),mid-values[from+i]/scale*h*.44]),color,2);
}
function chart(){
  const d=drawing(),width=1248,height=832;
  d.rect(0,0,width,height,bg);d.rect(42,33,25,4,mint);
  d.text('INK STUDIO / PHYSICAL SIMULATION',81,28,2,mint);
  d.text('One boundary set, three rigs',40,63,5,paper);
  d.text('REVISION 3 / REUSED BY THE GRID, PIPE AND MOVING-WALL MEASUREMENT',43,129,2,dim);
  d.rect(42,174,558,598,panel);d.rect(622,174,584,598,panel);
  d.text('GRID / FIXED VALUE, FLUX AND LOCAL SOURCE',59,195,2,mint);
  d.text('TRACER AT '+frames[11].time.toFixed(2)+' S',60,236,1,dim);
  raster(d,frames[11],60,258,520,138);
  d.text('TRACER AT '+frames.at(-1).time.toFixed(2)+' S',60,427,1,dim);
  raster(d,frames.at(-1),60,449,520,138);
  d.text('INLET FLUX',60,625,1,mint);
  d.text('LOCAL DISTURBANCE',212,625,1,purple);
  d.text('FIXED VALUE',429,625,1,blue);
  d.text('LOCAL SOURCE TOTAL '+budget.source.toFixed(3),60,673,2,paper);
  d.text('BALANCE RESIDUAL '+Math.abs(gridError).toExponential(2).toUpperCase(),60,719,1,dim);
  d.text('PIPE / ABSORBING END VS IMPEDANCE LOAD',642,195,2,mint);
  signals(d,642,234,544,173,first-14,echo+56,[[bright.report.pressure.launch,amber],[dry.report.pressure.launch,blue]]);
  d.text('ABSORBED',642,432,1,blue);d.text('IMPEDANCE ECHO',821,432,1,amber);
  d.text('ECHO '+(100*bounced/early).toFixed(1)+'% AFTER '+(1000*echo/rate).toFixed(1)+' MS',642,471,2,paper);

  d.text('PISTON / VOLUME CHANGE DRIVES A WAVE',642,537,2,mint);
  signals(d,642,570,544,126,Math.floor(.029*rate),Math.floor(.027*rate),[[moved.report.pressure.receiver,purple]]);
  d.text('COMPRESSION DISPLACES '+(wallVolume*1e6).toFixed(2)+' CM^3',642,724,1,purple);
  d.text('AUDIO ORDER   ABSORBING END / IMPEDANCE LOAD / MOVING WALL. EACH TAP SOUNDS TWICE.',42,799,1,dim);
  return packFrame(d,width,height);
}
write('boundary-comparison.png',PNG.encodeFrame(chart()));
const movie=frames.map(current=>{
  const width=618,height=321,d=drawing();
  d.rect(0,0,width,height,bg);
  d.text('FLUX AND A LOCAL DISTURBANCE',22,21,2,paper);
  d.text(current.time.toFixed(2)+' S / BOUNDARY SET REVISION 3',23,55,1,mint);
  raster(d,current,23,82,572,166);
  d.text('FLUX',23,276,1,mint);d.text('LOCAL SOURCE',201,276,1,purple);d.text('FIXED VALUE',444,276,1,blue);
  return packFrame(d,width,height);
});
write('tracer-boundaries.apng',PNG.encodeAnimation(movie,12));
