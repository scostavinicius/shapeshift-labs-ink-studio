const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const kit=require('../..').load(), PNG=require('../../cli/png.js');
const {KIT:K}=kit, {discretization:D,gridOperators:O}=K.world;
const folder=path.resolve(process.argv[2]??'studio/out/grid-operators');
fs.mkdirSync(folder,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(folder,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');

const width=10,height=3,velocity=[1.21,0,0],diffusivity=.021,duration=11;
const gridSize=[40,15], meshSize=[33,15];
const bounds=(min,max)=>({min:[...min,-.001],max:[...max,.001]});
const regions=[
  {tag:'dye-inlet',bounds:bounds([-.001,.9],[.001,2.1])},
  {tag:'clean-inlet',bounds:bounds([-.001,0],[.001,3])},
  {tag:'outlet',bounds:bounds([9.999,0],[10.001,3])}
];

function triangleMesh([nx,ny]){
  const positions=[],indices=[];
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
    const interior=i>0&&i<nx&&j>0&&j<ny;
    const x=i+(interior ? .24*Math.sin(i*1.7+j*2.69):0);
    const y=j+(interior ? .24*Math.sin(i*2.91-j*1.33):0);
    positions.push(x/nx*width,y/ny*height,0);
  }
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
    if((i+j)%2)indices.push(a,b,c,c,b,d);
    else indices.push(a,b,d,a,d,c);
  }
  return {kind:'mesh',positions,indices};
}
const boundary=value=>({
  'dye-inlet':{kind:'value',value},
  'clean-inlet':{kind:'open',inflow:0},
  outlet:{kind:'open'}
});
function source(id,description,kind){
  const domain=D.compile({format:D.format,version:1,id,revision:1,units:'m',source:kind,regions});
  const ops=O.prepare(domain);
  const carrierFlux=ops.flux(velocity,{location:'constant',boundary:boundary(1)});
  const values=new Float64Array(domain.cells.length);
  const {stableDt}=ops.diffusion(values,{diffusivity,boundary:boundary(1)});
  const polygons=domain.cells.map(cell=>[...new Set(cell.faces.flatMap(i=>domain.faces[i].vertices))]
    .map(i=>domain.vertices[i])
    .sort((a,b)=>Math.atan2(a[1]-cell.center[1],a[0]-cell.center[0])-Math.atan2(b[1]-cell.center[1],b[0]-cell.center[0])));
  json(id+'.compiled.json',domain);
  return {id,description,domain,ops,values,carrierFlux,stableDt,polygons,frames:[],
    peakDivergence:Math.max(...Array.from(ops.divergence(carrierFlux),Math.abs))};
}
const benches=[
  source('channel-grid','REGULAR GRID',{kind:'grid',size:gridSize,spacing:[width/gridSize[0],height/gridSize[1]]}),
  source('channel-mesh','SKEWED TRIANGLE MESH',triangleMesh(meshSize))
];

const clipLimit=Math.min(...benches.map(row=>row.ops.transport(row.values,{dt:row.stableDt*.1,boundary:boundary(1),
  carrierFlux:row.carrierFlux,diffusivity}).stableDt));
const frameCount=32, steps=Math.ceil(duration/(clipLimit*.87)), dt=duration/steps;
const captureAt=new Set(Array.from({length:frameCount},(_,i)=>Math.round(i*steps/(frameCount-1))));

function simulate(row){
  const tally={in:0,out:0,maxStepError:0}, frames=row.frames;
  let values=row.values, last=0;
  const capture=step=>frames.push({time:step*dt,values:values.slice(),total:last,...tally});
  capture(0);
  for(let i=0;i<steps;i++){
    const settings={dt,diffusivity,carrierFlux:row.carrierFlux,boundary:boundary(i*dt<2.7?1:0)};
    const result=row.ops.transport(values,settings);
    if(i===0){
      const plan={format:O.planFormat,version:1,operation:'transport',domain:row.id+'.compiled.json',
        values:Array.from(values),boundary:settings.boundary,settings:{dt,diffusivity,velocity,location:'constant'}};
      json(row.id+'.transport.plan.json',plan);
      const cli=require('../../cli/grid-operators.js').run(kit,plan,path.join(folder,row.id+'.transport.plan.json'));
      assert.deepEqual(cli.result.values,Array.from(result.values));
      json(row.id+'.transport.report.json',cli);
    }
    values=result.values;
    last=result.ledger.after;
    for(const amount of Object.values(result.ledger.boundary)){
      tally.in+=amount.in;
      tally.out+=amount.out;
    }
    tally.maxStepError=Math.max(tally.maxStepError,Math.abs(result.ledger.error));
    if(captureAt.has(i+1))capture(i+1);
  }
  row.summary={cells:row.domain.cells.length,faces:row.domain.faces.length,carrierDivergence:row.peakDivergence,
    initial:0,retained:last,entered:tally.in,exited:tally.out,balanceError:last-tally.in+tally.out,
    largestStepError:tally.maxStepError};
  assert.ok(row.peakDivergence<1e-12&&Math.abs(row.summary.balanceError)<1e-10);
  assert.ok(row.summary.exited>0&&values.every(v=>v>=-1e-12&&v<=1+1e-12));
}
benches.forEach(simulate);
json('channel-transport-comparison.json',{dt,steps,stableDt:clipLimit,duration,diffusivity,velocity,
  results:Object.fromEntries(benches.map(row=>[row.id,row.summary]))});

