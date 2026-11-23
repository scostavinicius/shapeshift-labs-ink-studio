const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const ink=require('../..'), PNG=require('../../cli/png.js'), CLI=require('../../cli/mass-properties.js');
const kit=ink.load(), {KIT:K}=kit, base=require('./balance.plan.json');
const folder=path.resolve(process.argv[2]??'studio/out/mass-properties');
fs.mkdirSync(folder,{recursive:true});
const file=name=>path.join(folder,name);
const pack=path.join(__dirname,'balance.pack.json');
const write=(name,value)=>fs.writeFileSync(file(name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
for(const name of ['arm.obj','instrument.json','balance.pack.json'])fs.copyFileSync(path.join(__dirname,name),file(name));

const variants=[
  {id:'oak',title:'OAK COLLAR',material:'balance/oak',bore:0.033,color:'#b9a078'},
  {id:'brass',title:'BRASS COLLAR',material:'balance/brass',bore:0.033,color:'#ffc084'},
  {id:'bored',title:'LARGER BRASS BORE',material:'balance/brass',bore:0.054,color:'#ecc78f'}
];
for(const row of variants){
  const name=row.id+'.plan.json';
  const document={...base,id:'balance-'+row.id,parts:{...base.parts,collar:{
    ...base.parts.collar,material:row.material,source:{...base.parts.collar.source,innerRadius:row.bore}
  }}};
  json(name,document);
  row.report=CLI.measure(kit,document,file(name),{assetPack:pack});
  json(row.id+'.report.json',row.report);
}
const [oak,brass,bored]=variants;
assert.equal(oak.report.volume,brass.report.volume);
assert.ok(oak.report.centerOfMass[0]>0&&brass.report.centerOfMass[0]<0);
assert.ok(bored.report.mass<brass.report.mass&&bored.report.centerOfMass[0]>brass.report.centerOfMass[0]);
assert.ok(Math.abs(oak.report.parts.collar.thickness-0.03)<1e-12);
assert.ok(Math.abs(bored.report.parts.collar.thickness-0.009)<1e-12);

const spring=62, gravity=9.81, fps=20, samples=65, substeps=12, dt=1/(fps*substeps);
function motion(properties){
  const [x,y]=properties.centerOfMass, mass=properties.mass, inertia=properties.about.tensor[8];
  const ratio=properties.parts.arm.material.damping, drag=2*ratio*Math.sqrt(spring*inertia);
  let angle=0, speed=0;
  const frames=[0];
  for(let frame=1;frame<samples;frame++){
    for(let i=0;i<substeps;i++){
      const offset=x*Math.cos(angle)-y*Math.sin(angle);
      const torque=-mass*gravity*offset-spring*angle-drag*speed;
      speed+=dt*torque/inertia;
      angle+=dt*speed;
    }
    frames.push(angle);
  }
  return frames;
}
for(const row of variants)row.frames=motion(row.report);
const degrees=value=>value*180/Math.PI;
json('comparison.json',{springNmPerRadian:spring,fields:variants.map(({id,report,frames})=>({
  id,volume:report.volume,mass:report.mass,centerOfMass:report.centerOfMass,hingeInertia:report.about.tensor[8],
  collarWall:report.parts.collar.thickness,collarProbes:report.parts.collar.probes,
  lastAngleDegrees:degrees(frames.at(-1)),material:report.parts.collar.material.id
}))});

const bg='#131f29',panel='#1d323c',inkColor='#f1f2e6',muted='#b2c5c9',grid='#47606c';
const mint='#a5ebc4',gold='#ffc18b',blue='#9ac8f1';
const plotColors=[mint,gold,blue];
const fixed=(n,d=2)=>n.toFixed(d);
const signed=(n,d=0)=>(n>=0?'+':'')+fixed(n,d);
const render=(width,height,commands)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    polygon:(points,fill)=>commands.push({type:'polygon',points,fill}),
    text:(text,x,y,scale=2,color=inkColor)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color})};
}

