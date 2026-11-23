const fs=require('node:fs'), path=require('node:path');
const kit=require('../..').load(), PNG=require('../../cli/png.js');
const {KIT:K}=kit, I=K.world.integrators, {drawing2d}=K.procedural;
const plan=require('./bounce.plan.json');
const load=require('./bounce.cjs');
const out=path.resolve(process.argv[2]??'studio/out/state-integrators');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');

const trace=require('../../cli/state-integrators.js').run(kit,plan,path.join(__dirname,'bounce.plan.json'));
const impacts=trace.results.flatMap(row=>row.events.map(event=>({...event,published:row.time})));
const {derivative}=load(kit);
const delayed=I.create({...plan.settings,derivative});
const endImpacts=[];
const coarse=[{time:0,state:plan.settings.initial}];
for(const time of plan.times){
  const sample=delayed.advance(time);
  const [x,y,vx,vy]=sample.state;
  if(y<=0&&vy<0){
    endImpacts.push({time,before:sample.state.slice()});
    sample.state=[x,0,vx,-.73*vy];
    delayed.restore({...delayed.snapshot(),state:sample.state});
  }
  coarse.push(sample);
}
const precise=[coarse[0],...impacts.map(row=>({time:row.time,state:row.after}))];
const groundTruth=Math.sqrt(2*plan.settings.initial[1]/9.81);
if(Math.abs(impacts[0].time-groundTruth)>plan.settings.eventTolerance)throw Error('First impact differs from the analytic solution');
json('bounce.trace.json',trace);
json('bounce.comparison.json',{exactFirstImpact:groundTruth,impacts,endImpacts});

function sample(rows,time){
  const before=rows.findLast(row=>row.time<=time);
  const [x,y,vx,vy]=before.state, dt=time-before.time;
  return [x+vx*dt,y+vy*dt-.5*9.81*dt*dt];
}
const angularFrequency=4.6, stiffness=angularFrequency**2;
const oscillators=I.methods.map(method=>{
  const solver=I.create({method,step:.16,initial:[1,0],
    derivative(_time,[q,v],out){out[0]=v;out[1]=-stiffness*q;},
    acceleration(_time,[q],_v,out){out[0]=-stiffness*q;},
    ...(method==='adaptive'&&{step:.26,maxStep:.35,relativeTolerance:1e-5,absoluteTolerance:1e-7})});
  let evaluations=0,rejections=0;
  const energy=[1];
  for(let i=1;i<=100;i++){
    const {state:[q,v],stats}=solver.advance(i*.16);
    energy.push(q*q+v*v/stiffness);
    evaluations+=stats.evaluations;
    rejections+=stats.rejectedSteps;
  }
  return {method,energy,evaluations,rejections};
});
json('oscillator.comparison.json',{duration:16,angularFrequency,oscillators});

const bg='#131f2c', panel='#1f3140', field='#172733', line='#3b5463', paper='#eff0d9',
  dim='#9db5bd', mint='#86e0b4', amber='#ffbe81', blue='#91c2ef', lilac='#c6b2f1';
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    path:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})};
}
const frame=(d,width,height)=>PNG.packRGBA(drawing2d.render({width,height,commands:d.commands,edges:'hard'}));
const labels={rk4:['FIXED RK4',blue],'semi-implicit':['SEMI-IMPLICIT EULER',amber],adaptive:['ADAPTIVE RK4',mint]};

