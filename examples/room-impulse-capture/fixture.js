/* Reproducible line check and stereo stairwell recording for the capture demo. */
(function(root){
  function stairwell(api,options={}){
    const sweep=api.sweep(options), {sampleRate,samples}=sweep, total=samples.length;
    const latency=Math.round(.0375*sampleRate), arrival=Math.round(.014*sampleRate);
    const recording=new Float32Array(total*2), loopback=new Float32Array(total);
    const taps=[[0,.64,.58],[17,.34,.08],[28,.09,.28],[41,.27,.09],[61,.09,.22],[84,.13,.17],[113,-.14,.06]];
    let seed=873;
    const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    for(let ms=135;ms<1390;ms+=3+rand()*9){
      const decay=.027*Math.exp(-ms/340);
      taps.push([ms,(rand()*2-1)*decay,(rand()*2-1)*decay]);
    }
    for(const [ms,left,right] of taps){
      const lag=latency+arrival+Math.round(sampleRate*ms/1000);
      for(let i=sweep.start;i<sweep.start+sweep.length&&i+lag<total;i++){
        recording[(i+lag)*2]+=samples[i]*left;
        recording[(i+lag)*2+1]+=samples[i]*right;
      }
    }
    for(let i=0;i<total;i++){
      recording[i*2]+=(rand()-.5)*.00004;
      recording[i*2+1]+=(rand()-.5)*.00004;
      loopback[i]=(samples[i-latency]??0)*.7+(rand()-.5)*.00001;
    }
    return {sweep,expected:{latency,arrival},room:{sampleRate,channels:2,samples:recording},
      loopback:{sampleRate,channels:1,samples:loopback}};
  }

  function strike(sampleRate){
    const samples=new Float32Array(Math.round(.18*sampleRate));
    let seed=204;
    for(let i=0;i<samples.length;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const t=i/sampleRate, impact=(seed/2147483648-1)*.33*Math.exp(-t/.0034);
      const body=.52*Math.sin(t*2*Math.PI*187)*Math.exp(-t/.013);
      const metal=.23*Math.sin(t*2*Math.PI*826)*Math.exp(-t/.034);
      samples[i]=(impact+body+metal)*Math.min(1,t/.0003);
    }
    return {sampleRate,channels:1,samples};
  }
  const fixture=Object.freeze({stairwell,strike});
  if(typeof module==='object'&&module.exports)module.exports=fixture;
  else root.InkRoomCaptureDemo=fixture;
})(globalThis);
