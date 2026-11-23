const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),K=kit.KIT,W=K.world,M=W.traceMeasurements;
const modal=require('../../cli/modal-resonator.js'),WAV=require('../../cli/wav.js');
const PNG=require('../../cli/png.js'),files=require('../../cli/asset-files.js');
const out=path.resolve(process.argv[2]??'studio/out/signal-comparison'), file=name=>path.join(out,name);
const write=(name,data)=>files.write(file(name),data), json=(name,data)=>files.json(file(name),data);
const benchJSON=(name,data)=>(json('bench/'+name,data),name);
const benchWav=(name,samples)=>(write('bench/'+name,WAV.encode({sampleRate:24000,channels:1,samples},{encoding:'pcm24'})),name);
const rate=24000, tau=2*Math.PI;
const {captures,report:referenceReport}=ink.runReferenceExperiments({kit,id:'damped-oscillator'});
const oscillator=captures['damped-oscillator'].rows;
const oscTrace={sampleRate:Math.round(1/oscillator[1].time),channels:{position:{unit:'m',samples:oscillator.map(row=>row.position)}}};

const reference=path.join(__dirname,'../reference-experiments/recipes');
const bake=JSON.parse(fs.readFileSync(path.join(reference,'membrane.bake.json')));
bake.source.count=1;
benchJSON('membrane.bake.json',bake);
write('bench/membrane.obj',fs.readFileSync(path.join(reference,'membrane.obj')));
const asset=modal.bake(kit,bake,file('bench/membrane.bake.json'));
const resonator={format:W.resonantModes.runFormat,version:1,asset:benchJSON('membrane-modes.json',asset),
  samples:2*rate,settings:{sampleRate:rate},impulses:[{excitation:'strike',sample:0,value:.11}]};
const drum=modal.run(kit,resonator,file('bench/membrane.run.json')), hit=drum.pickups.center;
const sine=(hz,t)=>Math.sin(tau*hz*t);
const samples=make=>Float64Array.from({length:rate},(_,i)=>make(i/rate));
const missing=samples(t=>.65*sine(392.6,t)+.26*sine(588.9,t+.01));
const changed=samples(t=>{
  const mix=Math.max(0,Math.min(1,(.045-Math.abs(t-.5))/.006));
  return .66*(1-mix)*sine(196.3,t)+.25*mix*sine(244,t);
});
const sources={
  oscillator:{file:benchJSON('oscillator.json',oscTrace)},
  membrane:{file:benchJSON('membrane.run.json',resonator)},
  missing:{file:benchWav('missing-fundamental.wav',missing)},
  changed:{file:benchWav('changing-pitch.wav',changed)}
};
const measure=(source,metric,band,options)=>({kind:'signal-compare',source,metric,band,...options});
const measurements={
  'oscillator-peak':measure('oscillator','resonance',[.45,1.04]),
  'membrane-width':measure('membrane','bandwidth',[238,300],{channel:'center'}),
  'short-window':measure('membrane','bandwidth',[238,300],{channel:'center',window:{from:0,to:2400}}),
  'missing-fundamental':measure('missing','pitch',[165,255]),
  'changing-pitch':measure('changed','pitch',[165,255])
};
const gate=(measurement,max)=>({measurement,max,unit:'Hz'});
const agreed={
  'peak-agrees':gate('oscillator-peak',.01),'width-agrees':gate('membrane-width',.025),
  'pitch-agrees':gate('missing-fundamental',.05)
};
const stress={'width-still-resolves':gate('short-window',.025),'pitch-stays-stable':gate('changing-pitch',.05)};
function report(name,assertions,status){
  const request={format:'ink-studio/simulation-measurement-run',version:1,sources,
    plan:{format:W.simulationMeasurements.format,version:1,id:name,measurements,assertions}};
  const input=benchJSON(name+'.json',request), output=file(name+'-report.json');
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
    'sim','measure',file('bench/'+input),'--out',output],{encoding:'utf8'});
  assert.equal(result.status,status,result.stderr);
  return JSON.parse(fs.readFileSync(output,'utf8'));
}
const verified=report('comparison',agreed,0), attempted=report('stress',stress,2);
assert.equal(attempted.assertions['width-still-resolves'].status,'unavailable');
assert.equal(attempted.assertions['pitch-stays-stable'].status,'out-of-bounds');
const rows=verified.measurements;

