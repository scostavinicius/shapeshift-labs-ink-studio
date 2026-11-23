const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const kit=require('../..').load(), PNG=require('../../cli/png.js');
const {KIT:K}=kit, N=K.world.lumpedNetworks;
const cli=require('../../cli/lumped-network.js');
const out=path.resolve(process.argv[2]??'studio/out/lumped-networks');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const seconds=5, frames=81, samples=Array.from({length:frames},(_,i)=>seconds*i/(frames-1));
const numerics={method:'adaptive',step:.02,maxStep:.10,absoluteTolerance:1e-12,relativeTolerance:1e-10};
const network=(id,parts)=>({format:N.format,version:1,id,revision:1,numerics,...parts});
const hydraulics=network('hydraulic-circuit',{
  units:{effort:'Pa',flow:'L/s'},inputs:{supply:{default:0,quantity:{unit:'Pa'}},makeup:{default:0,quantity:{unit:'L/s'}}},
  nodes:{
    supply:{kind:'reference',effort:{input:'supply'}},tee:{kind:'junction'},
    chamber:{kind:'storage',capacity:.53},buffer:{kind:'storage',capacity:.86},ground:{kind:'reference'}
  },
  elements:{
    feed:{kind:'resistor',from:'supply',to:'tee',resistance:.52},
    line:{kind:'inertance',from:'tee',to:'chamber',inertance:.63,resistance:.14},
    bleed:{kind:'resistor',from:'tee',to:'ground',resistance:6},
    load:{kind:'resistor',from:'chamber',to:'ground',resistance:3.8},
    transfer:{kind:'resistor',from:'chamber',to:'buffer',resistance:2.8},
    drain:{kind:'resistor',from:'buffer',to:'ground',resistance:5.2},
    makeup:{kind:'flow-source',from:'ground',to:'buffer',flow:{input:'makeup'}}
  },
  outputs:{pressure:{node:'chamber'},reserve:{node:'buffer'},flow:{element:'line'},residual:{ledger:'junctionResidual'}}
});
const commands=[
  {time:.375,inputs:{supply:2.6}},{time:1.30,inputs:{makeup:.46}},{time:2.60,inputs:{supply:.35}},
  {time:3.65,inputs:{makeup:0}},{time:4.10,inputs:{supply:0}}
];
const mechanical=(id,damping)=>network(id,{
  units:{effort:'m/s',flow:'N'},
  nodes:{ground:{kind:'reference'},cart:{kind:'storage',capacity:1.4}},
  elements:{spring:{kind:'spring',from:'cart',to:'ground',stiffness:12,initialDisplacement:.76},
    damper:{kind:'damper',from:'cart',to:'ground',damping}},
  outputs:{position:{element:'spring',measure:'displacement',quantity:{unit:'m'}},
    velocity:{node:'cart'},springForce:{element:'spring'},loss:{ledger:'dissipated'}}
});
function run(asset,commands=[]){
  const file=asset.id+'.network.json', plan=asset.id+'.run.json';
  json(file,asset);
  const definition={format:N.runFormat,version:1,network:file,samples,commands};
  json(plan,definition);
  const trace=cli.run(kit,definition,path.join(out,plan));
  json(asset.id+'.trace.json',trace);
  return trace.results;
}
const water=run(hydraulics,commands), light=run(mechanical('light-damper',.35)), heavy=run(mechanical('heavy-damper',2.8));
let phase=0;
const phases=water.map((row,i)=>{
  if(i){
    const previous=water[i-1];
    phase+=(row.time-previous.time)*(row.outputs.flow+previous.outputs.flow)*.5;
  }
  return phase;
});
const minFlow=Math.min(...water.map(row=>row.outputs.flow)), peakPressure=Math.max(...water.map(row=>row.outputs.pressure));
const junctionError=Math.max(...water.map(row=>row.ledger.junctionResidual));
const balance=Math.max(...[...water,...light,...heavy].map(row=>Math.abs(row.ledger.balance)));
assert.ok(minFlow<-.1&&junctionError<1e-12&&balance<1e-6);
assert.ok(heavy.at(-1).ledger.dissipated>light.at(-1).ledger.dissipated);
json('comparison.json',{hydraulic:{minimumLineFlow:minFlow,peakChamberPressure:peakPressure,
  junctionResidual:junctionError,ledger:water.at(-1).ledger},
  oscillator:{light:light.at(-1).ledger,heavy:heavy.at(-1).ledger},maximumBalanceError:balance});

