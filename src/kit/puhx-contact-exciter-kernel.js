/* Publish an authored contact track on Ink's existing sample-block clock. */
(function(K){
  const W=K.world,E=W.contactExciters,{check,record}=W.data;
  const kind='contact-exciter';
  const example={excitation:{format:E.format,version:1,id:'strike',sampleRate:8000,tracks:{
    hit:{kind:'impact',at:.0053,point:[1,0,0],impulse:[0,.01,0],duration:.002}}},track:'hit'};
  const operation=W.kernels.register(kind,{
    revision:1,block:true,description:'Publish authored contact position, tangential slip, impulse and average force.',
    inputs:{contact:{type:'record',default:{},description:'Held point, slip, or normal load for the selected track.'}},
    outputs:{point:'vec3',slip:'vec3',impulse:'vec3',force:'vec3',contacts:'event'},
    prepare(config,{dt}){
      check(record(config)&&Object.keys(config).every(key=>['excitation','track'].includes(key)),
        'Contact exciter kernel needs an excitation plan and track');
      const {excitation,track}=config, sampleRate=Math.round(1/dt);
      check(record(excitation)&&Math.abs(1/sampleRate-dt)<=4*Number.EPSILON*dt&&
        (excitation.sampleRate===undefined||excitation.sampleRate===sampleRate),
      'Contact exciter must match its integer sample-rate clock');
      const run=E.prepare({...excitation,sampleRate});
      check(run.info.tracks.some(row=>row.name===track),'Unknown contact kernel track '+track);
      function output(contacts){
        const {point,slip,impulse,force}=run.view().tracks[track];
        return {point,slip,impulse,force,contacts};
      }
      function advanceBlock({start,end,input}){
        check(start===run.view().sample,'Contact kernel cursor disagrees with its sample range');
        const {events}=run.process(end-start,{collect:false,controls:{[track]:input.contact}});
        return output(events.filter(row=>row.track===track));
      }
      return {advanceBlock,advance({tick,input}){return advanceBlock({start:tick-1,end:tick,input});},
        reset(){run.reset();return output([]);},
        snapshot(){const {buffers,...data}=run.snapshot({typed:true});return {buffers,data};},
        restore({buffers,data}){run.restore({...data,buffers});}};
    },
    example:{config:example,clock:{dt:1/8000,tick:55,blockSize:16}}
  });
  const graph=K.procedural.graph;
  graph.operations=Object.freeze({...graph.operations,[operation]:W.kernels.operation(operation)});
})(KIT);
