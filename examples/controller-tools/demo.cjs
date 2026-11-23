const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ink=require('../..'),kit=ink.load(),{KIT:K}=kit,W=K.world,C=W.controllers,F=W.inverseTargets;
const PNG=require('../../cli/png.js'),WAV=require('../../cli/wav.js'), tools=require('../../cli/controller-tools.js');
const {arm,string}=require('./evaluators.cjs');
const out=path.resolve(process.argv[2]??'studio/out/controller-tools');
fs.mkdirSync(out,{recursive:true});
const write=(name,data)=>fs.writeFileSync(path.join(out,name),data);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const dt=1/60,horizon=4.5, steps=Math.round(horizon/dt);
const flowQty={unit:'m^3/s',kind:'volume-flow'}, valveQty={unit:'1',kind:'opening-fraction'};
const valveInitial=.3;
const pump={kind:'pipe-network',config:{nodes:{
  supply:{capacity:10,initial:6,area:4,precharge:2.4},return:{capacity:10,initial:1,area:4}
},pipes:{gate:{from:'supply',to:'return',conductance:.36,maxFlow:1.4,opening:valveInitial}}},
portQuantities:{inputs:{'valve.gate':valveQty},outputs:{'flow.gate':flowQty}}};
const servo={format:C.format,version:1,id:'flow-servo',revision:1,mode:'pid',initial:valveInitial,
  quantities:{target:flowQty,output:valveQty},limits:{min:0,max:1,rise:1.8,fall:2.4},
  settings:{kp:.5,ki:3.5,kd:.009,derivativeTime:.04,integralMin:0,integralMax:1}};
json('servo.controller.json',servo);
const command=(port,tick,value)=>({tick,action:'world/input',args:{port,value}});
const disturbance=command('pipe/boost.gate',85,-1.15);
const world={format:W.format,version:1,id:'flow-feedback',dt,
  systems:{drive:{kind:'feedback-controller',operatorRevision:1,config:{controller:servo}},pipe:pump},
  connections:[{from:'pipe/flow.gate',to:'drive/measurement'},{from:'drive/value',to:'pipe/valve.gate'}],
  commands:[command('drive/target',1,.4),disturbance,command('drive/target',137,1.3),command('drive/target',166,.31)]};
const baseline={...world,id:'fixed-valve',systems:{pipe:pump},connections:[],commands:[disturbance]};
const calibration={...baseline,id:'calibration-flow',commands:[]};
json('feedback.world.json',world);
json('fixed-valve.world.json',baseline);
json('calibration.world.json',calibration);
const withServo=W.runtime.create(world), fixed=W.runtime.create(baseline);
const rows=Array.from({length:steps+1},(_,i)=>{
  if(i){withServo.step();fixed.step();}
  const signals=withServo.view().signals, detail=withServo.query().probe('drive/detail').value.axes[0];
  return {tick:i,time:i/60,target:detail.target,measurement:detail.measurement,feedback:signals['pipe/flow.gate'],
    fixed:fixed.view().signals['pipe/flow.gate'],valve:detail.value,limited:detail.rateLimited||detail.rangeLimited,
    integral:detail.integral,antiWindup:detail.integralLimited};
});
const at=t=>rows[Math.floor(t/dt+1e-9)];
assert.ok(at(2.2).feedback>at(2.2).fixed+.10);
assert.equal(at(2.7).valve,1);
assert.equal(at(2.7).antiWindup,true);
assert.ok(Math.abs(rows.at(-1).feedback-.31)<.01);
json('feedback.trace.json',rows);
const controlReplay={format:C.runFormat,version:1,controller:'servo.controller.json',dt,
  samples:rows.slice(1).map(({target,measurement})=>({target,measurement}))};
const controllerFile=path.join(out,'servo.run.json');
json('servo.run.json',controlReplay);
const controllerTrace=tools.run(kit,controlReplay,controllerFile);
assert.deepEqual(controllerTrace.results.map(row=>row.value),rows.slice(1).map(row=>row.valve));
json('servo.trace.json',controllerTrace);

write('evaluators.cjs',fs.readFileSync(path.join(__dirname,'evaluators.cjs')));
const fitPlan=(id,parameters,targets,evaluator)=>({format:F.planFormat,version:1,id,parameters,targets,evaluator,
  settings:{maxEvaluations:128,history:true}});
function fit(label,plan){
  const file=path.join(out,label+'.fit.json');
  json(label+'.fit.json',plan);
  const report=tools.fit(kit,plan,file);
  json(label+'.fit.report.json',report);
  return report;
}
const flowRequest=fitPlan('flow-fit',{valve:{min:.06,max:.9,initial:.22,quantity:valveQty}},
  {flow:{value:.43,tolerance:.000005,quantity:flowQty}},
  {kind:'world',world:'calibration.world.json',inputs:{valve:'pipe/valve.gate'},outputs:{flow:{port:'pipe/flow.gate',tick:60}}});
