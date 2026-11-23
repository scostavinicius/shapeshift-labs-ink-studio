const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const ink=require('../..'), {KIT:K}=ink.load(), W=K.world,G=W.gestureScores;
const PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const out=path.resolve(process.argv[2]??'studio/out/gesture-scores');
fs.mkdirSync(out,{recursive:true});
const write=(name,data)=>fs.writeFileSync(path.join(out,name),data);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
const rate=240,duration=3.6,videoRate=24;
const score={format:G.format,version:1,id:'valve-and-chime',revision:1,rate,channels:{
  opening:{type:'number',base:.08,quantity:{unit:'1',kind:'opening-fraction'},
    limits:{min:0,max:1,maxSpeed:1.85,maxAcceleration:15}},
  aim:{type:'vec3',base:[-.62,-.18,0],quantity:{unit:'m',frame:'nozzle-bench'},
    limits:{min:[-1,-1,-1],max:[1,1,1],maxSpeed:[1.8,1.5,1.5],maxAcceleration:[15,12,12]}},
  force:{type:'number',base:0,quantity:{unit:'N'},limits:{min:0,max:1}}
},gestures:[
  {id:'intake',channel:'opening',start:.54,end:1.62,leadIn:.42,release:.52,target:.98},
  {id:'feather',channel:'opening',start:1.08,end:1.92,leadIn:.32,release:.48,weight:.85,
    target:{keys:[{at:0,value:.47},{at:.5,value:.68},{at:1,value:.56}]}},
  {id:'inspection-close',start:1.42,end:1.66,leadIn:.15,release:.32,priority:10,targets:{opening:0,force:.12}},
  {id:'trim',channel:'opening',start:2.2,end:2.56,leadIn:.33,release:.34,blend:'add',target:.27},
  {id:'sweep',channel:'aim',start:.43,end:2.49,leadIn:.25,release:.49,
    target:{keys:[{at:0,value:[-.55,.55,.09]},{at:.43,value:[.78,.51,.2]},
      {at:.71,value:[.74,-.62,.15]},{at:1,value:[-.35,-.64,0]}]}},
  {id:'recenter',channel:'aim',start:1.31,end:1.6,leadIn:.2,release:.32,priority:2,target:[.05,.02,0]},
  {id:'chime-in',channel:'force',start:.49,end:.63,leadIn:.045,release:.13,target:.72},
  {id:'chime-mid',channel:'force',start:1.24,end:1.82,leadIn:.06,release:.15,target:.68},
  {id:'chime-out',channel:'force',start:2.14,end:2.4,leadIn:.06,release:.24,target:.56},
  {id:'chime-accent',channel:'force',start:2.36,end:2.46,leadIn:.031,release:.073,blend:'add',target:.26}
]};
const prepared=G.prepare(score), player=prepared.open();
const endTick=Math.round(duration*rate), samples=Array.from({length:endTick+1},(_,tick)=>{
  player.advance(tick);
  return player.view();
});
json('bench.score.json',score);
const all=prepared.trace({fromTick:0,toTick:endTick,every:10});
json('bench.trace.json',all);
const graph={format:'ink-studio/graph-project',version:1,
  assets:{bench:{file:'bench.score.json',format:'json'}},
  nodes:{asset:{op:'jsonAsset',inputs:{name:'bench'}},score:{op:'sim.gesture-score',inputs:{score:{node:'asset'}}}},
  outputs:{frame:{node:'score',port:'value'},controls:{node:'score',port:'outputs'}}};
json('bench.graph.json',graph);
const graphRunner=ink.readGraphProject(path.join(out,'bench.graph.json'));
assert.deepEqual(graphRunner.run({time:1.5}).outputs.frame,samples[360]);

const world={format:W.format,version:1,id:'gesture-valve-bench',dt:1/60,systems:{
  motion:{kind:'gesture-score',operatorRevision:1,config:{score}},
  pipe:{kind:'pipe-network',config:{nodes:{
    supply:{capacity:1,initial:.89,area:1,precharge:2.75},
    receiver:{capacity:1,initial:.1,area:1}
  },pipes:{gate:{from:'supply',to:'receiver',conductance:.19,maxFlow:.72,opening:.08}}},
  portQuantities:{inputs:{'valve.gate':{unit:'1',kind:'opening-fraction'}}}}
},connections:[{from:'motion/opening',to:'pipe/valve.gate'}]};
const run=W.runtime.create(world);
const flow=Array.from({length:Math.round(duration/world.dt)+1},(_,i)=>{
  if(i)run.step();
  const signals=run.view().signals;
  assert.equal(signals['motion/opening'],samples[i*4].channels.opening.value);
  return {time:i*world.dt,flow:signals['pipe/flow.gate'],stored:signals['pipe/volume.receiver']};
});
json('bench.world.json',world);
json('pipe-flow.json',flow);
const checkTick=360, checkFrame=samples[checkTick];
const beforeClose=samples[prepared.tickAt(1.31)].channels.opening.value;
assert.equal(checkFrame.channels.opening.target,0);
assert.ok(checkFrame.channels.opening.value>.4);
assert.ok(checkFrame.channels.opening.contributors.some(c=>c.id==='inspection-close'));
assert.ok(flow.some(row=>row.flow>.1));

