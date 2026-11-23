/* Shared modal contact pulses for the browser and soundtrack renderer. */
const InkContactPulse=(()=>{
  const tau=2*Math.PI, monitorDelay=.04, phases=['breakaway','slip','catch'];
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  function resonator(rate,hz,t60){
    const r=Math.exp(Math.log(.001)/(t60*rate)), a=2*r*Math.cos(tau*Math.min(hz,rate*.45)/rate), b=r*r;
    let y=0,z=0;
    return input=>{
      const out=input+a*y-b*z;
      z=y;
      y=out;
      return out;
    };
  }
  function valid(pulse){
    return pulse&&phases.includes(pulse.phase)&&finite(pulse.body,70,1800)&&
      finite(pulse.decay,.025,.22)&&finite(pulse.hardness,0,1);
  }
  const key=({phase,body,decay,hardness})=>JSON.stringify([phase,body,decay,hardness]);
  function render(pulse,rate){
    if(!valid(pulse)||!Number.isSafeInteger(rate)||!finite(rate,8000,192000))throw new TypeError('Invalid stick-slip pulse recipe');
    const {phase,body,decay,hardness}=pulse;
    const base=body*(phase==='catch'?.71:phase==='breakaway'?.92:1.12), seconds=decay*(phase==='slip'?.62:1);
    const modes=[1,1.62,2.39,3.82,5.37,8.53].map((ratio,i)=>{
      const hz=base*ratio, ring=resonator(rate,hz,seconds/(1+i*.31));
      const level=(.39+.58*hardness)**i*Math.sin(tau*Math.min(hz,rate*.45)/rate)/Math.sqrt(i+1);
      return {ring,level};
    });
    const length=Math.max(3,Math.round(rate*(.0006+.0027*(1-hardness)+(phase==='catch'?.0014:0))));
    const samples=new Float32Array(Math.ceil(seconds*rate));
    let peak=0;
    for(let i=0;i<samples.length;i++){
      const push=i<length?Math.sin(Math.PI*i/length)**2:0;
      let output=push*.12*hardness;
      for(const {ring,level} of modes)output+=ring(push/length)*level;
      samples[i]=output*Math.min(1,(samples.length-i-1)/(rate*.006));
      peak=Math.max(peak,Math.abs(samples[i]));
    }
    const scale=.78/(peak||1);
    for(let i=0;i<samples.length;i++)samples[i]*=scale;
    return {sampleRate:rate,channels:1,samples};
  }
  return Object.freeze({monitorDelay,resonator,valid,key,render});
})();
if (typeof module !== 'undefined') module.exports = InkContactPulse;
else globalThis[Symbol.for('ink-studio.contact-pulse')] = InkContactPulse;
