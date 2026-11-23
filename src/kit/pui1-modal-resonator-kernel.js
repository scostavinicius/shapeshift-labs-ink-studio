/* Drive a named modal excitation and publish a named pickup on the sample clock. */
(function(K){
  const W=K.world,M=W.resonantModes,{check,record,own}=W.data;
  const operation=W.kernels.register('modal-resonator',{
    revision:1,block:true,description:'Drive a versioned resonant mode asset from a scalar force.',
    inputs:{force:'number'},outputs:{position:'number'},
    prepare(config,{dt}){
      check(record(config)&&Object.keys(config).every(key=>['asset','excitation','pickup','settings'].includes(key)),
        'Modal kernel needs an asset, excitation, and pickup');
      const {asset,excitation,pickup,settings={}}=config, sampleRate=Math.round(1/dt);
      check(Math.abs(1/sampleRate-dt)<=4*Number.EPSILON*dt&&
        (settings.sampleRate===undefined||settings.sampleRate===sampleRate),'Modal kernel must match its sample-rate clock');
      const run=M.prepare(asset,{...settings,sampleRate});
      check(own(run.info.excitations,excitation)&&own(run.info.pickups,pickup),'Unknown modal kernel sites');
      const output=()=>({position:run.view().pickups[pickup]});
      function advanceBlock({start,end,input}){
        check(start===run.view().sample,'Modal cursor disagrees with its sample range');
        run.process(end-start,{forces:{[excitation]:input.force},collect:false});
        return output();
      }
      return {advanceBlock,advance({tick,input}){return advanceBlock({start:tick-1,end:tick,input});},
        reset(){run.reset();return output();},
        snapshot(){const {buffers,...data}=run.snapshot({typed:true});return {buffers,data};},
        restore({buffers,data}){run.restore({...data,buffers});}};
    },
    example:{config:{asset:M.bake({format:M.planFormat,version:1,id:'example-string',
      source:{kind:'string',length:1,speed:220,count:3},excitations:{drive:{point:[.37,0,0]}},
      pickups:{read:{point:[.28,0,0]}}}),excitation:'drive',pickup:'read'},
      commands:[{tick:1,input:'force',value:1},{tick:35,input:'force',value:0}],
      clock:{dt:1/8000,tick:90,blockSize:32}}
  });
  const graph=K.procedural.graph;
  graph.operations=Object.freeze({...graph.operations,[operation]:W.kernels.operation(operation)});
})(KIT);
