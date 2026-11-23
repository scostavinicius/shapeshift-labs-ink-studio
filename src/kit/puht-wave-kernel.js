/* Host a selected wave source and probe on the existing fixed sample-block clock. */
(function(K){
  const W=K.world,N=W.waveNetworks,{check,record}=W.data;
  const kind='acoustic-wave-network';
  const example={
    domain:{format:N.format,version:1,id:'block-tube',nodes:{inlet:{},outlet:{}},
      tubes:{bore:{from:'inlet',to:'outlet',sections:[{length:1,area:.002}]}},observations:{outlet:{node:'outlet'}}},
    settings:{method:'delay',terminations:{inlet:{kind:'matched'},outlet:{kind:'matched'}},
      sources:{inlet:{node:'inlet',kind:'flow'}}},
    source:'inlet',probe:'outlet'
  };
  const operation=W.kernels.register(kind,{
    revision:1,block:true,description:'Run a branched pressure/volume-flow network at a fixed sample rate.',
    inputs:{drive:'number'},
    outputs:{pressure:{type:'number',quantity:{unit:'Pa'}},flow:{type:'number',quantity:{unit:'m^3/s'}}},
    prepare(config,{dt}){
      check(record(config)&&Object.keys(config).every(key=>['domain','settings','source','probe'].includes(key)),
        'Acoustic wave kernel needs a network, source, and probe');
      const {domain,settings={},source,probe}=config, sampleRate=Math.round(1/dt);
      check(Math.abs(1/sampleRate-dt)<=4*Number.EPSILON*dt&&
        (settings.sampleRate===undefined||settings.sampleRate===sampleRate),'Acoustic wave kernel must match its integer sample-rate clock');
      const wave=N.prepare(domain,{...settings,sampleRate});
      check((source===undefined||wave.info.sources.some(row=>row.name===source))&&wave.info.probes.includes(probe),
        'Acoustic wave kernel needs a known source and probe');
      const current=()=>wave.view().probes[probe];
      function advanceBlock({start,end,input}){
        check(start===wave.view().sample,'Acoustic wave kernel sample cursor disagrees with its block');
        wave.process(end-start,{inputs:source===undefined?{}:{[source]:input.drive},collect:false});
        return current();
      }
      return {
        reset(){wave.reset();return current();},
        advance({tick,input}){return advanceBlock({start:tick-1,end:tick,input});},
        advanceBlock,
        snapshot(){
          const {buffers,...data}=wave.snapshot({typed:true});
          return {buffers,data};
        },
        restore({buffers,data}){wave.restore({...data,buffers});}
      };
    },
    example:{config:example,commands:[{tick:1,input:'drive',value:0.0001},{tick:3,input:'drive',value:0}],
      clock:{dt:1/48000,tick:141,blockSize:64}}
  });
  const graph=K.procedural.graph;
  graph.operations=Object.freeze({...graph.operations,[operation]:W.kernels.operation(operation)});
})(KIT);
