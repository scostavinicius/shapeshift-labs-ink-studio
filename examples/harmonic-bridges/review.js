const startButton=document.querySelector('#start'), stopButton=document.querySelector('#stop');
const status=document.querySelector('#status'), bridges=document.querySelector('#with-bridges');
const comparison=document.querySelector('audio');
const result=document.querySelector('#result'), pitches=document.querySelector('#pitches');
const takeButtons=[...document.querySelectorAll('[data-take]')];
const sections=new Map();
let audio, session, engineLoader, take, target, lastJoin;
function engine(){
  return engineLoader??=(async()=>{
    const compressed=Uint8Array.from(atob(compressedEngine),ch=>ch.charCodeAt(0));
    const decoded=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const script=document.createElement('script');
    script.textContent=await new Response(decoded).text();
    document.head.append(script);
    return KIT.music.production.live;
  })();
}
const pitch=midi=>['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'][midi%12]+(Math.floor(midi/12)-1);
function choose(to){
  if(!session)return;
  const view=session.score.inspect();
  session.score.dispatch({kind:'music-transition',time:view.time,from:view.section,to,rule:'signal-'+to});
  target=to;
}
for(const [name,{label,chord}] of Object.entries(config.labels)){
  const button=document.createElement('button'), title=document.createElement('strong'), harmony=document.createElement('span');
  button.type='button';button.dataset.section=name;button.disabled=true;
  title.textContent=label;harmony.textContent=chord;
  button.append(title,harmony);
  button.addEventListener('click',()=>choose(name));
  document.querySelector('#destinations').append(button);sections.set(name,button);
}
function chips(items,kind){
  for(const label of items){
    const node=document.createElement('span');
    node.className='chip';node.dataset.kind=kind;node.textContent=label;
    pitches.append(node);
  }
}
function show(){
  if(!session)return;
  const view=session.score.inspect(), join=view.joins.at(-1);
  for(const [name,button] of sections)button.setAttribute('aria-current',String(name===view.section));
  const pending=view.pending?.to??(target!==view.section?target:null);
  status.textContent=config.labels[view.section].chord+' is playing'+(pending?' · Next '+config.labels[pending].label:'.');
  if(!view.pending)target=null;
  if(join&&join.frame!==lastJoin){
    lastJoin=join.frame;
    result.hidden=false;
    const {harmonicBridge:bridge}=join.carry;
    document.querySelector('#join-label').textContent=config.labels[join.from].chord+' → '+config.labels[join.to].chord;
    pitches.replaceChildren();
    chips((bridge?.pickup?.notes??[]).filter(note=>note.status==='played').map(note=>pitch(note.midi)+' pickup'),'pickup');
    chips((bridge?.held??[]).map(note=>pitch(note.pitch)+' held'),'held');
    if(!pitches.children.length)chips([bridge?'No pickup or held notes at this join':'Straight cut'],'cut');
  }
}

function fill(){
  const current=session;
  if(!current)return;
  if(current.next<audio.currentTime)current.next=audio.currentTime+.022;
  while(current.next<audio.currentTime+.085){
    const block=current.score.pull(1024), sound=audio.createBuffer(2,1024,config.options.sampleRate);
    for(let channel=0;channel<2;channel++){
      const data=sound.getChannelData(channel);
      for(let i=0;i<1024;i++)data[i]=block.samples[i*2+channel];
    }
    const node=audio.createBufferSource();
    node.buffer=sound;node.connect(current.bus);
    current.nodes.add(node);
    node.onended=()=>{node.disconnect();current.nodes.delete(node);};
    node.start(current.next);
    current.next+=sound.duration;
  }
}
async function start(){
  startButton.disabled=true;bridges.disabled=true;comparison.pause();
  status.textContent='Preparing the live score.';
  try{
    audio??=new AudioContext();
    await audio.resume();
    const live=await engine(), timeline=bridges.checked?config.timeline:config.hard;
    const score=live.open(config.sources,timeline,config.options);
    const bus=audio.createGain();bus.connect(audio.destination);
    const current={score,bus,nodes:new Set(),next:audio.currentTime+.035};
    session=current;lastJoin=null;target=null;result.hidden=true;
    stopButton.disabled=false;
    for(const button of sections.values())button.disabled=false;
    fill();show();
    current.timer=setInterval(fill,25);
    current.display=setInterval(show,95);
  }catch(error){
    stop();
    status.textContent='The live score could not start. '+error.message;
  }
}
function stop(){
  if(session){
    const {nodes,bus,timer,display}=session;
    clearInterval(timer);clearInterval(display);
    bus.gain.setTargetAtTime(0,audio.currentTime,.006);
    for(const node of nodes)node.stop(audio.currentTime+.025);
    setTimeout(()=>bus.disconnect(),45);
    session=null;
  }
  for(const button of sections.values()){button.disabled=true;button.removeAttribute('aria-current');}
  status.textContent='Start the score to choose a destination.';
  startButton.disabled=false;stopButton.disabled=true;bridges.disabled=false;
}
function select(next){
  if(next===take)return;
  const time=comparison.currentTime, resume=!comparison.paused;
  comparison.src='data:audio/wav;base64,'+config.takes[next];
  comparison.currentTime=time;
  if(resume)comparison.play().catch(()=>{});
  take=next;
  for(const button of takeButtons)button.setAttribute('aria-pressed',String(button.dataset.take===take));
}
startButton.addEventListener('click',start);
stopButton.addEventListener('click',stop);
document.querySelector('#seek').addEventListener('click',()=>{comparison.currentTime=config.joins[0].time-.46;});
for(const button of takeButtons)button.addEventListener('click',()=>select(button.dataset.take));
comparison.addEventListener('play',()=>{if(session)stop();});
select('bridged');
