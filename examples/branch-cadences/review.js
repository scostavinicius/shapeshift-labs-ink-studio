(function () {
  const get=id=>document.getElementById(id);
  const start=get('start'),stop=get('stop'),transport=get('transport'),beat=get('beat');
  const branches=[...document.querySelectorAll('[data-section]')],takes=[...document.querySelectorAll('[data-take]')];
  const player=document.querySelector('audio'),rate=config.options.sampleRate;
  const names={pickup:'Pickup',turn:'Turnaround',full:'Full resolution'};
  let audio,session,loading,take,lastDecision='';
  function engine() {
    return loading ??=(async()=>{
      const data=Uint8Array.from(atob(compressed),ch=>ch.charCodeAt(0));
      const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
      const script=document.createElement('script');
      script.textContent=await new Response(stream).text();
      document.head.append(script);
      return KIT.music.production.live;
    })();
  }
  function display(cadence,to,heading) {
    const key=JSON.stringify([cadence?.id,cadence?.status,cadence?.landingFrame,to,heading]);
    if (key===lastDecision) return;
    lastDecision=key;
    get('decision-mode').textContent=heading;
    const chosen=get('chosen');
    const name=cadence?.id ? names[cadence.id] : cadence ? 'Straight landing' : 'Choose a branch';
    if (chosen.textContent!==name) chosen.textContent=name;
    get('decision').textContent=cadence ? config.labels[to]+' · '+(cadence.availableFrames/rate).toFixed(2)+
      ' s to land · beat '+cadence.beat.toFixed(2)+' · '+(cadence.dwellFrames/rate).toFixed(2)+' s aboard' : 'The decision will appear when you request an exit.';
    const width=cadence?.id ? 100*(cadence.landingFrame-cadence.startFrame)/cadence.availableFrames : 0;
    get('cadence-window').style.left=(100-width)+'%';
    get('timing').setAttribute('aria-label',cadence?.id ? name+' occupies the final '+Math.round(width)+' percent before landing' : 'No cadence interval');
  }
  function show() {
    if (!session) return;
    const view=session.score.inspect(), position=view.position*config.tempo/60;
    transport.textContent=config.labels[view.section]+(view.pending ? ' · Next '+config.labels[view.pending.to] : '');
    beat.textContent='Beat '+position.toFixed(2)+' / 4'+(view.phrase==='return-phrase' ? ' · Return phrase' : '');
    get('position').value=position;
    for (const button of branches) {
      const name=button.dataset.section;
      button.disabled=name===view.section && !view.pending;
    }
    const pending=view.pending?.cadence, join=view.joins.findLast(row=>row.carry.cadence);
    if (pending) display(pending,view.pending.to,'Live decision');
    else display(join?.carry.cadence,join?.to,'Live decision');
  }
  function fill() {
    const current=session;
    if (!current) return;
    if (current.next<audio.currentTime) current.next=audio.currentTime+.022;
    while (current.next<audio.currentTime+.085) {
      const block=current.score.pull(1024),buffer=audio.createBuffer(2,1024,rate);
      for (let ch=0;ch<2;ch++) {
        const data=buffer.getChannelData(ch);
        for (let i=0;i<data.length;i++) data[i]=block.samples[2*i+ch];
      }
      const node=audio.createBufferSource();
      node.buffer=buffer;
      node.connect(current.bus);
      current.nodes.add(node);
      node.onended=()=>{node.disconnect();current.nodes.delete(node);};
      node.start(current.next);
      current.next+=buffer.duration;
    }
  }
  function select(name,play=false) {
    const example=config.examples[name];
    if (name!==take) {
      take=name;
      player.src='data:audio/wav;base64,'+example.pcm;
    }
    for (const button of takes) button.setAttribute('aria-pressed',String(button.dataset.take===name));
    display(example.join.carry.cadence,example.join.to,'Recorded decision');
    if (play) player.play().catch(error=>{transport.textContent=error.message;});
  }
  function halt() {
    if (session) {
      const {nodes,bus,timer,display}=session;
      clearInterval(timer);
      clearInterval(display);
      bus.gain.setTargetAtTime(0,audio.currentTime,.006);
      for (const node of nodes) node.stop(audio.currentTime+.025);
      setTimeout(()=>bus.disconnect(),45);
      session=null;
    }
    transport.textContent='Start the score to choose a branch.';
    start.disabled=false;
    stop.disabled=true;
    for (const button of branches) button.disabled=true;
    get('position').value=0;
    beat.textContent='Beat 0.00 / 4';
  }
  start.onclick=async()=>{
    start.disabled=true;
    player.pause();
    transport.textContent='Preparing the live score…';
    try {
      audio??=new AudioContext();
      await audio.resume();
      const live=await engine(),score=live.open(config.sources,config.timeline,config.options);
      const bus=audio.createGain();
      bus.connect(audio.destination);
      const current={score,bus,nodes:new Set(),next:audio.currentTime+.035};
      session=current;
      stop.disabled=false;
      fill();
      show();
      current.timer=setInterval(fill,25);
      current.display=setInterval(show,90);
    } catch (error) {
      halt();
      transport.textContent='The live score could not start. '+error.message;
    }
  };
  stop.onclick=()=>{halt();select(take);};
  for (const button of branches) button.onclick=()=>{
    if (!session) return;
    const {score}=session,view=score.inspect();
    score.dispatch({kind:'music-transition',time:view.time,from:view.section,to:button.dataset.section});
  };
  for (const button of takes) button.onclick=()=>{
    if (session) halt();
    select(button.dataset.take,true);
  };
  player.onplay=()=>{
    if (session) halt();
    select(take);
  };
  select('pickup');
})();