const bg='#10202b', panel='#1b303d', well='#142632', grid='#395361', paper='#eff1db', dim='#a3bec8',
  blue='#88bcf0', mint='#84e7b8', amber='#ffbd7d', lilac='#ceb8fb';
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})};
}
const pack=(d,width,height)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands:d.commands,edges:'hard'}));
const exp=n=>n.toExponential(1).toUpperCase();
const f=(n,k=2)=>n.toFixed(k);

function diagram(d,row,phase,x,y,w,h){
  const at=([u,v])=>[x+u*w,y+v*h];
  const route=(points,color,width=2)=>d.line(points.map(at),color,width);
  const box=(a,b,c,e,color)=>d.rect(...at([a,b]),c*w,e*h,color);
  const text=(label,a,b,color)=>d.text(label,...at([a,b]),1,color);
  box(0,0,1,1,well);
  route([[.12,.38],[.80,.38],[.87,.61],[.87,.77],[.14,.77],[.14,.41]],grid,3);
  route([[.33,.38],[.33,.77]],grid,2);
  route([[.60,.38],[.60,.77]],grid,2);
  const flow=row.outputs.flow;
  for(let i=0;i<8;i++){
    const t=((i/8+phase*.85)%1+1)%1;
    box(.34+t*.245,.374,.009,.022,flow>=0?mint:amber);
  }
  for(const [side,p,c] of [[.56,row.outputs.pressure,mint],[.80,row.outputs.reserve,blue]]){
    box(side,.24,.115,.30,grid);
    box(side+.008,.257,.099,.266,well);
    const level=Math.min(1,Math.max(0,p/3))*.26;
    if(level>0)box(side+.008,.522-level,.099,level,c);
  }
  box(.06,.28,.12,.20,blue);
  text('DRIVE',.065,.135,blue);
  text('INERTANCE',.352,.258,dim);
  text('CHAMBER',.544,.086,mint);
  text('BUFFER',.791,.086,blue);
  text('BLEED',.286,.84,dim);
  text('RETURN',.774,.84,dim);
  box(.322,.355,.022,.050,paper);
}

function rail(d,a,b,x,y,w,h){
  d.rect(x,y,w,h,well);
  const draw=(row,i,tint)=>{
    const mid=y+(i+.52)*h/2, mark=x+w*(.59+.21*row.outputs.position);
    const start=x+w*.17;
    d.line([[x+w*.08,mid+h*.136],[x+w*.92,mid+h*.136]],grid,2);
    d.line([[start,mid-h*.095],[start,mid+h*.135]],dim,3);
    const spring=Array.from({length:17},(_,k)=>{
      const t=k/16;
      return [start+t*(mark-14-start),mid+(k%2?1:-1)*h*.029*Number(k!==0&&k!==16)];
    });
    d.line(spring,tint,2);
    d.rect(mark-13,mid-h*.051,26,h*.17,tint);
    d.text(i?'HIGH DAMPING':'LOW DAMPING',x+w*.72,mid-h*.15,1,tint);
  };
  draw(a,0,blue);
  draw(b,1,amber);
}

function chart(d,x,y,w,h,lo,hi,lines,markers=[]){
  d.rect(x,y,w,h,well);
  const at=([t,v])=>[x+12+t/seconds*(w-26),y+11+(hi-v)/(hi-lo)*(h-26)];
  for(const t of [0,1,2,3,4,5]){
    const [u]=at([t,0]);
    d.line([[u,y+8],[u,y+h-15]],grid);
    d.text(String(t),u-2,y+h-10,1,dim);
  }
  if(lo<=0&&hi>=0){
    const v=at([0,0])[1];
    d.line([[x+9,v],[x+w-11,v]],dim);
  }
  for(const t of markers){
    const u=at([t,0])[0];
    d.line([[u,y+8],[u,y+h-15]],amber);
  }
  for(const [rows,value,color] of lines)d.line(rows.map(row=>at([row.time,value(row)])),color,2);
}

