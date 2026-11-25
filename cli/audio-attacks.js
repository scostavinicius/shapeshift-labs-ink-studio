/* Detect an isolated attack inside a PCM window with context on either side. */
function measureAttacks(mediaGraph,{sampleRate,channels,samples},{
  from,to,channel='all',minStrength=.035,minPeakDbFS=-42,minRiseDb=6
}) {
  const count=samples.length/channels;
  if (from<0||to>count||to<=from) return {status:'uncovered',hit:null,candidates:[]};
  const pad=Math.round(.12*sampleRate), first=Math.max(0,from-pad), end=Math.min(count,to+pad);
  if (end-first>sampleRate*20) throw new RangeError('Audio search windows with context must be shorter than 20 seconds');
  let window=samples.subarray(first*channels,end*channels);
  let max=1;
  for (const sample of window) max=Math.max(max,Math.abs(sample));
  // Native transient analysis expects unit-range input. Keep the actual
  // samples and levels for its amplitude gate and for the caller's meters.
  if (max>1) window=window.map(value=>value/max);
  function peak(a,b,ch) {
    let result=0;
    for (let i=Math.max(0,a);i<Math.min(b,count);i++) {
      let value=0;
      if (ch==='mix') {
        for (let c=0;c<channels;c++) value+=samples[i*channels+c]/channels;
      } else value=samples[i*channels+ch];
      result=Math.max(result,Math.abs(value));
    }
    return 20*Math.log10(Math.max(1e-9,result));
  }
  const margin=Math.round(sampleRate*.012), short=Math.round(sampleRate*.002);
  const pcm={sampleRate,channels,samples:window};
  const candidates=mediaGraph.detectTransients(pcm,{channel,minStrength}).events.flatMap(({detected})=>{
    const sample=first+detected.sample;
    if (sample<from||sample>=to) return [];
    const level=peak(sample,sample+margin,detected.channel);
    const baseline=peak(sample-margin,sample-short,detected.channel);
    if (level<minPeakDbFS||level-baseline<minRiseDb) return [];
    return [{sample,channel:detected.channel,strength:detected.strength,peakDbFS:level,riseDb:level-baseline}];
  });
  const hit=candidates.length===1?candidates[0]:null;
  return {status:hit?'measured':candidates.length?'ambiguous':'unobserved',hit,candidates};
}

module.exports = {measureAttacks};
