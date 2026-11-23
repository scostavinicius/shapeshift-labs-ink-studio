const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const kit=require('../..').load(), PNG=require('../../cli/png.js');
const {KIT:K}=kit, {solvers:S,discretization:D,gridOperators:O}=K.world;
const run=require('../../cli/numerical-solvers.js').run;
const out=path.resolve(process.argv[2]??'studio/out/numerical-solvers');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
function save(method,settings){
  const plan={format:S.planFormat,version:1,method,...settings};
  const file=method+'.plan.json', report=run(kit,plan,path.join(out,file));
  assert.equal(report.status,'converged',method+' did not converge');
  json(file,plan);
  json(method+'.report.json',report);
  return report;
}

const dense=save('dense',{matrix:[[0,2,1],[3,1,-1],[1,-1,2]],rhs:[3.6,3.6,0]});
const points=54, n=points-1;
const k=Array.from({length:points},(_,i)=>i<19?1.35:i<37?.23:.90);
const tri=save('tridiagonal',{
  matrix:{diagonal:Array.from({length:n},(_,i)=>k[i]+k[i+1]),lower:k.slice(1,-1).map(v=>-v),
    upper:k.slice(1,-1).map(v=>-v)},
  rhs:Array.from({length:n},(_,i)=>i===0?90*k[0]:i===n-1?10*k.at(-1):0)
});
const heat=[90,...tri.solution,10];
const heatFlow=k.map((v,i)=>v*(heat[i]-heat[i+1]));
assert.ok(Math.max(...heatFlow)-Math.min(...heatFlow)<1e-9);
const valve=save('root',{equation:{coefficients:[-54,2.4,17.5]},bracket:[0,3],settings:{history:true,fTolerance:1e-9}});
const leak=x=>17.5*x*x+2.4*x;
assert.ok(Math.abs(leak(valve.root)-54)<1e-8);

const width=43,height=21;
const domain=D.compile({format:D.format,version:1,id:'slalom-pressure',revision:1,units:'m',
  source:{kind:'grid',size:[width,height],spacing:[.3,.3],
    mask:({address:[i,j]})=>!(i>=13&&i<=15&&j>=7||i>=28&&i<=30&&j<=13)},
  regions:[{tag:'inlet',side:'x0'},{tag:'outlet',side:'x1'}]});
const nCells=domain.cells.length, rows=Array.from({length:nCells},()=>new Map()), rhs=Array(nCells).fill(0);
const add=(i,j,value)=>rows[i].set(j,(rows[i].get(j)??0)+value);
const boundary={inlet:{kind:'value',value:1},outlet:{kind:'value',value:0}};
for(const f of domain.faces){
  const {owner,neighbor,area,ownerDistance,neighborDistance,region}=f;
  if(neighbor!==null){
    const g=area/(ownerDistance+neighborDistance);
    add(owner,owner,g);add(neighbor,neighbor,g);add(owner,neighbor,-g);add(neighbor,owner,-g);
  }else if(Object.hasOwn(boundary,region)){
    const g=area/ownerDistance;
    add(owner,owner,g);
    rhs[owner]+=g*boundary[region].value;
  }
}
const matrix={rowPointers:[0],columns:[],values:[]};
for(const row of rows){
  for(const [i,value] of [...row.entries()].sort((a,b)=>a[0]-b[0])){
    matrix.columns.push(i);
    matrix.values.push(value);
  }
  matrix.rowPointers.push(matrix.values.length);
}
const settings={restart:32,maxWork:70000000,maxIterations:1100,history:true,relativeTolerance:1e-9};
const pressure=save('sparse',{matrix,rhs,settings});
const ops=O.prepare(domain), field=ops.diffusion(pressure.solution,{boundary});
const maxCellMismatch=Math.max(...Array.from(field.rate,(v,i)=>Math.abs(v*domain.cells[i].measure)));
assert.ok(Math.abs(maxCellMismatch-pressure.residual.absolute)<1e-12);
const pressureWork=S.sparse(matrix,rhs,{...settings,maxWork:1000});
assert.equal(pressureWork.status,'work-limit');
json('slalom.compiled.json',domain);
json('evidence.json',{finiteVolume:{residual:maxCellMismatch,boundary:field.boundaryFlux},
  limitedSolve:{...pressureWork,solution:Array.from(pressureWork.solution)},rod:{flow:heatFlow[0],variation:Math.max(...heatFlow)-Math.min(...heatFlow)}});

const bg='#13212e', panel='#1d3140', fieldBg='#142634', line='#39505d', paper='#edf1e0',
  dim='#a5c1ce', blue='#a4cef3', mint='#8ee4bb', gold='#ffc18b', purple='#d3b5fb';
