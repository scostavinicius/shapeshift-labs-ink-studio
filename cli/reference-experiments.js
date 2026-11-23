/* Run the shipped physics experiments and compare independent reference solutions. */
const fs=require('node:fs'),path=require('node:path');

const suiteFormat='ink-studio/reference-experiment-suite', reportFormat='ink-studio/reference-experiment-report';
const defaultSuite=path.resolve(__dirname,'../examples/reference-experiments/recipes/suite.json');
const positive=n=>Number.isFinite(n)&&n>0;
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const peak=values=>values.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
const sum=values=>values.reduce((total,value)=>total+value,0);

function comparison(value,expected,absolute,unit){
  const valid=[value,expected,absolute].every(Number.isFinite)&&absolute>=0;
  const error=valid?Math.abs(value-expected):null;
  return {value:valid?value:null,expected,absolute,unit,error,passed:valid&&error<=absolute};
}

function tube(ctx,row){
  const {kit,W,source,read,dependency,check}=ctx, {value:plan,file}=source;
  const network=read(plan.network,file).value, bore=network.tubes?.bore, probe=network.observations?.inside;
  const {sampleRate=48000,soundSpeed=343,metersPerUnit=1,loss=0}=plan.settings??{};
  const section=bore?.sections?.[0], length=section?.length*metersPerUnit;
  const drive=plan.inputs?.drive, pulses=drive?.impulses, launch=pulses?.[0]?.sample;
  check(['open','sealed'].includes(row.end)&&plan.settings?.terminations?.tip?.kind===row.end&&
    Object.keys(network.tubes??{}).length===1&&bore?.from==='source'&&bore.to==='tip'&&bore.sections?.length===1&&
    probe?.tube==='bore'&&positive(probe.t)&&probe.t<1&&positive(length)&&positive(soundSpeed)&&
    integer(sampleRate,1000,192000)&&plan.settings.sources?.drive?.kind==='pressure'&&
    plan.settings.sources.drive.node==='source'&&(drive?.value??0)===0&&Array.isArray(pulses)&&integer(launch,0,plan.samples-1)&&
    pulses.every((pulse,i)=>pulse?.sample===launch+i&&Number.isFinite(pulse.value)),
  'Reference tube needs one uniform passage and a contiguous pressure pulse');
  const attenuation=section.loss??plan.settings.losses?.bore??loss, distance=length*probe.t, pulseSamples=pulses.length;
  const sealed=row.end==='sealed', rate=sampleRate, direct=Math.round(distance*rate/soundSpeed);
  const reflected=Math.round((2*length-distance)*rate/soundSpeed);
  const arrival=direct/rate, fundamental=soundSpeed/((sealed?4:2)*length);
  const pressureReflection=(sealed?1:-1)*sum(pulses.map(pulse=>pulse.value))/pulseSamples*Math.exp(-attenuation*(2*length-distance));
  const trace=require('./wave-network.js').run(kit,plan,file,dependency);
  const {measurements}=W.simulationMeasurements.run({
    format:W.simulationMeasurements.format,version:1,id:ctx.id,measurements:{
      arrival:{kind:'arrival',source:'wave',channel:'inside',threshold:.005,referenceSample:launch,
        window:{from:launch,to:launch+reflected}},
      frequency:{kind:'frequency',source:'wave',channel:'inside',band:[fundamental*.75,fundamental*1.25],
        window:{from:launch+reflected,to:trace.end}},
      reflection:{kind:'steady-state',source:'wave',channel:'inside',target:0,mode:'bias',
        window:{from:launch+reflected,to:launch+reflected+pulseSamples}},
      boundary:{kind:'steady-state',source:'wave',channel:'tip',target:0,mode:'peak',
        trace:{measure:sealed?'flow':'pressure'}}
    }
  },{wave:trace});
  const checks={
    arrival:comparison(measurements.arrival.value,arrival,1/rate,'s'),
    fundamental:comparison(measurements.frequency.value,fundamental,.6,'Hz'),
    reflectedPressure:comparison(measurements.reflection.value,pressureReflection,.015,'Pa'),
    boundary:comparison(measurements.boundary.value,0,1e-10,sealed?'m^3/s':'Pa')
  };
  return {checks,evidence:{length,soundSpeed,boundary:row.end,launchSample:launch,directSample:launch+direct,
    reflectedSample:launch+reflected,measurements},
  capture:{trace,length,probeFraction:distance/length,launch,sampleRate:rate,direct,reflected,pulseSamples,polarity:sealed?1:-1}};
}

