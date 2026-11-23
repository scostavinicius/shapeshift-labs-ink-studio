/* Stretch a take's decay on its native grid, leaving the earlier PCM intact. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,{check,fields,finite,integer}=P.musicInstruments;
  function editorialTails() {
    const assets=new Map();
    let budget=0;
    return function tail(source,from,to,pin,step,raw) {
      if (raw===undefined) return null;
      check(fields(raw,['fromSample','factor','mode','joinSamples']) && integer(raw.fromSample,pin+1,to-1) &&
        finite(raw.factor,.5,3) && ['tones','speech','repitch'].includes(raw.mode ?? 'tones'),
      'Choose a tail start after sync, a factor in [.5,3], and a decay warp mode');
      const {fromSample,factor,mode='tones'}=raw, {channels,sampleRate,samples}=source;
      const length=to-fromSample, rendered=Math.max(1,Math.round(length*factor)), end=fromSample+rendered;
      const overlap=Math.min(length,rendered), joinSamples=raw.joinSamples ?? Math.min(overlap,Math.round(sampleRate*.015));
      check(integer(joinSamples,0,overlap),'Tail join must fit both decays on the source sample grid');
      const info={fromSample,factor,mode,joinSamples,renderedSamples:rendered};
      if (length===rendered) return {end,info};
      const first=Math.max(from,fromSample-48), prefix=fromSample-first;
      const cache=assets.get(source) ?? new Map();
      const key=[first,fromSample,to,rendered,mode,joinSamples].join(':');
      if (!cache.has(key)) {
        budget+=(prefix+rendered)*channels;
        check(budget<=16e6,'Editorial exceeds its warped tail sample budget');
        cache.set(key,()=>{
          const data=new Float64Array((prefix+rendered)*channels), offset=prefix*channels;
          data.set(samples.slice(first*channels,fromSample*channels));
          const {value}=A.warpAudio({sampleRate,channels,samples:samples.slice(fromSample*channels,to*channels)},
            {mode,targetFrames:rendered});
          data.set(value.samples,offset);
          for (let i=0;i<joinSamples;i++) {
            const u=.5-.5*Math.cos(Math.PI*i/joinSamples);
            for (let c=0;c<channels;c++) {
              const k=i*channels+c, original=samples[fromSample*channels+k];
              data[offset+k]=original+(data[offset+k]-original)*u;
            }
          }
          const reader=S.pcmReader({samples:data,channels},0,prefix+rendered,step);
          const read=(position,out)=>reader.read(position-first,out);
          cache.set(key,()=>read);
          return read;
        });
        assets.set(source,cache);
      }
      return {end,info,read:(position,out)=>cache.get(key)()(position,out)};
    };
  }
  S.editorialTails=editorialTails;
})(KIT.procedural);
