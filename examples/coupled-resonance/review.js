(function () {
  const get=id=>document.getElementById(id),link=get('link'),stop=get('stop'),status=get('status');
  const player=document.querySelector('audio'),canvas=get('trace'),chart=canvas.getContext('2d');
  const {sampleRate:rate,contact,bodies,duration,breakAt,gain,modes}=demo;
  const takes=[...document.querySelectorAll('[data-take]')],names=Object.keys(bodies);
  let engine,context,session,starting,take,closed=true;
  function load() {
    return engine??=(async()=>{
      const bytes=Uint8Array.from(atob(compressed),char=>char.charCodeAt(0));
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const script=document.createElement('script');
      script.textContent=await new Response(stream).text();
      document.head.append(script);
      return KIT.world.resonantModes;
    })();
  }
  function paint() {
    const {clientWidth:width,clientHeight:height}=canvas,dpr=devicePixelRatio || 1;
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    }
    chart.setTransform(dpr,0,0,dpr,0,0);
    chart.clearRect(0,0,width,height);
    const left=45,plot=width-left-8,base=height-26,x=t=>left+t/duration*plot;
    chart.font='10px ui-monospace,monospace';
    chart.textBaseline='middle';
    for(const db of [-60,-40,-20,0]){
      const y=base-(db+60)/60*(base-12);
      chart.fillStyle='#3d4139';chart.fillRect(left,y,plot,1);
      chart.fillStyle='#c3c3b7';chart.fillText(db+' dB',0,y);
    }
    for(let t=0;t<=duration+.01;t+=width<440 ? 1 : .5)
      chart.fillText(t.toFixed(1)+' s',Math.min(width-32,x(t)),height-10);
    if(take==='release'){
      chart.fillStyle='#a39581';
      chart.fillRect(x(breakAt),0,1,base);
      chart.fillText('Contact breaks',x(breakAt)+5,12);
    }
    modes[take].envelopes.forEach((row,index)=>{
      chart.strokeStyle=index?'#8ecdbe':'#eeb983';
      chart.lineWidth=1.4;chart.beginPath();
      row.forEach((sample,i)=>{
        const db=Math.min(0,Math.max(-60,20*Math.log10(sample)));
        const y=base-(db+60)/60*(base-12), at=x(i*duration/(row.length-1));
        if(i)chart.lineTo(at,y);else chart.moveTo(at,y);
      });
      chart.stroke();
    });
  }
  function select(id) {
    if(id===take)return;
    const at=player.currentTime,resume=!player.paused;
    take=id;
    player.src='data:audio/wav;base64,'+modes[id].pcm;
    player.currentTime=at;
    for(const button of takes)button.setAttribute('aria-pressed',String(button.dataset.take===id));
    if(resume)player.play().catch(()=>{});
    paint();
  }
  const meters=view=>{
    const energy=view?.energy.bodies??{};
    get('gate-energy').value=Math.min(1,Math.sqrt(energy.gate??0)*1.4);
    get('rail-energy').value=Math.min(1,Math.sqrt(energy.railing??0)*1.4);
  };
  function fill() {
    const current=session;
    if(!current)return;
    if(current.next<context.currentTime)current.next=context.currentTime+.022;
    while(current.next<context.currentTime+.082){
      const impulses=current.queue.splice(0).map(body=>({body,excitation:'strike',sample:current.frame,value:.68}));
      const count=1024,block=current.pair.process(count,{impulses,contact:closed?1:0});
      current.frame=block.end;
      const audio=context.createBuffer(2,count,rate);
      for(const [i,name] of names.entries()){
        const output=audio.getChannelData(i),values=block.velocities[name].listen;
        for(let j=0;j<count;j++)output[j]=values[j]*gain*.8;
      }
      const node=context.createBufferSource();
      node.buffer=audio;node.connect(current.bus);current.nodes.add(node);
      node.onended=()=>{node.disconnect();current.nodes.delete(node);};
      node.start(current.next);
      current.next+=audio.duration;
    }
    meters(current.pair.view());
  }
  async function start() {
    player.pause();
    context??=new AudioContext();
    await context.resume();
    const api=await load();
    const pair=api.prepareCoupled({bodies,contact:{...contact,initial:closed?1:0}},{sampleRate:rate});
    const bus=context.createGain();bus.connect(context.destination);
    session={pair,bus,nodes:new Set(),queue:[],frame:0,next:context.currentTime+.031,timer:setInterval(fill,25)};
    status.textContent='Live audio';
    stop.disabled=false;
    return session;
  }
  async function strike(body) {
    try {
      status.textContent=session?'Live audio':'Preparing the resonators…';
      const live=session??await (starting??=start().finally(()=>{starting=null;}));
      if(live.queue.length<16)live.queue.push(body);
      fill();
    } catch(error) {status.textContent='Audio could not start. '+error.message;}
  }
  function halt(){
    if(!session)return;
    const {bus,nodes,timer}=session;
    clearInterval(timer);
    bus.gain.setTargetAtTime(0,context.currentTime,.007);
    for(const node of nodes)node.stop(context.currentTime+.03);
    setTimeout(()=>bus.disconnect(),45);
    session=null;
    stop.disabled=true;
    status.textContent='Ready';
    meters();
  }
  get('gate').onclick=()=>strike('gate');
  get('rail').onclick=()=>strike('railing');
  stop.onclick=halt;
  link.onclick=()=>{
    closed=!closed;
    link.textContent=closed?'Break contact':'Join again';
    link.setAttribute('aria-pressed',String(closed));
    get('joint').textContent=closed?'In contact':'Separated';
  };
  for(const button of takes)button.onclick=()=>{halt();select(button.dataset.take);};
  player.onplay=halt;
  new ResizeObserver(paint).observe(canvas);
  select('release');
})();
