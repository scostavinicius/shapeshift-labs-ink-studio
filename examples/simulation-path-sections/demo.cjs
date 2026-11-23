const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const ink=require('../..'), PNG=require('../../cli/png.js'), CLI=require('../../cli/path-sections.js');
const field=require('./duct-field.cjs'), {center,theta,radii}=field;
const kit=ink.load(), {KIT:K}=kit, {V}=K;
const base={format:CLI.format,version:1,samples:31,contours:true,
  path:Array.from({length:161},(_,i)=>center(i/160))};

function loop(t,n) {
  const [w,h]=radii(t);
  return Array.from({length:n},(_,i)=>{
    const a=i/n*2*Math.PI;
    return [w*Math.cos(a),h*Math.sin(a)];
  });
}

function ductMesh() {
  const positions=[], triangles=[], length=128, sides=64;
  for(let i=0;i<=length;i++){
    const t=i/length, angle=theta(t), p=center(t), side=[Math.cos(angle),0,Math.sin(angle)];
    for(const [u,v] of loop(t,sides)) positions.push(...V.mad(V.mad(p,side,u),[0,1,0],v));
    if(!i)continue;
    for(let j=0;j<sides;j++){
      const a=(i-1)*sides+j,b=(i-1)*sides+(j+1)%sides,c=a+sides,d=b+sides;
      triangles.push(a,c,b,b,c,d);
    }
  }
  for(let i=1;i<sides-1;i++)triangles.push(0,i,i+1,length*sides,length*sides+i+1,length*sides+i);
  return K.mesh.make(positions,triangles);
}

const folder=path.resolve(process.argv[2]??'studio/out/path-sections');
fs.mkdirSync(folder,{recursive:true});
const filename=file=>path.join(folder,file);
const write=(file,value)=>fs.writeFileSync(filename(file),value);
const json=(file,value)=>write(file,JSON.stringify(value,null,2)+'\n');
write('duct.obj',K.mesh.toObj(ductMesh()));
fs.copyFileSync(path.join(__dirname,'duct-field.cjs'),filename('duct-field.cjs'));
const plans={
  mesh:{kind:'mesh',file:'duct.obj'},
  sdf:{kind:'sdf',file:'duct-field.cjs',bounds:{min:[-1.48,-1.1],max:[1.48,1.1]},cell:0.024},
  contours:{kind:'contours',profiles:Array.from({length:33},(_,i)=>({at:i/32,loops:[loop(i/32,64)]}))}
};
const reports=Object.fromEntries(Object.entries(plans).map(([name,source])=>{
  const document={...base,source}, file='duct-'+name+'.plan.json';
  json(file,document);
  const report=CLI.measure(kit,document,filename(file));
  assert.equal(report.complete,true);
  json('duct-'+name+'.report.json',report);
  return [name,report];
}));
const reference=reports.contours, sections=reference.sections, throat=reference.minima.area.index;
assert.ok(Object.values(reports).every(report=>report.minima.area.index===throat));
const deviation=Object.fromEntries(Object.entries(reports).map(([name,report])=>[name,
  Math.max(...report.sections.map((row,i)=>Math.abs(row.area-sections[i].area)/sections[i].area))]));
assert.ok(Object.values(deviation).every(value=>value<0.02));
json('comparison.json',{length:reference.pathLength,stations:sections.length,maximumRelativeAreaDifference:deviation,
  minima:Object.fromEntries(Object.entries(reports).map(([name,report])=>[name,report.minima]))});

const navy='#111b26', panel='#1c303c', sky='#bddaff', white='#f0f2e8', gray='#b2c8ce';
const mint='#93edc1', gold='#ffc687', blue='#8aafff', grid='#425965', wall='#34515d', lines='#446473';
const render=(width,height,commands)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));
function drawing() {
  const commands=[];
  return {commands,
    rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=white)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    polygon:(points,fill)=>commands.push({type:'polygon',points,fill})};
}
const fixed=(value,n=2)=>value.toFixed(n);
const toWorld=(row,[x,y])=>V.mad(V.mad(row.point,row.u,x),row.v,y);
const outline=row=>row.contours.find(contour=>contour.selected).points;
const rings=sections.map(row=>outline(row).map(p=>toWorld(row,p)));
function planView(draw,{x,y,scale,active,highlight=true}) {
  const project=([a,b,c])=>[x+scale*(c+0.27*(a-6.1)),y+scale*(0.50*(a-6.1)-0.83*b-0.12*c)];
  const last=rings.length-1;
  for(let j=0;j<rings[0].length;j+=8)draw.line(rings.map(ring=>project(ring[j])),wall);
  for(let i=0;i<=last;i+=2){
    const points=rings[i].map(project);
    draw.line([...points,points[0]],lines);
  }
  draw.line(sections.map(row=>project(row.point)),sky);
  const cut=rings[active].map(project);
  if(highlight)draw.polygon(cut,'#407c6d');
  draw.line([...cut,cut[0]],mint,3);
  return project(sections[active].point);
}

