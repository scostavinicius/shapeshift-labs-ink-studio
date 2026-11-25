/* A sustained stereo backing and a foreground phrase that changes register. */
const tau=2*Math.PI, hz=note=>440*2**((note-69)/12);
const chords=[
  [0,2.08,[45,52,60],[76,79,81,84,88,91]],
  [1.94,2.13,[41,48,57],[77,81,84,89,93]],
  [3.91,2.14,[48,55,64],[76,79,84,88,91,96]],
  [5.89,2.10,[43,50,62],[74,79,83,86,91,95]]
];
const melody=[
  [.29,.33,81],[.72,.24,76],[1.00,.27,79],[1.34,.31,81],
  [2.22,.30,89],[2.60,.30,84],[2.98,.58,93],
  [4.20,.24,76],[4.50,.25,79],[4.82,.33,84],[5.23,.36,88],
  [6.19,.32,91],[6.61,.24,86],[6.92,.64,95]
];
function make(sampleRate=24000) {
  const duration=8,frames=duration*sampleRate,channels=2;
  const rival=new Float64Array(2*frames),lead=new Float64Array(2*frames);
  function place(samples,time,span,render) {
    const start=Math.round(time*sampleRate),end=Math.min(frames,start+Math.round(span*sampleRate));
    for (let i=start;i<end;i++) render((i-start)/sampleRate,(end-i)/sampleRate,2*i,samples);
  }
  for (const [time,span,roots,tones] of chords) {
    place(rival,time,span,(t,left,at,out)=>{
      const envelope=Math.sin(Math.PI/2*Math.min(1,t/.20,left/.25))**2;
      let base=0;
      for (const [i,note] of roots.entries()) {
        const p=tau*hz(note)*t;
        base+=(.074-i*.013)*Math.sin(p+i*.83)+.012*Math.sin(2*p+.2);
      }
      out[at]+=base*envelope;
      out[at+1]+=base*envelope;
      for (const [i,note] of tones.entries()) {
        const p=tau*hz(note)*t;
        const shimmer=.83+.17*Math.sin(tau*(1.1+i*.11)*t+i*.71);
        const lane=i%2,amount=.046*envelope*shimmer;
        out[at+lane]+=amount*Math.sin(p+i*.74);
        out[at+1-lane]+=.76*amount*Math.sin(p+i*.74+.37);
      }
    });
  }
  for (const [time,span,note] of melody) {
    place(lead,time,span,(t,left,at,out)=>{
      const p=tau*hz(note)*t+.17*Math.sin(tau*4.8*t)*(1-Math.exp(-9*t));
      const envelope=Math.sin(Math.PI/2*Math.min(1,t/.029,left/.095))**2;
      const sound=envelope*(.057*Math.sin(p)+.014*Math.sin(2*p+.4)*Math.exp(-3*t)+.007*Math.sin(3*p)*Math.exp(-8*t));
      out[at]+=sound;
      out[at+1]+=.96*sound;
    });
  }
  const audio=samples=>({sampleRate,channels,samples});
  return {duration,lead:audio(lead),rival:audio(rival)};
}
module.exports={make};
