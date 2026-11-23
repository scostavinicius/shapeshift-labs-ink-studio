const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {KIT: K} = require('./ink-studio.config.js').load();
const {embedModels} = require('../../cli/simulation-model-files.js');
const datasets = require('../../cli/data-inputs.js');
const PNG = require('../../cli/png.js');

const source = path.join(__dirname,'bench.world.json');
const world = embedModels(require(source),source);
world.dataInputs = datasets.embed(K.dataInputs,world.dataInputs,source);
const run = K.world.runtime.create(world,{profile:true});
const report = run.composition(), {execution:plan} = report;
const ticks = 16;
run.advance(ticks);
const profile = run.profile(), checkpoint = JSON.parse(JSON.stringify(run.checkpoint()));
const resumed = K.world.runtime.create(checkpoint.world,{checkpoint}).composition();
assert.deepEqual(resumed,run.composition());
const {systems,signals,feedback,resources,assets} = plan;
const spring = systems.spring.child.plan.execution;
const observed = {drive:profile.drive.calls,spring:profile.spring.calls,meter:profile.meter.calls,
  solver:checkpoint.states.spring.checkpoint.states.solver.steps};
for (const name of ['drive','spring','meter'])
  assert.equal(observed[name],systems[name].cadence[0].visitsPerTick*ticks);
assert.equal(observed.solver,spring.systems.solver.cadence[0].visitsPerTick*
  ticks*systems.spring.child.ticksPerHostTick);

const width=1140, height=854;
const bg='#10191f', paper='#182830', line='#324952', white='#e9f1eb', dim='#a5bac1';
const mint='#83e6c0', blue='#a2baff', gold='#ffbf80';
const marks=[];
const rect = (x,y,w,h,fill) => marks.push({type:'rect',rect:[x,y,w,h],fill});
const label = (text,x,y,scale=2,color=white) =>
  marks.push({type:'text',text:String(text),at:[x,y],scale,color});
rect(0,0,width,height,bg);
rect(42,38,22,4,mint);
label('INK STUDIO / SIM PLAN',77,32,2,mint);
label('Spring feedback bench',40,64,5);
label('25 HZ WORLD   /   2 PHASES PER TICK   /   100 HZ MODEL',43,124,2,dim);

rect(42,167,1056,304,paper);
label('EXECUTION CADENCE',62,188,2,mint);
label('HZ',270,222,2,dim);
label('FIRST FOUR WORLD TICKS',367,222,2,dim);
label('CALLS / 16 TICKS',872,222,2,dim);
const start=357, tickWidth=118;
for (let tick=1;tick<=4;tick++) {
  const x=start+(tick-1)*tickWidth;
  rect(x,252,1,193,line);
  label(tick,x+tickWidth-17,254,2,dim);
}
rect(start+4*tickWidth,252,1,193,line);
const lanes = [
  {id:'drive',title:'Force drive',rate:systems.drive.cadence[0],color:blue},
  {id:'spring',title:'Spring module',rate:systems.spring.cadence[0],color:mint},
  {id:'solver',title:'  Inner kernel',rate:spring.systems.solver.cadence[0],color:mint,
    multiplier:systems.spring.child.ticksPerHostTick},
  {id:'meter',title:'Average meter',rate:systems.meter.cadence[0],color:gold}
];
for (const [index,{id,title,rate,color,multiplier=1}] of lanes.entries()) {
  const y=287+index*42;
  label(title,63,y,2);
  label(rate.hz,270,y,2,color);
  rect(start,y+7,4*tickWidth,1,line);
  const count=4*multiplier, steps=rate.substeps;
  for (let tick=1;tick<=count;tick++) {
    if (tick%rate.every) continue;
    for (let step=1;step<=steps;step++) {
      const x=start+Math.round(tickWidth*(tick-1+step/steps)/multiplier);
      rect(x-4,y+3,9,9,color);
    }
  }
  label(observed[id],930,y,2,color);
}

rect(42,491,1056,178,paper);
label('SIGNAL CROSSINGS',62,512,2,mint);
const feedbackDelay=feedback[0].boundaries.find(edge=>edge.delay);
const labels = {
  'drive/position':['Spring displacement','Force drive', 'HOLD + '+feedbackDelay.delay+' TICK DELAY'],
  'spring/force':['Drive force','Spring module','HOLD'],
  'meter/value':['Spring displacement','Average meter','TIME-WEIGHTED AVERAGE']
};
for (const [index,edge] of signals.entries()) {
  const [from,to,mode]=labels[edge.to], y=547+index*33;
  label(from,63,y,2);
  label('>',340,y,2,dim);
  label(to,391,y,2);
  label(mode,657,y,2,edge.delay ? gold : blue);
}

rect(42,689,516,127,paper);
rect(578,689,520,127,paper);
label('RETAINED ASSETS',62,710,2,mint);
label('Drive CSV / '+assets.dataInputs[0].rowCount+' rows',62,746,2);
label('Backdrop image / '+assets.packs[0].bakedImages[0].width+' x '+assets.packs[0].bakedImages[0].height+' pixels',62,778,2);
label('MEMORY AND WORK',598,710,2,mint);
label(resources.memory.typedStateBytes+' B kernel state / '+resources.memory.delaySlots+' delay slot',598,746,2);
label(resources.work.fixedSolverVisitsPerTick+' host visits per tick on average',598,778,2);

const out=path.resolve(process.argv[2] ?? 'studio/out/simulation-execution-plan');
fs.mkdirSync(out,{recursive:true});
const write=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
write('plan.json',report);
write('checkpoint-plan.json',resumed);
write('observed-visits.json',{hostTicks:ticks,visits:observed});
const board=K.procedural.drawing2d.render({width,height,commands:marks,edges:'hard'});
fs.writeFileSync(path.join(out,'execution-plan.png'),PNG.encodeFrame(PNG.packRGBA(board)));
console.log('Wrote spring execution plan and observed visits to '+out);
