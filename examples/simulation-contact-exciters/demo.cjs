const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const kit=require('../..').load(), PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const {KIT:K}=kit, W=K.world, E=W.contactExciters, C=W.contactSamples, Waves=W.waveNetworks;
const out=path.resolve(process.argv[2]??'studio/out/contact-exciters');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const sampleRate=24000, seconds=.78, samples=Math.round(sampleRate*seconds);
const world={format:W.format,version:1,id:'contact-drop',dt:.04,systems:{striker:{kind:'mechanics',
  config:{gravity:[0,0,0],drag:0,contactSamples:true,
    bodies:{head:{position:[.22,.44,0],velocity:[.68,-2.2,0],half:[.035,.04,.04],mass:.08}}}}}};
const scene=W.runtime.create(world), contacts=[];
for(let i=0;i<8;i++){
  scene.step();
  contacts.push(...scene.view().signals['striker/contact-samples']);
}
assert.equal(contacts.length,1);
const [hit]=contacts;
json('striker.world.json',world);
json('striker.contact.json',hit);
const tracks={
  impact:C.impactTrack(hit,{duration:.0022}),
  pluck:{kind:'pluck',at:.1237,duration:.012,point:[.24,0,0],normal:[0,1,0],tangent:[1,0,0],
    stiffness:620,deflection:.021,slip:[.52,0,0]},
  bow:{kind:'bow',start:.073,end:.702,point:[.09,0,0],slip:[.24,0,0],load:1.8,stiffness:7400,
    staticFriction:.83,kineticFriction:.27,slipScale:.12,
    keys:[{time:.31,point:[.29,0,0],slip:[.61,0,0],load:2.2},
      {time:.61,point:[.48,0,0],slip:[.34,0,0]},{time:.702,point:[.54,0,0],load:0}]},
  scrape:{kind:'scrape',start:.086,end:.684,point:[.05,0,0],slip:[.26,0,0],load:1.6,
    friction:.52,grain:.00115,roughness:.93,
    keys:[{time:.39,point:[.24,0,.02],slip:[.91,0,.12],load:2.9},
      {time:.684,point:[.59,0,.08],slip:[.22,0,0],load:0}]},
  chatter:{kind:'chatter',start:.092,end:.681,point:[.14,0,0],slip:[.43,0,0],load:1.1,
    spacing:.0032,duty:.18,
    keys:[{time:.40,point:[.31,0,0],slip:[.67,0,0],load:1.25},
      {time:.681,point:[.51,0,0],slip:[.34,0,0],load:.55}]}
};
const excitation={format:E.format,version:1,id:'five-contacts',revision:1,sampleRate,seed:414,tracks};
const run={format:E.runFormat,version:1,excitation:'five-contacts.excitation.json',samples};
json('five-contacts.excitation.json',excitation);
json('five-contacts.run.json',run);
const trace=require('../../cli/contact-exciter.js').run(kit,run,path.join(out,'five-contacts.run.json'));
json('five-contacts.trace.json',trace);

const resonator={format:Waves.format,version:1,id:'contact-lab-receiver',nodes:{inlet:{},junction:{},bell:{},stub:{}},
  tubes:{stem:{from:'inlet',to:'junction',sections:[{length:.28,area:.0021}]},
    outlet:{from:'junction',to:'bell',sections:[{length:.31,area:.0037}]},
    side:{from:'junction',to:'stub',sections:[{length:.185,area:.0012}]}},
  observations:{bell:{node:'bell'}}};
const receiverSettings={method:'delay',sampleRate,loss:.13,sources:{drive:{node:'inlet',kind:'flow'}},
  terminations:{inlet:{kind:'reflect',coefficient:.3},bell:{kind:'reflect',coefficient:.4},stub:{kind:'sealed'}}};
json('receiver.network.json',resonator);
const names=Object.keys(tracks), axes={impact:[0,-1,0],pluck:[1,0,0],bow:[1,0,0],scrape:[1,.28,0],chatter:[0,1,0]};
const peak=values=>values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
const comparison={};
const stride=Math.round(sampleRate*.93), reel=new Float64Array(stride*names.length);
const projected={};
for(const [i,name] of names.entries()){
  const data=trace.tracks[name], axis=axes[name];
  const raw=Float64Array.from({length:samples},(_,j)=>data.force[j*3]*axis[0]+data.force[j*3+1]*axis[1]+data.force[j*3+2]*axis[2]);
  projected[name]=raw;
  let filter=0, previous=0;
  const level=Float64Array.from(raw,value=>{
    filter=.987*(filter+value-previous);
    previous=value;
    return filter;
  });
  const driveGain=.00017/peak(level), drive=Float64Array.from(level,value=>value*driveGain);
  const wave=Waves.prepare(resonator,receiverSettings);
  const pressure=wave.process(samples,{inputs:{drive}}).pressure.bell;
  const pcmGain=.78/peak(pressure);
  const audio=Float64Array.from(pressure,value=>value*pcmGain);
  reel.set(audio,i*stride);
  write(name+'.wav',WAV.encode({sampleRate,channels:1,samples:audio}));
  const events=trace.events.filter(row=>row.track===name);
  const totalImpulse=Array.from({length:3},(_,j)=>data.impulse.reduce((sum,value,k)=>sum+(k%3===j?value:0),0));
  comparison[name]={projectedPeakForce:peak(raw),totalImpulse,events:events.length,
    toothEvents:events.filter(row=>row.phase==='tooth').length,first:events[0],
    audition:{axis,driveGain,pcmGain}};
}
assert.ok(Math.abs(comparison.impact.totalImpulse[1]-hit.impulse[1])<1e-12);
assert.ok(comparison.chatter.toothEvents>60);
write('five-contact-auditions.wav',WAV.encode({sampleRate,channels:1,samples:reel}));
json('comparison.json',{sampleRate,receiver:{...receiverSettings,highPassPole:.987},order:names,tracks:comparison});

