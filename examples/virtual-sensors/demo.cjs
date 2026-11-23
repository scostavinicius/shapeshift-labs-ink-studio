const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ink=require('../..'),kit=ink.load(),{KIT:K}=kit,W=K.world,S=W.virtualSensors;
const PNG=require('../../cli/png.js'),tools=require('../../cli/virtual-sensors.js');
const out=path.resolve(process.argv[2]??'studio/out/virtual-sensors');
fs.mkdirSync(out,{recursive:true});
const write=(name,data)=>fs.writeFileSync(path.join(out,name),data);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const makeRig=(id,sensors)=>({format:S.format,version:1,id,revision:1,sensors});
function record(label,rig,source,audio){
  const plan={format:S.runFormat,version:1,rig:label+'.rig.json',source,...(audio&&{audio})};
  const file=label+'.sensors.json';
  json(label+'.rig.json',rig);json(file,plan);
  const report=tools.run(kit,plan,path.join(out,file));
  json(label+'.report.json',report);
  return report;
}
const rate=24000,totalSamples=20400,pulseAt=1100,speed=343;
const guide={format:W.waveNetworks.format,version:1,id:'two-position-guide',nodes:{inlet:{},outlet:{}},
  tubes:{bore:{from:'inlet',to:'outlet',sections:[{length:300*speed/rate,area:.008}]}},
  observations:{near:{tube:'bore',t:.15},far:{tube:'bore',t:.85},middle:{tube:'bore',t:.5}}};
const impulseValues=Array.from({length:59},(_,i)=>.000025*Math.sin(Math.PI*(i+1)/60)**2);
const onsets=[pulseAt,8500,15700];
const drive=onsets.flatMap(start=>impulseValues.map((value,i)=>({sample:start+i,value})));
const wavePlan={format:W.waveNetworks.runFormat,version:1,network:'guide.json',samples:totalSamples,
  settings:{method:'delay',sampleRate:rate,soundSpeed:speed,loss:.033,sources:{strike:{kind:'flow',node:'inlet'}},
    terminations:{inlet:{kind:'matched'},outlet:{kind:'reflect',coefficient:.63}}},inputs:{strike:{impulses:drive}}};
json('guide.json',guide);json('guide.wave.json',wavePlan);
const instrument=makeRig('waveguide-instruments',{
  near:{kind:'microphone',source:{kind:'wave',probe:'near'}},
  far:{kind:'microphone',source:{kind:'wave',probe:'far'}},
  tap:{kind:'pressure-tap',quantity:{unit:'kPa'},source:{kind:'wave',probe:'far'}},
  meter:{kind:'flow-meter',source:{kind:'wave',probe:'middle'}}
});
const audio={channels:['near','far'],gain:.86};
const wave=record('wave',instrument,{kind:'wave',run:'guide.wave.json'},audio);
tools.writeWav(path.join(out,'guide-microphones.wav'),wave,audio);
const {near,far,tap,meter}=wave.readings, arrival=rows=>rows.findIndex(value=>Math.abs(value)>1e-9);
const arriving={near:arrival(near),far:arrival(far)}, difference=(arriving.far-arriving.near)*1000/rate;
assert.equal(arriving.far-arriving.near,210);
assert.ok(Math.max(...far.map((value,i)=>Math.abs(value-1000*tap[i])))<1e-12);
assert.ok(wave.endpoint.sensors.meter.forward>wave.endpoint.sensors.meter.total&&
  wave.endpoint.sensors.meter.reverse>0);

const dt=.02, count=120, end=count*dt;
const command=(tick,action,args)=>({tick,action,args});
const rope={kind:'rope',points:[[0,1,0],[1,1,0],[2,1,0]],stretch:.017,bend:.035,tear:5,radius:.028,
  attachments:{left:{node:0,point:[0,1,0]},right:{node:2,point:[2,1,0]}}};
const world={format:W.format,version:1,id:'instrumented-bench',dt,
  systems:{
    fabric:{kind:'deformables',config:{ground:-3,gravity:[0,0,0],damping:2.8,substeps:8,shapes:{rope}}},
    pipe:{kind:'pipe-network',config:{nodes:{tank:{capacity:3,initial:2,area:1,precharge:2.2},bay:{capacity:3,initial:.25,area:1}},
      pipes:{gate:{from:'tank',to:'bay',conductance:.11,maxFlow:.68,opening:.75}}}}
  },commands:[
    command(10,'fabric/load',{shape:'rope',node:1,impulse:[0,-1.5,0]}),
    command(33,'fabric/load',{shape:'rope',node:1,impulse:[0,-.9,0]}),
    command(40,'world/input',{port:'pipe/valve.gate',value:.18}),
    command(67,'fabric/cut',{shape:'rope',point:[.08,1,0],radius:.20})
  ]};
