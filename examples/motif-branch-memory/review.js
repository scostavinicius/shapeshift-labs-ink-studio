const ui=Object.fromEntries([...document.querySelectorAll('[id]')].map(node=>[node.id,node]));
const audio=document.querySelector('audio'), buttons=[...document.querySelectorAll('[data-route]')];
const releases=new Map();
let active='waterline', current, generation=0, loading, localURL;
function engine(){
  return loading??=(async()=>{
    const bytes=Uint8Array.from(atob(compressedEngine),ch=>ch.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const script=document.createElement('script');
    script.textContent=await new Response(stream).text();
    document.head.append(script);
    return KIT.music.production.live;
  })();
}
function wav(value){
  const {sampleRate,samples}=value, bytes=new Uint8Array(44+samples.length*2), view=new DataView(bytes.buffer);
  for(const [at,name] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])
    bytes.set(new TextEncoder().encode(name),at);
  for(const [at,value] of [[4,bytes.length-8],[16,16],[24,sampleRate],[28,sampleRate*4],[40,samples.length*2]])
    view.setUint32(at,value,true);
  for(const [at,value] of [[20,1],[22,2],[32,4],[34,16]])view.setUint16(at,value,true);
  samples.forEach((n,i)=>view.setInt16(44+i*2,Math.max(-32768,Math.min(32767,Math.round(n*32768))),true));
  return new Blob([bytes],{type:'audio/wav'});
}
const pitch=midi=>['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'][midi%12]+(Math.floor(midi/12)-1);
const instrument={glass:'Struck glass',reed:'Reed'};
function notes(target,rows){
  target.replaceChildren();
  if(!rows?.length){
    const item=document.createElement('li');
    item.textContent='None';
    target.append(item);
    return;
  }
  for(const {midi,beat} of rows){
    const item=document.createElement('li'), time=document.createElement('span');
    time.textContent='+'+(beat-rows[0].beat).toFixed(2)+' beats';
    item.append(pitch(midi),time);
    target.append(item);
  }
}
function show(take){
  const recall=take.join.entry.recall, found=recall.version??take.versions.beacon;
  ui['source-label'].textContent=found?instrument[found.part]+' on the '+project.labels[found.source]+' path':'Heard on the route';
  notes(ui.heard,found?.notes);
  notes(ui.recall,recall.notes);
  const count=found?.notes.length??0;
  ui.provenance.textContent=recall.version?
    `${recall.version.notes.length} heard attacks from one ${project.labels[recall.version.source]} performance.`:
    `${count} heard ${count===1?'attack':'attacks'}. This recall needs at least three.`;
}
function setTake(take){
  audio.pause();
  if(localURL)URL.revokeObjectURL(localURL);
  localURL=take.wave?URL.createObjectURL(take.wave):null;
  audio.src=localURL??'data:audio/wav;base64,'+take.audio;
  current=take;
  ui.seek.disabled=false;
  show(take);
}
async function prepare(play=false){
  const stamp=++generation, mode=ui.preserve.value, key=active+'/'+mode;
  let take=mode==='both'?project.examples[active]:releases.get(key);
  try{
    if(!take){
      ui.play.disabled=true;ui.seek.disabled=true;
      audio.pause();ui.status.textContent='Generating the recall from the route.';
      const live=await engine();
      if(stamp!==generation)return;
      const timeline=structuredClone(project.timeline);
      timeline.thematic.recalls.overlook.preserve=mode;
      const output=await live.replay(project.sources,timeline,project.routes[active],project.options);
      take={join:output.report.joins.find(row=>row.to==='overlook'),versions:output.report.themeVersions,wave:wav(output.value)};
      if(releases.size>=6)releases.delete(releases.keys().next().value);
      releases.set(key,take);
    }
    if(stamp!==generation)return;
    if(take!==current)setTake(take);
    ui.status.textContent='';
    if(play){
      audio.currentTime=0;
      await audio.play();
    }
  }catch(error){
    if(stamp===generation)ui.status.textContent=error.message;
  }finally{
    if(stamp===generation)ui.play.disabled=false;
  }
}
for(const button of buttons)button.addEventListener('click',()=>{
  active=button.dataset.route;
  for(const option of buttons)option.setAttribute('aria-pressed',String(option===button));
  void prepare();
});
ui.preserve.addEventListener('change',()=>{void prepare();});
ui.play.addEventListener('click',()=>{void prepare(true);});
ui.seek.addEventListener('click',()=>{if(current)audio.currentTime=current.join.time;});
void prepare();