function oscillator(ctx){
  const {kit,W,source,read,dependency,check}=ctx,{value:plan,file}=source;
  const {nodes,elements}=read(plan.network,file).value;
  const m=nodes.cart.capacity,k=elements.spring.stiffness,c=elements.damper.damping, x0=elements.spring.initialDisplacement;
  const gamma=c/(2*m), omega=Math.sqrt(k/m-gamma*gamma);
  check(positive(omega)&&positive(m)&&Number.isFinite(x0),'Reference oscillator needs an underdamped mass and spring');
  const trace=require('./lumped-network.js').run(kit,plan,file,dependency,plan.diagnostics??true);
  const rows=trace.results.map(({time,outputs,ledger})=>{
    const a=x0*Math.exp(-gamma*time), cos=Math.cos(omega*time),sin=Math.sin(omega*time);
    return {time,position:outputs.displacement,speed:outputs.speed,dissipated:ledger.dissipated,
      expected:a*(cos+gamma/omega*sin),expectedSpeed:-a*(k/m)/omega*sin};
  });
  const {measurements}=W.simulationMeasurements.run({
    format:W.simulationMeasurements.format,version:1,id:ctx.id,
    measurements:{balance:{kind:'conservation',source:'trace',path:'/diagnostics',metric:'network-energy-balance'}}
  },{trace});
  const checks={
    displacement:comparison(peak(rows.map(row=>row.position-row.expected)),0,2e-7,'m'),
    velocity:comparison(peak(rows.map(row=>row.speed-row.expectedSpeed)),0,1e-6,'m/s'),
    energy:comparison(measurements.balance.value,0,1e-8,'J')
  };
  return {checks,evidence:{mass:m,stiffness:k,damping:c,amplitudeDecay:gamma,dampedFrequency:omega/(2*Math.PI),
    duration:rows.at(-1).time,energy:measurements.balance},capture:{rows}};
}

function membrane(ctx,row){
  const {kit,W,source,dependency,check}=ctx, modal=require('./modal-resonator.js');
  const {size,playback}=row;
  check(source.value.source?.kind==='mesh'&&Array.isArray(size)&&size.length===2&&size.every(positive)&&playback&&
    integer(playback.samples,1000,65536),'Reference membrane needs rectangle dimensions and bounded playback');
  const speed=source.value.source.speed, analytic=speed/2*Math.hypot(1/size[0],1/size[1]);
  const asset=modal.bake(kit,source.value,source.file,dependency), mode=asset.modes[0];
  const trace=modal.run(kit,{format:W.resonantModes.runFormat,version:1,asset,samples:playback.samples,
    settings:{sampleRate:playback.sampleRate},impulses:playback.impulses},source.file,dependency);
  const {measurements}=W.simulationMeasurements.run({
    format:W.simulationMeasurements.format,version:1,id:ctx.id,measurements:{
      pickup:{kind:'frequency',source:'trace',channel:'center',band:[analytic*.88,analytic*1.12]},
      edge:{kind:'steady-state',source:'trace',channel:'edge',target:0,mode:'peak'}
    }
  },{trace});
  const fixed=asset.evidence.fixedVertices, fixedPeak=peak(fixed.map(index=>mode.shape[index]));
  const checks={
    analyticFrequency:comparison(mode.hz,analytic,analytic*.015,'Hz'),
    pickupFrequency:comparison(measurements.pickup.value,mode.hz,.45,'Hz'),
    pinnedShape:comparison(fixedPeak,0,1e-12,'model-unit'),
    pinnedPickup:comparison(measurements.edge.value,0,1e-10,'model-unit')
  };
  return {checks,evidence:{size,speed,analyticFrequency:analytic,bakedFrequency:mode.hz,vertices:asset.geometry.vertices.length,
    pinnedVertices:fixed.length,relativeEigenResidual:mode.relativeResidual,measurements},
  capture:{trace,asset,size,analytic}};
}

function worldFrames(ctx,row,visit){
  const {W,source,check}=ctx,{steps,every}=row;
  check(integer(steps,1,10000)&&integer(every,1,steps)&&Math.ceil(steps/every)<=1000,'Invalid reference world capture schedule');
  const run=W.runtime.create(source.value), rows=[];
  for(let i=0;i<=steps;i++){
    if(i)run.step();
    const frame=visit(run,i,i%every===0||i===steps);
    if(frame!==undefined)rows.push(frame);
  }
  return rows;
}