const navy='#0f1d2a',panel='#172e3e',well='#102534',grid='#345063',rule='#2a4658',
  paper='#eff4e6',muted='#aec6cf',mint='#8be3c4',sky='#8dc8ef',gold='#f6ca89',rose='#ffa991';
const width=1144,height=690;
const f=(n,d=3)=>n.toFixed(d);
const size=values=>values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
const pcmAsset=key=>WAV.decode(fs.readFileSync(file('bench/'+sources[key].file))).samples;
const fromTrace=values=>W.outputAdapters.trace({sampleRate:rate,channels:{ch1:values}});
const traces={oscillator:W.outputAdapters.trace(oscTrace),membrane:W.outputAdapters.trace(drum),
  missing:fromTrace(pcmAsset('missing')),changed:fromTrace(pcmAsset('changed'))};
const cases=[
  {id:'oscillator-peak',title:'Damped oscillator',subtitle:'RESONANCE / FREE RESPONSE',color:mint,sweep:[.15,1.4],
    waveTitle:'DISPLACEMENT OVER TIME',spectrumTitle:'WINDOWED FFT / PEAK',
    bottom:'ANALYTIC FREQUENCY '+f(referenceReport.experiments[0].evidence.dampedFrequency,5)+' HZ'},
  {id:'membrane-width',title:'Membrane linewidth',subtitle:'BANDWIDTH / MESH-DERIVED MODE',color:sky,sweep:[245,295],
    waveTitle:'CENTRE PICKUP / RING-DOWN',spectrumTitle:'FFT / HALF-POWER CROSSINGS',bottom:'FULL 2.00 S WINDOW'},
  {id:'short-window',title:'Short capture',subtitle:'BANDWIDTH / SAME MEMBRANE',color:gold,sweep:[245,295],
    waveTitle:'CENTRE PICKUP / TRUNCATED',spectrumTitle:'FFT / WINDOW-BROADENED PEAK',bottom:'0.10 S WINDOW / 20 HZ MINIMUM WIDTH'},
  {id:'missing-fundamental',title:'Missing fundamental',subtitle:'PITCH / SECOND AND THIRD HARMONICS',color:mint,sweep:[145,655],
    waveTitle:'WAVEFORM / MIDDLE LAG SPAN',spectrumTitle:'FFT / HARMONIC SERIES',bottom:'STRONGEST PARTIAL IS 392.6 HZ'},
  {id:'changing-pitch',title:'Pitch changes',subtitle:'PITCH / A SHORT HIGH NOTE',color:rose,sweep:[145,405],
    waveTitle:'WAVEFORM / MIDDLE LAG SPAN',spectrumTitle:'FFT / WHOLE WINDOW',bottom:'MIDPOINT AND WHOLE-WINDOW ESTIMATES DIVERGE'}
];
const drawing=K.procedural.drawing2d;
function canvas(){
  const commands=[];
  return {
    rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    frame:()=>PNG.packRGBA(drawing.render({width,height,edges:'hard',commands}))
  };
}
const x=62,w=660, waveY=218,waveH=125,fftY=444,fftH=133;
function axes(d,y,h,lo,hi,unit,digits){
  d.rect(x,y,w,h,well);
  for(let i=0;i<=5;i++){
    const at=x+w*i/5;
    d.line([[at,y],[at,y+h]],grid);
    d.text(f(lo+(hi-lo)*i/5,digits),at-(i===5?25:i===0?0:10),y+h+12,1,muted);
  }
  for(let i=1;i<=3;i++)d.line([[x,y+h*i/4],[x+w,y+h*i/4]],rule);
  d.text(unit,x+w-12,y+h+31,1,muted);
}
function statistic(d,at,title,value,color=paper){
  d.text(title,800,at,1,muted);
  d.text(value,798,at+22,3,color);
}
function prepare(card){
  const row=rows[card.id],trace=traces[row.source],range=M.withChannel(trace,measurements[card.id]);
  const {signal}=M.centered(range), info=row.evidence.frequency.evidence;
  const bins=M.spectrum(signal,info.fftSize,info.window==='hann'),[low,high]=card.sweep;
  const peak=Math.max(...bins.slice(Math.ceil(low/info.binHz),Math.floor(high/info.binHz)+1));
  return {...card,row,signal,range,info,bins,peak};
}
function render(card,t){
  const {id,title,subtitle,color,sweep:[lo,hi],waveTitle,spectrumTitle,bottom,row,signal,range,info,bins,peak}=card;
  const {time,frequency}=row.evidence, count=signal.length, duration=count/range.sampleRate;
  const d=canvas();
  d.rect(0,0,width,height,navy);
  d.rect(34,31,23,4,color);
  d.text('INK STUDIO / INDEPENDENT SIGNAL ANALYSIS',73,26,2,color);
  d.text(title,32,62,5);
  d.text(subtitle,36,119,2,muted);
  d.rect(34,161,720,476,panel);d.rect(778,161,332,476,panel);
  d.text(waveTitle,62,186,2,muted);d.text(spectrumTitle,62,410,2,muted);
  const lag=time.evidence.method==='yin'&&time.status==='ok'?time.evidence:null;
  const zoom=id==='missing-fundamental', waveFrom=zoom?lag.windowOffset:0;
  const wave=zoom?signal.subarray(waveFrom,waveFrom+lag.analysisSamples):signal;
  axes(d,waveY,waveH,waveFrom/range.sampleRate,(waveFrom+wave.length)/range.sampleRate,'S',zoom?3:duration<.2?2:1);
  axes(d,fftY,fftH,lo,hi,'HZ',hi<2?2:0);
  if(lag&&!zoom){
    const left=x+w*lag.windowOffset/count, span=w*lag.analysisSamples/count;
    d.rect(left,waveY,span,waveH,'#294759');
    d.line([[left,waveY],[left,waveY+waveH]],sky);
    d.line([[left+span,waveY],[left+span,waveY+waveH]],sky);
  }
  const amplitude=size(wave), mid=waveY+waveH/2, scale=(waveH/2-5)/amplitude;
  const point=(i,n)=>[x+w*i/(wave.length-1),mid-n*scale];
  if(wave.length<=1000){
    d.line(Array.from(wave,(n,i)=>point(i,n)),sky,2);
  }else{
    for(let column=0;column<w;column+=2){
      const start=Math.floor(column*wave.length/w), end=Math.floor((column+2)*wave.length/w);
      let min=Infinity,max=-Infinity;
      for(let i=start;i<end;i++){min=Math.min(min,wave[i]);max=Math.max(max,wave[i]);}
      d.line([[x+column,mid-max*scale],[x+column,mid-min*scale]],sky);
    }
  }
  const marker=x+t*w;
  d.line([[marker,waveY],[marker,waveY+waveH]],paper);
  const toX=hz=>x+(hz-lo)*w/(hi-lo);
  const toY=normalized=>fftY+fftH-1-normalized*(fftH-9);
  const sampled=[], first=Math.ceil(lo/info.binHz), last=Math.floor(hi/info.binHz);
  const stride=Math.max(1,Math.ceil((last-first+1)/w));
  for(let i=first;i<=last;i+=stride){
    let highest=i;
    for(let bin=i+1;bin<i+stride&&bin<=last;bin++)if(bins[bin]>bins[highest])highest=bin;
    sampled.push([toX(highest*info.binHz),toY(bins[highest]/peak)]);
  }
  d.line(sampled,color,2);
  if(info.lowerHz!==undefined&&info.lowerHz!==null&&info.upperHz!==null){
    const y=toY(1/Math.SQRT2), a=toX(info.lowerHz), b=toX(info.upperHz);
    d.line([[x,y],[x+w,y]],rule);
    d.line([[a,fftY+fftH],[a,y],[b,y],[b,fftY+fftH]],gold,2);
    d.text('-3 DB',x+7,y-11,1,gold);
  }else if(row.evidence.metric==='pitch'&&frequency.status==='ok'){
    const at=toX(frequency.value), midX=toX(time.value), bottom=fftY+fftH-1;
    d.line([[at,fftY+14],[at,bottom]],mint,2);
    d.text('F0',at+6,fftY+17,1,mint);
    if(Math.abs(midX-at)>8){
      d.line([[midX,fftY+37],[midX,bottom]],rose,2);
      d.text('MIDPOINT',midX+6,fftY+40,1,rose);
    }
  }else{
    const at=toX(frequency.value);
    d.line([[at,fftY+12],[at,fftY+fftH]],mint);
    d.text('PEAK',at+6,fftY+18,1,mint);
  }
  d.text('METHOD COMPARISON',799,186,2,muted);
  const digits=row.evidence.metric==='resonance'?5:3;
  const unit=value=>f(value,digits)+' HZ';
  statistic(d,226,lag?'TIME / YIN LAG':'TIME / SAMPLE RECURRENCE',unit(time.value),sky);
  const spectral=row.evidence.metric==='pitch'?'FFT / HARMONIC FIT':row.evidence.metric==='bandwidth'?'FFT / HALF-POWER':'FFT / HANN PEAK';
  statistic(d,318,spectral,frequency.status==='ok'?unit(frequency.value):'UNRESOLVED',color);
  const difference=row.status==='ok'?f(row.value,row.value<.01?5:3)+' HZ':'UNAVAILABLE';
  statistic(d,405,'ABSOLUTE DIFFERENCE',difference,row.status==='ok'?color:gold);
  d.line([[800,490],[1087,490]],rule,2);
  d.text(id==='short-window'?'WINDOW TOO SHORT':id==='changing-pitch'?'OUTSIDE CI TOLERANCE':'WITHIN CI TOLERANCE',
    799,518,2,color);
  d.text(bottom,63,652,1,muted);
  return d.frame();
}
const view=cases.map(prepare), fps=10, hold=27, frameImages=[];
const mixed=new Float64Array(rate*hold*view.length/fps), audio=[null,hit,hit.slice(0,2400),pcmAsset('missing'),pcmAsset('changed')];
for(const [index,card] of view.entries()){
  const sound=audio[index];
  if(sound){
    const gain=.76/size(sound);
    const audition=Float64Array.from(sound,(v,i)=>v*gain*Math.min(1,i/72,(sound.length-i)/96));
    mixed.set(audition,Math.round(index*hold*rate/fps));
  }
  for(let i=0;i<hold;i++){
    const image=render(card,i/(hold-1));
    if(i===Math.floor(hold/2))write(card.id+'.png',PNG.encodeFrame(image));
    if(i%3===0)frameImages.push(image);
    write('frames/frame-'+String(index*hold+i).padStart(3,'0')+'.png',PNG.encodeFrame(image));
  }
}
write('comparison-gallery.png',PNG.encodeAnimation(frameImages,{numerator:fps,denominator:3}));
write('comparison-audio.wav',WAV.encode({sampleRate:rate,channels:1,samples:mixed},{encoding:'pcm24'}));
console.log('Wrote reproducible comparison benches, WAVs, stills and animation to '+out);