function compareBoard() {
  const d=drawing(), width=1180,height=884;
  d.rect(0,0,width,height,navy);
  d.rect(44,38,26,4,mint);
  d.text('INK STUDIO / GEOMETRY',82,32,2,mint);
  d.text('Find the throat',42,64,6);
  d.text('CURVED DUCT / 31 PLANES / RAW WORLD UNITS',45,132,2,gray);
  d.rect(44,171,1092,314,panel);
  d.text('SECTION PLANES',68,192,2,sky);
  const [cx,cy]=planView(d,{x:588,y:356,scale:80,active:throat});
  d.line([[cx,cy-18],[cx+45,cy-77],[cx+116,cy-77]],mint,2);
  d.text('THROAT',cx+125,cy-84,2,mint);
  d.text(fixed(sections[throat].distance)+' UNITS ALONG PATH',cx+125,cy-60,1,gray);
  d.text('INLET',77,446,1,gray);
  d.text('OUTLET',1039,446,1,gray);

  d.rect(44,503,675,307,panel);
  d.text('AREA ALONG THE PATH',65,523,2,white);
  const palette={mesh:gold,sdf:blue,contours:mint}, x0=84, x1=674, y0=751, y1=581;
  const top=3.2;
  const xval=distance=>x0+(x1-x0)*distance/reference.pathLength;
  const yval=area=>y0-(y0-y1)*area/top;
  for(const level of [0,1,2,3]){
    const y=Math.round(yval(level));
    d.rect(x0,y,x1-x0,1,grid);
    d.text(String(level),65,y-4,1,gray);
  }
  const origin=Math.round(xval(sections[throat].distance));
  d.rect(origin,y1,1,y0-y1,lines);
  for(const [i,name] of ['mesh','sdf','contours'].entries()){
    d.text(name.toUpperCase(),65+193*i,554,1,palette[name]);
    const rows=reports[name].sections;
    d.line(rows.map(row=>[xval(row.distance),yval(row.area)]),palette[name],name==='contours'?2:4);
  }
  for(const [value,label] of [[0,'0'],[reference.pathLength/2,fixed(reference.pathLength/2)],[reference.pathLength,fixed(reference.pathLength)]]){
    const x=Math.round(xval(value));
    d.text(label,x-9,763,1,gray);
  }
  d.text('AREA IN SQUARE WORLD UNITS',65,787,1,gray);

  d.rect(735,503,401,307,panel);
  d.text('NARROWEST SECTION',755,523,2,mint);
  const row=sections[throat], ring=outline(row).map(([u,v])=>[936+136*u,648-136*v]);
  d.rect(818,648,237,1,grid); d.rect(936,568,1,153,grid);
  d.polygon(ring,'#407c6d');
  d.line([...ring,ring[0]],mint,3);
  d.text('AREA',756,747,1,gray);d.text(fixed(row.area),756,773,2);
  d.text('PERIMETER',873,747,1,gray);d.text(fixed(row.perimeter),873,773,2);
  d.text('MIN OPENING',1005,747,1,gray);d.text(fixed(row.minimumOpening),1005,773,2);

  d.text('MESH / SDF / CONTOUR AREAS AGREE WITHIN '+fixed(100*Math.max(...Object.values(deviation)),2)+'%',45,841,2,mint);
  return render(width,height,d.commands);
}

function sweepFrame(i) {
  const d=drawing(), width=720,height=410, row=sections[i];
  d.rect(0,0,width,height,navy);
  d.text('SECTION SWEEP',24,24,3);
  d.text('DISTANCE '+fixed(row.distance)+' / '+fixed(reference.pathLength),24,61,1,gray);
  d.rect(24,85,672,221,panel);
  planView(d,{x:358,y:194,scale:47,active:i});
  const cut=outline(row).map(([u,v])=>[621+44*u,247-44*v]);
  d.polygon(cut,'#407c6d');d.line([...cut,cut[0]],mint,2);
  d.rect(24,327,672,57,panel);
  for(const [j,[name,value]] of [['AREA',row.area],['PERIMETER',row.perimeter],['OPENING',row.minimumOpening],
    ['SPAN',row.sectionLength]].entries()){
    const left=35+j*163;
    d.text(name,left,339,1,gray);d.text(fixed(value),left,358,2,mint);
  }
  return render(width,height,d.commands);
}

write('duct-sections.png',PNG.encodeFrame(compareBoard()));
const frames=sections.map((_,i)=>sweepFrame(i));
write('duct-sweep.png',PNG.encodeAnimation([...frames,...frames.slice(1,-1).reverse()],14));