const flowFit=fit('flow',flowRequest);
assert.equal(flowFit.converged,true);
json('fitted-flow.commands.json',flowFit.commands);
const replay=W.runtime.create(calibration);
replay.schedule(flowFit.commands);replay.advance(60);
assert.equal(replay.view().signals['pipe/flow.gate'],flowFit.targets.flow.measured);
const missed=fit('unmet',fitPlan('unmet-flow',flowRequest.parameters,
  {flow:{value:2,tolerance:.005,quantity:flowQty}},flowRequest.evaluator));
assert.equal(missed.converged,false);
assert.equal(missed.bounds.valve,'max');

const speed=420, initialLength=.92;
const pitchFit=fit('pitch',fitPlan('pitch-fit',{length:{min:.4,max:1.2,initial:initialLength,quantity:{unit:'m'}}},
  {pitch:{value:330,tolerance:.003,quantity:{unit:'Hz'}}},{kind:'module',file:'evaluators.cjs',config:{kind:'string',speed}}));
assert.equal(pitchFit.converged,true);
const initialString=string(W,initialLength,speed), tunedString=string(W,pitchFit.parameters.length,speed);
assert.equal(tunedString.modes[0].hz,pitchFit.targets.pitch.measured);
json('fitted-string.modes.json',tunedString);
const sampleRate=24000,count=Math.round(sampleRate*.9),stride=sampleRate*1.1;
const taps=[initialString,tunedString].map(asset=>{
  const session=W.resonantModes.prepare(asset,{sampleRate});
  return session.process(count,{impulses:[{excitation:'pluck',sample:750,value:1}]}).pickups.body;
});
const gain=.82/Math.max(...taps.map(tape=>tape.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0)));
const audition=new Float64Array(stride*2);
for(const [i,tape] of taps.entries())audition.set(tape.map((value,j)=>gain*value*Math.min(1,(tape.length-j)/900)),i*stride);
write('pitch-audition.wav',WAV.encode({sampleRate,channels:1,samples:audition}));

const start={shoulder:-.35,elbow:.55,load:1.8}, target=[1.12,.62,0];
const armFit=fit('posture-force',fitPlan('arm-fit',{
  shoulder:{min:-1.2,max:1.2,initial:start.shoulder,quantity:{unit:'rad'}},
  elbow:{min:.15,max:2.2,initial:start.elbow,quantity:{unit:'rad'}},
  load:{min:0,max:8,initial:start.load}
},{hand:{value:target,tolerance:.0004,quantity:{unit:'m'}},force:{value:3,tolerance:.0008,quantity:{unit:'N'}}},
{kind:'module',file:'evaluators.cjs',config:{kind:'arm'}}));
assert.equal(armFit.converged,true);

const relay=C.prepare({format:C.format,version:1,id:'flow-switch',revision:1,mode:'hysteresis',
  settings:{low:-.06,high:.06,off:0,on:1}}).open();
const relayTape=Array.from({length:145},(_,i)=>{
  const error=.12*Math.sin(2*Math.PI*i/100)+.029*Math.sin(i*1.76);
  const {active}=relay.step(1/60,{target:0,measurement:-error});
  return {error,active,binary:error>=0};
});
const changes=key=>relayTape.filter((row,i)=>i>0&&row[key]!==relayTape[i-1][key]).length;
assert.ok(changes('active')<changes('binary'));
json('comparison.json',{loop:{at22:at(2.2),unreachable:at(2.7),final:rows.at(-1)},
  inverse:{flow:flowFit.targets.flow,unmet:missed.targets.flow,pitch: pitchFit.targets.pitch,
    initialPitch:initialString.modes[0].hz,force:armFit.targets.force,posture:armFit.targets.hand},
  relay:{plainSwitches:changes('binary'),hysteresisSwitches:changes('active')}});

const bg='#14202b',panel='#203443',well='#152632',grid='#3d5667',paper='#eef0d9',dim='#b2c8ce',
  mint='#8de5bf',sky='#8dbef5',gold='#f9d393',pink='#ff9f88',lilac='#d2baf2';
