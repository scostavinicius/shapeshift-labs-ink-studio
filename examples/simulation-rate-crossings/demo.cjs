const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {KIT: K} = require('./ink-studio.config.js').load();
const PNG = require('../../cli/png.js');
const world = require('./bench.world.json');

const run = K.world.runtime.create(world), meter = [], scope = [];
run.advance(144,{onTick(view) {
  scope.push(...view.states.scope);
  if (view.tick % 3 === 0) meter.push(view.states.meter.at(-1));
}});
const plan = run.composition(), lanes = plan.execution.signals;
const crossing = sample => lanes.find(lane=>lane.sample===sample).crossing;
const fir = crossing('decimate'), linear = crossing('interpolate'), delay = crossing('fractional-delay');
const theory = time => Math.sin(2*Math.PI*3*time);
const sourceWave = time => theory(time)+0.8*Math.sin(2*Math.PI*44*time);
const sourceRate = 240, receiverRate = 20;
const chartStart = 0.8, chartEnd = 1.55;
const align = (key,latency) => meter.map(row=>({time:row.time-latency,value:row[key]}))
  .filter(row=>row.time>=chartStart && row.time<=chartEnd);
const held = align('plain',1/sourceRate), smooth = align('filtered',fir.latencySeconds);
const rms = rows => Math.sqrt(rows.reduce((error,row)=>error+(row.value-theory(row.time))**2,0)/rows.length);
const holdRms = rms(held), filteredRms = rms(smooth);
const attenuationDb = 20*Math.log10(holdRms/filteredRms);
assert.ok(filteredRms < holdRms/100);
const range = scope.filter(row=>row.time>=0.2 && row.time<=0.28);
const linearError = Math.max(...range.map(row=>Math.abs(row.linear-(row.time-linear.latencySeconds))));
assert.ok(linearError < 1e-12);
const saved = JSON.parse(JSON.stringify(run.checkpoint()));
const resumed = K.world.runtime.create(saved.world,{checkpoint:saved});
run.advance(150);
resumed.advance(150);
assert.deepEqual(resumed.checkpoint(),run.checkpoint());

const width = 1120, height = 810, marks = [];
const colors = {background:'#101b25',panel:'#182a37',guide:'#405367',paper:'#e9f1ec',
  dim:'#a7bac7',mint:'#8de5c8',copper:'#ffc18a',violet:'#b7b6ff'};
const c = colors;
const box = (x,y,w,h,fill) => marks.push({type:'rect',rect:[x,y,w,h],fill});
const label = (text,x,y,scale=2,color=c.paper) => marks.push({type:'text',text:String(text),at:[x,y],scale,color});
const line = (points,stroke,width=2) => marks.push({type:'path',points,stroke,width});
function plot({x,y,w,h},from,to,min,max) {
  const px = t => x+(t-from)*w/(to-from), py = value => y+h*(max-value)/(max-min);
  for (const m of [min,(min+max)/2,max]) box(x,py(m),w,1,c.guide);
  return {
    draw(rows,color,{dots=false,width=2}={}) {
      line(rows.map(({time,value})=>[px(time),py(value)]),color,width);
      if (dots) for (const {time,value} of rows) box(Math.round(px(time))-2,Math.round(py(value))-2,5,5,color);
    }
  };
}
box(0,0,width,height,c.background);
box(42,37,26,4,c.mint);
label('INK STUDIO / SIGNAL LAB',80,30,2,c.mint);
label('Explicit rate crossings',39,64,5);
label('TIMING, ANTI-ALIASING AND FRACTIONAL DELAY',43,125,2,c.dim);

box(42,166,1036,326,c.panel);
label('240 HZ TO 20 HZ / ANTI-ALIASED DECIMATION',62,186,2,c.mint);
label('HOLD',62,225,2,c.copper);
label('FIR',191,225,2,c.mint);
label('RMS ERROR '+holdRms.toFixed(3)+' / '+filteredRms.toFixed(5),543,225,2,c.paper);
const top = plot({x:66,y:266,w:986,h:156},chartStart,chartEnd,-1.9,1.9);
top.draw(held,c.copper,{dots:true});
top.draw(smooth,c.mint,{dots:true});
label('0.80 s',65,448,2,c.dim);
label('Source time, aligned for filter latency',328,448,2,c.dim);
label('1.55 s',973,448,2,c.dim);

box(42,514,506,254,c.panel);
label('60 HZ TO 240 HZ',61,533,2,c.mint);
label('HOLD',61,566,2,c.copper);
label('LINEAR',178,566,2,c.mint);
const left = plot({x:65,y:604,w:457,h:102},0.2,0.28,0.177,0.28);
const steps = [range[0]];
for (const row of range.slice(1)) steps.push({time:row.time,held:steps.at(-1).held},row);
left.draw(steps.map(row=>({time:row.time,value:row.held})),c.copper);
left.draw(range.map(row=>({time:row.time,value:row.linear})),c.mint,{dots:true});
label('One source interval of latency',61,730,2,c.dim);

box(572,514,506,254,c.panel);
label('FRACTIONAL DELAY',592,533,2,c.mint);
label('SOURCE',592,566,2,c.violet);
label('DELAYED',729,566,2,c.mint);
const right = plot({x:595,y:604,w:457,h:102},0.43,0.52,-1.9,1.9);
const clip = scope.filter(row=>row.time>=0.43 && row.time<=0.52);
right.draw(clip.map(row=>({time:row.time,value:sourceWave(row.time)})),c.violet);
right.draw(clip.map(row=>({time:row.time,value:row.delayed})),c.mint);
label('1.5 source samples / 6.25 ms',592,730,2,c.dim);

const out = path.resolve(process.argv[2] ?? 'studio/out/simulation-rate-crossings');
fs.mkdirSync(out,{recursive:true});
const write = (file,value) => fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
write('report.json',{sourceRate,receiverRate,holdRms,filteredRms,attenuationDb,linearError,replayMatches:true,
  decimation:fir,interpolation:linear,fractionalDelay:delay});
write('plan.json',plan);
write('crossings.checkpoint.json',saved);
fs.writeFileSync(path.join(out,'signal-crossings.png'),PNG.encodeFrame(PNG.packRGBA(
  K.procedural.drawing2d.render({width,height,commands:marks,edges:'hard'}))));
