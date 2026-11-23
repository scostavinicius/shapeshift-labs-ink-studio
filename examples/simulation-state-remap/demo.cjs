const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {KIT:K}=require('../..').load(), PNG=require('../../cli/png.js');
const {discretization:D,stateRemap:R}=K.world;
const totalCp=4180, ambientDensity=980, ambientTemperature=9;
const wallBefore={id:'wall',normal:[1,0,-0.65],offset:4.4}, wallAfter={id:'wall',normal:[1,0,0.65],offset:6.1};
const grid=(id,refined,wall)=>D.compile({format:D.format,version:1,id,revision:1,units:'m',
  source:{kind:'grid',size:refined?[24,2,16]:[12,1,8],spacing:refined?0.25:0.5,cutPlanes:[wall]}});
const coarse=grid('coarse',false,wallBefore), fine=grid('refined',true,wallBefore), changed=grid('boundary-shift',true,wallAfter);
const mass=[],heat=[];
for(const {center:[x,_y,z],measure} of coarse.cells){
  const amount=measure*(940+12*x+5*z);
  const excess=9+24*Math.exp(-((x-4.6)**2+(z-2.8)**2)/2.4);
  mass.push(amount);
  heat.push(amount*totalCp*excess);
}
const initial={mass:{units:'kg',values:mass},heat:{units:'J',values:heat}};
const refined=R.transfer(coarse,fine,initial,{details:true});
const fill={mass:{...refined.channels.mass,initializeDensity:ambientDensity},
  heat:{...refined.channels.heat,initializeDensity:ambientDensity*totalCp*ambientTemperature}};
const shifted=R.transfer(fine,changed,fill,{details:true});
assert.equal(refined.ledger.mass.escaped,0);
assert.equal(refined.ledger.heat.initialized,0);
assert.ok(Math.abs(refined.ledger.mass.balanceError)<1e-8);
assert.ok(Math.abs(refined.ledger.heat.balanceError)<1e-4);
for(const row of Object.values(shifted.ledger)) {
  assert.ok(row.escaped>0&&row.initialized>0);
  assert.ok(Math.abs(row.balanceError)<1e-12*row.input);
}
assert.ok(Math.abs(shifted.ledger.mass.initialized-shifted.geometry.opened*ambientDensity)<1e-8);

