const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const kit=require('../..').load(), PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const {KIT:K}=kit, N=K.world.waveNetworks, cli=require('../../cli/wave-network.js');
const out=path.resolve(process.argv[2]??'studio/out/distributed-waves');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const sampleRate=24000, soundSpeed=343, density=1.2;
const medium={sampleRate,soundSpeed,density};
const match={kind:'matched'};
const network=(id,nodes,tubes,observations)=>({format:N.format,version:1,id,revision:1,
  nodes:Object.fromEntries(nodes.map(name=>[name,{}])),tubes,observations});
const tube=(from,to,parts)=>({from,to,sections:parts.map(([length,area])=>({length,area}))});

const branch=network('horn-and-side-branch',['mouth','tee','bell','cap'],{
  stem:tube('mouth','tee',[[.34,.0019],[.26,.0031]]),
  flare:tube('tee','bell',[[.26,.0029],[.22,.0045],[.30,.0078]]),
  side:tube('tee','cap',[[.33,.0016],[.21,.0025]])
},{mouth:{node:'mouth'},tee:{node:'tee'},bell:{node:'bell'},cap:{node:'cap'}});
const branchSettings={...medium,loss:.055,losses:{side:.035},cellLength:.011,
  terminations:{mouth:match,bell:{kind:'reflect',coefficient:.21},cap:{kind:'sealed'}},
  sources:{hit:{node:'mouth',kind:'flow'}}};
const signal=new Float64Array(15600);
for(const [at,width,gain] of [[.034,4.5,.000145],[.234,9,.000135],[.438,16,.000125]]){
  const center=at*sampleRate, radius=Math.ceil(width*5);
  for(let i=Math.round(center)-radius;i<=Math.round(center)+radius;i++){
    const time=(i-center)/width;
    signal[i]+=-gain*time*Math.exp(-.5*time*time);
  }
}
json('branch.network.json',branch);
const plans=['distributed','delay'].map(method=>{
  const name='branch-'+method, file=path.join(out,name+'.run.json');
  const plan={format:N.runFormat,version:1,network:'branch.network.json',settings:{...branchSettings,method},
    samples:signal.length,inputs:{hit:Array.from(signal)},audio:{probe:'bell'}};
  return {name,method,file,plan,report:cli.run(kit,plan,file)};
});
const peak=values=>values.reduce((max,n)=>Math.max(max,Math.abs(n)),0);
const gain=.85/Math.max(...plans.map(row=>peak(row.report.pressure.bell)));
for(const row of plans){
  row.plan.audio.gain=gain;
  json(row.name+'.run.json',row.plan);
  json(row.name+'.trace.json',row.report);
  cli.writeWav(path.join(out,row.name+'.wav'),row.report,row.plan.audio);
}
assert.ok(plans[0].report.info.workPerSample>5*plans[1].report.info.workPerSample);
const balance=plans.map(row=>peak(row.report.flow.tee));
assert.ok(balance.every(value=>value<1e-15));

const length=80*soundSpeed/sampleRate, boreArea=.0022;
const straight=network('eighty-sample-guide',['inlet','end'],{guide:tube('inlet','end',[[length,boreArea]])},
  {inlet:{node:'inlet'},end:{node:'end'}});
const Y=boreArea/(density*soundSpeed), expectedEcho=160;
const inletPulse=Float64Array.from({length:340},(_,i)=>Math.abs(i-34)<=26?2*Y*Math.exp(-.5*((i-34)/4.6)**2):0);
const reflection=[['sealed','#8be7bb'],['open','#ffbd84'],['matched','#8ebcf1']].map(([kind,tint])=>{
  const wave=N.prepare(straight,{...medium,method:'delay',loss:.09,
    sources:{hit:{node:'inlet',kind:'flow'}},terminations:{inlet:match,end:{kind}}});
  const result=wave.process(inletPulse.length,{inputs:{hit:inletPulse}});
  return {kind,tint,pressure:Array.from(result.pressure.inlet)};
});
assert.ok(reflection[0].pressure[34+expectedEcho]>.7&&reflection[1].pressure[34+expectedEcho]<-.7);
assert.equal(reflection[2].pressure[34+expectedEcho],0);
const audition=new Float64Array(sampleRate*.66);
for(const [i,row] of reflection.entries()){
  const replay=new Float64Array(sampleRate*.22);
  const sourceGains=[.7,.55,.37];
  for(const [j,at] of [450,1800,3150].entries())
    row.pressure.forEach((value,k)=>{replay[k+at]=value*sourceGains[j];});
  audition.set(replay,i*replay.length);
}
write('sealed-open-matched.wav',WAV.encode({sampleRate,channels:1,samples:audition}));
json('comparison.json',{sampleRate,soundSpeed,branch:{gain,maxJunctionFlowResidual:balance,solvers:plans.map(row=>row.report.info)},
  reflection:{length,sourcePeakSample:34,echoDelaySamples:expectedEcho,echoes:Object.fromEntries(
    reflection.map(row=>[row.kind,row.pressure[34+expectedEcho]]))}});

const bg='#11202b', panel='#1b303e', well='#152732', grid='#364f60', paper='#eff1df',
  dim='#a1bcc9', blue='#8ebcf1', mint='#8be7bb', amber='#ffbd84', lilac='#cdb2f3';
const ramp=['#ffba7c','#df8f6a','#975e60','#594858','#33475a','#3e636e','#518493','#71bcb9','#a9efc6'];
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})};
}
const pack=(d,width,height)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands:d.commands,edges:'hard'}));
const points={stem:[[.07,.51],[.45,.51]],flare:[[.45,.51],[.84,.20]],side:[[.45,.51],[.76,.85]]};
const chartProbes=Object.fromEntries(Object.keys(points).flatMap(name=>Array.from({length:15},(_,i)=>
  [name+'-'+i,{tube:name,t:(i+.5)/15}])));
