const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {KIT:K}=require('./ink-studio.config.js').load();
const PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const source=require('./reed.world.json');
const W=K.world, sampleRate=Math.round(1/source.dt), count=sampleRate*1.5;
const explicit=JSON.parse(JSON.stringify(source));
explicit.systems.feedback.config.iteration={maxIterations:1,relaxation:1,onLimit:'accept'};

function trace(world) {
  const run=W.runtime.create(world), pressure=new Float64Array(count), opening=new Float64Array(count);
  const residual=new Float64Array(count), audio=new Float64Array(count);
  const tally={converged:0,limited:0,maxIterations:0,maxResidualRatio:0,maxMassDrift:0,maxImpulseDrift:0};
  let previous=run.view().states;
  run.advance(count,{onTick({tick,states,transfers}) {
    const {mouth,bore,reed,feedback}=states, i=tick-1;
    pressure[i]=bore.pressure;
    opening[i]=reed.opening;
    audio[i]=bore.pressure-bore.dc;
    residual[i]=feedback.residualRatio;
    tally[feedback.status==='converged'?'converged':'limited']++;
    tally.maxIterations=Math.max(tally.maxIterations,feedback.iterations);
    tally.maxResidualRatio=Math.max(tally.maxResidualRatio,feedback.residualRatio);
    tally.maxMassDrift=Math.max(tally.maxMassDrift,
      Math.abs((mouth.postedMass-previous.mouth.mass)+(bore.postedMass-previous.bore.mass)));
    tally.maxImpulseDrift=Math.max(tally.maxImpulseDrift,
      Math.abs((mouth.momentum-previous.mouth.momentum)+(reed.postedMomentum-previous.reed.momentum)));
    assert.ok((transfers?.length??0)<=2,'Only the chosen exchanges should reach the ledger');
    previous=states;
  }});
  const ordered=Array.from(residual).sort((a,b)=>a-b);
  tally.p95ResidualRatio=ordered[Math.floor(0.95*ordered.length)];
  return {audio,pressure,opening,residual,tally};
}

const single=trace(explicit), coupled=trace(source);
assert.equal(coupled.tally.converged,count);
assert.ok(single.tally.limited>count/2);
assert.ok(coupled.tally.maxMassDrift<1e-16 && coupled.tally.maxImpulseDrift<1e-17);
const out=path.resolve(process.argv[2]??'studio/out/simulation-transfer-coupling');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
let peak=0;
for (const clip of [single,coupled]) for (const value of clip.audio) peak=Math.max(peak,Math.abs(value));
for (const [name,clip] of [['one-pass',single],['two-way',coupled]]) {
  const samples=clip.audio.map((value,i)=>0.78*value/peak*Math.min(1,i/240,(count-1-i)/420));
  write(name+'.wav',WAV.encode({sampleRate,channels:1,samples}));
}
write('report.json',JSON.stringify({sampleRate,count,convergenceThreshold:1,
  onePass:single.tally,twoWay:coupled.tally},null,2)+'\n');

const width=1180,height=850, commands=[];
const bg='#121d27',panel='#1c303c',ink='#f1f3e8',dim='#b2c9d0',grid='#49606a';
const mint='#99edbf',gold='#ffc184',blue='#a3cefd';
const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
const text=(label,x,y,scale=2,color=ink)=>commands.push({type:'text',text:label,at:[x,y],scale,color});
const line=(points,stroke,width=2)=>commands.push({type:'path',points,stroke,width});
const arrow=(a,b,y,color)=>{
  line([[a,y],[b,y]],color,3);
  const direction=Math.sign(b-a);
  line([[b-8*direction,y-6],[b,y],[b-8*direction,y+6]],color,3);
};
rect(0,0,width,height,bg);
rect(44,39,25,4,mint);
text('INK STUDIO / SIMULATION',82,33,2,mint);
text('Pressure meets the reed',42,66,5);
text('TWO-WAY COUPLING / 12 KHZ WORLD',45,128,2,dim);

rect(44,168,1092,174,panel);
const nodes=[{x:68,title:'MOUTH',detail:'AIR PRESSURE'},
  {x:470,title:'REED',detail:'OPENING'},
  {x:866,title:'BORE',detail:'OUTLET PRESSURE'}];
for (const {x,title,detail} of nodes) {
  rect(x,195,246,76,'#2a4450');
  text(title,x+14,208,2,ink);
  text(detail,x+14,240,1,dim);
}
arrow(323,456,234,gold);
text('IMPULSE',351,211,1,gold);
arrow(727,849,234,mint);
text('GATES FLOW',744,211,1,mint);
line([[1073,281],[1073,309],[93,309],[93,284]],blue,2);
line([[88,291],[93,284],[98,291]],blue,2);
text('BORE PRESSURE FEEDS BACK INTO THE PRESSURE DROP',328,319,1,blue);

rect(44,357,1092,307,panel);
text('BORE PRESSURE AND REED OPENING',63,378,2);
text('ONE PASS',779,378,2,gold);
text('ITERATED',949,378,2,mint);
const x0=112,x1=1092, from=2508,to=2892;
const x=i=>x0+(x1-x0)*(i-from)/(to-from);
const tickLabels=[[420,'PA'],[558,'GAP']];
for (const [y,unit] of tickLabels) text(unit,64,y,1,dim);
for (let ms=0;ms<=32;ms+=8) {
  const at=x(from+ms*sampleRate/1000);
  rect(Math.round(at),410,1,223,grid);
  text(String(ms)+' MS',Math.round(at)-(ms===32?24:8),641,1,dim);
}
for (const y of [429,463,497,550,589,628]) rect(x0,y,x1-x0,1,grid);
let pMax=0, gapMin=1, gapMax=0;
for (const clip of [single,coupled]) for (let i=from;i<=to;i++) {
  pMax=Math.max(pMax,clip.pressure[i]);
  gapMin=Math.min(gapMin,clip.opening[i]); gapMax=Math.max(gapMax,clip.opening[i]);
}
function draw(clip,color,stroke) {
  line(Array.from({length:to-from+1},(_,j)=>[x(from+j),510-83*clip.pressure[from+j]/pMax]),color,stroke);
  line(Array.from({length:to-from+1},(_,j)=>[x(from+j),624-71*(clip.opening[from+j]-gapMin)/(gapMax-gapMin)]),color,stroke);
}
draw(single,gold,2);
draw(coupled,mint,3);

const k=n=>n.toLocaleString('en-US');
const stats=[
  ['ONE PASS',k(Math.round(single.tally.p95ResidualRatio))+' X','P95 RESIDUAL / TOLERANCE',gold],
  ['ITERATED',coupled.tally.p95ResidualRatio.toFixed(2)+' X','P95 RESIDUAL / TOLERANCE',mint],
  ['CONVERGED',k(coupled.tally.converged)+' / '+k(count),'PEAK ITERATIONS  '+coupled.tally.maxIterations+' OF 16',blue]
];
for (const [i,[title,value,detail,color]] of stats.entries()) {
  const left=44+i*367;
  rect(left,682,358,117,panel);
  text(title,left+16,695,2,color);
  text(value,left+16,723,3,ink);
  text(detail,left+16,766,1,dim);
}
text('RESIDUAL AT OR BELOW 1 X MEETS TOLERANCE',46,823,1,dim);
write('reed-coupling.png',PNG.encodeFrame(PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}))));