json('bench.world.json',world);
const node=i=>({field:'fabric/motion',args:{shape:'rope'},path:'/positions',node:i});
const benchRig=makeRig('bench-instruments',{
  down:{kind:'displacement-probe',reference:0,quantity:{unit:'mm'},
    source:{kind:'geometry',from:[1,1,0],to:node(1),axis:[0,-1,0]}},
  stretch:{kind:'strain-gauge',quantity:{unit:'%'},source:{kind:'geometry',from:node(0),to:node(1),
    when:{field:'fabric/motion',args:{shape:'rope'},path:'/broken/0',equals:false}}},
  pressure:{kind:'pressure-tap',quantity:{unit:'kPa'},source:{kind:'field',field:'pipe/nodes',args:{node:'tank'},path:'/pressure'}},
  volume:{kind:'flow-meter',quantity:{unit:'L/s'},source:{kind:'field',field:'pipe/pipes',args:{pipe:'gate'},path:'/flow'}},
  tears:{kind:'event-counter',source:{kind:'world-events'},filter:{kind:'deformable-tear'}}
});
const bench=record('bench',benchRig,{kind:'world',world:'bench.world.json',steps:count,every:1,includeWorldCheckpoint:true});
const frames=bench.frames, final=frames.at(-1).sensors, maxSag=Math.max(...frames.map(row=>row.sensors.down.value)),
  maxStrain=Math.max(...frames.slice(0,67).map(row=>row.sensors.stretch.value));
assert.ok(maxSag>25&&maxStrain>1);
assert.equal(final.tears.count,1);
assert.equal(final.stretch.status,'unavailable');
assert.equal(final.tears.lastEventTime,67*dt);
const source=W.runtime.create(bench.worldCheckpoint.world,{checkpoint:bench.worldCheckpoint});
const basin=source.query().probe('pipe/nodes',{}, {node:'bay'}).value.volume;
assert.ok(Math.abs(basin-.25-final.volume.total)<1e-10);
const roomWorld=require('../world-acoustic-hatch.json');
json('hatch.world.json',roomWorld);
const roomRig=makeRig('hatch-microphone',{listener:{kind:'microphone',source:{kind:'acoustic',field:'acoustics/audible',
  listener:{entity:'listen-post'},emitter:{entity:'beacon',socket:'speaker'},band:'high'}}});
const room=record('hatch',roomRig,{kind:'world',world:'hatch.world.json',steps:16,every:8});
const [open,shut,reopen]=room.frames.map(frame=>frame.sensors.listener);
assert.ok(open.detail.levelDb-shut.detail.levelDb>20);
assert.equal(open.detail.levelDb,reopen.detail.levelDb);

json('comparison.json',{wave:{...arriving,differenceMs:difference,rate,
  volume:wave.endpoint.sensors.meter.total,reverse:wave.endpoint.sensors.meter.reverse},
  bench:{maxSagMm:maxSag,maxStrainPercent:maxStrain,tearTime:final.tears.lastEventTime,tears:final.tears.count,
    meteredCubicMetres:final.volume.total,receivedCubicMetres:basin-.25},
  room:{openDb:open.detail.levelDb,shutDb:shut.detail.levelDb,dropDb:open.detail.levelDb-shut.detail.levelDb}});

const bg='#14212b',panel='#203543',well='#142733',grid='#3e5666',paper='#edf1dc',muted='#b1c9cf',
  mint='#8ce3bf',sky='#8fbef7',pink='#ffa58b',gold='#f6d995',lilac='#d3b8f4';
