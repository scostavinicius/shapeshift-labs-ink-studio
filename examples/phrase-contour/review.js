(function () {
  const audio=document.querySelector('audio'),canvas=document.querySelector('#contour'),chart=canvas.getContext('2d');
  const picks=[...document.querySelectorAll('[data-take]')],{notes,breath,duration}=demo;
  let take,frame;
  const peakShift=Math.max(...notes.map(note=>Math.abs(note.borrowed-note.written)));
  document.querySelector('#details').textContent=notes.length+' notes · '+(peakShift*1000).toFixed(0)+' ms largest fitted attack shift';
  function paint() {
    const {clientWidth:width,clientHeight:height}=canvas,dpr=devicePixelRatio || 1;
    if (canvas.width!==Math.round(width*dpr) || canvas.height!==Math.round(height*dpr)) {
      canvas.width=Math.round(width*dpr);
      canvas.height=Math.round(height*dpr);
    }
    chart.setTransform(dpr,0,0,dpr,0,0);
    chart.clearRect(0,0,width,height);
    const left=58,plotWidth=width-left-6,base=height-25;
    const x=seconds=>left+seconds/duration*plotWidth;
    chart.font='11px ui-monospace,monospace';
    chart.textBaseline='middle';
    for (let t=0;t<=duration+.01;t+=width<450 ? 1 : .5) {
      chart.fillStyle='#e0e8de';
      chart.fillRect(x(t),0,1,base);
      chart.fillStyle='#4c665c';
      chart.fillText(t.toFixed(1),Math.min(width-24,x(t)),base+12);
    }
    const high=Math.max(...notes.map(note=>note.midi)),low=Math.min(...notes.map(note=>note.midi));
    chart.fillText('Notes',1,24);
    for (const note of notes) {
      const y=15+95*(high-note.midi)/Math.max(1,high-low);
      chart.fillStyle='rgba(111,137,118,'+(.42+note.writtenAccent*.50)+')';
      chart.fillRect(x(note.written),y,Math.max(1,x(note.keyUp)-x(note.written)),5);
      chart.fillStyle='rgba(29,113,91,'+(.26+note.borrowedAccent*.70)+')';
      chart.fillRect(x(note.borrowed),y+6,Math.max(1,x(note.keyUp)-x(note.borrowed)),5);
    }
    chart.fillStyle='#4c665c';
    chart.fillText('Breath',1,143);
    chart.strokeStyle='#227e65';
    chart.lineWidth=2;
    chart.beginPath();
    breath.forEach(([time,value],i)=>{
      const y=base-5-value*46;
      if (i) chart.lineTo(x(time),y);else chart.moveTo(x(time),y);
    });
    chart.stroke();
    if (take!=='donor') {
      chart.fillStyle='#2e443d';
      chart.fillRect(x(Math.min(duration,audio.currentTime)),0,1,base);
    }
  }
  function tick() {
    paint();
    if (!audio.paused) frame=requestAnimationFrame(tick);
  }
  function select(id) {
    if (id===take) return;
    const resume=!audio.paused,at=take==='donor' || id==='donor' ? 0 : audio.currentTime;
    take=id;
    audio.src='data:audio/wav;base64,'+demo.audio[id];
    audio.currentTime=at;
    for (const button of picks) button.setAttribute('aria-pressed',String(button.dataset.take===id));
    if (resume) audio.play().catch(()=>{});
    paint();
  }
  for (const button of picks) button.onclick=()=>select(button.dataset.take);
  audio.onplay=()=>{cancelAnimationFrame(frame);tick();};
  audio.onpause=()=>{cancelAnimationFrame(frame);paint();};
  audio.onseeked=paint;
  new ResizeObserver(paint).observe(canvas);
  select('borrowed');
})();
