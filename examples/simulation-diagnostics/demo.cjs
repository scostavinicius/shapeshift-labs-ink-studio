const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const kit=require('../..').load(), {KIT:K}=kit, W=K.world;
const PNG=require('../../cli/png.js'), diagnostic=require('../../cli/simulation-diagnostics.js');
const output=path.resolve(process.argv[2]??'studio/out/simulation-diagnostics');
fs.mkdirSync(output,{recursive:true});
const write=(name,data)=>fs.writeFileSync(path.join(output,name),data);
const json=(name,data)=>write(name,JSON.stringify(data,null,2)+'\n');
function audit(name,plan){
  const file=name+'.plan.json';
  json(file,plan);
  const report=diagnostic.run(kit,plan,path.join(output,file));
  json(name+'.diagnostics.json',report);
  return report;
}
const metric=(report,code)=>report.metrics.find(row=>row.code===code);

const width=12,height=7;
const gridPlan={format:W.discretization.format,version:1,id:'diffusion-bench',revision:1,units:'m',
  source:{kind:'grid',size:[width,height],spacing:.2},regions:[{tag:'hot-wall',side:'x0'}]};
const grid=W.discretization.compile(gridPlan), finiteVolume=W.gridOperators.prepare(grid);
json('grid.json',gridPlan);
const field=grid.cells.map(({address:[x,y]})=>.2+.8*Math.exp(-((x-2)**2+(y-5)**2)/8));
const diffusivity=grid.cells.map(({address:[x,y]})=>x<=2&&y>=4?1.8:.12);
const boundary={'hot-wall':{kind:'value',value:.9}};
const {stableDt,limitingCell}=finiteVolume.diffusion(field,{diffusivity,boundary});
const settings={diffusivity,dt:.62*stableDt};
const plan={format:W.gridOperators.planFormat,version:1,domain:'grid.json',operation:'transport',values:field,boundary,settings};
const blocked=audit('grid-stability',{...plan,settings:{...settings,dt:1.6*stableDt}});
const clean=audit('grid-clean',plan);
const correct=finiteVolume.transport(field,{...settings,boundary}).values;
const altered=Array.from(correct), a=width*2+4,b=width*4+8;
altered[a]+=.2;
altered[b]-=.2;
const shifted=audit('grid-balance',{...plan,observed:altered});
const local=metric(shifted,'transport-cell-balance'), global=metric(shifted,'transport-balance');
const localFindings=shifted.findings.filter(row=>row.code==='transport-cell-balance');
assert.deepEqual(localFindings.map(row=>row.location.cell).sort((a,b)=>a-b),[a,b]);
assert.equal(blocked.status,'error');
assert.equal(clean.status,'pass');
assert.equal(global.severity,'pass');
assert.equal(local.severity,'error');

const pipe={format:W.waveNetworks.format,version:1,id:'inspection-pipe',
  nodes:{inlet:{},joint:{},outlet:{}}, observations:{end:{node:'outlet'}},
  tubes:{bore:{from:'inlet',to:'joint',sections:[{length:.16,area:.009}]},
    shim:{from:'joint',to:'outlet',sections:[{length:.0003,area:.0045}]}}};
json('pipe.json',pipe);
const wave={format:W.waveNetworks.runFormat,version:1,network:'pipe.json',samples:240,
  settings:{sampleRate:24000,sources:{tap:{kind:'flow',node:'inlet'}},terminations:{outlet:{kind:'matched'}}},
  inputs:{tap:{impulses:[{sample:0,value:.001}]}}};
const cfl=metric(audit('wave-cfl',wave),'wave-cfl-budget');
const drift=metric(audit('wave-delay',{...wave,settings:{...wave.settings,method:'delay'}}),'wave-travel-drift');
assert.equal(cfl.location.tube,'shim');
assert.equal(drift.location.tube,'shim');

const duration=12, secondsPerFrame=.2, snapshots=Array.from({length:61},(_,i)=>i*secondsPerFrame);
const lossless={format:W.lumpedNetworks.format,version:1,id:'lossless-oscillator',
  nodes:{ground:{kind:'reference'},store:{kind:'storage',capacity:1,initialEffort:1}},
  elements:{mass:{kind:'inertance',from:'store',to:'ground',inertance:1}}};
