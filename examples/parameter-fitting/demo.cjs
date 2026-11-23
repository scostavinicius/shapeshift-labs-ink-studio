const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const ink=require('../..'),kit=ink.load(),K=kit.KIT,W=K.world;
const fitCLI=require('../../cli/parameter-fit.js'),lumped=require('../../cli/lumped-network.js'),
  modal=require('../../cli/modal-resonator.js'),PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js'),
  files=require('../../cli/asset-files.js');
const out=path.resolve(process.argv[2]??'studio/out/parameter-fitting'),file=name=>path.join(out,name);
const write=(name,value)=>files.write(file(name),value), json=(name,value)=>files.json(file(name),value);
const save=(name,value)=>(json('bench/'+name,value),name);
const rate=16000,n=19200,peak=values=>values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
const normalize=values=>Float64Array.from(values,v=>.76*v/peak(values));
function audio(name,samples){
  write('bench/'+name,WAV.encode({sampleRate:rate,channels:1,samples},{encoding:'pcm24'}));
  return name;
}
const def=(min,max,initial)=>({min,max,initial});
const fitPlan=(id,parameters,objectives)=>({format:W.parameterFit.planFormat,version:1,id,parameters,objectives,
  settings:{maxEvaluations:96,parameterTolerance:2e-7}});
const binding=(path)=>[{source:'trial',path}];
function fit(name,template,reference,plan,bindings,gate=true){
  const request=save(name+'.fit.json',{format:fitCLI.runFormat,version:1,
    candidate:{trial:template},reference,plan,bindings});
  const destination=file(name+'-report.json');
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
    'sim','fit-parameters',file('bench/'+request),'--out',destination,'--require-tolerance'],{encoding:'utf8'});
  assert.equal(result.status,gate?0:2,result.stderr||('Inspect '+destination));
  const report=JSON.parse(fs.readFileSync(destination,'utf8'));
  assert.equal(report.metTolerance,gate);
  const original=JSON.parse(fs.readFileSync(file('bench/'+template)));
  const candidate=W.apply(original,report.edits.trial,{validate:null}).world;
  const replay=save(name+'.fitted.json',candidate);
  return {report,replay};
}
const referenceDir=path.join(__dirname,'../reference-experiments/recipes');
const oscillator=JSON.parse(fs.readFileSync(path.join(referenceDir,'damped-oscillator.run.json')));
oscillator.network=JSON.parse(fs.readFileSync(path.join(referenceDir,'damped-oscillator.network.json')));
delete oscillator.diagnostics;
const trueK=24,trueC=1.2,mass=1.2,start=.6, rateOfDecay=trueC/(2*mass), omega=Math.sqrt(trueK/mass-rateOfDecay**2);
const recorded=oscillator.samples.map(time=>{
  const sine=Math.sin(omega*time),scale=start*Math.exp(-rateOfDecay*time);
  return {time,position:scale*(Math.cos(omega*time)+rateOfDecay/omega*sine),
    velocity:-scale*(trueK/mass)/omega*sine};
});
oscillator.network.elements.spring.stiffness=16;
oscillator.network.elements.damper.damping=3.3;
const oscillatorTemplate=save('spring-and-damper.run.json',oscillator);
const times=oscillator.samples.filter((_,i)=>i%2===0);
const curve=(output,label,unit,tolerance,weight)=>({kind:'series',times,tolerance,weight,
  candidate:{source:'trial',rows:'/results',valuePath:'/outputs/'+output,unit},
  reference:{source:'recorded',rows:'/rows',valuePath:'/'+label,unit}});
const calibrated=fit('oscillator',oscillatorTemplate,{recorded:{file:save('oscillator-reference.json',{rows:recorded})}},
  fitPlan('spring-and-damper',{stiffness:def(12,36,16),damping:def(.3,4.5,3.3)},{
    position:curve('displacement','position','m',.00015,2),
    velocity:curve('speed','velocity','m/s',.0005,1)
  }),{stiffness:binding('/network/elements/spring/stiffness'),damping:binding('/network/elements/damper/damping')});