const folder=path.resolve(process.argv[2]??'studio/out/state-remap');
fs.mkdirSync(folder,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(folder,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
for(const domain of [coarse,fine,changed])json(domain.id+'.compiled.json',domain);
for(const [name,source,target,channels,report] of [['refine',coarse,fine,initial,refined],['move',fine,changed,fill,shifted]]){
  json(name+'.plan.json',{format:R.format,version:1,source:source.id+'.compiled.json',target:target.id+'.compiled.json',
    channels,options:{details:true}});
  json(name+'.report.json',report);
}
json('comparison.json',{cells:[coarse.cells.length,fine.cells.length,changed.cells.length],
  refine:{geometry:refined.geometry,ledger:summary(refined)},move:{geometry:shifted.geometry,ledger:summary(shifted)}});

function summary(report) {
  return Object.fromEntries(Object.entries(report.ledger).map(([key,{escapedBySource,initializedByTarget,...row}])=>[key,row]));
}
function physical(channels){
  return channels.mass.values.map((amount,i)=>amount>0?channels.heat.values[i]/(totalCp*amount):0);
}
const stages=[
  {name:'01 / COARSE',description:'INITIAL STATE',mesh:coarse,channels:initial,tint:'#a5c5f1'},
  {name:'02 / REFINED',description:'SAME BOUNDARY',mesh:fine,channels:refined.channels,report:refined,tint:'#9be9bc'},
  {name:'03 / WALL MOVED',description:'SPACE CUT AND OPENED',mesh:changed,channels:shifted.channels,report:shifted,tint:'#ffc385'}
];
for(const row of stages)row.temperature=physical(row.channels);

const bg='#121e29', panel='#1b303c', paper='#edf2e5',dim='#b1c7ce',gridColor='#415966';
const cool='#a5c5f1', mint='#9be9bc', amber='#ffc385';
const palette=['#29445c','#375c76','#447984','#65928a','#95aa8a','#c9bd84','#f1ce87','#f4ae6c'];
const fixed=(n,digits=2)=>n.toFixed(digits);
const render=(width,height,commands)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    polygon:(points,fill)=>commands.push({type:'polygon',points,fill})};
}
function dashed(d,a,b,color) {
  for(let i=0;i<14;i+=2){
    const at=t=>a.map((v,j)=>v+(b[j]-v)*t);
    d.line([at(i/14),at((i+1)/14)],color,2);
  }
}
function tank(d,row,x,y,w,h,showChange=false) {
  const project=([u,_v,z])=>[x+w*u/6,y+h*z/4];
  d.rect(x,y,w,h,'#12242f');
  const {mesh,temperature}=row;
  for(const i of mesh.boundaries.wall.faces){
    const face=mesh.faces[i];
    if(face.origin.side!=='y1')continue;
    const poly=face.vertices.map(j=>project(mesh.vertices[j]));
    const index=Math.min(palette.length-1,Math.max(0,Math.round((temperature[face.owner]-9)/24*(palette.length-1))));
    d.polygon(poly,palette[index]);
    d.line([...poly,poly[0]],panel,1);
  }
  const cut=mesh.layout.cutPlanes[0].normal;
  const offset=mesh.layout.cutPlanes[0].offset;
  const originX=offset/cut[0], intersectionZ=(offset-6*cut[0])/cut[2];
  const p=[originX,0,0], q=[6,0,intersectionZ];
  if(cut[2]<0)d.line([project(p),project(q)],row.tint,2);
  else d.line([project(p),project(q)],amber,2);
  if(showChange){
    dashed(d,project([4.4,0,0]),project([6,0,(6-4.4)/0.65]),cool);
    const [nx,ny]=project([5.42,0,0.54]), [rx,ry]=project([5.07,0,3.68]);
    d.text('NEW',nx,ny,1,mint);
    d.text('OUT',rx,ry,1,amber);
  }
}
function kg(value){return fixed(value,2);}
function mj(value){return fixed(value/1e6,3);}
function board(){
  const d=drawing(),width=1180,height=838;
  d.rect(0,0,width,height,bg);
  d.rect(44,37,27,4,mint);
  d.text('INK STUDIO / SIMULATION',84,31,2,mint);
  d.text('Keep the mass. Track the heat.',41,63,5);
  d.text('CONSERVATIVE STATE TRANSFER / CUT-CELL TANK',45,127,2,dim);
  for(const [i,row] of stages.entries()){
    const x=44+i*366;
    d.rect(x,166,360,342,panel);
    d.text(row.name,x+18,187,2,row.tint);
    d.text(row.description,x+19,224,1,dim);
    tank(d,row,x+19,252,320,178,i===2);
    d.text(row.mesh.cells.length+' ACTIVE CELLS',x+19,456,1,dim);
    const report=row.report?.ledger.mass;
    const mass=report?.output??refined.ledger.mass.input;
    d.text(kg(mass)+' KG',x+19,478,2,row.tint);
  }
  d.rect(44,531,713,249,panel);
  d.text('AFTER WALL MOTION',64,550,2);
  for(const [i,[key,label,color]] of [['input','BEFORE',dim],['moved','RETAINED',mint],['escaped','ESCAPED',amber],
    ['initialized','INITIALIZED',cool],['output','AFTER',paper]].entries()){
    const y=608+i*29;
    d.text(label,66,y,1,color);
    d.text(kg(shifted.ledger.mass[key])+' KG',307,y-3,2,color);
    d.text(mj(shifted.ledger.heat[key])+' MJ',522,y-3,2,color);
  }
  d.text('MASS',307,579,1,dim);d.text('HEAT',522,579,1,dim);
  d.rect(773,531,363,249,panel);
  d.text('RESOLUTION CHANGE',791,550,2,mint);
  d.text('MASS ESCAPED / INITIALIZED',792,601,1,dim);
  d.text('0 / 0 KG',791,622,2);
  d.text('HEAT ESCAPED / INITIALIZED',792,663,1,dim);
  d.text('0 / 0 MJ',791,685,2);
  d.text('TEMPERATURE ABOVE REFERENCE',792,723,1,dim);
  for(const [i,color] of palette.entries())d.rect(792+i*25,740,25,8,color);
  d.text('9 K',792,757,1,dim);d.text('33 K',965,757,1,dim);
  d.text('EACH LEDGER CLOSES TO FLOATING-POINT PRECISION',44,814,1,mint);
  return render(width,height,d.commands);
}
function frame(stage,index){
  const d=drawing(),width=740,height=450;
  d.rect(0,0,width,height,bg);
  d.text(stage.name,25,25,3,stage.tint);
  d.text(stage.description,26,62,1,dim);
  d.rect(24,85,692,314,panel);
  tank(d,stage,91,105,552,255,index===2);
  d.text(stage.mesh.cells.length+' ACTIVE CELLS',40,374,1,dim);
  if(stage.report){
    const {mass}=stage.report.ledger;
    d.text('MOVED '+kg(mass.moved)+' KG',26,419,1,mint);
    d.text('ESCAPED '+kg(mass.escaped)+' KG',252,419,1,amber);
    d.text('INITIALIZED '+kg(mass.initialized)+' KG',470,419,1,cool);
  }
  return render(width,height,d.commands);
}
write('state-remap.png',PNG.encodeFrame(board()));
write('state-remap-playback.png',PNG.encodeAnimation(stages.map(frame),{numerator:2,denominator:3}));
