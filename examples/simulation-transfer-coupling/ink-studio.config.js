const ink=require('../..');
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function install(W) {
  const {register}=W.runtime;
  function chamber({kind}) {
    const mouth=kind==='mouth', rest=mouth?0.00032:0.00072, stiffness=mouth?1.4e8:8e7;
    const pressure=mass=>stiffness*(mass-rest);
    const initial={mass:rest,postedMass:rest,momentum:0,pressure:0,dc:0,phase:0};
    const air={resource:'air-mass',units:'kg',type:'number',
      read:state=>({balance:state.mass}),write:(state,mass)=>({...state,mass}),
      observe:state=>({pressure:pressure(state.mass)})};
    const reaction={resource:'axial-momentum',units:'N*s',type:'number',
      read:state=>({balance:state.momentum,min:null}),write:(state,momentum)=>({...state,momentum})};
    return {initial:()=>initial,accounts:{air,...(mouth&&{reaction})},
      outputs:{pressure:'number',audio:'number'},
      output:state=>({pressure:state.pressure,audio:mouth?0:state.pressure-state.dc}),
      step(state,{time,dt}) {
        const post=pressure(state.mass);
        if (mouth) {
          const phase=(state.phase+2*Math.PI*(146+47*clamp((time-0.18)*1.6,0,1))*dt)%(2*Math.PI);
          const attack=clamp(time/0.045,0,1);
          const target=attack*(750+450*Math.sin(phase)+130*Math.sin(2*phase+0.38));
          return {...state,postedMass:state.mass,pressure:post,phase,
            mass:state.mass+0.32*(rest+target/stiffness-state.mass)};
        }
        return {...state,postedMass:state.mass,pressure:post,
          mass:rest+0.72*(state.mass-rest),dc:state.dc+0.014*(post-state.dc)};
      }};
  }
  register('bench-air-chamber',chamber);
  register('bench-reed',()=>{
    const effectiveMass=0.00011, restGap=0.000072, frequency=232;
    const spring=effectiveMass*(2*Math.PI*frequency)**2;
    const predict=(state,dt)=>clamp(state.position+dt*state.momentum/effectiveMass,-restGap,restGap);
    return {initial:()=>({position:0,momentum:0,postedMomentum:0,opening:1}),
      accounts:{drive:{resource:'axial-momentum',units:'N*s',type:'number',
        read:state=>({balance:state.momentum,min:null}),write:(state,momentum)=>({...state,momentum}),
        observe:(state,{dt})=>({opening:(restGap-predict(state,dt))/restGap})}},
      outputs:{opening:'number'},output:state=>({opening:state.opening}),
      step(state,{dt}) {
        const position=predict(state,dt);
        const freeMomentum=0.967*(state.momentum-dt*spring*position);
        const momentum=position===restGap ? Math.min(0,freeMomentum) :
          position===-restGap ? Math.max(0,freeMomentum) : freeMomentum;
        return {position,momentum,postedMomentum:state.momentum,opening:(restGap-position)/restGap};
      }};
  });
  W.transferCoupling.registerLaw('reed-flow',()=>({dt,link})=>{
    const air=link('air'), push=link('push');
    const pressure=air.from.values.pressure-air.to.values.pressure;
    const opening=push.to.values.opening;
    return {air:0.00118*opening*pressure/Math.sqrt(180+Math.abs(pressure))*dt,
      push:0.0000136*pressure*dt};
  });
}
module.exports={load(){const kit=ink.load();install(kit.KIT.world);return kit;}};
