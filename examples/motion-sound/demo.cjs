const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const kit=require('../..').load(),K=kit.KIT,W=K.world, A=W.motionSound,S=W.soundMeasurements;
const PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js');
const runner=require('../../cli/motion-sound.js'), contacts=require('../../cli/contact-exciter.js');
const sensors=require('../../cli/virtual-sensors.js');
const out=path.resolve(process.argv[2]??'studio/out/motion-sound');
const file=name=>path.join(out,name);
fs.mkdirSync(file('frames'),{recursive:true});
const write=(name,data)=>fs.writeFileSync(file(name),data);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const rate=48000,fps=20,duration=2.4,frames=duration*fps,pcmFrames=duration*rate;
fs.copyFileSync(path.join(__dirname,'../part-motion.js'),file('picture.js'));
const scene=require(file('picture.js'))(kit), world=scene.build(scene.seed);
world.clock=0;
if(world.anim?.stateful)world.anim.update(0,0);
const picture={clock:{fps,sampleRate:rate,cuts:[{frame:fps,id:'opposite-bank'}]},
  frames,options:{width:168,height:112},measures:{
    wheel:{channel:'partMotion',part:'servo-wheel',reduce:'rms',perSecond:true},
    distance:{channel:'depth',part:'tide-needle'},
    mask:{channel:'coverage',part:'tide-needle',reduce:'fraction',above:.5,region:[77,32,51,50]}
  }};
const measured=runner.captureRender(kit,world,picture,({value},take)=>{
  const frame=PNG.packRGBA(value);
  write('frames/'+String(take.frame).padStart(3,'0')+'.png',PNG.encodeFrame(frame));
});
const rope={kind:'rope',points:[[0,1,0],[.5,1,0],[1,1,0]],stretch:.017,bend:.035,tear:5,radius:.028,
  attachments:{left:{node:0,point:[0,1,0]},right:{node:2,point:[1,1,0]}}};
const cable={format:W.format,version:1,id:'dial-cable',dt:1/60,systems:{
  cable:{kind:'deformables',config:{ground:-2,gravity:[0,0,0],damping:3.3,substeps:8,shapes:{rope}}}
},commands:[.23,.58,1.34,1.72,2.07].map((at,i)=>({tick:Math.round(at*60),action:'cable/load',
  args:{shape:'rope',node:1,impulse:[0,-[.95,.68,1.3,.63,1.0][i],0]}}))};
json('cable.world.json',cable);
const node=node=>({field:'cable/motion',args:{shape:'rope'},path:'/positions',node});
const rig={format:W.virtualSensors.format,version:1,id:'tension-gauge',revision:1,sensors:{
  tension:{kind:'strain-gauge',quantity:{unit:'%'},source:{kind:'geometry',from:node(0),to:node(1)}}
}};
const gauge={format:W.virtualSensors.runFormat,version:1,rig,source:{kind:'world',world:'cable.world.json',steps:144}};
json('cable.sensors.json',gauge);
measured.strain=S.sensor(sensors.run(kit,gauge,file('cable.sensors.json')),'tension');
const exciter={format:W.contactExciters.runFormat,version:1,samples:24000*duration,excitation:{
  format:W.contactExciters.format,version:1,id:'dial-brake',sampleRate:24000,seed:774,tracks:{
    shoe:{kind:'scrape',start:.12,end:2.27,slip:[0,0,0],load:.95,grain:.002,roughness:.8,
      keys:[[.27,.27],[.46,.96],[.66,.02],[.81,.61],[.94,.12],[1.15,0],[1.4,.78],
        [1.61,.08],[1.89,.81],[2.1,.24],[2.24,.03]].map(([time,speed])=>({time,slip:[speed,0,0]}))}
  }
}};
json('brake.contact.json',exciter);
const slip={track:'shoe',windowSamples:480,reduce:'rms'};
measured.slip=S.contacts(contacts.run(kit,exciter,file('brake.contact.json')),slip);
const lane=(source,input,output,unit,extra={})=>({source,input,output,unit,...extra});
const plan={format:A.format,version:1,id:'tide-dial-foley',sampleRate:rate,lanes:{
  servo:lane('wheel',[13,72],[0,.88],'linear gain',{attack:.017,release:.085,shape:'smoothstep'}),
  scrape:lane('slip',[.035,.81],[0,.84],'linear gain',{attack:.022,release:.055,shape:'power',exponent:.8}),
  tension:lane('strain',[0,18],[0,.83],'linear gain',{attack:.009,release:.046,shape:'power',exponent:.72}),
  proof:lane('mask',[.052,.121],[0,.38],'linear gain',{attack:.028,release:.075}),
  muffling:lane('distance',[5.598,5.654],[2700,650],'Hz',{attack:.055,release:.10})
}};
const run={format:runner.runFormat,version:1,plan,sources:{
  picture:{kind:'render',scene:'picture.js',...picture},brake:{kind:'contacts',file:'brake.contact.json',measures:{slip}},
  cable:{kind:'sensors',file:'cable.sensors.json',measures:{strain:'tension'}}
}};
json('take.json',run);
const controls=A.compile(plan,measured), {lanes}=controls;
json('controls.json',controls);
json('cut-inspection.json',{
  before:A.sample(controls,{sample:rate-1}),cut:A.sample(controls,{sample:rate}),
  after:A.sample(controls,{at:1+1/fps})
});
assert.equal(A.sample(controls,{sample:rate}).values.servo,0);
assert.ok(controls.report.servo.observations.filter(row=>row.raw!==null).length>=frames-3);

