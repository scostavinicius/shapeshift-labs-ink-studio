/* Band-limited stereo reads from an isolated mono or stereo PCM range. */
(function (P) {
  const sinc=x=>Math.abs(x)<1e-10 ? 1 : Math.sin(Math.PI*x)/(Math.PI*x);
  function pcmReader({samples,channels},first,end,step) {
    const cutoff=step>1 ? .94/step : 1;
    const radius=Math.min(48,Math.ceil(8/cutoff));
    function read(pos,out) {
      const base=Math.floor(pos);
      if (cutoff===1 && base===pos) {
        out[0]=samples[base*channels] ?? 0;
        out[1]=channels===1 ? out[0] : samples[base*2+1] ?? 0;
        return;
      }
      let left=0,right=0,total=0;
      for (let i=Math.max(first,base-radius+1);i<Math.min(end,base+radius+1);i++) {
        const x=i-pos, w=sinc(x*cutoff)*sinc(x/radius);
        left+=w*samples[i*channels];
        if (channels===2) right+=w*samples[i*2+1];
        total+=w;
      }
      out[0]=left/total;
      out[1]=channels===1 ? out[0] : right/total;
    }
    return {read,cost:step===1 ? 2 : radius*4};
  }
  P.mediaGraphSupport.pcmReader=pcmReader;
  P.mediaGraph.pcmReader=pcmReader;
})(KIT.procedural);
