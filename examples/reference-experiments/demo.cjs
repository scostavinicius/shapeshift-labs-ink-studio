const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ink=require('../..'),kit=ink.load(),K=kit.KIT;
const PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js'),files=require('../../cli/asset-files.js');
const out=path.resolve(process.argv[2]??'studio/out/reference-experiments'),file=name=>path.join(out,name);
const write=(name,bytes)=>files.write(file(name),bytes);
const {report,captures}=ink.runReferenceExperiments({kit});
assert.equal(report.passed,true);
files.json(file('reference-report.json'),report);
files.json(file('membrane.modes.json'),captures.membrane.asset);
fs.cpSync(path.join(__dirname,'recipes'),file('recipes'),{recursive:true});

const rate=24000,fps=12,perExperiment=24,seconds=perExperiment/fps;
const samples=rate*seconds, audition=new Float64Array(samples*report.experiments.length);
const peak=values=>values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
const tubePeak=Math.max(...['open-tube','closed-tube'].map(id=>peak(captures[id].trace.pressure.inside)));
const stem=id=>{
  if(id.endsWith('-tube'))return Float64Array.from(captures[id].trace.pressure.inside,v=>.76*v/tubePeak);
  if(id==='membrane'){
    const input=captures[id].trace.pickups.center, scale=.76/peak(input);
    return Float64Array.from(input,v=>v*scale);
  }
  if(id==='two-body-impact'){
    const {world:W}=K, raw=W.contactSamples.impactTrack(captures[id].hit,{duration:.008});
    const pulse=W.contactExciters.prepare({format:W.contactExciters.format,version:1,
      id:'reference-impact-audition',sampleRate:rate,tracks:{impulse:raw}}).process(rate).tracks.impulse.force;
    let filtered=0, previous=0;
    const audio=Float64Array.from({length:rate},(_,i)=>{
      const value=pulse[i*3]; // X component of the interleaved force vector.
      filtered=.965*(filtered+value-previous);
      previous=value;
      return filtered;
    });
    const scale=.68/peak(audio);
    return audio.map(value=>value*scale);
  }
  return null;
};
const montage=[];
for(const [i,{id}] of report.experiments.entries()){
  const signal=stem(id);
  if(!signal)continue;
  const impact=captures['two-body-impact'];
  const offset=id==='two-body-impact'?Math.round(rate*impact.hit.timing.time*(seconds/impact.rows.at(-1).time-1)):0;
  audition.set(signal,i*samples+offset);
  montage.push(signal);
  write(id+'.wav',WAV.encode({sampleRate:rate,channels:1,samples:signal},{encoding:'pcm24'}));
}
const gap=rate/6, mixed=new Float64Array(montage.reduce((n,v)=>n+v.length,0)+gap*(montage.length-1));
for(let i=0,at=0;i<montage.length;i++){mixed.set(montage[i],at);at+=montage[i].length+gap;}
write('reference-auditions.wav',WAV.encode({sampleRate:rate,channels:1,samples:mixed},{encoding:'pcm24'}));
write('gallery-sound.wav',WAV.encode({sampleRate:rate,channels:1,samples:audition},{encoding:'pcm24'}));

const bg='#111f2c',panel='#1a3141',well='#112936',grid='#395562',inkColor='#edf3e5',dim='#a9c4cb',
  mint='#87e1c2',blue='#92c2ec',amber='#f6c382',rose='#f1a58d',violet='#d3b6f1',steel='#546e85';
const colorById={'open-tube':mint,'closed-tube':amber,'damped-oscillator':blue,membrane:violet,
  'tank-drain':mint,'heat-slab':rose,'two-body-impact':amber};