const ramp=['#243961','#2f4d7c','#355b8b','#346b91','#408494','#55a292','#76b68d','#a8ca8c','#d6d88e','#ffe4a2'];
function drawing(){
  const commands=[];
  return {commands, rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    path:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width})};
}
const render=(d,w,h)=>PNG.packRGBA(K.procedural.drawing2d.render({width:w,height:h,commands:d.commands,edges:'hard'}));
const short=n=>n.toExponential(2).toUpperCase();
function map(d,values,x,y,w,h){
  const sx=w/width,sy=h/height;
  d.rect(x,y,w,h,fieldBg);
  for(const [i,{address:[a,b]}] of domain.cells.entries()){
    const v=Math.max(0,Math.min(1,values[i]));
    d.rect(x+a*sx,y+b*sy,sx,sy,ramp[Math.round(v*(ramp.length-1))]);
  }
  d.path([[x,y],[x,y+h]],mint,3);
  d.path([[x+w,y],[x+w,y+h]],gold,3);
}
function trace(d,rows,x,y,w,h,xMax){
  d.rect(x,y,w,h,fieldBg);
  const transform=([t,v])=>[x+37+t*(w-55)/xMax,y+10+Math.max(0,Math.min(11,-Math.log10(Math.max(1e-11,v))))*(h-31)/11];
  for(const v of [1,.01,.0001,1e-6,1e-8,1e-10]){
    const [,at]=transform([0,v]);
    d.path([[x+35,at],[x+w-7,at]],line,1);
    d.text('1E'+Math.round(Math.log10(v)),x+4,at-3,1,dim);
  }
  if(rows.length>1)d.path(rows.map(r=>transform([r.iterations,r.absolute])),mint,2);
  const last=rows.at(-1), [u,v]=transform([last.iterations,last.absolute]);
  d.rect(u-2,v-2,4,4,mint);
}
function smallPlot(d,x,y,width,height,points,tint,marker){
  d.rect(x,y,width,height,fieldBg);
  for(const i of [1,2,3])d.path([[x,y+height*i/4],[x+width,y+height*i/4]],line,1);
  const place=([a,b])=>[x+13+a*(width-26),y+height-8-b*(height-16)];
  if(marker){
    const [u,v]=place(marker);
    d.path([[x+5,v],[x+width-5,v]],gold,1);
    d.path(points.map(place),tint,2);
    d.rect(u-3,v-3,6,6,paper);
  }else d.path(points.map(place),tint,2);
}
function board(){
  const width=1280,height=854,d=drawing();
  d.rect(0,0,width,height,bg);
  d.rect(40,37,30,4,mint);
  d.text('INK STUDIO / PHYSICAL SIMULATION',84,31,2,mint);
  d.text('Four ways to solve a system',40,65,5,paper);
  d.text('MATRIX RESIDUALS / WORK BUDGETS / BRACKETED ROOTS',43,130,2,dim);
  d.rect(40,169,686,631,panel);
  d.text('SPARSE / PRESSURE THROUGH A BAFFLED CHANNEL',59,190,2,mint);
  d.text(nCells+' CELLS / '+matrix.values.length+' NONZERO MATRIX ENTRIES',59,225,1,dim);
  map(d,pressure.solution,61,251,643,266);
  d.text('HIGH PRESSURE INLET',62,531,1,mint);
  d.text('LOW PRESSURE OUTLET',584,531,1,gold);
  d.text('MEASURED RESIDUAL OVER GMRES ITERATIONS',60,576,1,dim);
  trace(d,pressure.history,60,597,643,127,pressure.work.iterations);
  d.text(pressure.work.iterations+' ITERATIONS / RESIDUAL '+short(pressure.residual.absolute),60,748,2,mint);
  d.text('A 1000 UNIT BUDGET STOPPED WITH STATUS WORK-LIMIT',60,778,1,dim);
  for(const [i,[title,tint]] of [['DENSE / THREE COUPLED CONTROLS',blue],['TRIDIAGONAL / HEAT THROUGH A ROD',gold],['ROOT / VALVE FLOW AT A TARGET PRESSURE',purple]].entries()){
    const x=747,y=169+i*216;
    d.rect(x,y,492,199,panel);
    d.text(title,x+17,y+19,2,tint);
    if(i===0){
      d.text('SOLVED CONTROL VALUES',x+18,y+57,1,dim);
      for(const [j,v] of dense.solution.entries()){
        d.rect(x+18+j*151,y+84,143,51,fieldBg);
        d.text(v.toFixed(2),x+30+j*151,y+101,2,blue);
      }
      d.text(dense.work.pivotSwaps+' ROW SWAPS / RESIDUAL '+short(dense.residual.absolute),x+18,y+164,1,dim);
    }else if(i===1){
      smallPlot(d,x+18,y+55,456,103,heat.map((v,j)=>[j/(heat.length-1),v/100]),gold);
      d.text('90 TO 10 / '+n+' UNKNOWNS / RESIDUAL '+short(tri.residual.absolute),x+18,y+168,1,dim);
    }else{
      const curve=Array.from({length:51},(_,i)=>[i/50,leak(3*i/50)/170]);
      smallPlot(d,x+18,y+55,456,103,curve,purple,[valve.root/3,54/170]);
      d.text('FLOW '+valve.root.toFixed(4)+' / '+valve.work.evaluations+' EVALUATIONS / ERROR '+short(valve.residual),x+18,y+168,1,dim);
    }
  }
  d.text('LINEAR RESIDUALS MEASURE THE ORIGINAL SYSTEM. ROOT ERROR MEASURES PRESSURE MISMATCH.',42,824,1,dim);
  return render(d,width,height);
}
write('solver-comparison.png',PNG.encodeFrame(board()));

const pointsInTime=[0,3,8,16,32,64,96,128,...pressure.history.map(r=>r.iterations),pressure.work.iterations];
const selected=[...new Set(pointsInTime.filter(i=>i<=pressure.work.iterations))].sort((a,b)=>a-b);
const animation=[];
for(const count of selected){
  const r=count===pressure.work.iterations?pressure:S.sparse(matrix,rhs,{...settings,maxIterations:count});
  const d=drawing(), width=646,height=404;
  d.rect(0,0,width,height,bg);
  d.text('PRESSURE SOLVE / RESTARTED GMRES',20,20,2,paper);
  d.text(r.work.iterations+' ITERATIONS / RESIDUAL '+short(r.residual.absolute),20,50,1,mint);
  map(d,r.solution,21,73,603,197);
  trace(d,r.history,20,289,604,90,pressure.work.iterations);
  animation.push(render(d,width,height));
}
write('pressure-iterations.apng',PNG.encodeAnimation(animation,4));
