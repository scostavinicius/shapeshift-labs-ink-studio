const ink = require('../..');

function register(kit) {
  const W = kit.KIT.world;
  W.runtime.register('event-marker-receiver', ({precise = true}) => {
    const initial = () => ({travel:0,speed:0,received:[]});
    function react(state,{time,input,emitAt,reaction}) {
      const received = Object.values(input).flat().map(row=>{
        emitAt(reaction?0:1,'marker-received',{label:row.kind,occurrence:row.timing?.time??null});
        return {label:row.kind,occurrence:row.timing?.time??null,reaction:time};
      });
      return {...state,speed:state.speed+received.length,received:state.received.concat(received)};
    }
    return {
      initial, inputs:Object.fromEntries(['impact','note'].map(port=>[port,
        precise?{type:'event',timing:'split'}:'event'])),
      ...(precise && {react}),
      step(state,ctx) {
        const advanced={...state,travel:state.travel+ctx.dt*state.speed};
        return precise?advanced:react(advanced,ctx);
      }
    };
  });

  W.kernels.register('note-clock',{
    block:true,
    description:'Emit an authored note onset at a fractional audio sample.',
    outputs:{note:'event'},
    prepare({atSample=999,fraction=0.5}) {
      const state = new Uint8Array(1);
      const reset=()=>{state.fill(0);return {note:[]};};
      function advanceBlock({start,end,eventAt}) {
        if (state[0] || atSample<start || atSample>=end) return {note:[]};
        state[0]=1;
        return {note:[eventAt(atSample,fraction,{kind:'note-on',midi:64})]};
      }
      return {
        reset,
        advance({tick,time,dt}) {
          return advanceBlock({start:tick-1,end:tick,eventAt:(sample,frac,row)=>
            W.timedEvents.within(time-dt,time,frac,row,{sample,fraction:frac})});
        },
        advanceBlock,
        snapshot:()=>({buffers:{state}}),
        restore:({buffers})=>state.set(buffers.state)
      };
    }
  });
  return kit;
}
module.exports = {load:()=>register(ink.load()),register};