const pickup=W.resonantModes.bake({format:W.resonantModes.planFormat,version:1,id:'bench-chime',
  source:{kind:'string',length:1,speed:452,count:7,decay:9,decayPerHz:.004},
  excitations:{drive:{point:[.38,0,0]}},pickups:{contact:{point:[.48,0,0]}}});
const audioRate=24000, resonator=W.resonantModes.prepare(pickup,{sampleRate:audioRate});
const pcm=new Float64Array(Math.round(duration*audioRate));
for(let from=0;from<pcm.length;from+=1024){
  const forces=Float64Array.from({length:Math.min(1024,pcm.length-from)},(_,i)=>{
    const sample=from+i,time=sample/audioRate, at=sample*rate/audioRate, tick=Math.floor(at), blend=at-tick;
    const value=samples[tick].channels.force.value*(1-blend)+samples[tick+1].channels.force.value*blend;
    return value*Math.sin(2*Math.PI*226*time);
  });
  const chunk=resonator.process(forces.length,{forces:{drive:forces}});
  pcm.set(chunk.pickups.contact,from);
}
const peak=pcm.reduce((maximum,n)=>Math.max(maximum,Math.abs(n)),0);
assert.ok(peak>1e-6);
write('gesture-chime.wav',WAV.encode({sampleRate:audioRate,channels:1,samples:pcm.map(n=>.85*n/peak)}));
json('comparison.json',{score:prepared.info.identity,inspection:{time:checkFrame.time,
  requested:checkFrame.channels.opening.target,opening:checkFrame.channels.opening.value,beforeClose,
  contributors:checkFrame.channels.opening.contributors,limits:checkFrame.channels.opening.limits},
  pipe:{peakFlow:Math.max(...flow.map(row=>row.flow)),endVolume:flow.at(-1).stored},
  audio:{excitation:'drive',pickup:'contact',sampleRate:audioRate,peakUnscaled:peak}});

const bg='#12202a',card='#1c3040',well='#142633',line='#3d5364',mint='#82e0c3',blue='#93c6f4',muted='#abc5cc',
  paper='#f3ebd4',coral='#ff9c82',sand='#ffce8f',lavender='#d3b5f7';