const oscBefore=lumped.run(kit,oscillator,file('bench/'+oscillatorTemplate)).results;
const oscAfter=lumped.run(kit,JSON.parse(fs.readFileSync(file('bench/'+calibrated.replay))),file('bench/'+calibrated.replay)).results;

const waveform=(hz,decay)=>Float64Array.from({length:n},(_,i)=>.74*Math.sin(2*Math.PI*hz*i/rate)*Math.exp(-decay*i/rate));
const referenceTone=waveform(436.7,9.5), secondTone=waveform(462.1,9.5);
const recording=audio('ring-reference.wav',referenceTone), altRecording=audio('ring-alternative.wav',secondTone);
const baked=modal.bake(kit,{format:W.resonantModes.planFormat,version:1,id:'single-mode',revision:1,
  source:{kind:'authored',modes:[{id:'ring',hz:382,decay:3.2}]},
  excitations:{tap:{point:[0,0,0],gains:[1]}},pickups:{pickup:{point:[.2,0,0],gains:[1]}}},file('bench/ring.run.json'));
const ring={format:W.resonantModes.runFormat,version:1,asset:baked,samples:n,settings:{sampleRate:rate},
  impulses:[{excitation:'tap',sample:0,value:.65}]};
const ringTemplate=save('ring.run.json',ring);
const metric=(name,kind,opts,tolerance,weight)=>({kind:'measurement',tolerance,weight,
  candidate:{source:'trial',kind,...opts},reference:{source:name,kind,...opts}});
const pitch=(name,weight)=>metric(name,'frequency',{band:[340,520],window:{from:0,to:16000}},.04,weight);
const captured={reference:{file:recording},alternative:{file:altRecording}};
const pitchBinding=binding('/asset/modes/0/hz'), decayBinding=binding('/asset/modes/0/decay');
const tuned=fit('resonator',ringTemplate,captured,fitPlan('pickup-match',{
  frequency:def(350,510,382),decay:def(1.5,15,3.2)
},{frequency:pitch('reference',3),decay:metric('reference','decay',{blockSamples:800,minFit:.97},.05,1)}),
{frequency:pitchBinding,decay:decayBinding});
const favor=(left,right)=>fit(left>right?'favor-low':'favor-high',tuned.replay,captured,
  fitPlan('priority-'+(left>right?'low':'high'),{frequency:def(415,480,450)},
    {low:pitch('reference',left),high:pitch('alternative',right)}),
  {frequency:pitchBinding},false);
const favorsLow=favor(9,1), favorsHigh=favor(1,9);
function sound(plan){return normalize(modal.run(kit,plan,file('bench/'+ringTemplate)).pickups.pickup);}
const fittedSound=entry=>sound(JSON.parse(fs.readFileSync(file('bench/'+entry.replay))));
const before=sound(ring), after=fittedSound(tuned), leftSound=fittedSound(favorsLow),rightSound=fittedSound(favorsHigh);
audio('ring-before.wav',before);audio('ring-after.wav',after);

const WID=1120,HEI=674,drawing=K.procedural.drawing2d;
const back='#101f2d',panel='#1a3140',well='#142837',grid='#395669',quiet='#a9c5ca',paper='#edf5e9',
  mint='#8fe3c4',blue='#99c9ee',gold='#ffcb85',rose='#ffab96';
