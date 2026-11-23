const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const world = require('./pump.world.json');

const {KIT: K} = ink.load();
const {runtime} = K.world;
const held = runtime.create(world);
const plan = held.composition();
held.advance(8);
const signals = held.view().signals;
const graph = ink.readGraphProject(path.join(__dirname,'pressure.graph.json')).run();
const wrong = K.procedural.data.clone(world);
wrong.connections[1].from = 'pump/pressure.supply';
let rejection;
try { runtime.validate(wrong); }
catch (error) { rejection = error.message; }
if (!rejection?.includes('cannot supply m^3/s')) throw new Error('Expected the miswired pump to fail validation');

const pressure = signals['gauge/value'], flow = signals['meter/value'];
const graphInput = graph.report.inputs.sensor, graphOutput = graph.outputs.pressure;
const senderRate = plan.systems.pump.writes.outputs['flow.branch'].quantity.sampleRate;
const meterRate = plan.systems.meter.reads.inputs.value.quantity.sampleRate;
const report = {tick:held.view().tick, time:held.view().time, pressurePa:pressure, flowM3PerSecond:flow,
  sampler:{sourceHz:senderRate, targetHz:meterRate, policy:'average'},
  graph:{inputKPa:graphInput, outputPa:graphOutput}, rejection};
const out = path.resolve(process.argv[2] ?? 'studio/out/physical-ports');
fs.mkdirSync(out,{recursive:true});
const write = (name, value) => fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
write('report.json',report);
write('rejected.world.json',wrong);

const canvas = [1000,600], commands = [];
const inkColor = '#edf4f1', muted = '#a5bfbe', aqua = '#78ead6', warm = '#ff9b86';
function box(x,y,w,h,fill) {
  commands.push({type:'rect',rect:[x,y,w,h],fill});
}
function text(value,x,y,scale,color = inkColor,tracking = 0) {
  commands.push({type:'text',text:String(value),at:[x,y],scale,color,tracking});
}
function arrow(x,y,color) {
  box(x,y,26,2,color);
  commands.push({type:'path',points:[[x+20,y-5],[x+26,y+1],[x+20,y+7]],stroke:color,width:2});
}
box(0,0,...canvas,'#0d1923');
box(44,40,30,4,aqua);
text('INK STUDIO / SIMULATION',87,34,2,aqua,1);
text('Physical ports',42,64,5);
text('Metered pump  /  tick 8  /  0.40 s',45,115,2,muted);
box(44,151,912,1,'#36525c');

box(44,173,446,134,'#162a36');
box(44,173,446,2,aqua);
text('SUPPLY PRESSURE',65,191,2,aqua,1);
text(pressure.toFixed(1)+' Pa',65,227,3);
text('Pa',65,270,2,muted);
arrow(107,276,aqua);
text('N/m^2  /  same scale',150,270,2,muted);

box(510,173,446,134,'#162a36');
box(510,173,446,2,aqua);
text('BRANCH FLOW',531,191,2,aqua,1);
text(flow.toFixed(5)+' m^3/s',531,227,3);
text(senderRate+' Hz',531,270,2,muted);
arrow(612,276,aqua);
text(meterRate+' Hz  /  average',655,270,2,muted);

box(44,327,912,136,'#302329');
box(44,327,5,136,warm);
text('REJECTED DURING PLANNING',65,345,2,warm,1);
text('pump/pressure.supply',65,375,2);
arrow(323,381,warm);
text('meter/value',366,375,2);
const reason = rejection.slice(rejection.indexOf(': ')+2);
text(reason,65,412,2,warm);

box(44,483,912,76,'#162a36');
text('EXPLICIT GRAPH CONVERSION',65,503,2,aqua,1);
text(graphInput+' kPa',503,503,3);
arrow(658,513,aqua);
text(graphOutput+' Pa',705,503,3);
const {data} = K.procedural.drawing2d.render({width:canvas[0], height:canvas[1], commands, edges:'hard'});
fs.writeFileSync(path.join(out,'physical-ports.png'),PNG.encode(...canvas,data,4));
process.stdout.write(JSON.stringify(report,null,2)+'\n');
