const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {KIT:K}=require('../..').load(), PNG=require('../../cli/png.js');
const world=require('./bench.world.json'), run=K.world.runtime.create(world);
const tracks=[], total=180;
function record({tick,states,signals}) {
  tracks.push({tick,time:tick*world.dt,...states.gauge.seat,
    flow:signals['pipes/flow.seat'],inlet:signals['pipes/head.inlet'],outlet:signals['pipes/head.outlet']});
}
record(run.view());
run.advance(total,{onTick:record});
const cards=[{name:'OPEN',row:tracks[18],color:'#99edc0'},
  {name:'NEARLY CLOSED',row:tracks[64],color:'#ffc48b'},
  {name:'SEALED',row:tracks[85],color:'#a7c8ff'}];
const [open,near,sealed]=cards.map(card=>card.row);
assert.equal(near.status,'open');
assert.ok(near.aperture>0&&near.aperture<open.aperture/100&&near.flow>0);
assert.equal(sealed.status,'sealed');
assert.equal(sealed.flow,0);
assert.ok(sealed.inlet>sealed.outlet);
const balance=run.query().probe('pipes/mass').value;
assert.ok(Math.abs(balance.error)<1e-10);
const folder=path.resolve(process.argv[2]??'studio/out/moving-boundaries');
fs.mkdirSync(folder,{recursive:true});
const write=(file,value)=>fs.writeFileSync(path.join(folder,file),value);
const json=(file,value)=>write(file,JSON.stringify(value,null,2)+'\n');
json('bench.world.json',world);
json('report.json',{dt:world.dt,assumedMetersPerUnit:1,stations:{open,near,sealed},
  events:run.history.filter(row=>row.kind==='boundary-sealed'||row.kind==='boundary-opened'),
  balance,trace:tracks});

const navy='#111c26',panel='#1c303b',ink='#eff2e7',dim='#9db7c0',grid='#415d68';
const mint=cards[0].color,gold=cards[1].color,blue=cards[2].color,brass='#c48759',pipe='#527584';
const fixed=(n,places=2)=>n.toFixed(places), scientific=n=>n===0?'0':n.toExponential(2).toUpperCase();
const render=(width,height,commands)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    text:(text,x,y,scale=2,color=ink)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color})};
}
function cross(d,x,y,w,row,accent){
  const lip=y+79, left=x+w*0.25, right=x+w*0.75, center=x+w/2;
  const gap=row.status==='sealed'?0:Math.max(2,Math.round(row.maxGap*345));
  const underside=lip-gap;
  d.rect(left-35,lip,35,45,pipe);
  d.rect(right,lip,35,45,pipe);
  d.rect(left-35,lip,35,2,dim);
  d.rect(right,lip,35,2,dim);
  d.rect(left-11,underside-14,right-left+22,14,brass);
  d.rect(left-11,underside-14,right-left+22,2,gold);
  d.rect(center-5,underside-36,10,22,brass);
  if(gap>0){
    d.rect(left-10,underside,10,gap,accent);
    d.rect(right,underside,10,gap,accent);
    const brush=gap>=12?3:1;
    d.line([[left-49,lip+19],[left-49,underside+gap/2],[left+21,underside+gap/2]],accent,brush);
    d.line([[left+17,underside+gap/2-3],[left+21,underside+gap/2],[left+17,underside+gap/2+3]],accent,brush);
  }else{
    d.rect(left-10,lip,10,2,gold);
    d.rect(right,lip,10,2,gold);
  }
}
function board(){
  const d=drawing(),w=1180,h=864;
  d.rect(0,0,w,h,navy);
  d.rect(44,38,27,4,mint);
  d.text('INK STUDIO / SIMULATION',82,32,2,mint);
  d.text('The last quarter millimetre',42,65,5);
  d.text('POPPET VALVE / SOCKET MOTION DRIVES PIPE FLOW',45,126,2,dim);
  for(const [i,{name,row,color}] of cards.entries()){
    const x=44+i*366;
    d.rect(x,166,360,335,panel);
    d.text(name,x+20,189,2,color);
    d.text('TICK '+row.tick,x+20,223,1,dim);
    cross(d,x+20,239,320,row,color);
    d.text('GAP',x+20,397,1,dim);
    d.text('APERTURE',x+151,397,1,dim);
    d.text('PIPE FLOW',x+249,397,1,dim);
    d.text(fixed(1000*row.maxGap)+' MM',x+20,420,2,ink);
    d.text(scientific(row.aperture),x+151,420,1,color);
    d.text(scientific(row.flow),x+249,420,1,color);
    d.text('M2',x+151,446,1,dim);
    d.text('M3/S',x+249,446,1,dim);
    d.text('DISPLACED '+fixed(1000*row.displacedVolume,3)+' L',x+20,473,1,color);
  }
  d.rect(44,522,1092,289,panel);
  d.text('APERTURE, PIPE FLOW AND DISPLACED VOLUME',65,544,2);
  const legend=[['APERTURE',mint],['FLOW',gold],['DISPLACED VOLUME',blue]];
  for(const [i,[name,color]] of legend.entries())d.text(name,67+i*174,575,1,color);
  const marks=[['aperture',mint],['flow',gold],['displacedVolume',blue]];
  const x=t=>83+988*t/total, y=u=>754-139*u;
  for(const q of [0,0.5,1])d.rect(83,y(q),988,1,grid);
  for(const {row,color} of cards)d.rect(x(row.tick),615,1,139,color);
  for(const [key,color] of marks){
    const max=Math.max(...tracks.map(row=>row[key]));
    d.line(tracks.map(row=>[x(row.tick),y(Math.max(0,row[key]/max))]),color,2);
  }
  for(const second of [0,1,2,3])d.text(second+' S',x(second/world.dt)-7,767,1,dim);
  d.text('EACH TRACE NORMALIZED TO ITS OWN PEAK',68,791,1,dim);
  d.text('THE OPEN GAP IS ENLARGED IN THE CUTAWAY FOR READABILITY',44,836,1,mint);
  return render(w,h,d.commands);
}

function animation(row){
  const d=drawing(), w=760,h=384;
  const accent=row.status==='sealed'?blue:row.maxGap<0.001?gold:mint;
  const label=row.status==='sealed'?'SEALED':row.maxGap<0.001?'NEARLY CLOSED':'OPEN';
  d.rect(0,0,w,h,navy);
  d.text('POPPET VALVE',23,22,4);
  d.text('TIME '+fixed(row.time)+' S',25,69,1,dim);
  d.text(label,525,66,2,accent);
  d.rect(24,93,712,192,panel);
  cross(d,175,124,410,row,accent);
  d.rect(24,306,712,54,panel);
  for(const [i,[key,value]] of [['GAP / MM',fixed(1000*row.maxGap)],['APERTURE / M2',scientific(row.aperture)],
    ['FLOW / M3 S',scientific(row.flow)],['DISPLACED / L',fixed(1000*row.displacedVolume,3)]].entries()){
    const x=39+i*173;
    d.text(key,x,315,1,dim);
    d.text(value,x,337,2,accent);
  }
  return render(w,h,d.commands);
}
write('valve-cutaway.png',PNG.encodeFrame(board()));
write('valve-playback.png',PNG.encodeAnimation(tracks.filter(row=>row.tick%3===0).map(animation),20));