let noiseState=701,low=0,ring=0;
const noise=()=>{
  noiseState=(Math.imul(1664525,noiseState)+1013904223)>>>0;
  return noiseState/2147483648-1;
};
const sin=(hz,t)=>Math.sin(2*Math.PI*hz*t);
const ats=Float64Array.from({length:pcmFrames},(_,i)=>i/rate);
const mono=sample=>({sampleRate:rate,channels:1,samples:ats.map(sample)});
const assets={
  motor:mono(t=>.17*(sin(91,t)+.31*sin(183,t)+.09*sin(691,t))*(.63+.37*sin(11,t)**2)),
  scrape:mono(t=>{
    const n=noise();
    low=.91*low+.09*n;
    return .24*(n-low)*(.44+.56*sin(43,t)**2)+.033*sin(760,t);
  }),
  cable:mono(t=>{
    ring=.73*ring+.27*noise();
    return .19*(sin(202,t)+.43*sin(437.3,t)+.20*sin(808.3,t)+.08*ring);
  }),
  proof:mono(t=>.075*(sin(658,t)+.12*sin(1320,t))*(.55+.45*sin(18,t)**2))
};
const strip=(source,fader,pan,inserts)=>({clips:[{id:'bed',source}],fader,pan,...(inserts&&{inserts})});
const mixer={id:'dial-foley',sampleRate:rate,end:{samples:pcmFrames},output:'master',tail:'cut',peakPolicy:'error',strips:{
  motor:strip('motor',lanes.servo,-.32,['distance']),
  scrape:strip('scrape',lanes.scrape,.32),
  cable:strip('cable',lanes.tension,-.08),
  proof:strip('proof',lanes.proof,.65),
  master:{fader:.91}
},processors:{distance:{type:'lowpass',hz:lanes.muffling}},
taps:Object.fromEntries(Object.keys(assets).map(strip=>[strip,{strip,tap:'post'}]))};
const pcm=audio=>WAV.encode(audio,{encoding:'pcm24'});
for(const [name,audio] of Object.entries(assets))write('bed-'+name+'.wav',pcm(audio));
json('mixer.json',{mixer,assets:Object.fromEntries(Object.keys(assets).map(name=>[name,'bed-'+name+'.wav']))});
const sound=K.procedural.mediaGraph.mixer.render(mixer,assets);
write('authored-foley.wav',pcm(sound.value));
for(const [name,audio] of Object.entries(sound.taps))write('stem-'+name+'.wav',pcm(audio));
const constant=Object.fromEntries(['motor','scrape','cable','proof'].map(name=>{
  const row=mixer.strips[name], compiled=row.fader.points;
  const value=compiled.reduce((sum,point)=>sum+point.value,0)/compiled.length;
  return [name,{...row,fader:value}];
}));
const reference=K.procedural.mediaGraph.mixer.render({...mixer,strips:{...mixer.strips,...constant},
  processors:{distance:{type:'lowpass',hz:1710}}},assets).value;
write('fixed-controls.wav',pcm(reference));
const gap=rate*.3, comparison=new Float64Array((pcmFrames*2+gap)*2);
comparison.set(reference.samples);
comparison.set(sound.value.samples,(pcmFrames+gap)*2);
write('fixed-then-authored.wav',pcm({sampleRate:rate,channels:2,samples:comparison}));
assert.notDeepEqual(sound.value.samples,reference.samples);

const bg='#101f2b',panel='#1b3340',grid='#385562',paper='#ebf4eb',dim='#acc4ce';
const lanesView=[['servo','WHEEL MOTION','#91e0c0'],['scrape','BRAKE SLIP','#eeb877'],['tension','CABLE STRAIN','#f5a191'],
  ['proof','VISIBLE NEEDLE','#d2b7fa'],['muffling','CAMERA DEPTH','#93c1f1']];
const commands=[];
const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
const line=(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width});
rect(0,0,936,604,bg);
rect(27,28,24,4,lanesView[0][2]);
text('INK STUDIO / MOTION-DRIVEN FOLEY',61,22,2,lanesView[0][2]);
text('Sound of the tide dial',24,53,4);
text('MEASURED DATA / EDITABLE MIXER AUTOMATION',28,98,2,dim);
rect(26,129,884,422,panel);
const x=226,w=652,left=time=>x+w*time/duration;
const cut=left(1);
for(const [i,[name,label,color]] of lanesView.entries()){
  const y=161+72*i, range=name==='muffling'?[650,2700]:[0,1];
  text(label,47,y+6,2,color);
  text(name==='muffling'?'FILTER CUTOFF / HZ':'LINEAR GAIN',48,y+29,1,dim);
  rect(x,y,w,53,bg);
  for(const at of [0,.5,1,1.5,2,2.4])line([[left(at),y],[left(at),y+53]],grid);
  line([[x,y+26],[x+w,y+26]],grid);
  line([[cut,y],[cut,y+53]],'#aa6d72');
  const shape=lanes[name].points.map(({at,value})=>[left(at/rate),y+49-44*(value-range[0])/(range[1]-range[0])]);
  line(shape,color,2);
}
text('0 S',x,523,1,dim);text('CUT / 1.00 S',cut-25,523,1,'#ffcbb6');text('2.40 S',x+w-34,523,1,dim);
text('48 KHZ AUDIO / NATIVE ART PASSES / SIMULATED CONTACT AND STRAIN',28,575,1,dim);
const overview=K.procedural.drawing2d.render({width:936,height:604,commands,edges:'hard'});
write('sound-control-review.png',PNG.encodeFrame(PNG.packRGBA(overview)));
console.log('Wrote motion-driven mix and editable control assets to '+out);
