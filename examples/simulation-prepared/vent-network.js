/* Shared by the Node and browser playback examples. */
function registerPreparedVentNetwork(K, precision='float64') {
  if (precision!=='float64' && precision!=='float32') throw Error('Unknown vent calculation precision');
  const store=precision==='float32'?Math.fround:value=>value;
  const capacity = {maxSamples:160,maxWork:1152,maxBytes:8192,deadlineMs:1000*96/48000};
  return K.world.kernels.register('prepared-vent-network',{
    revision:1,
    description:'Compile a vent network once and process pressure samples in fixed buffers.',
    inputs:{inlet:'number'},
    outputs:{outlet:'number'},
    processing:capacity,
    prepare({cells=6, vents=[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]]}, {allocate,capacity}) {
      if (!Number.isSafeInteger(cells) || cells<2 || cells>64 || vents.length<1 || vents.length>128)
        throw Error('Vent network needs 2–64 cells and 1–128 links');
      const from = allocate('from','Uint16Array',vents.length,'table');
      const to = allocate('to','Uint16Array',vents.length,'table');
      const flow = allocate('flow','Float64Array',vents.length,'table');
      const pressure = allocate('pressure','Float64Array',cells,'state');
      const delta = allocate('delta','Float64Array',cells,'scratch');
      const trace = allocate('trace','Float32Array',capacity.maxSamples,'output');
      for (let i=0;i<vents.length;i++) {
        const [a,b] = vents[i];
        if (![a,b].every(value=>Number.isSafeInteger(value)&&value>=0&&value<cells) || a===b)
          throw Error('Vent endpoint is outside the prepared topology');
        from[i]=a;
        to[i]=b;
        flow[i]=0.021+0.004*(i%3);
      }
      return {
        workPerSample:cells+vents.length,
        process({start,end,input,output}) {
          const count=end-start;
          for (let sample=0;sample<count;sample++) {
            delta.fill(0);
            pressure[0]+=input.inlet;
            for (let i=0;i<from.length;i++) {
              const a=from[i], b=to[i], transfer=(pressure[a]-pressure[b])*flow[i];
              delta[a]-=transfer;
              delta[b]+=transfer;
            }
            for (let i=0;i<cells;i++) pressure[i]=store(0.986*(pressure[i]+delta[i]));
            trace[sample]=pressure[cells-1];
          }
          output.outlet=pressure[cells-1];
        }
      };
    },
    example:{clock:{dt:1/48000,tick:128,blockSize:160},
      commands:[{tick:1,input:'inlet',value:0.03}]}
  });
}
if (typeof module!=='undefined' && module.exports) module.exports=registerPreparedVentNetwork;