const width=1112,height=690,sx=32,sy=151,sw=656,sh=497,rx=708,rw=372;
function draw(){
  const commands=[];
  return {rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(label,x,y,scale=2,color=inkColor)=>commands.push({type:'text',text:label,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    polygon:(points,fill)=>commands.push({type:'polygon',points,fill}),
    finish:()=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}))};
}
function arrow(d,a,b,color,width=2){
  const t=Math.atan2(b[1]-a[1],b[0]-a[0]), h=8;
  d.line([a,b],color,width);
  d.line([[b[0]-h*Math.cos(t-.52),b[1]-h*Math.sin(t-.52)],b,
    [b[0]-h*Math.cos(t+.52),b[1]-h*Math.sin(t+.52)]],color,width);
}
const fmt=(n,digits=2)=>n.toFixed(digits);
const sci=n=>n.toExponential(2).toUpperCase();
const frame=(rows,t)=>rows[Math.min(rows.length-1,Math.floor(t*(rows.length-1)+.5))];
function axes(d,x,y,w,h){
  d.rect(x,y,w,h,well);
  for(let i=0;i<=6;i++)d.line([[x+w*i/6,y],[x+w*i/6,y+h]],grid);
  for(let i=1;i<4;i++)d.line([[x,y+h*i/4],[x+w,y+h*i/4]],grid);
}
function chart(d,lines,{lo=0,hi=1,cursor,x=55,y=461,w=610,h=120}={}){
  axes(d,x,y,w,h);
  const point=(u,value)=>[x+w*u,y+h*(1-(value-lo)/(hi-lo))];
  for(const [values,color] of lines)d.line(values.map((value,i)=>point(i/(values.length-1),value)),color,2);
  if(cursor!==undefined)d.line([[x+w*cursor,y],[x+w*cursor,y+h]],inkColor);
}
function metric(d,at,label,value,color=inkColor,scale=3){
  d.text(label,rx+22,at,1,dim);d.text(value,rx+21,at+22,scale,color);
}
function header(d,row){
  const color=colorById[row.id];
  d.rect(0,0,width,height,bg);d.rect(34,30,25,4,color);
  d.text('INK STUDIO / REFERENCE EXPERIMENTS',73,24,2,color);
  d.text(row.title,31,61,5);
  d.rect(sx,sy,sw,sh,panel);d.rect(rx,sy,rw,sh,panel);
  d.text('REFERENCE CHECKS',rx+20,170,2,inkColor);
  d.text(Object.values(row.checks).filter(check=>check.passed).length+' / '+Object.keys(row.checks).length+' PASSED',rx+20,612,2,mint);
}
function tube(d,row,source,t){
  const {trace,launch,reflected,direct,sampleRate,polarity}=source, signed=row.checks.reflectedPressure.value;
  const passage=Math.round(source.length*sampleRate/row.evidence.soundSpeed);
  const x=95,y=293,w=540, probe=x+source.probeFraction*w, time=t*2*passage;
  d.text('PULSE AND FIRST REFLECTION / SLOWED',54,170,2);
  d.rect(55,207,610,199,well);
  d.rect(x,y-62,w,15,steel);d.rect(x,y+47,w,15,steel);
  d.rect(x,y-47,w,94,'#233e50');
  if(polarity>0)d.rect(x+w-12,y-61,12,123,amber);
  for(const p of [x,x+w])for(const a of [-1,1])d.rect(p-5,y+a*53-11,10,22,dim);
  d.line([[probe,y-52],[probe,y+54]],blue);
  d.text('PROBE',probe-25,y+67,1,blue);
  d.text(polarity>0?'SEALED END':'OPEN END',x+w-71,y+67,1,polarity>0?amber:mint);
  const incident=time<=passage, u=(incident?time:2*passage-time)/passage;
  const front=x+w*u, color=incident?mint:(polarity>0?amber:rose);
  d.rect(Math.min(x+w-12,Math.max(x,front-6)),y-43,12,86,color);
  arrow(d,[front,y],[Math.max(x,Math.min(x+w,front+(incident?35:-35))),y],inkColor);
  d.text('NATIVE PRESSURE TRACE',54,433,2);
  const reach=2*passage+22;
  const values=trace.pressure.inside.slice(launch,launch+reach);
  chart(d,[[values,colorById[row.id]]],{lo:-tubePeak,hi:tubePeak,cursor:time/reach});
  d.text('DIRECT '+direct+' SAMPLES   /   ECHO '+reflected+' SAMPLES',56,610,1,dim);
  metric(d,219,'FUNDAMENTAL',fmt(row.checks.fundamental.value,1)+' HZ',colorById[row.id],4);
  metric(d,310,'MEAN REFLECTED PRESSURE',fmt(signed,3)+' PA',signed<0?rose:amber);
  metric(d,399,'PULSE ARRIVAL',fmt(row.checks.arrival.value*1000,2)+' MS',blue);
  metric(d,486,polarity>0?'TIP FLOW':'TIP PRESSURE',sci(row.checks.boundary.value)+' '+(polarity>0?'M3/S':'PA'),mint,2);
}
function oscillator(d,row,{rows},t){
  const state=frame(rows,t), left=116, right=590, x=348+state.position*260, y=304;
  d.text('MASS, SPRING AND VISCOUS DAMPER',54,170,2);
  d.rect(55,207,610,200,well);
  d.line([[left,y-57],[left,y+52]],steel,6);
  d.line([[left-15,y+55],[right+35,y+55]],grid,5);
  const spring=Array.from({length:34},(_,i)=>[left+(x-left-51)*i/33,y+(i===0||i===33?0:i%2?17:-17)]);
  d.line(spring,blue,3);
  d.rect(x-51,y-29,102,57,blue);d.rect(x-46,y-23,92,8,'#b6d6ec');d.rect(x-42,y+17,83,7,steel);
  d.line([[left,y+35],[x-52,y+35]],violet,2);
  d.rect(left+42,y+23,51,23,violet);d.rect(left+47,y+27,42,15,well);
  if(Math.abs(state.speed)>.08)arrow(d,[x,y-43],[x+state.speed*26,y-43],amber);
  d.text('POSITION / SOLVER AND CLOSED FORM',54,433,2);
  chart(d,[[rows.map(r=>r.expected),mint],[rows.map(r=>r.position),blue]],{lo:-.65,hi:.65,cursor:t});
  d.text('SIMULATION TIME '+fmt(state.time)+' S',56,611,1,dim);
  metric(d,220,'DAMPED FREQUENCY',fmt(row.evidence.dampedFrequency,3)+' HZ',blue);
  metric(d,307,'AMPLITUDE DECAY',fmt(row.evidence.amplitudeDecay,2)+' /S',violet);
  metric(d,396,'MAX POSITION ERROR',sci(row.checks.displacement.value)+' M',mint,2);
  metric(d,489,'ENERGY RESIDUAL',sci(row.checks.energy.value)+' J',mint,2);
}
function membrane(d,row,{asset,trace},t){
  const colorByLevel=['#273c59','#39526f','#577392','#8391b1','#a397c8','#c5b0e3','#e6c7f1'];
  const {geometry,modes}=asset, shape=modes[0].shape,max=peak(shape), phase=Math.sin(2*Math.PI*1.3*t);
  const transform=([x,y],height)=>[170+376*x+146*y,326+67*x-101*y-94*height];
  d.text('FIRST MESH MODE / PHASE SLOWED',54,170,2);
  d.rect(55,207,610,200,well);
  for(const tri of geometry.elements){
    const a=tri.reduce((total,i)=>total+shape[i]*phase/max,0)/3;
    const tone=colorByLevel[Math.round(3+3*a)];
    d.polygon(tri.map(i=>transform(geometry.vertices[i],phase*shape[i]/max)),tone);
  }
  for(const i of asset.evidence.fixedVertices){
    const [x,y]=transform(geometry.vertices[i],0);
    d.rect(x-1,y-1,3,3,amber);
  }
  d.text('MEASURED CENTER DISPLACEMENT',54,433,2);
  const pickup=trace.pickups.center, maxPickup=peak(pickup), envelope=Array.from({length:121},(_,i)=>{
    const from=Math.floor(i*(pickup.length-180)/120);
    return peak(pickup.slice(from,from+180))/maxPickup;
  });
  chart(d,[[envelope,violet]],{lo:0,hi:1,cursor:t});
  d.text('AMBER MARKS FIXED EXTERIOR VERTICES',55,611,1,dim);
  metric(d,218,'MEASURED PICKUP',fmt(row.checks.pickupFrequency.value,2)+' HZ',violet);
  metric(d,310,'ANALYTIC RECTANGLE',fmt(row.evidence.analyticFrequency,2)+' HZ',blue);
  metric(d,399,'PINNED VERTICES',String(row.evidence.pinnedVertices),amber);
  metric(d,487,'EIGENPAIR RESIDUAL',sci(row.evidence.relativeEigenResidual),mint,2);
}
function tank(d,row,{rows,volume},t){
  const state=frame(rows,t), x=147,y=225,w=392,bottom=y+151;
  const water=138*state.volume/volume, stream=3+15*Math.sqrt(Math.max(0,state.flow/.8));
  d.text('LINEAR HEAD-DRIVEN DRAIN',54,170,2);
  d.rect(55,207,610,200,well);
  d.rect(x,y,10,155,steel);d.rect(x+w,y,10,155,steel);d.rect(x,bottom,w+10,13,steel);
  d.rect(x+10,bottom-water,w-10,water,'#397d97');d.rect(x+10,bottom-water,w-10,4,blue);
  for(let i=0;i<5;i++)d.rect(x+w+14,y+15+i*30,10,2,dim);
  d.rect(x+w-3,bottom-21,56,9,steel);
  d.rect(x+w+26,bottom-18,stream,37,mint);
  d.text('VOLUME / CONTINUUM DRAIN',54,433,2);
  chart(d,[[rows.map(r=>r.expected),inkColor],[rows.map(r=>r.volume),mint]],{hi:volume,cursor:t});
  d.text('SIMULATION TIME '+fmt(state.time)+' S',56,610,1,dim);
  metric(d,220,'WATER REMAINING',fmt(state.volume,3)+' M3',blue);
  metric(d,311,'OUTFLOW',fmt(state.flow,3)+' M3/S',mint);
  metric(d,397,'ACCOUNTED DISCHARGE',fmt(state.escaped,3)+' M3',inkColor);
  metric(d,487,'MAX VOLUME BALANCE ERROR',sci(row.checks.waterBalance.value)+' M3',mint,2);
}
function heat(d,row,{rows,nx,ny,mean,amplitude},t){
  const state=frame(rows,t), heatColors=['#365774','#487294','#638da2','#82adc0','#afc6c0','#e0cb9f','#e7af83',
    '#e99375','#dc745f','#d15a4d','#a94c47'];
  const val=c=>Math.min(10,Math.max(0,Math.round(5+5*(c-mean)/amplitude)));
  d.text('INSULATED SLAB / DIFFUSION',54,170,2);
  d.rect(55,207,610,200,well);
  const x=73,y=257,w=574,h=105;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)
    d.rect(x+w*i/nx,y+h*j/ny,w/nx+.35,h/ny+.35,heatColors[val(state.values[j*nx+i])]);
  for(const p of [x,x+w])d.rect(p-4,y-9,8,h+18,steel);
  d.text('ZERO FLUX',x,376,1,blue);d.text('ZERO FLUX',x+w-68,376,1,blue);
  d.text('MIDLINE TEMPERATURE / CLOSED FORM',54,433,2);
  const lineIndex=nx*Math.floor(ny/2);
  chart(d,[[state.expected.slice(lineIndex,lineIndex+nx),inkColor],[state.values.slice(lineIndex,lineIndex+nx),rose]],
    {lo:mean-amplitude,hi:mean+amplitude});
  d.text('SIMULATION TIME '+fmt(state.time)+' S',55,610,1,dim);
  metric(d,220,'HOT END',fmt(Math.max(...state.values))+' C',rose);
  metric(d,307,'COLD END',fmt(Math.min(...state.values))+' C',blue);
  metric(d,395,'MAX CONTINUUM ERROR',fmt(row.checks.continuousDiffusion.value,4)+' K',inkColor,2);
  metric(d,483,'MAX HEAT BALANCE ERROR',sci(row.checks.heatBalance.value)+' J',mint,2);
}
function impact(d,row,{rows,expectedTime},t){
  const state=frame(rows,t), pos=n=>Math.round(104+(n+1.2)*177), y=316;
  d.text('TWO FREE MASSES / NORMAL IMPACT',54,170,2);
  d.rect(55,207,610,200,well);d.line([[75,y+38],[633,y+38]],steel,3);
  for(const [x,v,c,label,h] of [[state.x1,state.v1,blue,'1.50 KG',51],[state.x2,state.v2,amber,'2.25 KG',67]]){
    const p=pos(x), wall=y+36-h;
    d.rect(p-30,wall,60,h,c);d.rect(p-27,wall+4,53,8,inkColor);
    d.text(label,p-23,y+57,1,c);
    if(Math.abs(v)>.01)arrow(d,[p,wall-10],[p+v*28,wall-10],c);
  }
  d.text('X POSITION / BOTH BODIES',54,433,2);
  chart(d,[[rows.map(r=>r.x1),blue],[rows.map(r=>r.x2),amber]],{lo:-1.12,hi:1.62,cursor:t});
  d.text('SIMULATION TIME '+fmt(state.time)+' S',55,611,1,dim);
  metric(d,220,'SUB-TICK CONTACT',fmt(expectedTime*1000,2)+' MS',amber);
  metric(d,308,'RECEIVED IMPULSE',fmt(row.checks.impulse.value,2)+' N S',blue);
  metric(d,398,'STEP-AVERAGE FORCE',fmt(row.checks.stepAverageForce.value,1)+' N',amber);
  metric(d,486,'MOMENTUM RESIDUAL',sci(row.checks.momentum.value)+' KG M/S',mint,2);
}