function probe(run,field,args){
  const result=run.query().probe(field,undefined,args);
  if(result.status!=='ok')throw Error('Missing reference probe '+field+' ('+result.status+')');
  return result.value;
}

function tank(ctx,row){
  const manifest=ctx.source.value,{dt}=manifest,{nodes,leaks}=manifest.systems.hydraulics.config;
  const volume=nodes.tank.initial,area=nodes.tank.area,conductance=leaks.drain.conductance,rate=conductance/area;
  const substeps=Math.min(256,Math.max(1,Math.ceil(dt/.05))), substepDecay=Math.log1p(rate*dt/substeps);
  let drift=0,solverError=0,analyticError=0,minimumFlow=Infinity;
  const rows=worldFrames(ctx,row,(run,tick,keep)=>{
    const mass=probe(run,'hydraulics/mass'), drain=probe(run,'hydraulics/leaks',{leak:'drain'});
    const time=tick*dt, expected=volume*Math.exp(-rate*time), discrete=volume*Math.exp(-tick*substeps*substepDecay);
    drift=Math.max(drift,Math.abs(mass.error));
    solverError=Math.max(solverError,Math.abs(mass.volume-discrete));
    analyticError=Math.max(analyticError,Math.abs(mass.volume-expected));
    minimumFlow=Math.min(minimumFlow,drain.flow);
    if(keep)return {time,volume:mass.volume,escaped:mass.leaked,expected,flow:drain.flow};
  });
  const checks={
    discreteDrain:comparison(solverError,0,3e-10,'m^3'),
    continuousDrain:comparison(analyticError,0,.002,'m^3'),
    waterBalance:comparison(drift,0,5e-12,'m^3'),
    outwardFlow:comparison(Math.min(0,minimumFlow),0,1e-12,'m^3/s')
  };
  return {checks,evidence:{initialVolume:volume,area,conductance,dt,substeps,final:rows.at(-1)},capture:{rows,volume,area}};
}

function heat(ctx,row){
  const {kit,W,source,read,dependency,check}=ctx,{steps,every,mean,amplitude,arealHeatCapacity}=row;
  check(integer(steps,1,10000)&&integer(every,1,steps)&&Math.ceil(steps/every)<=1000&&
    Number.isFinite(mean)&&positive(amplitude)&&positive(arealHeatCapacity),'Invalid reference heat slab settings');
  const {value:plan,file}=source, domainSource=read(plan.domain,file);
  const compiled=require('./discretization.js').compile(kit,domainSource.value,domainSource.file,dependency);
  const op=W.gridOperators.prepare(compiled), {dt,diffusivity}=plan.settings;
  const {size,spacing}=domainSource.value.source, [nx,ny]=size, dx=spacing[0], length=nx*dx;
  const equation=diffusivity*(Math.PI/length)**2, discreteRate=4*diffusivity*(Math.sin(Math.PI/(2*nx))/dx)**2;
  const initial=Float64Array.from(plan.values), rows=[];
  const original=sum(compiled.cells.map((cell,i)=>cell.measure*initial[i]));
  let values=initial, discreteError=0, continuumError=0, maxDrift=0;
  for(let step=0;step<=steps;step++){
    if(step)values=op.transport(values,{...plan.settings,boundary:plan.boundary}).values;
    const time=step*dt, factor=Math.exp(step*Math.log1p(-discreteRate*dt)), physical=Math.exp(-equation*time);
    const expected=compiled.cells.map(cell=>mean+amplitude*Math.cos(Math.PI*cell.center[0]/length)*physical);
    let content=0;
    for(const [i,cell] of compiled.cells.entries()){
      discreteError=Math.max(discreteError,Math.abs(values[i]-(mean+(initial[i]-mean)*factor)));
      continuumError=Math.max(continuumError,Math.abs(values[i]-expected[i]));
      content+=cell.measure*values[i];
    }
    maxDrift=Math.max(maxDrift,Math.abs(content-original)*arealHeatCapacity);
    if(step%every===0||step===steps)rows.push({time,values:Array.from(values),expected});
  }
  const checks={
    discreteDiffusion:comparison(discreteError,0,3e-8,'K'),
    continuousDiffusion:comparison(continuumError,0,.04,'K'),
    heatBalance:comparison(maxDrift,0,1e-7,'J')
  };
  return {checks,evidence:{shape:[nx,ny],length,dt,diffusivity,arealHeatCapacity,initialMean:mean,
    endTemperatureRange:[Math.min(...values),Math.max(...values)],duration:steps*dt},capture:{rows,nx,ny,mean,amplitude}};
}

