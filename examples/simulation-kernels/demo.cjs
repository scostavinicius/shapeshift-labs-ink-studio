const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const kit = require('./ink-studio.config.js').load();
const K = kit.KIT, W = K.world;
const model = require('./spring.model.json');
const pause = 95, lastTick = 300;

const source = W.runtime.create(model);
const sample = run => ({tick:run.view().tick,time:run.view().time,...W.models.sample(run).outputs});
const original = [sample(source)];
source.advance(pause,{onTick() { original.push(sample(source)); }});
const text = JSON.stringify(source.checkpoint());
const checkpoint = JSON.parse(text);
const resumed = W.runtime.create(checkpoint.world,{checkpoint});
const restarted = [sample(resumed)];
source.advance(lastTick,{onTick() { original.push(sample(source)); }});
resumed.advance(lastTick,{onTick() { restarted.push(sample(resumed)); }});
if (!W.data.equal(original.slice(pause),restarted) || !W.data.equal(source.checkpoint(),resumed.checkpoint()))
  throw new Error('Spring checkpoint replay diverged');

const op = 'kernel.damped-spring.v1';
const {example} = ink.describeGraphNode(op,{kit});
const graph = K.procedural.data.clone(example.project);
graph.nodes.example.inputs.clock.tick = lastTick;
graph.nodes.example.inputs.checkpoint = checkpoint;
const named = ink.createGraphProject(graph,{kit}).run().outputs;
const final = original.at(-1);
if (named.value !== final.displacement) throw new Error('The catalog graph disagrees with the replay');

const width = 1000, height = 657;
const inkColor = '#edf4ee', dim = '#9eb9be', mint = '#7ce8cc', copper = '#ffab72';
const plot = {x:126,y:465,w:804,h:119};
const timeX = tick => Math.round(plot.x+plot.w*tick/lastTick);
const positionY = value => Math.round(plot.y+plot.h*(0.8-value)/1.6);

function draw(frame) {
  const marks = [];
  const box = (x,y,w,h,fill) => marks.push({type:'rect',rect:[x,y,w,h],fill});
  const line = (points,stroke,width = 2) => marks.push({type:'path',points,stroke,width});
  const label = (text,x,y,scale = 2,color = inkColor,tracking = 0) =>
    marks.push({type:'text',text:String(text),at:[x,y],scale,color,tracking});
  box(0,0,width,height,'#0e1923');
  box(44,38,28,4,mint);
  label('INK STUDIO / SIMULATION',86,32,2,mint,1);
  label('Kernel checkpoint',42,63,5);
  label('Damped spring / creator-authored JavaScript',45,116,2,dim);
  box(44,151,912,1,'#38505b');

  box(44,172,912,196,'#182a36');
  label('SPRING POSITION',65,192,2,mint,1);
  label(frame.displacement.toFixed(4)+' m',65,232,3);
  label('VELOCITY',65,277,1,dim,1);
  label(frame.velocity.toFixed(3)+' m/s',65,294,2,dim);
  const mass = Math.round(698+frame.displacement*209);
  box(359,300,537,3,'#647b83');
  box(377,227,10,75,'#657d86');
  for (let x=415;x<=895;x+=40) box(x,305,2,8,'#486371');
  const coil = [[387,264]];
  for (let i=1;i<=16;i++) coil.push([387+(mass-387)*i/17,264+(i%2?11:-11)]);
  coil.push([mass,264]);
  line(coil,mint,3);
  box(mass,235,55,65,'#3c7e79');
  box(mass,235,55,4,mint);
  box(mass+7,246,41,46,'#2e625f');
  label('ENERGY '+frame.energy.toFixed(2)+' J',715,331,2,dim);

  box(44,393,912,228,'#152631');
  label('DISPLACEMENT',66,414,2,inkColor,1);
  label('TRACE',578,414,1,mint,1);
  box(557,419,12,2,mint);
  label('RESUMED SAMPLES',702,414,1,copper,1);
  box(685,417,6,6,copper);
  label('CHECKPOINT 0.95 s',timeX(pause)+10,442,1,copper,1);
  for (const position of [-0.8,0,0.8]) {
    box(plot.x,positionY(position),plot.w,1,'#37515b');
    label(position.toFixed(1)+' m',67,positionY(position)-4,1,dim);
  }
  for (let y=plot.y;y<=plot.y+plot.h;y+=9) box(timeX(pause),y,1,4,'#b78764');
  const curve = original.slice(0,frame.tick+1).map(row=>[timeX(row.tick),positionY(row.displacement)]);
  if (curve.length > 1) line(curve,mint,3);
  for (const row of restarted) {
    if (row.tick > frame.tick) break;
    if ((row.tick-pause)%12 !== 0 && row.tick !== lastTick) continue;
    box(timeX(row.tick)-2,positionY(row.displacement)-2,5,5,copper);
  }
  label('0 s',plot.x,594,1,dim);
  label('0.95 s',timeX(pause)-10,594,1,dim);
  label('3.00 s',plot.x+plot.w-36,594,1,dim);
  label(frame.time.toFixed(2)+' s / '+Math.max(0,frame.tick-pause+1)+' matched samples',491,632,2,inkColor);
  return PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands:marks,edges:'hard'}));
}

const out = path.resolve(process.argv[2] ?? 'studio/out/simulation-kernels');
fs.mkdirSync(out,{recursive:true});
const frames = original.filter(row => row.tick % 10 === 0).map(draw);
const still = frames.at(-1);
fs.writeFileSync(path.join(out,'kernel-checkpoint.png'),PNG.encodeFrame(still));
fs.writeFileSync(path.join(out,'kernel-checkpoint.apng'),PNG.encodeAnimation([...frames,...Array(8).fill(still)],10));
fs.writeFileSync(path.join(out,'spring.checkpoint.json'),JSON.stringify(checkpoint,null,2)+'\n');
const report = {checkpointTick:pause,lastTick,matchedSamples:restarted.length,final,
  buffers:checkpoint.states.solver.buffers,graphOutput:named.value};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report,null,2)+'\n');