function bouncePlot(d){
  const x=66,y=252,w=1128,h=225,floor=y+h*.64;
  const to=([t,v])=>[x+(w-44)*t/2.4+22,floor-v*78];
  d.rect(x,y,w,h,field);
  for(const t of [0,...plan.times]){
    const [at]=to([t,0]);
    d.path([[at,y+8],[at,y+h-26]],line,1);
    if(Math.round(t/.24)%2===0)d.text(t.toFixed(2),at-10,y+h-15,1,dim);
  }
  d.path([[x+8,floor],[x+w-8,floor]],paper);
  const subdivide=[...new Set([0,...Array.from({length:241},(_,i)=>i*.01),...impacts.map(row=>row.time),...plan.times])]
    .sort((a,b)=>a-b);
  for(const [rows,tint,width] of [[coarse,amber,2],[precise,mint,3]]){
    const points=[];
    for(const t of subdivide){
      if(rows===coarse&&endImpacts.some(row=>row.time===t))points.push(to([t,sample(coarse,t-1e-8)[1]]));
      points.push(to([t,sample(rows,t)[1]]));
    }
    d.path(points,tint,width);
  }
  for(const rows of [endImpacts,impacts])for(const {time} of rows){
    const [x,y]=to([time,0]);
    d.rect(x-3,y-3,6,6,rows===impacts?mint:amber);
  }
  const [mark]=to([impacts[0].time,0]);
  d.text(impacts[0].time.toFixed(3)+' S',mark-55,floor+18,1,mint);
  const [late]=to([endImpacts[0].time,0]);
  d.text(endImpacts[0].time.toFixed(3)+' S',late-5,floor+66,1,amber);
}
function energyPlot(d){
  const x=69,y=635,w=750,h=208;
  const to=([t,e])=>[x+36+t/16*(w-55),y+14+(1.62-e)*165];
  d.rect(x,y,w,h,field);
  for(const e of [.6,.8,1,1.2,1.4,1.6]){
    const [,at]=to([0,e]);
    d.path([[x+29,at],[x+w-12,at]],e===1?dim:line,1);
    d.text((e*100).toFixed(0),x+5,at-3,1,dim);
  }
  for(const {method,energy} of oscillators){
    d.path(energy.map((e,i)=>to([i*.16,e])),labels[method][1],method==='adaptive'?2:1);
  }
  for(const t of [0,4,8,12,16]){
    const [at]=to([t,0]);
    d.text(t+' S',at-3,y+h-15,1,dim);
  }
}
function board(){
  const d=drawing(), width=1260,height=908;
  d.rect(0,0,width,height,bg);
  d.rect(43,37,28,4,mint);
  d.text('INK STUDIO / PHYSICAL SIMULATION',84,31,2,mint);
  d.text('Find the impact inside the step',41,63,5);
  d.text('THREE STATE SOLVERS / TIMED ZERO CROSSINGS',45,127,2,dim);
  d.rect(43,169,1174,368,panel);
  d.text('BOUNCE TEST',65,190,3,paper);
  d.text('HOST READS EVERY 0.240 S',66,226,1,dim);
  d.text('LOCATED IMPACT',728,205,1,mint);
  d.text('END-OF-STEP CHECK',958,205,1,amber);
  bouncePlot(d);
  d.text('FIRST REACTION IS '+((endImpacts[0].time-impacts[0].time)*1000).toFixed(0)+' MS EARLIER WITH EVENT DETECTION',66,501,2,mint);
  d.rect(43,557,1174,309,panel);
  d.text('UNDAMPED OSCILLATOR',65,576,3,paper);
  d.text('ENERGY AS A PERCENTAGE OF INITIAL ENERGY',70,612,1,dim);
  energyPlot(d);
  for(const [i,{method,energy,evaluations,rejections}] of oscillators.entries()){
    const y=631+i*73, [label,tint]=labels[method];
    d.text(label,851,y,2,tint);
    const final=(100*energy.at(-1)).toFixed(method==='adaptive'?2:1);
    d.text('FINAL '+final+'% / '+evaluations+' EVALUATIONS',852,y+24,1,paper);
    if(rejections)d.text(rejections+' REJECTED PROPOSALS',852,y+39,1,dim);
  }
  d.text('FIXED METHODS USE 0.160 S STEPS. THE ADAPTIVE SOLVER USES LOCAL ERROR CONTROL.',45,882,1,dim);
  return frame(d,width,height);
}
write('integration-comparison.png',PNG.encodeFrame(board()));

const movie=Array.from({length:41},(_,index)=>{
  const d=drawing(), time=index*.06, width=540,height=290;
  d.rect(0,0,width,height,bg);
  d.text('TWO WAYS TO CATCH A BOUNCE',24,21,2,paper);
  for(const [i,[rows,label,tint]] of [[precise,'BETWEEN HOST STEPS',mint],[coarse,'AT HOST STEP END',amber]].entries()){
    const x=20+i*253, start=82, floor=179;
    d.rect(x,start,246,155,field);
    d.text(label,x+7,61,1,tint);
    d.path([[x+5,floor],[x+241,floor]],dim,1);
    const pos=([a,b])=>[x+7+a*63,floor-b*54];
    const [px,py]=pos(sample(rows,time));
    d.path(Array.from({length:Math.max(2,index+1)},(_,k)=>pos(sample(rows,time*k/Math.max(1,index)))),line,1);
    d.rect(px-4,py-4,8,8,tint);
  }
  const label=impacts.filter(row=>row.time<=time).length+' LOCATED IMPACTS';
  d.text(time.toFixed(2)+' S',24,257,2,dim);
  d.text(label,275,258,1,mint);
  return frame(d,width,height);
});
write('bounce-comparison.apng',PNG.encodeAnimation(movie,12));