function canvas(width,height){
  const commands=[];
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const line=(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width});
  const text=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
  const image=()=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
  rect(0,0,width,height,bg);
  return {rect,line,text,image};
}
function guideChart(d,x,y,w,h){
  const start=pulseAt,end=pulseAt+730, times=[arriving.near,arriving.far];
  const max=Math.max(...[near,far].flatMap(rows=>rows.slice(start,end).map(Math.abs)));
  d.rect(x,y,w,h,well);
  for(let i=0;i<=4;i++)d.line([[x+i*w/4,y],[x+i*w/4,y+h]],grid);
  d.line([[x,y+h/2],[x+w,y+h/2]],grid);
  for(const [i,[signal,color]] of [[near,sky],[far,lilac]].entries()){
    const at=x+w*(times[i]-start)/(end-start-1);
    d.line([[at,y],[at,y+h]],color);
    d.line(signal.slice(start,end).map((v,j)=>[x+w*j/(end-start-1),y+h*.5-v*h*.42/max]),color,1);
  }
}
const real=t=>frames[Math.min(count,Math.floor(t/dt+1e-8))].sensors;
function chart(d,x,y,w,h,through=end){
  d.rect(x,y,w,h,well);
  const map=(t,v)=>[x+w*t/end,y+h*(1-v)];
  for(const v of [0,.25,.5,.75,1])d.line([map(0,v),map(end,v)],grid);
  for(const t of [.6,1.2,1.8])d.line([map(t,0),map(t,1)],grid);
  const viewed=frames.filter(({time})=>time<=through), scale=Math.max(...frames.map(r=>r.sensors.volume.value));
  for(const [name,mult,color] of [['down',maxSag,mint],['volume',scale,sky]]){
    const points=viewed.map(row=>map(row.time,Math.max(0,row.sensors[name].value)/mult));
    if(points.length>1)d.line(points,color,2);
  }
  const [cut]=map(67*dt,0),[cursor]=map(through,0);
  d.line([[cut,y],[cut,y+h]],pink);
  d.line([[cursor,y],[cursor,y+h]],paper);
}
function board(){
  const d=canvas(1190,825);
  d.rect(34,30,25,4,mint);d.text('INK STUDIO / VIRTUAL INSTRUMENTS',73,25,2,mint);
  d.text('Measure the live simulation',34,63,5);
  d.rect(34,143,541,392,panel);d.rect(596,143,560,392,panel);
  d.rect(34,555,541,218,panel);d.rect(596,555,560,218,panel);
  d.text('WAVEGUIDE / TWO MICROPHONES',54,164,2);
  guideChart(d,55,211,500,162);
  d.text('NEAR',56,396,1,sky);d.text('FAR',185,396,1,lilac);
  d.text('FAR ARRIVES '+difference.toFixed(2)+' MS LATER',55,448,2);
  d.text('PRESSURE TAP IN KPA / SIGNED FLOW IN M^3/S',55,498,1,muted);
  d.text('ROPE AND PIPE / LIVE READINGS',616,164,2);
  chart(d,617,211,515,162);
  d.text('DISPLACEMENT',617,396,1,mint);d.text('FLOW',777,396,1,sky);d.text('TEAR',951,396,1,pink);
  d.text('PEAK STRAIN '+maxStrain.toFixed(1)+'% BEFORE CUT',617,448,2);
  d.text('EVENT COUNT '+final.tears.count+' / OCCURRENCE '+final.tears.lastEventTime.toFixed(2)+' S',617,498,1,muted);
  d.text('FLOW METER / VOLUME CHECK',54,575,2);
  d.text((final.volume.total*1000).toFixed(2)+' L',54,630,4,mint);
  d.text('METER TOTAL MATCHES RECEIVER GAIN',54,721,1,muted);
  d.text('ROOM MIC / HIGH-BAND ESTIMATE',615,575,2);
  d.text((open.detail.levelDb-shut.detail.levelDb).toFixed(1)+' DB',615,630,4,pink);
  d.text('DROP WITH HATCH CLOSED',615,721,1,muted);
  d.text('SENSORS READ NATIVE PROBES, FIELDS, GEOMETRY AND EVENTS.',34,795,1,muted);
  return d.image();
}
write('sensor-comparison.png',PNG.encodeFrame(board()));
const motion=Array.from({length:Math.round(end*25)+1},(_,i)=>{
  const time=i/25, row=real(time), d=canvas(844,472);
  d.text('INSTRUMENTED ROPE AND PIPE',26,24,2);
  d.text(time.toFixed(2)+' S',26,57,1,muted);
  d.rect(25,85,794,150,panel);d.rect(25,252,516,190,panel);d.rect(562,252,257,190,panel);
  const y=124, middle=[308,y+65*row.down.value/maxSag], right=[570,y];
  if(row.tears.count===0)d.line([[65,y],middle],mint,3);
  d.line([middle,right],mint,3);
  d.rect(60,y-4,10,8,paper);d.rect(566,y-4,10,8,paper);
  d.rect(middle[0]-3,middle[1]-3,6,6,gold);
  d.text('MIDPOINT '+row.down.value.toFixed(0)+' MM',594,112,1,mint);
  d.text(row.stretch.valid?'STRAIN '+row.stretch.value.toFixed(1)+'%':'GAUGE DISCONNECTED',594,147,1,gold);
  d.text('TEARS '+row.tears.count,594,181,1,pink);
  chart(d,47,278,472,118,time);
  d.text('SAG',48,413,1,mint);d.text('FLOW',144,413,1,sky);d.text('CUT',245,413,1,pink);
  d.text('PIPE',583,278,1,muted);
  d.text(row.volume.value.toFixed(1)+' L/S',583,310,2,sky);
  d.text((row.volume.total*1000).toFixed(1)+' L TOTAL',583,365,2,mint);
  return d.image();
});
write('bench-sensors.apng',PNG.encodeAnimation(motion,25));