function series(name,step){
  const network={...lossless,numerics:{step}};
  json(name+'.network.json',network);
  const outputs=Array.from({length:16},(_,i)=>(i+1)*.8).filter(t=>t<=duration);
  const plan={format:W.lumpedNetworks.runFormat,version:1,network:name+'.network.json',samples:outputs,
    diagnostics:{tolerances:{'network-energy-balance':{absolute:1e-7,relative:0}}}};
  const report=audit(name,plan);
  const prepared=W.lumpedNetworks.prepare(network);
  const checkpoints=[prepared.view(),...outputs.map(t=>prepared.advance(t))];
  const scale=checkpoints.map(({time,ledger})=>({time,initial:ledger.initialEnergy,energy:ledger.energy}));
  return {scale,report,step};
}
const coarse=series('energy-coarse',.8), refined=series('energy-refined',.05);
assert.equal(coarse.report.status,'error');
assert.equal(refined.report.status,'pass');
const finalDrift=visit=>metric(visit.report,'network-energy-balance').value;
const percent=visit=>(100*finalDrift(visit)/visit.scale[0].initial).toFixed(2);
const heat=initial=>({kind:'store',config:{accounts:{q:{resource:'heat',units:'J',initial}}}});
const world={format:W.format,version:1,dt:.1,systems:{hot:heat(10),cold:heat(2),warm:heat(5.1),cool:heat(5),
  exchange:{kind:'transfer-coupling',config:{law:'proportional',revision:1,
    parameters:{gain:2},iteration:{maxIterations:1,onLimit:'reject'},links:{
      jacket:{from:'hot/q',to:'cold/q',tolerance:.001}, trim:{from:'warm/q',to:'cool/q',tolerance:.01}
    }}}}};
json('exchange.world.json',world);
const runtime=W.runtime.create(world);
runtime.step();
const probe=runtime.query().probe('exchange/coupling');
json('exchange.probe.json',probe);
const coupling=W.diagnostics.coupling(probe.value,{}, {time:.1});
json('exchange.diagnostics.json',coupling);
const link=metric(coupling,'coupling-residual');
assert.equal(link.location.link,'jacket');
const numerical=audit('short-solve',{format:W.solvers.planFormat,version:1,method:'sparse',
  matrix:{rowPointers:[0,1,2,3],columns:[0,1,2],values:[1,1,1]},rhs:[1,4,18],settings:{maxIterations:0}});
const row=metric(numerical,'linear-residual');
assert.equal(row.location.row,2);

const bg='#111b24', card='#1a2a37', well='#10202a', line='#38515e', paper='#edf2dc', dim='#a9c2c9',
  teal='#81d9bf', coral='#ff907d', blue='#91bcee', ochre='#f6c184';