const lanes=[['intake',mint],['feather',blue],['inspection-close',coral],['trim',sand]];
const axis=ref=>ref.channels.aim;
function drawing(width,height){
  const commands=[];
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const text=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
  const path=(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width});
  const frame=()=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
  rect(0,0,width,height,bg);
  return {rect,text,path,frame};
}
function strip(d,x,y,w,time){
  const unit=w/duration, labels=125;
  for(const [i,[id,color]] of lanes.entries()){
    const row=score.gestures.find(g=>g.id===id), top=y+i*22;
    d.text(id.replaceAll('-',' '),x,top+4,1,color);
    d.rect(x+labels,top,w,13,well);
    d.rect(x+labels+(row.start-row.leadIn)*unit,top+4,row.leadIn*unit,5,color);
    d.rect(x+labels+row.start*unit,top+1,(row.end-row.start)*unit,11,color);
    d.rect(x+labels+row.end*unit,top+4,row.release*unit,5,color);
  }
  const playhead=x+labels+time*unit;
  d.path([[playhead,y-5],[playhead,y+79]],paper);
}
function plot(d,x,y,w,h,through=duration,playhead=through){
  const map=(t,v)=>[x+t/duration*w,y+(1-v)*h];
  d.rect(x,y,w,h,well);
  for(const v of [0,.25,.5,.75,1])d.path([map(0,v),map(duration,v)],line);
  for(let t=1;t<duration;t++)d.path([map(t,0),map(t,1)],line);
  const visit=samples.filter(({tick,time})=>tick%4===0&&time<=through);
  if(visit.length>1){
    d.path(visit.map(f=>map(f.time,f.channels.opening.target)),sand,1);
    d.path(visit.map(f=>map(f.time,f.channels.opening.value)),mint,2);
  }
  const [px]=map(playhead,0);
  d.path([[px,y],[px,y+h]],coral);
  d.text('0 S',x,y+h+9,1,muted);
  d.text('3.6 S',x+w-28,y+h+9,1,muted);
}
function trajectory(d,x,y,w,h,time){
  d.rect(x,y,w,h,well);
  const project=([a,b,c])=>[x+w*(.50+a*.43+c*.09),y+h*(.52-b*.43-c*.05)];
  d.path([project([-1,0,0]),project([1,0,0])],line);
  d.path([project([0,-1,0]),project([0,1,0])],line);
  const rows=samples.filter(({tick})=>tick%8===0);
  d.path(rows.map(row=>project(axis(row).target)),blue);
  d.path(rows.map(row=>project(axis(row).value)),mint,2);
  const row=samples[prepared.tickAt(time)], anchor=project([0,0,0]), [tx,ty]=project(axis(row).target);
  const current=project(axis(row).value);
  d.path([anchor,current],mint,3);
  d.rect(current[0]-3,current[1]-3,7,7,mint);
  d.path([[tx-4,ty],[tx+4,ty]],coral,2);
  d.path([[tx,ty-4],[tx,ty+4]],coral,2);
}
function board(){
  const d=drawing(1195,852);
  d.rect(35,30,24,3,mint);
  d.text('INK STUDIO / GESTURE SCORES',73,25,2,mint);
  d.text('One score drives three controls',34,61,5);
  d.rect(34,138,657,651,card);d.rect(711,138,449,651,card);
  d.text('VALVE / OVERLAPPING TARGETS',55,161,2);
  strip(d,57,215,478,1.5);
  d.text('THIN BARS SHOW LEAD-IN AND RELEASE.',182,314,1,muted);
  d.text('REQUESTED APERTURE',57,367,1,sand);
  d.text('EXECUTED APERTURE',276,367,1,mint);
  plot(d,182,390,478,189,duration,1.5);
  d.text('100%',149,391,1,muted);
  d.text('0%',161,574,1,muted);
  d.text('AT THE 1.50 S CLOSE',57,638,2,coral);
  d.text('TARGET 0% / VALVE '+Math.round(checkFrame.channels.opening.value*100)+'% OPEN',57,676,2);
  d.text('SPEED AND ACCELERATION LIMITS STILL APPLY.',57,725,1,muted);
  d.text('NOZZLE / VECTOR TARGET',734,161,2);
  trajectory(d,734,215,400,263,1.5);
  d.text('AUTHORED PATH',735,495,1,blue);
  d.text('LIMITED PATH',881,495,1,mint);
  d.text('REQUEST AT 1.50 S',1022,495,1,coral);
  d.text('PIPE / ACTUAL FLOW',734,561,2);
  const top=607,w=401,h=62,max=Math.max(...flow.map(row=>row.flow));
  d.rect(734,top,w,h,well);
  d.path(flow.map(row=>[734+w*row.time/duration,top+h*(1-row.flow/max)]),lavender,2);
  d.text('CHIME / SAME SCORE DRIVES FORCE',734,727,1,muted);
  d.text('LIBRARY + WORLD PORTS + GRAPH CLOCK',35,814,1,muted);
  return d.frame();
}
write('gesture-score-comparison.png',PNG.encodeFrame(board()));
const frames=Array.from({length:Math.floor(duration*videoRate)+1},(_,i)=>{
  const time=i/videoRate;
  const tick=prepared.tickAt(time), row=samples[tick], {target,value,contributors}=row.channels.opening;
  const d=drawing(810,442);
  d.text('VALVE AND NOZZLE / ONE GESTURE SCORE',24,22,2);
  d.text('TIME '+time.toFixed(2)+' S',24,58,1,muted);
  d.rect(24,87,435,326,card);
  strip(d,43,108,268,time);
  plot(d,168,220,268,119,time);
  d.text('100%',137,220,1,muted);
  d.text('0%',149,333,1,muted);
  d.text('TARGET '+Math.round(target*100)+'%',44,376,1,sand);
  d.text('VALVE '+Math.round(value*100)+'%',243,376,1,mint);
  d.rect(478,87,306,326,card);
  trajectory(d,496,109,271,203,time);
  const overriding=contributors.find(c=>c.priority>0);
  d.text(overriding?'OVERRIDE: '+overriding.id:'VALVE FOLLOWING SCORE',496,349,1,overriding?coral:muted);
  d.text('REQUEST',496,377,1,coral);
  d.text('EXECUTED AIM',660,377,1,mint);
  return d.frame();
});
write('gesture-score-motion.apng',PNG.encodeAnimation(frames,videoRate));
