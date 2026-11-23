const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const {KIT:K}=require('../..').load();
const PNG=require('../../cli/png.js');
const authored=require('./channel.plan.json'), mesh=K.world.discretization.compile(authored);
const count=mesh.cells.length;
const diagonal=new Float64Array(count), forcing=new Float64Array(count), links=[], ends=[];
const boundaryValues={inlet:1,outlet:0};
for(const face of mesh.faces){
  const {owner,neighbor,area,ownerDistance,neighborDistance}=face;
  if(neighbor!==null){
    const conductance=area/(ownerDistance+neighborDistance);
    diagonal[owner]+=conductance;
    diagonal[neighbor]+=conductance;
    links.push({owner,neighbor,conductance});
  }else if(Object.hasOwn(boundaryValues,face.region)){
    const value=boundaryValues[face.region], conductance=area/ownerDistance;
    diagonal[owner]+=conductance;
    forcing[owner]+=value*conductance;
    ends.push({owner,region:face.region,conductance,value});
  }
}
function apply(input,output) {
  for(let i=0;i<count;i++)output[i]=diagonal[i]*input[i];
  for(const {owner,neighbor,conductance} of links){
    output[owner]-=conductance*input[neighbor];
    output[neighbor]-=conductance*input[owner];
  }
}
function dot(a,b) {
  let sum=0;
  for(let i=0;i<a.length;i++)sum+=a[i]*b[i];
  return sum;
}

const x=new Float64Array(count), residue=forcing.slice(), direction=residue.map((value,i)=>value/diagonal[i]);
const work=new Float64Array(count), snapshots=[], residuals=[1], scale=Math.sqrt(dot(residue,residue));
let previous=dot(residue,direction);
snapshots.push({iteration:0,residual:1,values:x.slice()});
for(let iteration=1;iteration<=400;iteration++){
  apply(direction,work);
  const step=previous/dot(direction,work);
  for(let i=0;i<count;i++){
    x[i]+=step*direction[i];
    residue[i]-=step*work[i];
  }
  const residual=Math.sqrt(dot(residue,residue))/scale;
  residuals.push(residual);
  if(iteration<=8||iteration%4===0||residual<1e-11)snapshots.push({iteration,residual,values:x.slice()});
  if(residual<1e-11)break;
  let next=0;
  for(let i=0;i<count;i++)next+=residue[i]**2/diagonal[i];
  const adjust=next/previous;
  for(let i=0;i<count;i++)direction[i]=residue[i]/diagonal[i]+adjust*direction[i];
  previous=next;
}
const solved=snapshots.at(-1);
const flux={inlet:0,outlet:0};
for(const {owner,region,conductance,value} of ends)flux[region]+=conductance*(value-x[owner]);
const balance=Math.abs(flux.inlet+flux.outlet);
const exactVolume=9*1.44*0.62, exactEnd=1.44*0.62;
assert.ok(Math.abs(mesh.measure-exactVolume)<1e-10);
for(const name of ['inlet','outlet'])assert.ok(Math.abs(mesh.boundaries[name].area-exactEnd)<1e-10);
assert.ok(solved.residual<1e-11&&balance<1e-9);
const crossBlock=mesh.faces.filter(f=>f.neighbor!==null&&mesh.cells[f.owner].block!==mesh.cells[f.neighbor].block);
assert.ok(crossBlock.length>0);
const example=crossBlock.filter(f=>mesh.cells[f.owner].block==='left'&&f.center[1]>0.48)
  .sort((a,b)=>Math.abs(a.center[2]+0.36)-Math.abs(b.center[2]+0.36))[0];
assert.ok(example);
const dense=mesh.layout.size.reduce((a,b)=>a*b,1);
const candidates=Object.values(mesh.layout.blocks).reduce((a,b)=>a+b.size.reduce((x,y)=>x*y,1),0);
const cut=mesh.cells.filter(c=>c.fraction<1-1e-9).length;

const folder=path.resolve(process.argv[2]??'studio/out/discretization');
fs.mkdirSync(folder,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(folder,name),value);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
json('channel.compiled.json',mesh);
json('report.json',{cells:count,faces:mesh.faces.length,cutCells:cut,denseCandidates:dense,
  sparseCandidates:candidates,crossBlockFaces:crossBlock.length,volume:mesh.measure,referenceVolume:exactVolume,
  regions:Object.fromEntries(Object.entries(mesh.boundaries).map(([name,row])=>[name,{faces:row.faces.length,area:row.area}])),
  exampleFace:{...example,ownerAddress:mesh.cells[example.owner].address,neighborAddress:mesh.cells[example.neighbor].address},
  solve:{method:'two-point steady diffusion',iterations:solved.iteration,residual:solved.residual,flux,balance}});