const f=(x,d=2)=>x.toFixed(d);
const x=62, width=640, top=210, h=130, low=432;
function canvas(){
  const commands=[];
  return {rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    finish:()=>PNG.packRGBA(drawing.render({width:WID,height:HEI,commands,edges:'hard'}))};
}
function base(title,note,color){
  const d=canvas();
  d.rect(0,0,WID,HEI,back);d.rect(34,32,26,4,color);
  d.text('INK STUDIO / REFERENCE PARAMETER FIT',73,26,2,color);
  d.text(title,31,63,5);d.text(note,34,121,2,quiet);
  d.rect(33,159,701,474,panel);d.rect(755,159,333,474,panel);
  return d;
}
function axes(d,y,label){
  d.text(label,x,y-27,2,quiet);d.rect(x,y,width,h,well);
  for(let i=0;i<=5;i++)d.line([[x+i*width/5,y],[x+i*width/5,y+h]],grid);
  for(let i=1;i<=3;i++)d.line([[x,y+i*h/4],[x+width,y+i*h/4]],grid);
}
function curveLine(d,values,y,color,lo,hi,count=values.length){
  const points=values.slice(0,Math.max(2,count)).map((v,i)=>[x+width*i/(values.length-1),y+h*(1-(v-lo)/(hi-lo))]);
  d.line(points,color,2);
}
function history(d,report,t){
  const values=report.candidates.map(row=>row.feasible?Math.log10(Math.max(1e-12,row.rms)):null);
  const available=values.filter(Number.isFinite);
  const floor=Math.min(-1,Math.floor(Math.min(...available))), high=Math.max(1,Math.ceil(Math.max(...available)));
  let best=Infinity;
  const retained=values.map(value=>best=value===null?best:Math.min(best,value));
  axes(d,low,'CANDIDATE WEIGHTED RMS / LOG10');
  curveLine(d,retained,low,mint,floor,high,Math.ceil(Math.max(.08,t)*retained.length));
  for(let i=0;i<Math.min(values.length,Math.ceil(t*values.length));i++){
    if(values[i]===null)continue;
    const at=x+width*i/(values.length-1), y=low+h*(1-(values[i]-floor)/(high-floor));
    d.rect(at-1,y-1,3,3,blue);
  }
  d.text('INITIAL',x,583,1,quiet);
  d.text(report.work.evaluations+' EVALUATIONS',x+width-94,583,1,quiet);
}
function metricCard(d,at,label,value,color){
  d.text(label,779,at,1,quiet);d.text(value,778,at+21,3,color);
}
const envelope=data=>Array.from({length:120},(_,bin)=>peak(data.slice(bin*n/120,(bin+1)*n/120)));
const ringEnv=[envelope(before),envelope(after),envelope(referenceTone)];
function oscillatorCard(t){
  const d=base('Spring and damper','FIT TO DISPLACEMENT AND VELOCITY CURVES',mint);
  axes(d,top,'OSCILLATOR POSITION / METRES');
  curveLine(d,oscBefore.map(row=>row.outputs.displacement),top,rose,-.43,.64);
  curveLine(d,recorded.map(row=>row.position),top,paper,-.43,.64);
  curveLine(d,oscAfter.map(row=>row.outputs.displacement),top,mint,-.43,.64);
  d.text('BEFORE',62,357,1,rose);d.text('FITTED + REFERENCE',135,357,1,mint);
  d.text('0 - 5 S',650,357,1,quiet);
  const {report}=calibrated;
  history(d,report,t);
  metricCard(d,191,'STIFFNESS / N/M','16.0 TO '+f(report.parameters.stiffness,1),mint);
  metricCard(d,293,'DAMPING / N S/M','3.30 TO '+f(report.parameters.damping),blue);
  metricCard(d,395,'INITIAL WEIGHTED RMS',f(report.candidates[0].rms,1),rose);
  metricCard(d,501,'FITTED WEIGHTED RMS',report.rms.toExponential(2).toUpperCase(),mint);
  return d.finish();
}
function resonatorCard(t){
  const d=base('Tune a resonator','FIT AN EDITABLE MODE TO A REFERENCE WAV',blue);
  axes(d,top,'AMPLITUDE ENVELOPE');
  curveLine(d,ringEnv[0],top,rose,0,.8);curveLine(d,ringEnv[2],top,paper,0,.8);
  curveLine(d,ringEnv[1],top,mint,0,.8);
  const index=t<1.4/4.2?0:t<2.8/4.2?1:2;
  const labels=['BEFORE','FITTED','REFERENCE'];
  for(const [i,label] of labels.entries())d.text(label,62+i*90,359,2,index===i?[rose,mint,paper][i]:quiet);
  const {report}=tuned;
  history(d,report,t);
  metricCard(d,191,'FREQUENCY / HZ','382.0 TO '+f(report.parameters.frequency,1),mint);
  metricCard(d,293,'DECAY / 1/S','3.20 TO '+f(report.parameters.decay),blue);
  metricCard(d,395,'INITIAL WEIGHTED RMS',f(report.candidates[0].rms,1),rose);
  metricCard(d,501,'FITTED WEIGHTED RMS',report.rms.toExponential(2).toUpperCase(),mint);
  return d.finish();
}
function weightsCard(t){
  const d=base('Choose a priority','TWO REFERENCE NOTES / ONE TUNABLE FREQUENCY',gold);
  const targets=[favorsLow.report.objectives.low.reference,favorsLow.report.objectives.high.reference];
  function mark(frequency,y,color,width=1){
    const at=x+(frequency-430)/40*640;
    d.line([[at,y],[at,y+h]],color,width);
    return at;
  }
  const entries=[[favorsLow,top,'LOW TARGET / 9 TO 1'],[favorsHigh,low,'HIGH TARGET / 1 TO 9']];
  for(const [entry,y,label] of entries){
    axes(d,y,label);
    for(const target of targets){
      const at=mark(target,y,blue);
      d.text(f(target,1)+' HZ',at-31,y+h+12,1,blue);
    }
    const at=mark(entry.report.parameters.frequency,y,gold,3);
    d.text('FIT '+f(entry.report.parameters.frequency,2)+' HZ',at-28,y+42,1,gold);
  }
  metricCard(d,191,'LOW TARGET WEIGHTED 9:1',f(favorsLow.report.parameters.frequency)+' HZ',gold);
  metricCard(d,293,'HIGH TARGET WEIGHTED 9:1',f(favorsHigh.report.parameters.frequency)+' HZ',gold);
  metricCard(d,397,'REFERENCE SEPARATION',f(targets[1]-targets[0],1)+' HZ',blue);
  d.text('BOTH FITS MISS STRICT TOLERANCE',778,523,1,rose);
  d.text(t<.5?'AUDITION / LOW PRIORITY FIT':'AUDITION / HIGH PRIORITY FIT',778,569,1,quiet);
  return d.finish();
}
const fps=10,hold=42,views=[oscillatorCard,resonatorCard,weightsCard];
const audioReel=new Float64Array(rate*views.length*hold/fps), keep=[];
function cue(card,t,signal){
  const base=rate*(card*hold/fps+t);
  for(let i=0;i<signal.length;i++)audioReel[Math.round(base)+i]=signal[i]*Math.min(1,i/96,(signal.length-i)/240);
}
cue(1,.04,before);cue(1,1.44,after);cue(1,2.84,referenceTone);
cue(2,.1,leftSound);cue(2,2.18,rightSound);
for(const [card,view] of views.entries())for(let i=0;i<hold;i++){
  const image=view(i/(hold-1));
  write('frames/frame-'+String(card*hold+i).padStart(3,'0')+'.png',PNG.encodeFrame(image));
  if(i===hold-1)write(['oscillator','resonator','weights'][card]+'.png',PNG.encodeFrame(image));
  if(i%3===0)keep.push(image);
}
write('fitting-auditions.wav',WAV.encode({sampleRate:rate,channels:1,samples:audioReel},{encoding:'pcm24'}));
write('fitting-gallery.png',PNG.encodeAnimation(keep,{numerator:fps,denominator:3}));
console.log('Wrote fitted templates, reports, and demos to '+out);
