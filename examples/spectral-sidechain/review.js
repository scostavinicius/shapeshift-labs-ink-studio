(function () {
  const byId=id=>document.getElementById(id);
  const play=byId('play'),bypass=byId('bypass'),processed=byId('processed'),solo=byId('solo');
  const ceiling=byId('ceiling'),seek=byId('seek'),position=byId('position'),status=byId('status'),canvas=byId('mask');
  const {mixer,duration}=demo,rate=mixer.sampleRate,chart=canvas.getContext('2d');
  let context,source,offset=0,start=0,enabled=true,soloed=false,playing=false,rendering,frame;
  let mask=demo.mask,mediaGraph,assets,buffers={};
  const seconds=()=>playing ? (offset+context.currentTime-start)%duration : offset;
  async function unpack(text) {
    const compressed=Uint8Array.from(atob(text),char=>char.charCodeAt(0));
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  function pcm(buffer) {
    return {sampleRate:rate,channels:2,samples:new Float32Array(buffer)};
  }
  function audioBuffer({samples}) {
    const buffer=context.createBuffer(2,samples.length/2,rate);
    for (let ch=0;ch<2;ch++) {
      const dest=buffer.getChannelData(ch);
      for (let i=0;i<dest.length;i++) dest[i]=samples[2*i+ch];
    }
    return buffer;
  }
  function stopVoice() {
    if (!source) return;
    const now=context.currentTime,{node,gain}=source;
    if (gain.gain.cancelAndHoldAtTime) gain.gain.cancelAndHoldAtTime(now);
    else {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value,now);
    }
    gain.gain.linearRampToValueAtTime(0,now+.012);
    node.stop(now+.013);
    source=null;
  }
  function swapVoice() {
    stopVoice();
    if (!playing) return;
    const node=context.createBufferSource(),gain=context.createGain(),now=context.currentTime;
    node.buffer=soloed ? buffers[enabled ? 'keys' : 'rival'] : buffers[enabled ? 'processed' : 'bypass'];
    node.loop=true;
    node.connect(gain).connect(context.destination);
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(1,now+.012);
    node.start(now,seconds());
    node.onended=()=>{node.disconnect();gain.disconnect();};
    source={node,gain};
  }
  const hz=value=>value>=1000 ? (value/1000)+'k' : String(value);
  function paint(time) {
    const width=canvas.clientWidth,height=canvas.clientHeight,dpr=devicePixelRatio || 1;
    const pixelWidth=Math.round(width*dpr),pixelHeight=Math.round(height*dpr);
    if (canvas.width!==pixelWidth || canvas.height!==pixelHeight) {
      canvas.width=pixelWidth;
      canvas.height=pixelHeight;
    }
    chart.setTransform(dpr,0,0,dpr,0,0);
    chart.clearRect(0,0,width,height);
    const left=68,plotWidth=width-left,heightPerBand=(height-23)/(mask.frequencyEdgesHz.length-1);
    chart.font='11px ui-monospace,monospace';
    chart.textBaseline='middle';
    chart.fillStyle='#b0beb2';
    for (let band=0;band<mask.frequencyEdgesHz.length-1;band++) {
      const bottom=mask.frequencyEdgesHz.length-2-band,y=bottom*heightPerBand;
      const [low,high]=mask.frequencyEdgesHz.slice(band,band+2);
      chart.fillText(hz(low)+'–'+hz(high),0,y+heightPerBand/2);
      chart.fillStyle='#27322a';
      chart.fillRect(left,y,plotWidth,heightPerBand-1);
      if (enabled) mask.trace.forEach((row,index)=>{
        const stepWidth=plotWidth*mask.traceStepSamples/(duration*rate),cut=row[band];
        if (cut<=.02) return;
        chart.fillStyle='rgba(217,248,138,'+Math.min(1,cut/12)+')';
        chart.fillRect(left+index*stepWidth,y,Math.min(stepWidth,plotWidth-index*stepWidth),heightPerBand-1);
      });
      chart.fillStyle='#b0beb2';
    }
    for (let t=0;t<=duration;t+=2) {
      const x=left+t/duration*plotWidth;
      chart.fillText(t+' s',Math.min(x,width-22),height-8);
    }
    chart.fillStyle='#edf3e9';
    chart.fillRect(Math.min(width-1,left+plotWidth*time/duration),0,1,height-23);
  }
  function refresh() {
    const time=seconds();
    position.textContent=time.toFixed(2)+' / '+duration.toFixed(2)+' s';
    seek.value=time;
    paint(time);
    if (playing) frame=requestAnimationFrame(refresh);
  }
  function describe() {
    status.textContent=enabled ? 'Peak mask cut '+mask.peakCutDb.toFixed(1)+' dB' : 'Insert bypassed';
  }
  function selection(active) {
    enabled=active;
    bypass.setAttribute('aria-pressed',String(!active));
    processed.setAttribute('aria-pressed',String(active));
    if (context) swapVoice();
    describe();
    paint(seconds());
  }
  bypass.onclick=()=>selection(false);
  processed.onclick=()=>selection(true);
  solo.onclick=()=>{
    soloed=!soloed;
    solo.setAttribute('aria-pressed',String(soloed));
    if (context) swapVoice();
  };
  play.onclick=async()=>{
    if (playing) {
      offset=seconds();
      playing=false;
      cancelAnimationFrame(frame);
      stopVoice();
      play.textContent='Play';
      refresh();
      return;
    }
    await context.resume();
    start=context.currentTime;
    playing=true;
    swapVoice();
    play.textContent='Pause';
    refresh();
  };
  function jump(time) {
    offset=Math.max(0,Math.min(duration-.001,time));
    if (playing) {
      start=context.currentTime;
      swapVoice();
    } else refresh();
  }
  seek.oninput=()=>jump(Number(seek.value));
  canvas.onclick=event=>{
    const width=canvas.clientWidth,at=event.clientX-canvas.getBoundingClientRect().left;
    jump(duration*(at-68)/(width-68));
  };
  new ResizeObserver(()=>paint(seconds())).observe(canvas);
  ceiling.oninput=()=>{
    const maxCutDb=Number(ceiling.value);
    byId('ceiling-value').textContent=maxCutDb+' dB';
    clearTimeout(rendering);
    status.textContent='Rendering…';
    rendering=setTimeout(()=>{
      try {
        const processors={space:{...mixer.processors.space,maxCutDb}};
        const result=mediaGraph.mixer.render({...mixer,processors},assets);
        buffers.processed=audioBuffer(result.value);
        buffers.keys=audioBuffer(result.taps.keys);
        mask=result.report.strips.rival.inserts[0].details;
        if (enabled) swapVoice();
        describe();
        paint(seconds());
      } catch (error) {status.textContent='Render failed. '+error.message;}
    },90);
  };
  async function init() {
    context=new AudioContext();
    const assetRows=Object.entries(demo.assets),mixRows=Object.entries(demo.mixes);
    const [engine,...tracks]=await Promise.all([unpack(inkBundle),...assetRows.concat(mixRows).map(([,data])=>unpack(data))]);
    mediaGraph=Function(new TextDecoder().decode(engine)+'\nreturn KIT.procedural.mediaGraph;')();
    assets=Object.fromEntries(assetRows.map(([id],i)=>[id,pcm(tracks[i])]));
    buffers=Object.fromEntries(mixRows.map(([id],i)=>[id,audioBuffer(pcm(tracks[assetRows.length+i]))]));
    buffers.rival=audioBuffer(assets.rival);
    play.disabled=ceiling.disabled=false;
    describe();
  }
  init().catch(error=>{status.textContent='Audio could not load. '+error.message;});
})();
