const ink=require('../..');

function register({KIT:K}) {
  K.world.kernels.register('editable-tube-network',{
    revision:1,description:'A driven acoustic-style network of coupled, damped resonators.',
    inputs:{bore:{type:'number',default:0.9},drive:{type:'number',default:0.7}},
    outputs:{air:'number'},
    processing:{maxSamples:512,maxWork:30000,maxBytes:32768},
    prepare({frequencies,links},{allocate,capacity,dt}) {
      const cells=frequencies.length;
      if (cells<3 || cells>12 || links.length<2 || links.length>24 ||
          !frequencies.every(value=>Number.isFinite(value)&&value>=80&&value<=2400) ||
          !links.every(([a,b])=>[a,b].every(value=>Number.isInteger(value)&&value>=0&&value<cells)&&a!==b))
        throw Error('Invalid acoustic network');
      const from=allocate('from','Uint8Array',links.length,'table');
      const to=allocate('to','Uint8Array',links.length,'table');
      const resonance=allocate('resonance','Float64Array',cells,'table');
      const pressure=allocate('pressure','Float64Array',cells,'state');
      const velocity=allocate('velocity','Float64Array',cells,'state');
      const phase=allocate('phase','Float64Array',1,'state');
      const force=allocate('force','Float64Array',cells);
      const bore=allocate('bore','Float64Array',capacity.maxSamples,'input');
      const wave=allocate('wave','Float32Array',capacity.maxSamples,'output');
      const diameter=allocate('diameter','Float32Array',capacity.maxSamples,'output');
      for (let i=0;i<links.length;i++) [from[i],to[i]]=links[i];
      for (let i=0;i<cells;i++) resonance[i]=(2*Math.PI*frequencies[i]*dt)**2;
      bore.fill(0.9);
      return {
        workPerSample:3*cells+links.length+5,
        process({start,end,input,output}) {
          const count=end-start;
          for (let i=0;i<count;i++) {
            const width=bore[i], pitch=127+52*(1-width);
            phase[0]=(phase[0]+2*Math.PI*pitch*dt)%(2*Math.PI);
            for (let cell=0;cell<cells;cell++) force[cell]=-resonance[cell]*pressure[cell];
            force[0]+=input.drive*0.00016*(Math.sin(phase[0])+0.45*Math.sin(phase[0]*2)+0.25*Math.sin(phase[0]*3));
            for (let link=0;link<from.length;link++) {
              const a=from[link], b=to[link], flow=(pressure[a]-pressure[b])*(link===0?0.0028*width:0.0023);
              force[a]-=flow;
              force[b]+=flow;
            }
            for (let cell=0;cell<cells;cell++) {
              velocity[cell]=0.984*velocity[cell]+force[cell];
              pressure[cell]+=velocity[cell];
            }
            wave[i]=Math.tanh(25*(pressure[2]+0.16*(pressure[3]??0)-0.12*(pressure[4]??0)));
            diameter[i]=width;
          }
          output.air=wave[count-1];
        }
      };
    }
  });
}

module.exports={load(){const kit=ink.load();register(kit);return kit;}};
