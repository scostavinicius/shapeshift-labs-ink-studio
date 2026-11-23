const ink = require('../..');

function register(kit) {
  const W=kit.KIT.world;
  W.kernels.register('checkpoint-voice',{
    revision:1, block:true,
    description:'A noisy oscillator with a one-pole filter, feedback delay, and fractional note events.',
    inputs:{gain:'number'},outputs:{voice:'number',notes:'event'},
    prepare({delaySamples=149}, {seed}) {
      if (!Number.isSafeInteger(delaySamples)||delaySamples<1||delaySamples>4096)
        throw Error('The voice needs a bounded delay line');
      const phase=new Float64Array(1), filter=new Float64Array(1), delay=new Float64Array(delaySamples),
        noise=new Uint32Array(1), head=new Uint32Array(1);
      const cues=[{sample:211,fraction:0.5,note:60},{sample:1249,fraction:0.25,note:67}];
      let voice=0;
      function reset() {
        phase.fill(0);filter.fill(0);delay.fill(0);head.fill(0);noise[0]=seed>>>0||1;
        voice=0;
        return {voice,notes:[]};
      }
      function advanceBlock({start,end,dt,input,eventAt}) {
        const notes=[];
        for(let sample=start;sample<end;sample++) {
          noise[0]=(Math.imul(noise[0],1664525)+1013904223)>>>0;
          const tone=input.gain*Math.sin(phase[0])+0.035*(noise[0]/2147483648-1);
          phase[0]=(phase[0]+2*Math.PI*137*dt)%(2*Math.PI);
          filter[0]+=0.13*(tone-filter[0]);
          const echo=delay[head[0]];
          voice=filter[0]+echo*0.54;
          delay[head[0]]=voice;
          head[0]=(head[0]+1)%delay.length;
        }
        for(const cue of cues) if(cue.sample>=start&&cue.sample<end)
          notes.push(eventAt(cue.sample,cue.fraction,{kind:'note-on',note:cue.note}));
        return {voice,notes};
      }
      return {reset,advanceBlock,
        advance({tick,dt,input}) {
          return advanceBlock({start:tick-1,end:tick,dt,input,eventAt:(sample,fraction,row)=>
            W.timedEvents.within(sample*dt,(sample+1)*dt,fraction,row,{sample,fraction})});
        },
        snapshot:()=>({buffers:{phase,filter,delay,noise,head},data:{voice}}),
        restore({buffers,data}) {
          phase.set(buffers.phase);filter.set(buffers.filter);delay.set(buffers.delay);
          noise.set(buffers.noise);head.set(buffers.head);voice=data.voice;
        }};
    }
  });
  W.runtime.register('checkpoint-note-meter',()=>({
    inputs:{level:'number',notes:'event'},initial:()=>({level:0,notes:[]}),
    step:(state,{input})=>({level:input.level,notes:state.notes.concat(input.notes)})
  }));
  return kit;
}
module.exports={load:()=>register(ink.load()),register};