const displays={tube,oscillator,membrane,tank,heat,impact};
const review=[];
for(const [i,row] of report.experiments.entries()){
  for(let f=0;f<perExperiment;f++){
    const d=draw();
    header(d,row);
    displays[row.kind](d,row,captures[row.id],f/(perExperiment-1));
    const image=d.finish(), number=i*perExperiment+f;
    write('frames/frame-'+String(number).padStart(3,'0')+'.png',PNG.encodeFrame(image));
    if(f===Math.floor(perExperiment*.38))write('stills/'+row.id+'.png',PNG.encodeFrame(image));
    if(f%2===0)review.push(image);
  }
}
write('reference-gallery.png',PNG.encodeAnimation(review,fps/2));
const d=draw();
d.rect(0,0,width,height,bg);d.rect(33,30,26,4,mint);d.text('INK STUDIO / SIMULATION',74,24,2,mint);
d.text('Seven reference experiments',29,63,5);
d.text('NATIVE SOLVERS CHECKED AGAINST INDEPENDENT SOLUTIONS',33,117,2,dim);
const summary={
  'open-tube':'125.0 HZ / INVERTED PRESSURE ECHO','closed-tube':'62.5 HZ / SAME-POLARITY ECHO',
  'damped-oscillator':'ANALYTIC MOTION AND ENERGY BALANCE',membrane:'MESH MODE AND FIXED EDGE',
  'tank-drain':'LINEAR HEAD AND CONSERVED VOLUME','heat-slab':'COSINE DECAY WITH INSULATED EDGES',
  'two-body-impact':'SUB-TICK CONTACT AND MOMENTUM CONSERVATION'
};
for(const [i,row] of report.experiments.entries()){
  const y=155+i*70,c=colorById[row.id], n=Object.keys(row.checks).length;
  d.rect(32,y,1047,60,i%2?well:panel);d.rect(32,y,5,60,c);
  d.text(row.title,53,y+10,2,c);d.text(summary[row.id],54,y+34,1,dim);
  d.text(n+' / '+n+' PASSED',884,y+19,2,mint);
}
write('reference-board.png',PNG.encodeFrame(d.finish()));
console.log('Wrote seven animated reference experiments, reports and native auditions to '+out);
