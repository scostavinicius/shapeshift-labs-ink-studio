const fs = require('node:fs');
const path = require('node:path');
const {KIT: K} = require('../..').load();
const {embedModels} = require('../../cli/simulation-model-files.js');
const PNG = require('../../cli/png.js');

const file = path.join(__dirname,'bench.world.json');
const run = K.world.runtime.create(embedModels(require(file),file));
const names = ['slow','fast'];
const closeTick = 16, lastTick = 36;
const plan = run.composition();
const gains = Object.fromEntries(names.map(name => [name,plan.systems[name].module.parameters.valveGain.value]));
const snapshot = () => {
  const {signals, tick, time} = run.view();
  return {tick,time,...Object.fromEntries(names.map(name => [name,
    Object.fromEntries(['supply','receiver','flow','valve'].map(port => [port,signals[name+'/'+port]]))]))};
};
const frames = [snapshot()];
run.advance(lastTick,{onTick() { frames.push(snapshot()); }});
const balance = Object.fromEntries(names.map(name => [name,run.query().probe(name+'/balance').value]));
if (frames[closeTick+1].fast.flow !== 0 || frames.at(-1).slow.receiver <= frames[closeTick].slow.receiver ||
    !Object.values(balance).every(row => Math.abs(row.error) < 1e-12))
  throw new Error('Expected independent valve closure and a balanced volume in each module');

const width = 1000, height = 670;
const ink = '#eff5f0', muted = '#9fbbc1', slow = '#74e5ca', fast = '#ffb677';
const colors = {slow,fast};
const plot = {x:111,y:497,w:816,h:105};
const xAt = tick => Math.round(plot.x + tick/lastTick*plot.w);
const yAt = volume => Math.round(plot.y + plot.h*(1-volume/0.4));

function draw(frame) {
  const commands = [];
  const rect = (x,y,w,h,fill) => commands.push({type:'rect',rect:[x,y,w,h],fill});
  const line = (points,color,width = 2) => commands.push({type:'path',points,stroke:color,width});
  const text = (label,x,y,scale = 2,color = ink,tracking = 0) =>
    commands.push({type:'text',text:String(label),at:[x,y],scale,color,tracking});
  rect(0,0,width,height,'#101a24');
  rect(44,38,28,4,slow);
  text('INK STUDIO / SIMULATION',86,32,2,slow,1);
  text('Reservoir bench',42,63,5);
  text('One reservoir module / two independent instances',45,116,2,muted);
  rect(44,151,912,1,'#38515e');

  function tank(x,y,volume,paint) {
    const h = Math.max(1,Math.round(volume*100));
    rect(x,y,108,104,'#415966');
    rect(x+2,y+2,104,100,'#111e29');
    rect(x+2,y+102-h,104,h,paint);
  }
  for (const [i,name] of names.entries()) {
    const x = 44 + i*466, color = colors[name], data = frame[name];
    rect(x,173,446,233,'#192b37');
    rect(x,173,446,2,color);
    text(name.toUpperCase()+' INSTANCE',x+20,190,2,color,1);
    text(Math.round(gains[name]*100)+'% gain',x+290,191,2,muted);
    tank(x+32,225,data.supply,'#49787d');
    tank(x+302,225,data.receiver,color);
    rect(x+140,271,162,12,'#405563');
    if (data.flow > 0) rect(x+140,275,162,4,color);
    rect(x+207,264,28,26,data.valve === 0 ? '#54606b' : color);
    rect(x+216,271,10,12,'#172733');
    text('SUPPLY',x+32,344,2,muted);
    text('RECEIVER',x+302,344,2,muted);
    text(data.supply.toFixed(3),x+32,373,2);
    text(data.receiver.toFixed(3),x+302,371,3,color);
    text(data.valve > 0 ? 'OPEN' : 'CLOSED',x+181,308,2,data.valve > 0 ? color : muted);
  }

  rect(44,428,912,206,'#152731');
  text('RECEIVER VOLUME',65,447,2,ink,1);
  text('world^3',65,470,1,muted);
  text('FAST CLOSE COMMAND',xAt(closeTick)+10,470,1,fast,1);
  for (const volume of [0,0.2,0.4]) {
    rect(plot.x,yAt(volume),plot.w,1,'#324a54');
    text(volume.toFixed(1),70,yAt(volume)-4,1,muted);
  }
  for (let y=plot.y; y<=plot.y+plot.h; y+=9) rect(xAt(closeTick),y,1,4,'#bb8d69');
  const visible = frames.slice(0,frame.tick+1);
  for (const name of names) {
    const points = visible.map(row => [xAt(row.tick),yAt(row[name].receiver)]);
    if (points.length > 1) line(points,colors[name],3);
    const [x,y] = points.at(-1);
    rect(x-3,y-3,7,7,colors[name]);
  }
  text('0 s',plot.x,612,1,muted);
  text('0.80 s',xAt(closeTick)-13,612,1,muted);
  text('1.80 s',plot.x+plot.w-36,612,1,muted);
  text('TICK '+String(frame.tick).padStart(2,'0')+'  /  '+frame.time.toFixed(2)+' s',730,447,2,muted);
  return PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
}

const out = path.resolve(process.argv[2] ?? 'studio/out/simulation-modules');
fs.mkdirSync(out,{recursive:true});
const animation = frames.filter(row => row.tick % 2 === 0).map(draw);
const final = animation.at(-1);
fs.writeFileSync(path.join(out,'reservoir-bench.png'),PNG.encodeFrame(final));
fs.writeFileSync(path.join(out,'reservoir-bench.apng'),PNG.encodeAnimation([...animation,...Array(8).fill(final)],10));
const report = {module:plan.systems.fast.module.id, revision:plan.systems.fast.module.revision, gains,
  closeTick, samples:frames, balance};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({directory:out,final:frames.at(-1),balance},null,2)+'\n');
