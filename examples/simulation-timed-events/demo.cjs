const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {KIT: K} = require('./ink-studio.config.js').load();
const {embedModels} = require('../../cli/simulation-model-files.js');
const PNG = require('../../cli/png.js');
const file = path.join(__dirname,'bench.world.json');
const world = embedModels(require(file),file);

const R=K.world.runtime, run=R.create(world,{traceSteps:4,profile:true,recordRun:true});
run.step();
const first=run.checkpoint(), firstSteps=run.stepFrame().steps;
const note=first.states.score.eventValues.note[0];
const impact=first.signals['fall/impacts'][0];
assert.equal(note.timing.sample,999);
assert.equal(first.states.precise.received.length,2);
assert.deepEqual(first.states.coarse.received,[]);
const saved=JSON.parse(JSON.stringify(first));
const resumed=R.create(saved.world,{checkpoint:saved});
run.step();
resumed.step();
assert.deepEqual(resumed.checkpoint(),run.checkpoint());
assert.deepEqual(R.replay(JSON.parse(JSON.stringify(run.recording()))).checkpoint(),run.checkpoint());
const {precise,coarse}=run.view().states;
const dt=world.dt, impactAt=impact.timing.time, noteAt=note.timing.time;
const milliseconds=time=>(time*1000).toFixed(3)+' ms';
assert.deepEqual(precise.received.map(row=>row.reaction),[impactAt,noteAt]);
assert.deepEqual(coarse.received.map(row=>row.reaction),[2*dt,2*dt]);

const width=1120, height=766, marks=[];
const c={background:'#0f1922',panel:'#192c38',line:'#3b5361',paper:'#eef4ef',dim:'#9fb8c2',
  mint:'#8fe9bc',amber:'#ffbf89',lavender:'#b4b6ff'};
const box=(x,y,w,h,fill)=>marks.push({type:'rect',rect:[x,y,w,h],fill});
const text=(label,x,y,scale=2,color=c.paper)=>marks.push({type:'text',text:String(label),at:[x,y],scale,color});
const line=(points,stroke,width=2)=>marks.push({type:'path',points,stroke,width});
const x0=288, x1=1028, at=time=>Math.round(x0+(x1-x0)*time/(2*dt)), right=at(dt);
const timingRows=[
  {time:impactAt,label:'Impact',color:c.amber},
  {time:noteAt,label:'Note on',color:c.lavender}
];
box(0,0,width,height,c.background);
box(42,36,25,4,c.mint);
text('INK STUDIO / SIMULATION',79,30,2,c.mint);
text('Events inside a timestep',39,63,5);
text('60 HZ WORLD / SWEPT COLLISION AND 96 KHZ NOTE CLOCK',43,124,2,c.dim);

box(42,164,1036,317,c.panel);
text('EVENT TIME AND REACTION',62,186,2,c.mint);
text('TICK 1',x0+14,221,2,c.dim);
text('TICK 2',right+14,221,2,c.dim);
for (const x of [x0,right,x1]) box(x,215,1,218,c.line);
for (const [label,y] of [['Occurred',267],['Split solver',332],['Boundary receiver',398]]) {
  text(label,63,y-4,2);
  box(x0,y+3,x1-x0,1,c.line);
}
for (const {time,label,color} of timingRows) {
  const x=at(time);
  text(label,x-28,244,2,color);
  box(x-4,266,9,9,color);
  box(x-4,329,9,9,color);
  line([[x,275],[x,329]],color,1);
  text(milliseconds(time),x+(label==='Impact'?-54:6),356,2,color);
}
box(x1-5,393,10,10,c.mint);
text('Both at '+milliseconds(2*dt),793,424,2,c.dim);

box(42,505,1036,222,c.panel);
text('RECEIVER MOTION',62,528,2,c.mint);
text('SPLIT',62,583,2,c.mint);
text('BOUNDARY',62,629,2,c.dim);
const y0=672, scale=2200;
const physical=[[0,0],[impactAt,0],[noteAt,noteAt-impactAt],[2*dt,precise.travel]];
for (const x of [x0,right,x1]) box(x,561,1,113,c.line);
line([[x0,y0],[x1,y0]],c.dim,2);
line(physical.map(([time,pos])=>[at(time),y0-pos*scale]),c.mint,3);
text('0 ms',x0,691,2,c.dim);
text(milliseconds(dt),right-49,691,2,c.dim);
text(milliseconds(2*dt),x1-104,691,2,c.dim);

const out=path.resolve(process.argv[2]??'studio/out/simulation-timed-events');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
write('report.json',{worldHz:1/dt,kernelHz:96000,samplesPerBlock:1600,impact,note,
  split:precise,baseline:coarse,replayMatches:true,firstTick:firstSteps});
write('plan.json',run.composition());
write('bench.checkpoint.json',saved);
fs.writeFileSync(path.join(out,'timed-event-boundaries.png'),PNG.encodeFrame(PNG.packRGBA(
  K.procedural.drawing2d.render({width,height,commands:marks,edges:'hard'}))));
