const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const kit = require('../..').load();
const {embedModels} = require('../../cli/simulation-model-files.js');
const PNG = require('../../cli/png.js');
const {sampleRate,register} = require('./resonator.cjs');
const {KIT: K} = kit;

const source = path.join(__dirname,'bench.world.json');
const blockWorld = embedModels(require(source),source);
const scalarWorld = K.procedural.data.clone(blockWorld);
delete scalarWorld.modules.resonator.numerics.blockSize;

const hostTicks = 12;
const hostHz = 1/blockWorld.dt;
const samplesPerTick = sampleRate/hostHz;
const totalSamples = samplesPerTick*hostTicks;
let active;
register(kit,{
  sample:(index,value) => {
    if (active) active.wave[index] = value;
  },
  visit:count => {
    if (active) {
      active.publications++;
      active.samples += count;
    }
  },
  publish() {
    if (active) active.snapshotCalls++;
  }
});

function measure(world) {
  const run = K.world.runtime.create(world);
  const observed = {wave:new Float64Array(totalSamples),publications:0,snapshotCalls:0,samples:0};
  active = observed;
  const start = performance.now();
  try {
    run.advance(hostTicks);
    observed.ms = performance.now()-start;
  } finally {
    active = undefined;
  }
  return {observed,checkpoint:run.checkpoint(),plan:run.composition()};
}

// Warm both routes before measuring a short repeatable take.
measure(blockWorld);
measure(scalarWorld);
const fast = measure(blockWorld), scalar = measure(scalarWorld);
const block = fast.observed, sample = scalar.observed;
assert.deepEqual(block.wave,sample.wave);
assert.equal(block.samples,totalSamples);
assert.equal(sample.samples,totalSamples);
assert.equal(block.publications,hostTicks);
assert.equal(block.snapshotCalls,hostTicks);
assert.equal(sample.publications,totalSamples);
assert.ok(sample.snapshotCalls >= totalSamples);
const endpoint = result => result.checkpoint.states.voice.checkpoint.states.solver;
assert.deepEqual(endpoint(fast),endpoint(scalar));

const width=1100, height=690, marks=[];
const bg='#101e25', panel='#182e37', guide='#30505a', white='#eff4e8', soft='#adc3c4';
const green='#88e8ba', orange='#ffc28e';
const rect=(x,y,w,h,fill)=>marks.push({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale=2,color=white)=>marks.push({type:'text',text:String(text),at:[x,y],scale,color});
const trace=(points,stroke,width)=>marks.push({type:'path',points,stroke,width});
const number=n=>n.toLocaleString('en-US');
rect(0,0,width,height,bg);
rect(42,36,26,4,green);
label('INK STUDIO / SIMULATION',80,30,2,green);
label('96 kHz beneath 60 Hz',40,64,5);
label(number(samplesPerTick)+' SOLVER SAMPLES PER WORLD TICK',44,123,2,soft);

rect(42,162,1016,181,panel);
label('KERNEL STATE PUBLICATIONS',63,184,2,green);
label(hostTicks+' WORLD TICKS',830,184,2,soft);
label('Per sample',63,232,2);
label(number(sample.publications),365,230,3,orange);
label('Block executor',63,286,2);
label(number(block.publications),365,284,3,green);
rect(617,230,403,15,orange);
const barWidth=Math.max(2,Math.round(403*block.publications/sample.publications));
rect(617,285,barWidth,15,green);
rect(617+barWidth,285,403-barWidth,1,guide);

rect(42,365,1016,263,panel);
label('MATCHED OUTPUT SAMPLES',63,389,2,green);
label(number(block.samples)+' / '+number(totalSamples),798,389,2,white);
const clipStart=1536, clipEnd=2208, plot={x:66,y:438,w:962,h:133};
for (const fraction of [0,0.5,1]) rect(plot.x,plot.y+plot.h*fraction,plot.w,1,guide);
const samples=block.wave.subarray(clipStart,clipEnd+1);
const amplitude=Math.max(...samples.map(Math.abs));
const offset=value=>plot.y+plot.h/2-(plot.h/2-4)*value/amplitude;
const xpos=index=>plot.x+plot.w*(index-clipStart)/(clipEnd-clipStart);
const boundary=Math.round(xpos(samplesPerTick));
rect(boundary,plot.y,1,plot.h,orange);
trace(Array.from(samples,(value,index)=>[xpos(clipStart+index),offset(value)]),green,2);
label(number(clipStart),plot.x,584,2,soft);
label('WORLD TICK 1 ENDS',boundary+9,584,2,orange);
label(number(clipEnd),plot.x+plot.w-60,584,2,soft);
label('Sample indices',43,653,2,soft);
label('24 B TYPED KERNEL STATE',737,653,2,soft);

const out=path.resolve(process.argv[2] ?? 'studio/out/simulation-blocks');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const counters=({wave,...stats})=>stats;
write('report.json',{hostHz,sampleRate,samplesPerTick,hostTicks,totalSamples,matchingSamples:totalSamples,
  block:counters(block),scalar:counters(sample),localSpeedup:sample.ms/block.ms});
write('plan.json',fast.plan);
write('bench.checkpoint.json',fast.checkpoint);
const board=K.procedural.drawing2d.render({width,height,commands:marks,edges:'hard'});
fs.writeFileSync(path.join(out,'sample-block-executor.png'),PNG.encodeFrame(PNG.packRGBA(board)));