const bg='#12222e',panel='#1c3140',field='#152935',grid='#385463',paper='#edf2dc',dim='#a7c1cc';
const colors={impact:'#ffbf83',pluck:'#8fe6b9',bow:'#8ebcf2',scrape:'#c6adf7',chatter:'#f1db86'};
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    label:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})};
}
const render=(d,width,height)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands:d.commands,edges:'hard'}));
const fixed=(value,n=2)=>value.toFixed(n);
const subtitles={impact:'SWEPT COLLISION',pluck:'ELASTIC RELEASE',bow:'STICK AND SLIP',
  scrape:'SEEDED SURFACE TEXTURE',chatter:'TRAVEL-SPACED RECONTACT'};

function plot(d,name,x,y,w,h,widthInSamples=samples,offset=0){
  d.rect(x,y,w,h,field);
  const series=projected[name], amplitude=peak(series), mid=y+h*.54;
  for(const fraction of [0,.2,.4,.6,.8,1])d.line([[x+fraction*w,y+2],[x+fraction*w,y+h-3]],grid);
  d.line([[x,mid],[x+w,mid]],grid);
  const points=Array.from({length:w},(_,j)=>{
    const start=offset+Math.floor(j*widthInSamples/w), stop=Math.max(start+1,offset+Math.floor((j+1)*widthInSamples/w));
    let high=0;
    for(let k=start;k<stop;k++)if(Math.abs(series[k])>Math.abs(high))high=series[k];
    return [x+j,mid-high/amplitude*h*.44];
  });
  d.line(points,colors[name],1);
}
function lane(d,name,x,y,w,h,time){
  const factor=Math.max(0,Math.min(samples-1,Math.round(time*sampleRate)));
  const row=trace.tracks[name], base=y+h*.63, current=row.point[factor*3];
  const at=x+w*(.11+.77*current/.65), color=colors[name];
  d.rect(x,y,w,h,field);
  d.line([[x+w*.07,base],[x+w*.94,base]],dim,2);
  for(let j=0;j<8;j++)d.rect(x+w*(.1+j*.11),base+7,11,3,grid);
  const radius=9, momentum=projected[name][factor]/comparison[name].projectedPeakForce;
  const dy=row.active[factor]?0:10;
  d.rect(at-radius,base-dy-20,2*radius,19,row.active[factor]?color:grid);
  if(row.active[factor])d.rect(at-2,base-6-Math.min(1,Math.abs(momentum))*31,4,Math.min(1,Math.abs(momentum))*31+6,color);
}
function board(){
  const d=drawing(),width=1240,height=854;
  d.rect(0,0,width,height,bg);d.rect(39,33,28,4,colors.pluck);
  d.label('INK STUDIO / PHYSICAL SIMULATION',81,28,2,colors.pluck);
  d.label('Five ways to excite a surface',38,62,5,paper);
  d.label('CONTACT GEOMETRY AND FORCE / ONE ACOUSTIC RECEIVER',42,128,2,dim);
  const preview={impact:hit.timing.time+.0011,pluck:.128,bow:.31,scrape:.44,chatter:.42};
  for(const [i,name] of names.entries()){
    const y=166+i*123, color=colors[name], row=comparison[name],first=row.first;
    d.rect(42,y,1156,113,panel);
    d.label(name.toUpperCase(),58,y+18,3,color);
    d.label(subtitles[name],59,y+56,1,dim);
    d.label(fixed(first.timing.time*1000,1)+' MS ONSET',59,y+80,1,dim);
    lane(d,name,269,y+17,221,77,preview[name]);
    if(name==='bow'){
      plot(d,name,523,y+17,470,77,Math.round(.024*sampleRate),Math.round(.245*sampleRate));
      d.label('24 MS DETAIL',911,y+23,1,dim);
    }else plot(d,name,523,y+17,470,77);
    d.label('PEAK '+fixed(row.projectedPeakForce,1)+' N',1016,y+26,1,color);
    d.label('SLIP '+fixed(Math.hypot(...first.slip),2)+' M/S',1016,y+50,1,dim);
    const k=name==='chatter'?row.toothEvents+' TOOTH EVENTS':'P.X '+fixed(first.point[0],3)+' M';
    d.label(k,1016,y+74,1,dim);
  }
  d.label('FORCE PROJECTION SHOWN WITH AN INDEPENDENT SCALE PER ROW. CONTACT DATA IS SAMPLE ALIGNED.',42,803,1,dim);
  d.label('AUDITION ORDER   IMPACT / PLUCK / BOW / SCRAPE / CHATTER',42,827,1,colors.pluck);
  return render(d,width,height);
}
write('contact-exciter-board.png',PNG.encodeFrame(board()));
const playback=[];
for(const name of names)for(let i=0;i<13;i++){
  const d=drawing(),width=639,height=291,t=i/12*seconds;
  d.rect(0,0,width,height,bg);
  d.label(name.toUpperCase(),26,24,3,colors[name]);
  d.label(subtitles[name],27,66,1,dim);
  lane(d,name,26,94,586,97,t);
  plot(d,name,26,212,586,46);
  d.rect(26+586*t/seconds,213,2,43,paper);
  playback.push(render(d,width,height));
}
write('contact-exciters.apng',PNG.encodeAnimation(playback,10));
