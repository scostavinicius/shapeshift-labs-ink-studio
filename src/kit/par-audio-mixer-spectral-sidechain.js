/* Stereo-linked, score-aligned spectral gain for a foreground/rival pair. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,finite,integer,check,db}=P.musicInstruments;
  const smoothstep=x=>{
    const t=Math.max(0,Math.min(1,x));
    return t*t*(3-2*t);
  };
  function compile(raw,rate,wet) {
    const {size=2**Math.round(Math.log2(rate*.043)),maxCutDb=8,thresholdDb=-48,attackMs=12,
      releaseMs=85,lowHz=0,highHz=rate/2}=raw;
    check(fields(raw,['type','wet','size','maxCutDb','thresholdDb','attackMs','releaseMs','lowHz','highHz']) &&
      integer(size,256,4096) && !(size&(size-1)) && finite(maxCutDb,0,24) && finite(thresholdDb,-90,-6) &&
      finite(attackMs,0,500) && finite(releaseMs,0,2000) && finite(lowHz,0,rate/2) &&
      finite(highHz,0,rate/2) && lowHz<highHz,'Invalid spectral sidechain settings');
    const half=size/2,hop=size/4,binHz=rate/size,bins=half+1;
    const firstBin=Math.ceil(lowHz/binHz),lastBin=Math.floor(highHz/binHz);
    const threshold=db(thresholdDb),knee=threshold*(db(10)-1);
    const step=ms=>ms===0 ? 1 : -Math.expm1(-1000*hop/(rate*ms));
    const attack=step(attackMs),release=step(releaseMs),bypassed=maxCutDb===0 || wet.max===0;
    const frequencyEdgesHz=[0,...[125,250,500,1000,2000,4000,8000,16000].filter(hz=>hz<rate/2),rate/2];
    function block(input,output,key) {
      output.set(input.subarray(0,output.length));
      const frames=output.length/2,traceStep=hop*Math.ceil(frames/(hop*64)),bands=frequencyEdgesHz.length-1;
      const report={fftSize:size,hopSamples:hop,maxCutDb,thresholdDb,peakCutDb:0,overlapFrames:0,
        frequencyEdgesHz,traceStepSamples:traceStep,trace:[]};
      if (bypassed || !key.length || firstBin>lastBin) return report;
      const {transform,weights,total}=S.fftSetup({sampleRate:rate},{size},size,2);
      const trace=Array.from({length:Math.ceil(frames/traceStep)},()=>Array(bands).fill(0));
      const bandAt=Uint8Array.from({length:bins},(_,bin)=>{
        const edge=frequencyEdgesHz.findIndex(hz=>hz>bin*binHz);
        return edge===-1 ? bands-1 : edge-1;
      });
      const spectrum=()=>({re:new Float64Array(size),im:new Float64Array(size)});
      const rival=[spectrum(),spectrum()],foreground=[spectrum(),spectrum()];
      const cuts=new Float64Array(bins),gains=new Float64Array(bins),correction=new Float64Array(output.length);
      function analyze(samples,begin,channels) {
        for (let ch=0;ch<2;ch++) {
          const {re,im}=channels[ch];
          im.fill(0);
          for (let i=0;i<size;i++) re[i]=(samples[2*(begin+i)+ch] ?? 0)*weights[i];
          transform(re,im,0,1,-1);
        }
      }
      function magnitude(channels,bin,scale) {
        const [left,right]=channels;
        // Read the stronger channel without phase cancellation, then use one mask for both.
        const l=left.re[bin]**2+left.im[bin]**2,r=right.re[bin]**2+right.im[bin]**2;
        return Math.sqrt(Math.max(l,r))*scale;
      }
      for (let center=-hop;center<frames+half;center+=hop) {
        const begin=center-half,traceRow=center>=0 && center<frames ? trace[Math.floor(center/traceStep)] : null;
        analyze(input,begin,rival);
        analyze(key,begin,foreground);
        let overlaps=false,modified=false;
        for (let bin=firstBin;bin<=lastBin;bin++) {
          const scale=(bin===0 || bin===half ? 1 : 2)/total;
          const a=magnitude(rival,bin,scale),b=magnitude(foreground,bin,scale);
          const occupied=smoothstep((a-threshold)/knee)*smoothstep((b-threshold)/knee);
          const aim=occupied===0 ? 0 : maxCutDb*occupied*smoothstep(2*b/(a+b));
          const prior=cuts[bin],next=prior+(aim-prior)*(aim>prior ? attack : release);
          const cut=cuts[bin]=next<1e-5 ? 0 : Math.min(maxCutDb,next);
          gains[bin]=db(-cut)-1;
          overlaps ||= aim>0;
          modified ||= cut>0;
          report.peakCutDb=Math.max(report.peakCutDb,cut);
          if (traceRow) traceRow[bandAt[bin]]=Math.max(traceRow[bandAt[bin]],cut);
        }
        if (traceRow && overlaps) report.overlapFrames++;
        if (!modified) continue;
        const start=Math.max(0,-begin),end=Math.min(size,frames-begin);
        for (let ch=0;ch<2;ch++) {
          const {re,im}=rival[ch];
          for (let i=0;i<size;i++) {
            const gain=gains[Math.min(i,size-i)];
            re[i]*=gain;
            im[i]*=gain;
          }
          transform(re,im,0,1,1);
          for (let i=start;i<end;i++) correction[2*(begin+i)+ch]+=re[i]*weights[i];
        }
      }
      // Four periodic Hann windows make a constant squared sum of 1.5, including the padded edges.
      for (let i=0;i<output.length;i++) output[i]+=correction[i]/(1.5*size);
      report.trace=trace;
      return report;
    }
    return {type:raw.type,latency:half,tail:0,sidechain:true,requiresSidechain:true,wet,
      cost:bypassed ? 1 : 12+12*Math.log2(size),extra:bypassed ? 0 : 2,block};
  }
  S.spectralSidechain=compile;
})(KIT.procedural);