function impact(ctx,row){
  const manifest=ctx.source.value,{dt}=manifest, from=manifest.systems.rig.config.bodies;
  const {left,right}=from, m1=left.mass,m2=right.mass,u1=left.velocity[0],u2=right.velocity[0];
  const relative=u1-u2, gap=right.position[0]-right.half[0]-left.position[0]-left.half[0];
  const expectedTime=gap/relative, momentum=m1*u1+m2*u2, common=momentum/(m1+m2), impulse=m2*(common-u2);
  ctx.check(positive(relative)&&positive(gap)&&row.steps*dt>expectedTime,'Reference impact requires separated bodies closing along X');
  const energy=(a,b)=>(m1*a*a+m2*b*b)*.5, expectedLoss=m1*m2/(m1+m2)*relative**2*.5, hits=[];
  let maxDrift=0;
  const rows=worldFrames(ctx,row,(run,tick,keep)=>{
    const bodies=probe(run,'rig/bodies'), x1=bodies.left.position[0],x2=bodies.right.position[0];
    const v1=bodies.left.velocity[0],v2=bodies.right.velocity[0];
    hits.push(...run.view().signals['rig/contact-samples']);
    maxDrift=Math.max(maxDrift,Math.abs(m1*v1+m2*v2-momentum));
    if(keep)return {time:tick*dt,x1,x2,v1,v2,energy:energy(v1,v2)};
  });
  const hit=hits[0], end=rows.at(-1), actualLoss=energy(u1,u2)-end.energy;
  const checks={
    occurrences:comparison(hits.length,1,0,'1'),
    contactTime:comparison(hit?.timing.time,expectedTime,2e-11,'s'),
    commonVelocity:comparison(Math.max(Math.abs(end.v1-common),Math.abs(end.v2-common)),0,1e-10,'m/s'),
    momentum:comparison(maxDrift,0,1e-10,'kg*m/s'),
    impulse:comparison(hit?.impulse[0],impulse,1e-10,'N*s'),
    stepAverageForce:comparison(hit?.force[0],impulse/dt,1e-8,'N'),
    kineticLoss:comparison(actualLoss,expectedLoss,1e-9,'J')
  };
  return {checks,evidence:{dt,expectedTime,initialMomentum:momentum,commonVelocity:common,contact:hit??null},
    capture:{rows,hit,from,expectedTime}};
}

const solvers={tube,oscillator,membrane,tank,heat,impact};
function run(kit,{suite=defaultSuite,id,dependency=()=>{}}={}){
  const W=kit.KIT.world,{check,id:valid,own,record}=W.data,{fields}=W.boundarySignals, owner=path.resolve(suite);
  function load(file){
    dependency(file);
    return {file,value:JSON.parse(fs.readFileSync(file,'utf8'))};
  }
  const {value:spec}=load(owner);
  check(fields(spec,['format','version','id','experiments'])&&spec.format===suiteFormat&&spec.version===1&&
    valid(spec.id)&&record(spec.experiments)&&Object.keys(spec.experiments).length>=1&&Object.keys(spec.experiments).length<=24&&
    Object.keys(spec.experiments).every(valid),'Expected a version 1 reference experiment suite');
  check(id===undefined||own(spec.experiments,id),'Unknown reference experiment '+id);
  function read(reference,file){
    check(typeof reference==='string'&&reference.length&&!path.isAbsolute(reference)&&!path.win32.isAbsolute(reference),
      'Reference experiment assets must be relative to their recipe');
    return load(path.resolve(path.dirname(file),reference));
  }
  const captures={}, experiments=Object.entries(spec.experiments).filter(([name])=>id===undefined||id===name).map(([name,row])=>{
    check(record(row)&&own(solvers,row.kind)&&typeof row.title==='string','Invalid reference experiment '+name);
    const source=read(row.source,owner);
    const {checks,evidence,capture}=solvers[row.kind]({kit,W,source,read,dependency,check,id:name},row);
    captures[name]=capture;
    return {id:name,title:row.title,kind:row.kind,source:row.source,passed:Object.values(checks).every(result=>result.passed),checks,evidence};
  });
  return {report:{format:reportFormat,version:1,id:spec.id,passed:experiments.every(row=>row.passed),experiments},captures};
}

module.exports={suiteFormat,reportFormat,defaultSuite,run};