function board(){
  const d=drawing(), width=1256,height=814;
  d.rect(0,0,width,height,bg);d.rect(40,36,28,4,mint);
  d.text('INK STUDIO / PHYSICAL SIMULATION',81,31,2,mint);
  d.text('From pressure to motion',39,65,5,paper);
  d.text('THE SAME EFFORT AND FLOW PRIMITIVES IN TWO SYSTEMS',43,130,2,dim);
  const y=169, w=572,h=580, a=42,b=638;
  d.rect(a,y,w,h,panel);d.rect(b,y,w,h,panel);
  d.text('HYDRAULIC CIRCUIT',a+17,y+21,3,mint);
  d.text('RESISTORS / INERTANCE / STORAGE / SOURCES',a+18,y+63,1,dim);
  diagram(d,water[42],phases[42],a+18,y+87,w-36,181);
  d.text('CHAMBER PRESSURE',a+18,y+289,1,mint);
  d.text('SIGNED LINE FLOW',a+183,y+289,1,blue);
  d.text('SOURCE STEP',a+342,y+289,1,amber);
  chart(d,a+18,y+313,w-36,169,-1.6,3.6,[[water,r=>r.outputs.pressure,mint],[water,r=>r.outputs.flow,blue]],[.375,2.6]);
  d.text('PEAK PRESSURE '+f(peakPressure)+' PA',a+18,y+509,2,mint);
  d.text('LINE REVERSED TO '+f(minFlow)+' L/S',a+18,y+541,1,dim);

  d.text('SPRING DAMPER BENCH',b+17,y+21,3,amber);
  d.text('STORAGE AS MASS / TWO DAMPER COEFFICIENTS',b+18,y+63,1,dim);
  rail(d,light[37],heavy[37],b+18,y+87,w-36,181);
  d.text('POSITION / LOW DAMPING',b+18,y+289,1,blue);
  d.text('POSITION / HIGH DAMPING',b+239,y+289,1,amber);
  chart(d,b+18,y+313,w-36,169,-.9,.9,[[light,r=>r.outputs.position,blue],[heavy,r=>r.outputs.position,amber]]);
  d.text('ENERGY LOST AT 5 S',b+18,y+507,2,paper);
  d.text(f(light.at(-1).ledger.dissipated)+' J LOW',b+18,y+541,1,blue);
  d.text(f(heavy.at(-1).ledger.dissipated)+' J HIGH',b+196,y+541,1,amber);
  d.text('MAX JUNCTION IMBALANCE '+exp(junctionError)+' L/S',43,778,1,mint);
  d.text('MAX ENERGY BALANCE RESIDUAL '+exp(balance)+' IN AUTHORED UNITS',627,778,1,lilac);
  return pack(d,width,height);
}
write('lumped-network-comparison.png',PNG.encodeFrame(board()));

const movie=Array.from({length:41},(_,i)=>{
  const d=drawing(), width=852,height=408, index=i*2, run=water[index];
  d.rect(0,0,width,height,bg);
  d.text('LUMPED NETWORKS IN MOTION',23,21,2,paper);
  d.text(f(run.time)+' S',711,21,2,mint);
  for(const [j,label] of ['HYDRAULIC PRESSURE','MECHANICAL DAMPING'].entries()){
    const x=21+j*407;
    d.rect(x,58,398,313,panel);
    d.text(label,x+12,72,1,j?amber:mint);
    if(j){
      rail(d,light[index],heavy[index],x+12,103,374,171);
      d.text('LOW '+f(light[index].outputs.position)+' M',x+13,297,1,blue);
      d.text('HIGH '+f(heavy[index].outputs.position)+' M',x+13,326,1,amber);
    }else{
      diagram(d,run,phases[index],x+12,103,374,171);
      d.text('CHAMBER '+f(run.outputs.pressure)+' PA',x+13,297,1,mint);
      d.text('SIGNED FLOW '+f(run.outputs.flow)+' L/S',x+13,326,1,run.outputs.flow>=0?blue:amber);
    }
  }
  d.text('FLOW CAN REVERSE. DAMPING CONVERTS STORED MOTION INTO DISSIPATION.',23,385,1,dim);
  return pack(d,width,height);
});
write('lumped-networks.apng',PNG.encodeAnimation(movie,10));
