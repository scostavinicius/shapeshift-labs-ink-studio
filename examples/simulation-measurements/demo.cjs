const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),K=kit.KIT,W=K.world,M=W.simulationMeasurements;
const PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js'),files=require('../../cli/asset-files.js');
const runner=require('../../cli/simulation-measurements.js'),wave=require('../../cli/wave-network.js'),
  modal=require('../../cli/modal-resonator.js');
const out=path.resolve(process.argv[2]??'studio/out/simulation-measurements'),file=name=>path.join(out,name);
const write=(name,data)=>files.write(file(name),data);
const json=(name,data)=>files.json(file(name),data);
const save=(name,value)=>(json('suite/'+name,value),name);
const rate=24000,trigger=960,forceTime=.16,modalSamples=33600;
const ideal={arrival:.015,hz:437.3,decay:6,force:.021*Math.PI/(2*.006)};
const variants={
  reference:{lengthSamples:720,hz:ideal.hz,decay:ideal.decay,rise:1.4,step:.05,impulse:.021},
  changed:{lengthSamples:900,hz:461.7,decay:8.8,rise:.46,step:.8,impulse:.029}
};
const plan={format:M.format,version:1,id:'delivery-bench',measurements:{
  arrival:{kind:'arrival',source:'pipe',channel:'tap',threshold:.05,referenceSample:trigger,window:{from:trigger,to:2000}},
  frequency:{kind:'frequency',source:'plate',channel:'center',band:[350,550],window:{from:1200,to:14400}},
  decay:{kind:'decay',source:'plate',channel:'center',blockSamples:720,minFit:.999,window:{from:1200,to:24000}},
  steady:{kind:'steady-state',source:'controller',rows:'/results',fromTime:1.6,toTime:1.96,
    valuePath:'/value',target:1,unit:'1'},
  balance:{kind:'conservation',source:'energy',metric:'network-energy-balance'},
  force:{kind:'contact-force',source:'contact',track:'pad',mode:'peak'}
},assertions:{
  'arrival-budget':{measurement:'arrival',expected:ideal.arrival,absolute:2/rate,unit:'s'},
  'tuning-band':{measurement:'frequency',expected:ideal.hz,absolute:.45,unit:'Hz'},
  'ring-down':{measurement:'decay',expected:ideal.decay,absolute:.06,unit:'1/s'},
  'tracking-error':{measurement:'steady',max:.025,unit:'1'},
  'energy-budget':{measurement:'balance',max:1e-7,unit:'J'},
  'impact-limit':{measurement:'force',expected:ideal.force,absolute:.035,unit:'N'}
}};
json('suite/test-plan.json',plan);
const results={};
for(const [name,v] of Object.entries(variants)){
  const sources={};
  function native(alias,recipe,mode){
    sources[alias]={file:save(name+'-'+alias+'.json',recipe),...(mode&&{mode})};
    return recipe;
  }
  const pipe=native('pipe',{format:W.waveNetworks.runFormat,version:1,samples:3200,
    network:{format:W.waveNetworks.format,version:1,id:'calibration-guide',nodes:{inlet:{},outlet:{}},
      tubes:{guide:{from:'inlet',to:'outlet',sections:[{length:v.lengthSamples*343/rate,area:.006}]}},
      observations:{tap:{tube:'guide',t:.5}}},
    settings:{method:'delay',sampleRate:rate,loss:.01,sources:{pulse:{kind:'flow',node:'inlet'}},
      terminations:{inlet:{kind:'matched'},outlet:{kind:'matched'}}},
    inputs:{pulse:{impulses:[{sample:trigger,value:.000044}]}}});
  const asset=modal.bake(kit,{format:W.resonantModes.planFormat,version:1,id:name+'-plate',revision:1,
    source:{kind:'authored',modes:[{id:'ring',hz:v.hz,decay:v.decay}]},
    excitations:{strike:{point:[0,0,0],gains:[1]}},pickups:{center:{point:[.2,0,0],gains:[1]}}},
  file('suite/'+name+'-modal.bake.json'));
  const plate=native('plate',{format:W.resonantModes.runFormat,version:1,asset:save(name+'-modes.json',asset),
    settings:{sampleRate:rate},samples:modalSamples,impulses:[{excitation:'strike',sample:0,value:.55}]});
  native('controller',{format:W.controllers.runFormat,version:1,dt:.02,
    controller:{format:W.controllers.format,version:1,id:name+'-servo',revision:1,mode:'follow',
      limits:{rise:v.rise}},
    samples:Array.from({length:100},()=>({target:1}))});
  native('energy',{format:W.lumpedNetworks.runFormat,version:1,
    network:{format:W.lumpedNetworks.format,version:1,id:'lossless-oscillator',numerics:{step:v.step},
      nodes:{ground:{kind:'reference'},store:{kind:'storage',capacity:1,initialEffort:1}},
      elements:{mass:{kind:'inertance',from:'store',to:'ground',inertance:1}}},
    samples:Array.from({length:15},(_,i)=>(i+1)*.8),
    diagnostics:{tolerances:{'network-energy-balance':{absolute:1e-7,relative:0}}}},'diagnostics');
  native('contact',{format:W.contactExciters.runFormat,version:1,samples:6000,
    excitation:{format:W.contactExciters.format,version:1,id:name+'-impact',sampleRate:rate,
      tracks:{pad:{kind:'impact',at:forceTime,duration:.006,normal:[0,1,0],impulse:[0,v.impulse,0]}}}});
  const recipe=save(name+'.suite.json',{format:runner.runFormat,version:1,plan:'test-plan.json',sources});
  const reportFile=file(name+'.report.json');
  const run=spawnSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),'sim','measure',
    file('suite/'+recipe),'--out',reportFile],{encoding:'utf8'});
  const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
  assert.equal(run.status,name==='reference'?0:2,run.stderr);
  assert.equal(report.passed,name==='reference');
  assert.ok(Object.values(report.measurements).every(row=>row.status==='ok'));
  assert.ok(Object.values(report.assertions).every(row=>row.passed===(name==='reference')));
  const signal=modal.run(kit,plate,file('suite/'+sources.plate.file)).pickups.center;
  const response=wave.run(kit,pipe,file('suite/'+sources.pipe.file)).pressure.tap;
  results[name]={report,signal,response};
}