const ramp=['#203645','#254659','#2b566b','#337487','#509695','#73b4a4','#b2d1ae','#eedfb0'];
function draw(width,height){
  const commands=[];
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const text=(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[x,y],scale,color});
  const path=(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width});
  function outline(x,y,w,h,color,width=1){path([[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]],color,width);}
  function bake(){return PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}));}
  rect(0,0,width,height,bg);
  return {rect,text,path,outline,bake};
}
function gridPreview(d,x,y,scale,marks){
  for(const [i,cell] of grid.cells.entries()){
    const [ix,iy]=cell.address;
    const color=ramp[Math.min(ramp.length-1,Math.floor(field[i]*ramp.length))];
    d.rect(x+ix*scale,y+(height-1-iy)*scale,scale-1,scale-1,color);
  }
  for(const [cell,color] of marks){
    const [ix,iy]=grid.cells[cell].address;
    d.outline(x+ix*scale,y+(height-1-iy)*scale,scale-1,scale-1,color,2);
  }
}
const ms=value=>(1000*value).toFixed(2);
const us=value=>(1e6*value).toFixed(2);
const floorEnergy=.475, ceilEnergy=.503;
function chart(d,x,y,w,h,through=duration){
  d.rect(x,y,w,h,well);
  const map=(time,energy)=>[x+time/duration*w,y+(ceilEnergy-energy)/(ceilEnergy-floorEnergy)*h];
  for(let t=0;t<=12;t+=3)d.path([[x+t/12*w,y],[x+t/12*w,y+h]],line);
  for(const e of [.48,.49,.50])d.path([map(0,e),map(12,e)],e===.50?dim:line);
  for(const [series,color] of [[coarse,coral],[refined,teal]]){
    const points=series.scale.filter(({time})=>time<=through).map(({time,energy})=>map(time,energy));
    if(points.length>1)d.path(points,color,2);
    const [px,py]=points.at(-1);
    d.rect(px-2,py-2,5,5,color);
  }
  d.text('0 S',x,y+h+9,1,dim);
  d.text('12 S',x+w-24,y+h+9,1,dim);
}
function board(){
  const d=draw(1120,817);
  d.rect(35,28,24,3,teal);
  d.text('INK STUDIO / SIMULATION DIAGNOSTICS',72,23,2,teal);
  d.text('Where the solve goes wrong',34,60,5);
  d.rect(35,134,514,314,card); d.rect(570,134,515,314,card);
  d.rect(35,469,514,312,card); d.rect(570,469,515,312,card);
  d.text('01  FINITE-VOLUME GRID',54,154,2);
  gridPreview(d,55,194,17,[[limitingCell.cell,ochre],...localFindings.map(row=>[row.location.cell,coral])]);
  d.text('LIMITING CELL '+limitingCell.address.join(','),283,199,1,ochre);
  d.text(ms(1.6*stableDt)+' MS REQUESTED',282,220,2,coral);
  d.text(ms(stableDt)+' MS LIMIT',282,251,2,ochre);
  d.text(ms(settings.dt)+' MS PASSES',282,282,2,teal);
  d.text('GLOBAL BALANCE CLOSES',55,338,2,teal);
  d.text('TWO CELL ERRORS CANCEL IN THE TOTAL.',55,369,1,dim);
  d.text('LOCAL ERROR '+Math.abs(local.value).toFixed(3)+' AT CELL '+local.location.address.join(','),55,394,2,coral);

  d.text('02  WAVEGUIDE SECTION',590,154,2);
  d.rect(596,206,345,31,'#365b71');
  d.rect(941,214,83,15,coral);
  d.path([[941,201],[941,241]],ochre);
  d.text('BORE',596,252,1,dim);
  d.text('SHIM / 0.30 MM',936,252,1,coral);
  d.text(cfl.details.requiredSubsteps+' SUBSTEPS NEEDED / '+cfl.details.maxSubsteps+' AVAILABLE',590,288,2,coral);
  d.text(us(cfl.threshold)+' US CFL LIMIT',590,317,2,ochre);
  d.text('DELAY LINE: '+drift.details.desired.toFixed(3)+' SAMPLE ROUNDS UP TO 1',590,362,1,blue);
  d.text('ARRIVAL DRIFTS '+drift.value.toFixed(3)+' SAMPLE',590,395,2,coral);

  d.text('03  LOSSLESS NETWORK',54,489,2);
  chart(d,58,536,466,131);
  d.text('RK4 0.80 S',58,700,1,coral);
  d.text('RK4 0.05 S',265,700,1,teal);
  d.text(percent(coarse)+'% ENERGY',58,720,2,coral);
  d.text(Math.abs(finalDrift(refined)).toExponential(1).toUpperCase()+' RESIDUAL',265,720,2,teal);

  d.text('04  COUPLING AND LINEAR SOLVE',590,489,2);
  d.text('CONNECTION / '+link.location.link.toUpperCase(),590,538,2,ochre);
  d.text(link.value.toFixed(1)+'X TOLERANCE / TRANSFER REJECTED',590,569,2,coral);
  d.path([[590,611],[1064,611]],line);
  d.text('EQUATION ROW / '+row.location.row,590,639,2,blue);
  d.text('SIGNED RESIDUAL '+row.value,590,670,2,coral);
  d.text('GMRES ITERATION LIMIT REACHED',590,722,1,dim);
  return d.bake();
}
write('diagnostics-comparison.png',PNG.encodeFrame(board()));
const frames=snapshots.map(time=>{
  const d=draw(620,328);
  d.text('ENERGY IN A LOSSLESS OSCILLATOR',22,22,2);
  d.text(time.toFixed(1)+' S',24,62,2,dim);
  chart(d,32,101,550,148,time);
  d.text('RK4 STEP 0.80 S',33,285,1,coral);
  d.text('RK4 STEP 0.05 S',261,285,1,teal);
  d.text('EXPECTED ENERGY',452,285,1,dim);
  return d.bake();
});
write('energy-drift.apng',PNG.encodeAnimation(frames,15));
json('comparison.json',{grid:{limitingCell,stableDt,local,global,localFindings},waves:{cfl,drift},energy:{
  coarseStep:coarse.step,refinedStep:refined.step,coarseError:finalDrift(coarse),refinedError:finalDrift(refined)
},coupling:link,linear:row});
