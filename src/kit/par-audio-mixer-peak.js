/* Shared polyphase true-peak reconstruction and offline lookahead limiting. */
(function (P) {
  const S=P.mediaGraphSupport, {fields,check,finite,db}=P.musicInstruments;
  const radius=16, logs=value=>value===0 ? null : 20*Math.log10(value);
  const sinc=x=>x===0 ? 1 : Math.sin(Math.PI*x)/(Math.PI*x);
  const phases=Array.from({length:7},(_,phase)=>{
    const weights=Array.from({length:2*radius},(_,tap)=>{
      const x=(phase+1)/8+radius-1-tap, w=Math.PI*x/radius;
      return sinc(x)*(.42+.5*Math.cos(w)+.08*Math.cos(2*w));
    });
    const sum=weights.reduce((a,b)=>a+b,0);
    return Float64Array.from(weights,value=>value/sum);
  });
  const fourths=[phases[1],phases[3],phases[5]];
  function interval(samples,channels,frame,kernels,peak=0) {
    const count=samples.length/channels, first=frame-radius+1;
    const start=Math.max(0,-first), end=Math.min(2*radius,count-first);
    for (let ch=0;ch<channels;ch++) {
      const at=frame*channels+ch;
      if (frame>=0 && frame<count) peak=Math.max(peak,Math.abs(samples[at]));
      for (const weights of kernels) {
        let value=0;
        for (let tap=start;tap<end;tap++) value+=weights[tap]*samples[(first+tap)*channels+ch];
        peak=Math.max(peak,Math.abs(value));
      }
    }
    return peak;
  }
  function peak(samples,channels) {
    let best=0;
    const frames=samples.length/channels;
    if (!frames) return best;
    for (let frame=-radius;frame<frames+radius;frame++) best=interval(samples,channels,frame,phases,best);
    return best;
  }
  function limiter(raw,rate,time,wet) {
    check(fields(raw,['type','wet','ceilingDbTP','lookahead','release','inputDb']),
      'Unknown true-peak limiter parameter');
    const {ceilingDbTP=-1,lookahead=.005,release=.075}=raw;
    check(finite(ceilingDbTP,-24,-.1) && finite(lookahead,.001,.05) && finite(release,.005,2) &&
      wet.min===1 && wet.max===1,'Limiter needs a fixed ceiling, lookahead, release, and a fully wet insert');
    const inputDb=time.lane(raw.inputDb,0,-24,24,'limiter input gain');
    const ahead=Math.round(lookahead*rate), latency=ahead+radius, recovery=1-Math.exp(-1/(rate*release));
    const ceiling=db(ceilingDbTP), target=ceiling*db(-.08);
    function block(input,output) {
      const gain=inputDb.reader(), scaled=new Float64Array(input.length), frames=input.length/2;
      for (let i=0;i<frames;i++) {
        const level=db(gain(i));
        scaled[2*i]=input[2*i]*level;
        scaled[2*i+1]=input[2*i+1]*level;
      }
      const size=Math.min(frames,ahead+1)+1, indexes=new Int32Array(size), values=new Float64Array(size);
      let first=0,last=0,scan=0,envelope=1,reduction=1,detected=0;
      for (let i=0;i<frames;i++) {
        while (first<last && indexes[first%size]<i) first++;
        for (;scan<Math.min(frames,i+ahead+1);scan++) {
          const value=interval(scaled,2,scan,fourths);
          detected=Math.max(detected,value);
          while (first<last && values[(last-1)%size]<=value) last--;
          indexes[last%size]=scan;
          values[last%size]=value;
          last++;
        }
        const aim=Math.min(1,target/Math.max(1e-30,values[first%size]));
        envelope=Math.min(aim,envelope+(1-envelope)*recovery);
        reduction=Math.min(envelope,reduction);
        output[2*i]=scaled[2*i]*envelope;
        output[2*i+1]=scaled[2*i+1]*envelope;
      }
      // Gain changes can create new inter-sample peaks. Verify the limited PCM itself.
      const measured=peak(output,2), guard=measured>target ? target/measured : 1;
      if (guard<1) for (let i=0;i<output.length;i++) output[i]*=guard;
      return {ceilingDbTP,detectedDbTP:logs(detected),outputDbTP:logs(measured*guard),
        maximumReductionDb:-logs(reduction*guard),guardDb:-logs(guard),verificationOversample:8};
    }
    return {type:'limiter',latency,tail:0,sidechain:false,cost:170,extra:2,block,wet};
  }
  S.mixerPeak={peak,limiter,levelDb:logs};
})(KIT.procedural);
