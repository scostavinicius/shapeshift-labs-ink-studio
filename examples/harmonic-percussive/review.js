const ui=Object.fromEntries([...document.querySelectorAll('[id]')].map(node=>[node.id,node]));
const audio=document.querySelector('audio'), buttons=[...document.querySelectorAll('[data-mode]')];
const inputs=[ui.pitch,ui['hit-a'],ui['hit-b']];
const fmt=(n,unit)=>(n>0?'+':'')+n+' '+unit;
const decode=text=>Uint8Array.from(atob(text),ch=>ch.charCodeAt(0));
const pcm=(text)=>({sampleRate:config.rate,channels:config.channels,samples:new Float32Array(decode(text).buffer)});
const layers=Object.fromEntries(Object.entries(config.layers).map(([name,base64])=>[name,pcm(base64)]));
let module, mode, remixURL, editedSession=config.edited, busy=false;
function editor(){
  return module??=(async()=>{
    const bytes=decode(compressedEngine);
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const script=document.createElement('script');
    script.textContent=await new Response(stream).text();
    document.head.append(script);
    return KIT.procedural.mediaGraph.audioEditorial;
  })();
}
function wav(value){
  const {sampleRate,samples}=value, bytes=new Uint8Array(44+samples.length*2), view=new DataView(bytes.buffer);
  for(const [at,tag] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])bytes.set(new TextEncoder().encode(tag),at);
  for(const [at,n] of [[4,bytes.length-8],[16,16],[24,sampleRate],[28,sampleRate*4],[40,samples.length*2]])view.setUint32(at,n,true);
  for(const [at,n] of [[20,1],[22,2],[32,4],[34,16]])view.setUint16(at,n,true);
  samples.forEach((n,i)=>view.setInt16(44+i*2,Math.max(-32768,Math.min(32767,Math.round(n*32768))),true));
  return new Blob([bytes],{type:'audio/wav'});
}
function draw(){
  for(const [name,color] of [['harmonic','#a9dccc'],['percussive','#ffbc86']]){
    const canvas=ui[name+'-wave'], width=Math.round(canvas.clientWidth*devicePixelRatio), height=Math.round(canvas.clientHeight*devicePixelRatio);
    if(!width||!height)continue;
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d'), {channels,samples}=layers[name], frames=samples.length/channels;
    context.fillStyle='#3e4f64';
    context.fillRect(0,height/2,width,1);
    context.fillStyle=color;
    for(let x=0;x<width;x++){
      let lo=0,hi=0;
      const first=Math.floor(x*frames/width), last=Math.min(frames,Math.ceil((x+1)*frames/width));
      for(let i=first*channels;i<last*channels;i++){
        lo=Math.min(lo,samples[i]);hi=Math.max(hi,samples[i]);
      }
      if(lo!==hi)context.fillRect(x,height*(.5-hi),1,Math.max(1,height*(hi-lo)));
    }
    if(name==='percussive'){
      context.fillStyle='#fff1ce';
      for(const [i,hit] of config.hits.entries()){
        const old=hit.sample*width/frames;
        const moved=(hit.sample+Number(inputs[i+1].value)*config.rate/1000)*width/frames;
        context.globalAlpha=.33;context.fillRect(old,0,1,height);
        context.globalAlpha=1;context.fillRect(moved,0,2,height);
      }
    }
  }
}
function labels(){
  ui['pitch-value'].textContent=fmt(Number(ui.pitch.value),'st');
  for(const id of ['hit-a','hit-b'])ui[id+'-value'].textContent=fmt(Number(ui[id].value),'ms');
  draw();
}
function select(next,{force=false,play=false}={}){
  if(next===mode&&!force)return;
  const time=audio.currentTime, resume=play||!audio.paused;
  mode=next;
  audio.src=mode==='remix'&&remixURL?remixURL:'data:audio/wav;base64,'+config.clips[mode];
  audio.currentTime=time;
  for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));
  if(resume)audio.play().catch(error=>{ui.status.textContent=error.message;});
}
async function apply(){
  if(busy)return;
  busy=true;
  ui.apply.disabled=true;ui.save.disabled=true;
  ui.status.textContent='Rendering edits.';
  const pitch=Number(ui.pitch.value), shifts=inputs.slice(1).map(input=>Number(input.value));
  try{
    const native=await editor();
    const changes=[{op:'transpose',clip:'harmonic',semitones:pitch},...config.hits.map(({id},i)=>({
      op:'nudge',clip:id,offsetSamples:Math.round(shifts[i]*config.rate/1000)}))];
    const revision=native.revise(config.project.session,layers,changes);
    const sound=native.render(revision.value,layers).value;
    const previous=remixURL;
    remixURL=URL.createObjectURL(wav(sound));
    editedSession=revision.value;
    ui.status.textContent='Remix '+fmt(pitch,'semitones')+' · Snares '+shifts.map(value=>fmt(value,'ms')).join(' and ')+'.';
    select('remix',{force:true,play:true});
    if(previous)URL.revokeObjectURL(previous);
  }catch(error){
    ui.status.textContent=error.message;
  }finally{
    busy=false;ui.apply.disabled=false;ui.save.disabled=false;
  }
}
function save(){
  const project={session:editedSession,assets:config.project.assets};
  const data=new Blob([JSON.stringify(project,null,2)+'\n'],{type:'application/json'});
  const link=document.createElement('a'), url=URL.createObjectURL(data);
  link.href=url;link.download='relay-break-edit.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
for(const button of buttons)button.addEventListener('click',()=>select(button.dataset.mode));
for(const input of inputs)input.addEventListener('input',labels);
ui.pitch.value=config.preset.pitch;
config.preset.shifts.forEach((n,i)=>inputs[i+1].value=n);
ui.apply.addEventListener('click',()=>{void apply();});
ui.save.addEventListener('click',save);
window.addEventListener('resize',draw);
labels();select('original');