const bg='#10202b', panel='#192e3c', pit='#132632', ink='#ecf0db', dim='#a9c2ce',
  mint='#92efba', gold='#ffcc87', blue='#8fc6f2', edge='#314654';
const ramp=['#1a3344','#25465e','#225d72','#247986','#33978c','#55ad87','#82ca88','#b6d588','#e4db90','#ffe3a2'];
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=ink)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    polygon:(points,fill)=>commands.push({type:'polygon',points,fill})};
}
const pack=(d,w,h)=>PNG.packRGBA(K.procedural.drawing2d.render({width:w,height:h,commands:d.commands,edges:'hard'}));
const n3=value=>value.toFixed(3);
function channel(d,row,frame,x,y,w,h){
  const draw=([u,v])=>[x+u/width*w,y+(height-v)/height*h];
  d.rect(x,y,w,h,ramp[0]);
  for(const [i,polygon] of row.polygons.entries()){
    const shade=Math.round(Math.min(1,Math.max(0,frame.values[i]))*(ramp.length-1));
    d.polygon(polygon.map(draw),ramp[shade]);
  }
  for(const face of row.domain.faces){
    if(face.neighbor!==null){
      if(frame.values[face.owner]<.015&&frame.values[face.neighbor]<.015&&face.id%2===0)
        d.line(face.vertices.map(i=>draw(row.domain.vertices[i])),edge,1);
    }else{
      const color=face.region==='dye-inlet'?mint:face.region==='outlet'?gold:edge;
      d.line(face.vertices.map(i=>draw(row.domain.vertices[i])),color,2);
    }
  }
}
function legend(d,x,y){
  for(const [i,color] of ramp.entries())d.rect(x+i*17,y,17,9,color);
  d.text('0',x,y+14,1,dim);
  d.text('1',x+161,y+14,1,dim);
}
function board(){
  const d=drawing(), w=1236,h=788, preview=16;
  d.rect(0,0,w,h,bg);
  d.rect(39,33,30,4,mint);
  d.text('INK STUDIO / PHYSICAL SIMULATION',82,28,2,mint);
  d.text('One pulse, two discretizations',37,59,5,ink);
  d.text('CONSERVATIVE ADVECTION AND DIFFUSION / A TAGGED CHANNEL',41,119,2,dim);
  for(const [i,row] of benches.entries()){
    const x=40+i*583,y=159, sample=row.frames[preview], finish=row.frames.at(-1);
    d.rect(x,y,573,548,panel);
    d.text(row.description,x+17,y+20,2,i?blue:mint);
    d.text(row.summary.cells+' CELLS / '+row.summary.faces+' ORIENTED FACES',x+17,y+48,1,dim);
    channel(d,row,sample,x+18,y+76,536,162);
    d.text('PULSE IN TRANSIT / '+sample.time.toFixed(2)+' S',x+18,y+248,1,dim);
    channel(d,row,finish,x+18,y+273,536,125);
    d.text('LATE OUTFLOW / '+finish.time.toFixed(2)+' S',x+18,y+411,1,gold);
    d.rect(x+17,y+438,538,91,pit);
    for(const [j,[name,value]] of [['ENTERED',row.summary.entered],['STORED',row.summary.retained],['EXITED',row.summary.exited]].entries()){
      d.text(name,x+29+j*172,y+452,1,dim);
      d.text(n3(value),x+29+j*172,y+473,2,j===2?gold:mint);
    }
    d.text('BALANCE ERROR  '+Math.abs(row.summary.balanceError).toExponential(2),x+29,y+508,1,dim);
  }
  d.text('DYE CONCENTRATION',40,736,1,dim);
  legend(d,199,731);
  d.text('MINT EDGE / DYE INLET',459,737,1,mint);
  d.text('GOLD EDGE / OPEN OUTLET',668,737,1,gold);
  d.text('UNMARKED WALLS ARE SEALED',907,737,1,dim);
  return pack(d,w,h);
}
write('grid-mesh-transport.png',PNG.encodeFrame(board()));

const frames=Array.from({length:frameCount},(_,i)=>{
  const d=drawing(), w=852,h=287, a=benches[0].frames[i];
  d.rect(0,0,w,h,bg);
  d.text('CHANNEL DYE PULSE',26,19,2,ink);
  d.text(a.time.toFixed(2)+' S',700,22,2,mint);
  for(const [j,row] of benches.entries()){
    const x=25+j*406, f=row.frames[i];
    d.rect(x,55,397,180,panel);
    d.text(row.description,x+10,67,1,j?blue:mint);
    channel(d,row,f,x+10,87,377,113);
    d.text('STORED '+n3(f.total)+'   EXITED '+n3(f.out),x+10,214,1,dim);
  }
  legend(d,27,251);
  d.text('CHANNEL WIDTH 10 M / FLOW 1.21 M/S',474,253,1,dim);
  return pack(d,w,h);
});
write('channel-dye-pulse.apng',PNG.encodeAnimation(frames,10));