const peak=Math.max(...Object.values(results).map(({signal})=>signal.reduce((n,s)=>Math.max(n,Math.abs(s)),0)));
const gap=Math.floor(.3*rate), reel=new Float64Array(modalSamples*2+gap);
for(const [i,[name,{signal}]] of Object.entries(results).entries()){
  const buffer=Float64Array.from(signal,x=>.78*x/peak);
  reel.set(buffer,i*(modalSamples+gap));
  write(name+'-resonator.wav',WAV.encode({sampleRate:rate,channels:1,samples:buffer},{encoding:'pcm24'}));
}
write('resonator-comparison.wav',WAV.encode({sampleRate:rate,channels:1,samples:reel},{encoding:'pcm24'}));

const paper='#edf4e9',dim='#a5beca',bg='#12222f',panel='#1b3340',well='#142a37',line='#3d5767',
  mint='#8ce5c2',salmon='#ff9d88';
const width=1136,height=768;
const labels=[
  ['arrival','ARRIVAL TIME','15.00 MS +/- 0.08',v=>(1000*v).toFixed(2)+' MS'],
  ['frequency','DOMINANT FREQUENCY','437.30 HZ +/- 0.45',v=>v.toFixed(2)+' HZ'],
  ['decay','ENVELOPE DECAY','6.00 /S +/- 0.06',v=>v.toFixed(2)+' /S'],
  ['steady','STEADY-STATE ERROR','MAX 0.025',v=>v.toFixed(3)],
  ['balance','ENERGY BALANCE RESIDUAL','MAX 1E-7 J',v=>v.toExponential(2).toUpperCase()+' J'],
  ['force','PEAK CONTACT FORCE','5.50 N +/- 0.035',v=>v.toFixed(2)+' N']
];
function board(active){
  const commands=[];
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const stroke=(points,color,width=1)=>commands.push({type:'path',points,stroke:color,width});
  const text=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
  rect(0,0,width,height,bg);
  rect(36,28,25,4,mint);text('INK STUDIO / SIMULATION MEASUREMENTS',74,23,2,mint);
  text('Calibration bench',33,59,5);
  text('THE SAME SIX ASSERTIONS ON TWO RUNS',38,118,2,dim);
  rect(34,156,1068,338,panel);
  text('MEASUREMENT',55,172,2);text('CI LIMIT',405,172,2);
  text('REFERENCE',720,172,2,mint);text('CHANGED RUN',907,172,2,salmon);
  for(const [i,[key,label,limit,display]] of labels.entries()){
    const y=212+i*43;
    rect(47,y,1040,35,i%2?panel:well);
    text(label,56,y+9,2);text(limit,405,y+11,1,dim);
    text(display(results.reference.report.measurements[key].value),720,y+9,2,mint);
    text(display(results.changed.report.measurements[key].value),907,y+9,2,salmon);
  }
  rect(34,520,517,205,panel);rect(574,520,528,205,panel);
  text('ARRIVAL / THRESHOLD SAMPLE',55,538,2);
  text('RING-DOWN / RMS ENVELOPES',595,538,2);
  const x=55,y=575,w=473,h=97, tailX=596,tailW=479;
  rect(x,y,w,h,well);rect(tailX,y,tailW,h,well);
  for(let i=0;i<=6;i++){
    stroke([[x+w*i/6,y],[x+w*i/6,y+h]],line);
    stroke([[tailX+tailW*i/6,y],[tailX+tailW*i/6,y+h]],line);
  }
  const responsePeak=Math.max(...Object.values(results).map(({response})=>response.reduce((n,s)=>Math.max(n,Math.abs(s)),0)));
  for(const [i,data] of Object.values(results).entries()){
    const color=i?salmon:mint, sample=data.report.measurements.arrival.evidence.sample;
    const pos=x+w*((sample-trigger)/720);
    const center=y+25+i*36;
    const pressure=Array.from({length:721},(_,j)=>[x+w*j/720,center-15*data.response[trigger+j]/responsePeak]);
    stroke(pressure,color);
    stroke([[pos,y+7],[pos,y+h-7]],color,1);
    text(String(sample),pos+7,center+6,1,color);
    const series=Array.from({length:121},(_,j)=>{
      const first=Math.floor(j*(modalSamples-720)/120);
      let sum=0;
      for(let k=0;k<480;k++)sum+=data.signal[first+k]**2;
      const v=Math.sqrt(sum/480)/peak;
      return [tailX+tailW*j/120,y+h-8-v*(h-14)];
    });
    stroke(series,color,2);
  }
  text('TRIGGER SAMPLE '+trigger,55,694,1,dim);
  text('EXIT 0 / REFERENCE',595,694,1,mint);text('EXIT 2 / CHANGED',808,694,1,salmon);
  if(active==='reference')rect(719,198,114,2,mint);
  if(active==='changed')rect(906,198,135,2,salmon);
  return PNG.encodeFrame(PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'})));
}
write('measurement-board.png',board());
write('reference-listening.png',board('reference'));
write('changed-listening.png',board('changed'));
console.log('Wrote passing and failing CI reports, measurement board and resonator auditions to '+out);