const bg='#101b24',panel='#192d37',ink='#edf4e9',dim='#9ebac3',grid='#3a565f';
const mint='#a3edc1',gold='#ffc588',blue='#99c7ff';
const ramp=['#22344c','#2e4562','#375a72','#3e7180','#4d8f88','#75ad8b','#a2c693','#d2d698','#fbe29d'];
const fixed=(value,n=3)=>value.toFixed(n);
const render=(w,h,commands)=>PNG.packRGBA(K.procedural.drawing2d.render({width:w,height:h,commands,edges:'hard'}));
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    polygon:(points,fill)=>commands.push({type:'polygon',points,fill}),
    text:(text,x,y,scale=2,color=ink)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color})};
}
const pts=face=>face.vertices.map(i=>mesh.vertices[i]);
function map(d,{ox,oy,sx,sz,frame,mark=false}) {
  const screen=([x,_y,z])=>[ox+sx*x,oy+sz*z];
  const {spacing,origin,blocks}=mesh.layout, gridPoint=at=>at.map((n,i)=>origin[i]+n*spacing[i]);
  for(const block of Object.values(blocks)){
    const min=block.index,max=min.map((n,i)=>n+block.size[i]);
    const box=[[min[0],0,min[2]],[max[0],0,min[2]],[max[0],0,max[2]],[min[0],0,max[2]]]
      .map(p=>screen(gridPoint(p)));
    d.line([...box,box[0]],grid,1);
  }
  for(const id of mesh.boundaries.roof.faces){
    const face=mesh.faces[id], points=pts(face).map(screen);
    const level=Math.min(ramp.length-1,Math.max(0,Math.round(frame.values[face.owner]*(ramp.length-1))));
    d.polygon(points,ramp[level]);
    d.line([...points,points[0]],panel,1);
  }
  for(const [name,color] of [['inlet',gold],['outlet',blue],['bank',mint]]){
    for(const id of mesh.boundaries[name].faces){
      const ridge=pts(mesh.faces[id]).filter(p=>Math.abs(p[1]-0.62)<1e-8).map(screen);
      if(ridge.length===2)d.line(ridge,color,3);
    }
  }
  if(mark){
    const [x,y]=screen(example.center);
    d.line([[x,y],[x+52,y]],ink,2);
    d.line([[x+46,y-5],[x+52,y],[x+46,y+5]],ink,2);
    d.rect(x-2,y-2,5,5,ink);
    d.line([[x+20,y-8],[x+38,y-51],[x+108,y-51]],ink,1);
    d.text('SHARED FACE '+example.id,x+114,y-56,1,ink);
  }
}

function board(){
  const d=drawing(), w=1180,h=844;
  d.rect(0,0,w,h,bg);
  d.rect(44,38,25,4,mint);
  d.text('INK STUDIO / SIMULATION',82,32,2,mint);
  d.text('Cut cells in an angled channel',41,64,5);
  d.text('ORIENTED FACES / THREE SPARSE BLOCKS / STEADY DIFFUSION',45,125,2,dim);
  d.rect(44,164,751,362,panel);
  d.text('COMPILED ROOF FOOTPRINT',63,184,2);
  map(d,{ox:93,oy:337,sx:71,sz:43,frame:solved,mark:true});
  d.text('INLET',65,231,1,gold);d.text('OUTLET',707,449,1,blue);
  d.text('CUT WALLS',65,487,1,mint);
  d.text('SPARSE BLOCK OUTLINES',173,487,1,dim);
  for(const [i,color] of ramp.entries())d.rect(496+i*22,481,21,9,color);
  d.text('0',489,495,1,dim);d.text('1',695,495,1,dim);

  d.rect(812,164,324,362,panel);
  d.text('ONE SHARED FACE',832,184,2,mint);
  d.text('OWNER   '+mesh.cells[example.owner].id,832,231,1,dim);
  d.text('NEIGHBOR   '+mesh.cells[example.neighbor].id,832,256,1,dim);
  d.rect(846,298,103,61,'#325366');
  d.rect(949,298,102,61,'#2a4556');
  d.rect(947,294,3,69,mint);
  d.line([[904,329],[998,329]],ink,2);
  d.line([[991,323],[998,329],[991,335]],ink,2);
  d.text('NORMAL  +X',832,386,1,dim);
  d.text(fixed(example.area,4)+' M2',832,409,3);
  d.text('ACROSS LEFT AND MIDDLE BLOCKS',832,475,1,mint);

  d.rect(44,548,751,245,panel);
  d.text('NORMALIZED DIFFUSION RESIDUAL',64,568,2);
  const graphX=i=>92+665*i/solved.iteration, graphY=value=>617+142*Math.min(12,-Math.log10(value))/12;
  for(const level of [0,4,8,12]){
    const y=graphY(10**-level);
    d.rect(92,Math.round(y),665,1,grid);
    d.text('1E-'+level,60,y-5,1,dim);
  }
  d.line(residuals.map((value,i)=>[graphX(i),graphY(value)]),mint,2);
  d.text(solved.iteration+' ITERATIONS',624,767,1,dim);

  d.rect(812,548,324,245,panel);
  d.text('COMPILED COUNTS',831,568,2,blue);
  d.text(count+' ACTIVE  /  '+cut+' CUT',831,611,2);
  d.text(candidates+' CANDIDATES  /  '+dense+' DENSE',831,643,1,dim);
  d.text('TOTAL VOLUME',831,684,1,dim);
  d.text(fixed(mesh.measure,4)+' M3',831,703,3,mint);
  d.text('SAME VOLUME AS THE ANALYTIC CHANNEL',831,762,1,dim);
  d.text('INLET / OUTLET FLUX IMBALANCE  '+balance.toExponential(1).toUpperCase(),44,820,1,mint);
  return render(w,h,d.commands);
}

function frame(sample){
  const d=drawing(), w=760,h=402;
  d.rect(0,0,w,h,bg);
  d.text('DIFFUSION ON CUT CELLS',23,23,3);
  d.text('ITERATION '+sample.iteration,24,65,1,dim);
  d.text('RESIDUAL '+sample.residual.toExponential(2).toUpperCase(),530,65,1,mint);
  d.rect(24,90,712,272,panel);
  map(d,{ox:55,oy:217,sx:71,sz:33,frame:sample});
  d.text('INLET',39,132,1,gold);d.text('OUTLET',667,316,1,blue);
  d.text('FIELD FROM THE COMPILED FACES',25,377,1,dim);
  return render(w,h,d.commands);
}

write('cut-cell-channel.png',PNG.encodeFrame(board()));
const frames=snapshots.map(frame);
write('diffusion-solve.png',PNG.encodeAnimation([...frames,...Array(8).fill(frames.at(-1))],12));
