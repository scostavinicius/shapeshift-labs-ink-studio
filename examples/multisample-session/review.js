(function () {
  const get=id=>document.getElementById(id);
  const play=get('play'),room=get('room'),roomValue=get('room-value'),time=get('time'),status=get('status');
  const colors=['#314cb2','#95613e','#75418c'],labels=['Close','Middle','Room'];
  const {sampleRate,duration,modes,settings}=demo;
  let context,tracks,voices,mode='aligned',offset=0,start=0,frame,playing=false;
  const current=()=>playing ? Math.max(0,(context.currentTime-start)%duration) : offset;
  const milliseconds=n=>(n/sampleRate*1000).toFixed(2)+' ms';
  for (const [i,setting] of settings.entries()) {
    const row=document.createElement('div'),mic=document.createElement('dt'),data=document.createElement('dd');
    mic.textContent=labels[i];
    data.textContent=i===0 ? 'Reference clock' : milliseconds(setting.offset)+' offset · '+
      (setting.polarity<0 ? 'polarity corrected' : milliseconds(setting.arrival)+' arrival retained');
    row.append(mic,data);
    get('measurements').append(row);
  }
  function plot(id) {
    const canvas=get(id+'-trace'),chart=canvas.getContext('2d'),dpr=devicePixelRatio || 1;
    const width=canvas.clientWidth,height=canvas.clientHeight,left=53,plotWidth=width-left-5,plotHeight=height-21;
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    chart.scale(dpr,dpr);
    chart.font='10px ui-monospace,monospace';
    chart.textBaseline='middle';
    for (const ms of [-10,0,10,20,30,40,50]) {
      const x=left+plotWidth*(ms+15)/67;
      chart.fillStyle=ms===0 ? '#9da7c5' : '#dedfe3';
      chart.fillRect(x,0,1,plotHeight);
      if (ms%20===0 || ms===-10) {
        chart.fillStyle='#566175';
        chart.fillText(ms+' ms',Math.min(width-32,x-12),height-9);
      }
    }
    modes[id].trace.forEach((trace,i)=>{
      const y=(i+.5)*plotHeight/3;
      chart.fillStyle=colors[i];
      chart.fillText(labels[i],0,y);
      chart.strokeStyle=colors[i];chart.beginPath();
      trace.forEach((value,j)=>{
        const x=left+j*plotWidth/(trace.length-1),row=y-Math.max(-.55,Math.min(.55,value))*plotHeight*.50;
        if (j===0) chart.moveTo(x,row);else chart.lineTo(x,row);
      });
      chart.stroke();
    });
  }
  for (const id of Object.keys(modes)) {
    new ResizeObserver(()=>plot(id)).observe(get(id+'-trace'));
    get(id).onclick=()=>{
      mode=id;
      for (const name of Object.keys(modes)) {
        get(name).setAttribute('aria-pressed',String(name===mode));
        get(name+'-figure').classList.toggle('active',name===mode);
      }
      mix();
    };
  }
  function weights() {
    const point=2*Number(room.value)/100;
    return [Math.max(0,1-point),1-Math.abs(point-1),Math.max(0,point-1)];
  }
  function mix() {
    roomValue.textContent=room.value+'%';
    if (!voices) return;
    const target=weights(),now=context.currentTime;
    for (const [id,group] of Object.entries(voices)) group.forEach(({gain},i)=>{
      gain.gain.setTargetAtTime(mode===id ? target[i] : 0,now,.007);
    });
  }
  room.oninput=mix;
  for (const button of document.querySelectorAll('[data-position]')) button.onclick=()=>{
    room.value=button.dataset.position;
    mix();
  };
  function showTime() {
    time.textContent=current().toFixed(2)+' s';
    if (playing) frame=requestAnimationFrame(showTime);
  }
  play.onclick=async()=>{
    if (playing) {
      offset=current();
      playing=false;
      cancelAnimationFrame(frame);
      const now=context.currentTime;
      for (const group of Object.values(voices)) for (const {node,gain} of group) {
        gain.gain.setTargetAtTime(0,now,.004);
        node.stop(now+.03);
      }
      voices=null;
      play.textContent='Resume';
      showTime();
      return;
    }
    await context.resume();
    const when=context.currentTime+.02,target=weights();
    voices=Object.fromEntries(Object.entries(tracks).map(([id,buffers])=>[id,buffers.map((buffer,i)=>{
      const node=context.createBufferSource(),gain=context.createGain();
      node.buffer=buffer;node.loop=true;
      node.connect(gain).connect(context.destination);
      gain.gain.value=mode===id ? target[i] : 0;
      node.start(when,offset);
      node.onended=()=>{node.disconnect();gain.disconnect();};
      return {node,gain};
    })]));
    start=when-offset;
    playing=true;
    play.textContent='Pause';
    showTime();
  };
  async function decode(text) {
    const bytes=Uint8Array.from(atob(text),char=>char.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const pcm=new Int16Array(await new Response(stream).arrayBuffer());
    const buffer=context.createBuffer(2,pcm.length/2,sampleRate);
    for (let ch=0;ch<2;ch++) {
      const out=buffer.getChannelData(ch);
      for (let i=0;i<out.length;i++) out[i]=pcm[i*2+ch]/32767;
    }
    return buffer;
  }
  async function init() {
    context=new AudioContext();
    tracks=Object.fromEntries(await Promise.all(Object.entries(modes).map(async ([id,{audio}])=>
      [id,await Promise.all(audio.map(decode))])));
    play.disabled=false;
    status.textContent='Calibrated playback retains the room mic’s '+milliseconds(settings[2].arrival)+' acoustic arrival.';
  }
  init().catch(error=>{status.textContent='Audio could not load. '+error.message;});
})();
