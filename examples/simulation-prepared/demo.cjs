const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const studio = require('../..');
const PNG = require('../../cli/png.js');
const {KIT: K} = require('./ink-studio.config.js').load();
const proc = K.world.kernels.prepare('prepared-vent-network',1,{}, {dt:1/48000}).processor;
const waveform = proc.buffers.trace;
const requests = [[96,.03],[128,.04],[192,.04],[40,.04],[96,-.014]].map(([samples,inlet])=>{
  const before = proc.report().observed.cursor;
  proc.input.inlet = inlet;
  const status = proc.process(samples);
  const {observed} = proc.report();
  return {samples,status,cursor:observed.cursor,retained:observed.cursor===before,work:observed.lastWork};
});
assert.deepEqual(requests.map(row=>row.status.endsWith('capacity')?row.status:'admitted'),
  ['admitted','work-capacity','sample-capacity','admitted','admitted']);
assert.equal(proc.buffers.trace,waveform);
const report = proc.report();
assert.equal(report.observed.processedSamples,232);
const out = path.resolve(process.argv[2] ?? 'studio/out/simulation-prepared');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({requests,...report},null,2)+'\n');

let html=fs.readFileSync(path.join(__dirname,'playback.html'),'utf8');
const safe = source => source.replace(/<\/script/gi,'<\\/script');
html=html.replace('/*__INK_KIT__*/',()=>safe(studio.bundle()))
  .replace('/*__VENT_NETWORK__*/',()=>safe(fs.readFileSync(path.join(__dirname,'vent-network.js'),'utf8')));
fs.writeFileSync(path.join(out,'prepared-playback.html'),html);

const width=1100, height=732, marks=[];
const bg='#101b24', panel='#192d37', paper='#eef5ee', dim='#acc2c8';
const mint='#9cebc2', orange='#ffc58a', grid='#3f5962';
const rect=(x,y,w,h,fill)=>marks.push({type:'rect',rect:[x,y,w,h],fill});
const text=(data,x,y,scale=2,color=paper)=>marks.push({type:'text',text:String(data),at:[x,y],scale,color});
const line=(points,color,w=2)=>marks.push({type:'path',points,stroke:color,width:w});
rect(0,0,width,height,bg);
rect(44,37,26,4,mint);
text('INK STUDIO / SIMULATION',82,31,2,mint);
text('Prepared kernel playback',42,64,5);
text('48 KHZ / SIX-CELL VENT NETWORK',45,126,2,dim);

rect(44,171,1012,159,panel);
text('PREPARED CAPACITY',64,191,2,mint);
for (const [i,[label,value]] of [
  ['EFFECTIVE BLOCK',report.capacity.effectiveMaxSamples+' samples'],
  ['WORK BUDGET',report.capacity.maxWork+' units'],
  ['TYPED BUFFERS',report.memory.allocatedBytes+' B']
].entries()) {
  const x=64+i*333;
  text(label,x,237,2,dim);
  text(value,x,272,3,paper);
}

rect(44,350,1012,336,panel);
text('PROCESS REQUESTS',64,370,2,mint);
text('SAMPLES',65,409,2,dim);
text('CAPACITY',250,409,2,dim);
text('RESULT',624,409,2,dim);
const label = {
  ok:'COMMITTED', deadline:'COMMITTED / DEADLINE', 'work-capacity':'WORK OVERRUN',
  'sample-capacity':'SIZE OVERRUN'
};
const x0=246, span=325, at=n=>Math.round(x0+span*n/192);
const limit=at(report.capacity.effectiveMaxSamples);
rect(limit,434,1,208,grid);
for (const [index,row] of requests.entries()) {
  const y=450+index*38, color=row.retained?orange:mint;
  text(row.samples,64,y,2,color);
  line([[x0,y+7],[x0+span,y+7]],grid);
  rect(x0,y+3,at(row.samples)-x0,8,color);
  text(label[row.status],624,y,2,color);
}
text('Rejected blocks kept the previous state and output.',64,654,2,dim);
fs.writeFileSync(path.join(out,'prepared-kernel.png'),PNG.encodeFrame(PNG.packRGBA(
  K.procedural.drawing2d.render({width,height,commands:marks,edges:'hard'}))));