function mechanism(d,{cx,cy,scale,row,angle,accent}){
  const c=Math.cos(angle),s=Math.sin(angle);
  const project=([x,y])=>[cx+scale*(c*x-s*y),cy-scale*(s*x+c*y)];
  function block(x0,y0,x1,y1,color){
    const points=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(project);
    d.polygon(points,color);
    d.line([...points,points[0]],panel,1);
  }
  d.line([[cx-126,cy],[cx+126,cy]],grid,1);
  d.polygon([[cx-18,cy+42],[cx+18,cy+42],[cx,cy+4]],'#436272');
  d.line([[cx-29,cy+43],[cx+29,cy+43]],grid,2);
  block(-0.60,-0.014,0.60,0.014,'#a3a699');
  const left=-0.41,y=0.014,r=0.063;
  block(left-r,y,left-row.bore,y+0.08,row.color);
  block(left+row.bore,y,left+r,y+0.08,row.color);
  block(0.392,y,0.528,y+0.038,'#90bccc');
  d.rect(cx-2,cy-2,5,5,inkColor);
  const center=project(row.report.centerOfMass);
  d.rect(center[0]-3,center[1]-3,7,7,accent);
  d.line([[center[0],center[1]-7],[center[0],center[1]-25]],accent,1);
  d.polygon([[center[0],center[1]-5],[center[0]-5,center[1]-12],[center[0]+5,center[1]-12]],accent);
}

function board(){
  const d=drawing(),width=1180,height=842;
  d.rect(0,0,width,height,bg);
  d.rect(44,37,27,4,mint);
  d.text('INK STUDIO / SIMULATION',83,31,2,mint);
  d.text('Where the weight goes',42,63,5);
  d.text('MESH ARM / ANALYTIC COLLAR / SDF INSTRUMENT',44,125,2,muted);
  for(const [i,row] of variants.entries()){
    const px=44+i*366, accent=plotColors[i], {report}=row;
    d.rect(px,164,360,314,panel);
    d.text(row.title,px+18,183,2,accent);
    d.text('CENTRE OF MASS',px+18,217,1,muted);
    mechanism(d,{cx:px+180,cy:292,scale:245,row,angle:0,accent});
    d.text(fixed(report.mass)+' KG',px+19,365,3);
    d.text('COM '+signed(1000*report.centerOfMass[0])+' MM FROM PIVOT',px+19,409,1,accent);
    d.text('BORE WALL  '+fixed(1000*report.parts.collar.thickness,0)+' MM',px+19,436,1,muted);
  }
  d.rect(44,501,742,279,panel);
  d.text('RELEASE FROM LEVEL',65,521,2);
  d.text('ANGLE AT A SPRING HINGE',65,553,1,muted);
  const max=Math.max(...variants.flatMap(row=>row.frames.map(value=>Math.abs(degrees(value)))));
  const y=angle=>654-81*degrees(angle)/max, x=i=>90+664*i/(samples-1);
  for(const level of [-1,-0.5,0,0.5,1]){
    const at=Math.round(654-81*level);
    d.rect(90,at,664,1,grid);
    d.text(signed(max*level),54,at-4,1,muted);
  }
  for(const [i,row] of variants.entries())d.line(row.frames.map((angle,j)=>[x(j),y(angle)]),plotColors[i],2);
  d.text('0 S',85,755,1,muted);
  d.text(fixed((samples-1)/fps,1)+' S',726,755,1,muted);

  d.rect(802,501,334,279,panel);
  d.text('INERTIA AT THE HINGE',821,521,2);
  d.text('KG M2 / ABOUT Z',821,553,1,muted);
  for(const [i,row] of variants.entries()){
    const yy=590+57*i;
    d.text(row.title,821,yy,1,plotColors[i]);
    d.text(fixed(row.report.about.tensor[8],3),821,yy+20,2);
  }
  d.text('COLLAR MATERIAL AND BORE SET THE BALANCE',44,814,1,mint);
  return render(width,height,d.commands);
}

function animation(i){
  const d=drawing(),width=910,height=338;
  d.rect(0,0,width,height,bg);
  d.text('BALANCE BENCH',23,25,3);
  d.text('RELEASE FROM LEVEL / '+fixed(i/fps)+' S',24,63,1,muted);
  for(const [j,row] of variants.entries()){
    const px=24+j*289, accent=plotColors[j], angle=row.frames[i];
    d.rect(px,93,280,220,panel);
    d.text(row.title,px+14,110,1,accent);
    mechanism(d,{cx:px+140,cy:194,scale:190,row,angle,accent});
    d.text(signed(degrees(angle),1)+' DEG',px+14,275,2,accent);
  }
  return render(width,height,d.commands);
}

write('mass-properties-bench.png',PNG.encodeFrame(board()));
const frames=Array.from({length:samples},(_,i)=>animation(i));
write('balance-playback.png',PNG.encodeAnimation(frames,fps));