function canvas(width,height){
  const commands=[];
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const line=(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width});
  const text=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
  const image=()=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
  rect(0,0,width,height,bg);
  return {rect,line,text,image};
}
function plots(d,x,y,w,h,until=horizon,marker=until){
  const map=(t,v)=>[x+t/horizon*w,y+h*(1-v/1.4)];
  d.rect(x,y,w,h,well);
  for(const v of [0,.35,.7,1.05,1.4])d.line([map(0,v),map(horizon,v)],grid);
  for(const t of [1,2,3,4])d.line([map(t,0),map(t,1.4)],grid);
  const rail=map(85/60,1.4)[0], mark=map(marker,1.4)[0];
  d.line([[rail,y],[rail,y+h]],pink);
  const shown=rows.filter(row=>row.time<=until);
  if(shown.length>1)for(const [key,color,width] of [['target',gold,1],['fixed',sky,1],['feedback',mint,2]])
    d.line(shown.map(row=>map(row.time,row[key])),color,width);
  d.line([[mark,y],[mark,y+h]],paper);
}
function armSketch(d,x,y,w,h){
  const point=([a,b])=>[x+30+a*(w-60)/1.65,y+h*.72-b*h*.66], origin=point([0,0]);
  const prior=arm(start), fitted=arm(armFit.parameters);
  d.rect(x,y,w,h,well);
  d.line([[x+8,origin[1]],[x+w-8,origin[1]]],grid);
  d.line([origin,point(prior.elbow),point(prior.hand)],sky,2);
  d.line([origin,point(fitted.elbow),point(fitted.hand)],mint,4);
  const [a,b]=point(target);
  d.line([[a-7,b],[a+7,b]],pink,1);d.line([[a,b-7],[a,b+7]],pink,1);
  for(const node of [[0,0],fitted.elbow,fitted.hand]){
    const [a,b]=point(node);
    d.rect(a-2,b-2,5,5,mint);
  }
}
function board(){
  const d=canvas(1210,865);
  d.rect(37,30,24,4,mint);d.text('INK STUDIO / SIMULATION CONTROLS',78,25,2,mint);
  d.text('Follow a target. Fit a target.',35,61,5);
  d.rect(36,144,618,401,panel);d.rect(674,144,500,401,panel);
  d.rect(36,565,618,246,panel);d.rect(674,565,500,246,panel);
  d.text('PIPE / CLOSED-LOOP FLOW',56,162,2);
  plots(d,58,216,575,194,horizon,2.2);
  d.text('TARGET',58,426,1,gold);d.text('FIXED VALVE',170,426,1,sky);d.text('PID',302,426,1,mint);
  d.text('PRESSURE LOAD',457,426,1,pink);
  d.text('2.20 S  PID '+at(2.2).feedback.toFixed(3)+' / FIXED '+at(2.2).fixed.toFixed(3),58,471,2);
  d.text('SATURATION AT 2.70 S / INTEGRAL HELD',58,513,1,dim);
  d.text('ARM / POSITION AND FORCE FIT',694,162,2);
  armSketch(d,696,215,456,195);
  d.text('INITIAL',699,430,1,sky);d.text('FITTED',819,430,1,mint);d.text('TARGET',981,430,1,pink);
  d.text('FORCE '+armFit.targets.force.measured.toFixed(3)+' N',696,474,2);
  d.text('HAND RESIDUAL UNDER 0.4 MM PER AXIS',696,511,1,dim);
  d.text('INVERSE FLOW / REPLAY INK COMMANDS',57,588,2);
  d.text('TARGET 0.430 / REPLAY '+flowFit.targets.flow.measured.toFixed(6),57,643,2,mint);
  d.text('UNMET TARGET 2.0 / MAX VALVE '+missed.parameters.valve.toFixed(2),57,708,1,pink);
  d.text('HYSTERESIS  '+changes('binary')+' THRESHOLD EDGES / '+changes('active')+' RELAY EDGES',57,769,1,dim);
  d.text('STRING / FIT THE FUNDAMENTAL',696,588,2);
  d.text(initialString.modes[0].hz.toFixed(1)+' HZ',696,648,3,sky);
  d.text(tunedString.modes[0].hz.toFixed(1)+' HZ',937,648,3,mint);
  d.text('INITIAL',697,686,1,sky);d.text('FITTED',938,686,1,mint);
  d.text('LENGTH '+initialLength.toFixed(3)+' M TO '+pitchFit.parameters.length.toFixed(3)+' M',697,753,1,dim);
  return d.image();
}
write('controller-comparison.png',PNG.encodeFrame(board()));
const frames=Array.from({length:Math.round(horizon*24)+1},(_,i)=>{
  const time=i/24, row=at(time), d=canvas(800,420);
  d.text('PIPE / FEEDBACK UNDER LOAD',24,23,2);
  d.text(time.toFixed(2)+' S',24,59,1,dim);
  d.rect(24,86,523,303,panel);d.rect(566,86,210,303,panel);
  plots(d,42,110,486,197,time,time);
  d.text('TARGET',42,332,1,gold);d.text('FIXED VALVE',159,332,1,sky);d.text('PID',322,332,1,mint);
  d.text('LOAD AT 1.42 S',42,360,1,pink);
  d.text('FLOW '+row.feedback.toFixed(3),580,117,2,mint);
  d.text('VALVE '+Math.round(row.valve*100)+'%',580,172,2);
  d.rect(581,207,177,17,well);d.rect(581,207,177*row.valve,17,row.limited?pink:mint);
  d.text('INTEGRAL '+row.integral.toFixed(3),580,272,1,lilac);
  d.text(row.antiWindup?'ANTI-WINDUP ACTIVE':'TRACKING',580,309,1,row.antiWindup?pink:dim);
  return d.image();
});
write('flow-feedback.apng',PNG.encodeAnimation(frames,24));