const drawWave=N.prepare(branch,{...branchSettings,probes:chartProbes});
const drawingPulse=Float64Array.from({length:544},(_,i)=>.000107*Math.exp(-.5*((i-28)/5)**2));
const propagation=drawWave.process(drawingPulse.length,{inputs:{hit:drawingPulse}});
const displayPeak=Math.max(...Object.keys(chartProbes).map(k=>peak(propagation.pressure[k])));
function diagram(d,x,y,w,h,sample){
  d.rect(x,y,w,h,well);
  const place=([u,v])=>[x+u*w,y+v*h];
  for(const [name,[a,b]] of Object.entries(points)){
    const to=t=>place([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
    d.line([to(0),to(1)],grid,4);
    let end=0,total=0;
    const parts=branch.tubes[name].sections, length=parts.reduce((sum,row)=>sum+row.length,0);
    for(const [i,{length:span,area}] of parts.entries()){
      total+=span/length;
      d.line([to(end),to(total)],i%2?'#40596a':'#344b5a',11+area*2400);
      end=total;
    }
    for(let i=0;i<15;i++){
      const value=propagation.pressure[name+'-'+i][sample]/displayPeak;
      const tint=ramp[Math.round(4+4*Math.max(-1,Math.min(1,value)))];
      d.line([to((i+.17)/15),to((i+.83)/15)],tint,6);
    }
  }
  for(const [name,pos,label,color] of [['mouth',[.07,.51],'DRIVEN MOUTH',mint],['tee',[.45,.51],'TEE',paper],
    ['bell',[.84,.20],'LOADED BELL',blue],['cap',[.76,.85],'SEALED STUB',amber]]){
    const [u,v]=place(pos);
    d.rect(u-3,v-3,6,6,color);
    d.text(label,u-16,v-18,1,color);
  }
}
function plot(d,x,y,w,h,series,tracks,memory=1){
  d.rect(x,y,w,h,well);
  const place=(i,v)=>[x+12+i*(w-26)/(series-1),y+h/2-v*(h*.44)/memory];
  for(const f of [0,.2,.4,.6,.8,1]){
    const [u]=place((series-1)*f,0);
    d.line([[u,y+8],[u,y+h-9]],grid);
  }
  const mid=place(0,0)[1];
  d.line([[x+8,mid],[x+w-8,mid]],grid);
  for(const [values,tint] of tracks)d.line(Array.from({length:series},(_,i)=>place(i,values[i])),tint,2);
}

function board(){
  const d=drawing(), width=1248,height=808;
  d.rect(0,0,width,height,bg);d.rect(40,35,28,4,mint);
  d.text('INK STUDIO / PHYSICAL SIMULATION',83,30,2,mint);
  d.text('What comes back down the tube',39,63,5,paper);
  d.text('VARIABLE BORE / BRANCHED ACOUSTICS / MATCHED LISTENING GAIN',43,128,2,dim);
  d.rect(41,165,568,584,panel);d.rect(627,165,580,584,panel);
  d.text('BRANCHED WAVEGUIDE',58,188,2,mint);
  d.text('PRESSURE PULSE MOVES THROUGH EACH BORE',59,224,1,dim);
  diagram(d,59,249,532,210,116);
  d.text('AT THE BELL / FIRST HIT',59,490,1,dim);
  const from=790,count=280, pair=plans.map(({report},i)=>[report.pressure.bell.slice(from,from+count),i===0?mint:lilac]);
  plot(d,59,514,532,120,count,pair,Math.max(...pair.map(([v])=>peak(v))));
  d.text('DISTRIBUTED',59,663,1,mint);
  d.text('DELAY LINE',191,663,1,lilac);
  d.text(plans[0].report.info.workPerSample+' VS '+plans[1].report.info.workPerSample+' EST. WORK UNITS / SAMPLE',59,712,1,dim);
  d.text('SAME TUBE / THREE ENDS',645,188,2,blue);
  d.text('PRESSURE AT THE DRIVE AFTER A SINGLE PULSE',646,224,1,dim);
  plot(d,646,249,543,255,reflection[0].pressure.length,reflection.map(row=>[row.pressure,row.tint]));
  d.text('SEALED / POSITIVE ECHO',646,541,1,mint);
  d.text('OPEN / INVERTED ECHO',646,571,1,amber);
  d.text('MATCHED / NO RETURN',646,601,1,blue);
  d.text('ROUND TRIP '+(expectedEcho/sampleRate*1000).toFixed(2)+' MS',646,651,2,paper);
  d.text('160 SAMPLES AT 24 KHZ',646,698,1,dim);
  d.text('PRESSURE AND SIGNED VOLUME FLOW ARE RECORDED AT EACH NAMED PROBE.',41,777,1,dim);
  return pack(d,width,height);
}
write('wave-comparison.png',PNG.encodeFrame(board()));
const movie=Array.from({length:36},(_,i)=>{
  const d=drawing(),width=676,height=361, at=28+i*12;
  d.rect(0,0,width,height,bg);
  d.text('A PRESSURE PULSE IN THE BRANCHES',26,23,2,paper);
  d.text((at/sampleRate*1000).toFixed(1)+' MS / SLOWED DOWN',27,58,1,mint);
  diagram(d,27,92,622,225,at);
  d.text('AMBER / NEGATIVE PRESSURE     MINT / POSITIVE PRESSURE',27,337,1,dim);
  return pack(d,width,height);
});
write('branch-wave.apng',PNG.encodeAnimation(movie,10));
