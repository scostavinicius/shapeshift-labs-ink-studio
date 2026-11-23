const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ink=require('../..'), PNG=require('../../cli/png.js');
const kit=require('./ink-studio.config.js').load(), {KIT:K}=kit, W=K.world;
const {embedModels}=require('../../cli/simulation-model-files.js');
const model=require('./voice.model.json'), spec=require('./bench.take.json');
const source=path.join(__dirname,'bench.world.json'), world=embedModels(require(source),source);
const make=(simulation=spec.simulation,checkpoint)=>ink.createTake({clock:spec.clock,world,simulation},{kit,checkpoint});
const plain=value=>JSON.parse(JSON.stringify(value));
const first=891, end=1860, wave=[], resumed=[];
const record=(destination)=>(start,stop,outputs)=>{destination[stop-1]=outputs.voice;};
const uninterrupted=W.blockReview.playback(model,{path:'offline',retainEvents:true,onBlock:record(wave)});
for(let sample=0;sample<first;sample++) uninterrupted.process(1);
const portable=plain(uninterrupted.checkpoint());
const restored=W.blockReview.playback(model,{path:'offline',checkpoint:portable,onBlock:record(resumed)});
for(let sample=first;sample<end;sample++) {
  uninterrupted.process(1);
  restored.process(1);
  assert.equal(resumed[sample],wave[sample]);
}
assert.deepEqual(restored.checkpoint(),uninterrupted.checkpoint());

const take=make(), positions=[];
function sample(name,transport,frame,iteration=0) {
  const row=transport.seek(frame,{iteration}), checkpoint=transport.checkpoint();
  positions.push({name,frame,iteration,worldTick:row.world.tick,
    fastSample:checkpoint.world.states.voice.checkpoint.tick,
    origin:row.simulation.originCut,pendingNotes:checkpoint.world.sampling['meter/notes'].length});
  return checkpoint;
}
const worldCheckpoint=plain(sample('SAVED',take,1));
const resumedTake=make(spec.simulation,worldCheckpoint);
resumedTake.seek(3);
sample('CARRY CUT',take,3);
assert.deepEqual(resumedTake.checkpoint(),take.checkpoint());
const atReset=sample('RESET CUT',take,6);
const atRestore=sample('RESTORE LOOP',take,6,1);
assert.deepEqual(atRestore.world,atReset.world);
const carry=make({...spec.simulation,loop:{...spec.simulation.loop,state:'carry'}});
sample('CARRY LOOP',carry,6,1);
assert.notDeepEqual(carry.checkpoint().world.states.voice.checkpoint.states,atReset.world.states.voice.checkpoint.states);

const out=path.resolve(process.argv[2]??'studio/out/simulation-fast-checkpoints');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const pending=worldCheckpoint.world.sampling['meter/notes'].map(({timing})=>timing.sample+timing.fraction);
write('voice.checkpoint.json',portable);
write('take.checkpoint.json',worldCheckpoint);
write('report.json',{sampleRate:48000,checkpointSample:first,matchedSamples:end-first,positions,
  typedState:Object.fromEntries(Object.entries(portable.kernel.buffers)
    .map(([name,{type,length}])=>[name,{type,length}])),
  pendingWorldNotes:pending,matchedWorldResume:true});

const width=1120,height=792, marks=[];
const bg='#101c25', panel='#1b303b', paper='#edf4ee', dim='#adc4cc', mint='#94e8bf', gold='#ffc388', grid='#3c5966';
const rect=(x,y,w,h,fill)=>marks.push({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale=2,color=paper)=>marks.push({type:'text',text:String(text),at:[x,y],scale,color});
const line=(points,stroke,width=2)=>marks.push({type:'path',points,stroke,width});
rect(0,0,width,height,bg);
rect(44,37,26,4,mint);
label('INK STUDIO / SIMULATION',82,31,2,mint);
label('Checkpoint the fast state',41,65,5);
label('48 KHZ VOICE / 60 HZ WORLD',44,126,2,dim);

rect(44,164,1032,325,panel);
label('VOICE AFTER CHECKPOINT RESUME',64,184,2,mint);
label('CONTINUOUS',65,222,2,gold);
label('RESUMED',270,222,2,mint);
label((end-first)+' SAMPLES MATCH EXACTLY',666,222,2);
const start=540, x0=67, span=982, endGraph=end-1;
const x=sample=>x0+(sample-start)/(endGraph-start)*span;
const y=value=>337-value*175;
rect(x0,337,span,1,grid);
rect(Math.round(x(first)),253,1,179,grid);
line(wave.slice(start).map((value,i)=>[x(i+start),y(value)]),gold,3);
line(resumed.slice(first).map((value,i)=>[x(i+first),y(value)]),mint,2);
label('SAMPLE '+start,x0,450,2,dim);
label('CHECKPOINT '+first,Math.round(x(first))+10,450,2,paper);
label(endGraph,984,450,2,dim);

rect(44,508,1032,239,panel);
label('TAKE TRANSPORT',64,529,2,mint);
label('PICTURE',574,563,2,dim);
label('WORLD TICK',727,563,2,dim);
label('FAST SAMPLE',916,563,2,dim);
for(const [i,row] of positions.entries()) {
  const y=592+i*28;
  label(row.name,64,y,2);
  label(row.iteration?row.frame+' / LOOP '+row.iteration:row.frame,572,y,2,dim);
  label(row.worldTick,727,y,2,mint);
  label(row.fastSample.toLocaleString('en-US'),916,y,2,paper);
}
label('World checkpoint held '+pending.length+' unread notes.',63,766,2,dim);
fs.writeFileSync(path.join(out,'fast-checkpoint-take.png'),PNG.encodeFrame(PNG.packRGBA(
  K.procedural.drawing2d.render({width,height,commands:marks,edges:'hard'}))));
