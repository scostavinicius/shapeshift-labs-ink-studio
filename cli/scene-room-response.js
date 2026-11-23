/* Feed independent impulse responses on the scene sample grid. */
function addRoomResponse({assets,smoothing,path,convolution}, resolve, input, bus, rate, firstSample, reportStart) {
  const frames=input.length/2, decay=smoothing ? Math.exp(-1/(rate*smoothing)) : 0;
  const weighted=new Float32Array(input.length), wetSum=new Float32Array(bus.length);
  const outputOffset=2*(reportStart-firstSample);
  let rendered=0, work=frames*assets.length;
  for (const impulse of assets) {
    const effect=convolution(impulse,resolve(impulse),rate);
    const targets=path.map(row=>({at:row.sample-firstSample,gain:row.sends.find(send=>send.asset===impulse)?.gain??0}));
    let next=0, target=0, level=0, first=frames, last=0;
    for (let i=0;i<frames;i++) {
      while (next<targets.length && targets[next].at<=i) {
        target=targets[next++].gain;
        if (!i) level=target;
      }
      const n=i*2, send=smoothing ? level : target;
      const l=weighted[n]=input[n]*send, r=weighted[n+1]=input[n+1]*send;
      if (Math.max(Math.abs(l),Math.abs(r))>1e-12) {
        first=Math.min(i,first);
        last=i+1;
      }
      level=target+decay*(level-target);
    }
    if (last<=first) continue;
    const count=Math.min(frames-first,last-first+effect.tail);
    work+=count*effect.cost;
    if (work>240e6) throw new RangeError('Scene room response exceeds its processing budget');
    const wet=new Float32Array(count*2);
    effect.block(weighted.subarray(first*2,last*2),wet);
    let audible=false;
    for (let i=Math.max(0,outputOffset-first*2);i<wet.length;i++) {
      wetSum[first*2+i-outputOffset]+=wet[i];
      audible ||= Math.abs(wet[i])>1e-12;
    }
    if (audible) rendered++;
  }
  let peak=0;
  for (let i=0;i<bus.length;i++) {
    bus[i]+=wetSum[i];
    peak=Math.max(peak,Math.abs(wetSum[i]));
  }
  return {assets:rendered,peak};
}

module.exports={addRoomResponse};
