/* Shared mono grain preparation and compass sectors for overflow textures. */
const InkCrowdAudio=(()=>{
  const tau=2*Math.PI, monitorDelay=.05;
  function direction(sector,seats){
    if(seats===2)return [sector?-1:1,0,0];
    const angle=sector*tau/seats;
    return [Math.sin(angle),0,-Math.cos(angle)];
  }
  function sector(position,listener,seats){
    const x=position[0]-listener[0], z=position[2]-listener[2];
    if(seats===2)return x<0?1:0;
    if(x===0&&z===0)return 0;
    return (Math.round(Math.atan2(x,-z)/tau*seats)+seats)%seats;
  }
  const point=(listener,d)=>listener.map((n,i)=>n+d[i]*2);
  const shape=n=>n/Math.sqrt(1+4*n*n);
  function grainFrames({duration,offset=0,rate=1},source,outputRate,limit){
    return Math.max(0,Math.ceil(outputRate*Math.min(limit,duration??Infinity,(source.duration-offset)/rate)));
  }
  function addGrain(output,destination,length,source,{offset=0,rate=1,gain,cutoff=22000},sampleRate,clipLength=length){
    const step=source.sampleRate/sampleRate*rate, start=offset*source.sampleRate;
    const alpha=cutoff>=22000?1:-Math.expm1(-tau*cutoff/sampleRate);
    const fade=Math.max(1,Math.min(clipLength*.25,sampleRate*.006));
    let low=0;
    for(let i=0;i<length;i++){
      const x=start+i*step,j=Math.floor(x),a=source.sample(j),b=source.sample(j+1);
      low+=alpha*(a+(x-j)*(b-a)-low);
      if(destination+i>=0)output[destination+i]+=low*gain*Math.min(1,(clipLength-i)/fade);
    }
  }
  return Object.freeze({monitorDelay,direction,sector,point,shape,grainFrames,addGrain});
})();
if (typeof module !== 'undefined') module.exports = InkCrowdAudio;
else globalThis[Symbol.for('ink-studio.crowd-audio')] = InkCrowdAudio;
