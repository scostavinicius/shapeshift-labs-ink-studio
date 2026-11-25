import {roomImpulseCapture as api,captureRoomSweep,requestRoomCaptureInput} from '../../src/webgl/room-impulse-capture.mjs';
import './fixture.js';

const {stairwell,strike}=globalThis.InkRoomCaptureDemo;
const ui={}; for(const node of document.querySelectorAll('[id]'))ui[node.id]=node;
const editFields=[ui.direct,ui['direct-cut'],ui.split,ui.crossfade,ui.length,ui['end-fade']];
let context, result, layers, reference, controller, playing, inputRate;
function audioContext(sampleRate=48000){
  if(context&&context.sampleRate!==sampleRate){
    stopAudio();
    void context.close();
    context=undefined;
  }
  return context??=new AudioContext({sampleRate});
}
const frames=(ms,rate)=>Math.round(ms*rate/1000);
const ms=(samples,rate)=>1000*samples/rate;
const gain=channel=>Number(ui[channel].value)/100;
const report=(id,message,error=false)=>{
  ui[id].textContent=message;
  ui[id].classList.toggle('error',error);
};

function buffer(audio,pcm){
  const created=audio.createBuffer(pcm.channels,pcm.samples.length/pcm.channels,pcm.sampleRate);
  for(let ch=0;ch<pcm.channels;ch++){
    const data=created.getChannelData(ch);
    for(let i=0;i<data.length;i++)data[i]=pcm.samples[i*pcm.channels+ch];
  }
  return created;
}
function fromBuffer(audio){
  const samples=new Float32Array(audio.length*audio.numberOfChannels);
  for(let ch=0;ch<audio.numberOfChannels;ch++)audio.getChannelData(ch).forEach((n,i)=>samples[i*audio.numberOfChannels+ch]=n);
  return {sampleRate:audio.sampleRate,channels:audio.numberOfChannels,samples};
}
function pcmChannel(capture,ch){
  return {sampleRate:capture.sampleRate,channels:1,samples:Float32Array.from(
    {length:capture.samples.length/capture.channels},(_,i)=>capture.samples[i*capture.channels+ch])};
}

function wave(){
  if(!layers)return;
  const target=ui.wave, width=Math.round(target.clientWidth*devicePixelRatio), height=Math.round(target.clientHeight*devicePixelRatio);
  if(!width||!height)return;
  target.width=width;target.height=height;
  const ctx=target.getContext('2d'), {sampleRate,channels}=layers.wet, window=frames(240,sampleRate);
  const center=height*.50, top=height*.12, bottom=height*.81;
  ctx.fillStyle='#35494a';
  for(let m=0;m<240;m+=60)ctx.fillRect(m*width/240,top,1,bottom-top);
  ctx.fillRect(0,center,width,1);
  ctx.font=Math.ceil(height*.092)+'px system-ui';ctx.fillStyle='#a9b8b5';
  for(let m=0;m<240;m+=60)ctx.fillText(m+' ms',m*width/240+4,height*.94);
  const direct=result.edit.directSample*width/window;
  ctx.fillStyle='#d0d4bf';ctx.fillRect(direct,top,1,bottom-top);
  for(const [layer,color] of [['early','#86e3c4'],['tail','#ffbc81']]){
    const {samples}=layers[layer], level=gain(layer);
    ctx.fillStyle=color;
    for(let x=0;x<width;x++){
      let hi=0,lo=0;
      const start=Math.floor(x*window/width),end=Math.ceil((x+1)*window/width);
      for(let i=start*channels;i<end*channels;i++){
        const value=(samples[i]??0)*level;
        hi=Math.max(value,hi);lo=Math.min(value,lo);
      }
      const y=n=>Math.atan(23*n)/1.57*height*.30;
      if(hi!==lo)ctx.fillRect(x,center-y(hi),1,y(hi)-y(lo));
    }
  }
}
function install(next,label,mix){
  const nextLayers=api.split(next.response,next.edit);
  const {earlyGain,tailGain}=api.mixSettings(mix);
  stopAudio();
  result=next; layers=nextLayers;
  const {directSample,directEndMs,splitMs,crossfadeMs,lengthMs,endFadeMs}=next.edit;
  inputRate=next.response.sampleRate;
  ui.direct.value=Number(ms(directSample,inputRate).toFixed(4));
  ui['direct-cut'].value=directEndMs;
  ui.split.value=splitMs;
  ui.crossfade.value=crossfadeMs;
  ui.length.value=lengthMs;
  ui.length.max=1000*next.response.samples.length/next.response.channels/inputRate;
  ui['end-fade'].value=endFadeMs;
  ui.early.value=100*earlyGain;ui.tail.value=100*tailGain;
  ui.latency.textContent=next.report.latencyMs.toFixed(2)+' ms';
  ui['recording-kind'].textContent=label;
  ui['room-editor'].hidden=false;
  updateMix();
  report('edit-status','');
}
function edit(){
  if(!result)return;
  try{
    if(editFields.some(input=>input.value===''))throw new RangeError('Enter a value for every timing field');
    const next={...result.edit,directSample:frames(Number(ui.direct.value),inputRate),
      directEndMs:Number(ui['direct-cut'].value),splitMs:Number(ui.split.value),crossfadeMs:Number(ui.crossfade.value),
      lengthMs:Number(ui.length.value),endFadeMs:Number(ui['end-fade'].value)};
    const prepared=api.split(result.response,next);
    stopAudio();
    result.edit=next;layers=prepared;
    report('edit-status','');
    updateMix();
  }catch(error){report('edit-status',error.message,true);}
}
function updateMix(){
  ui.arrival.textContent=ms(result.edit.directSample,inputRate).toFixed(2)+' ms';
  for(const name of ['early','tail']){
    ui[name+'-value'].textContent=ui[name].value+'%';
    if(playing?.levels?.[name]){
      const param=playing.levels[name].gain;
      param.setTargetAtTime(gain(name),context.currentTime,.01);
    }
  }
  wave();
}

function sample(){
  try{
    const example=stairwell(api);
    install(api.measure(example.room,{sweep:example.sweep.settings,loopback:example.loopback}),'Simulated stereo');
    report('capture-status','Loaded the simulated stairwell and its electrical loopback.');
  }catch(error){report('capture-status',error.message,true);}
}
function layout(){
  const messages={
    dual:'Use a two-input interface. Plug the room mic into input 1 and patch an output into line input 2.',
    reference:'Patch an output into the line input for calibration. Keep the sample rate and interface routing for the room pass.',
    mono:'Place the room mic where you want the probe. Record a loopback first with the same interface.',
    stereo:'Place both room mics. Record a loopback first with the same interface.'
  };
  ui['input-hint'].textContent=messages[ui.layout.value]+(reference?' Loopback pass saved.':'');
}
async function record(){
  const mode=ui.layout.value, channels=mode==='dual'||mode==='stereo'?2:1;
  if(['mono','stereo'].includes(mode)&&!reference){
    report('capture-status','Record a loopback pass first or choose the two-input capture.',true);
    return;
  }
  const abort=new AbortController();controller=abort;
  ui.record.disabled=true;ui.layout.disabled=true;ui.example.disabled=true;
  ui.cancel.hidden=false;
  let stream;
  try{
    const audio=audioContext();
    await audio.resume();
    stopAudio();
    report('capture-status','Waiting for input permission.');
    const deviceId=['mono','stereo'].includes(mode)?reference?.deviceId:undefined;
    stream=await requestRoomCaptureInput({channels,deviceId,signal:abort.signal});
    if(abort.signal.aborted)return;
    report('capture-status','Recording the sweep and decay. Keep the room quiet.');
    const take=await captureRoomSweep(audio,stream,{channels,signal:abort.signal});
    report('capture-status','Recovering the impulse response.');
    if(mode==='reference'){
      api.measure(take,{sweep:take.settings,loopback:take});
      reference={...take,deviceId:stream.getAudioTracks()[0].getSettings().deviceId};
      ui.layout.value='mono';layout();
      report('capture-status','Loopback saved. Connect the room microphone and record the room pass.');
      return;
    }
    const paired=mode==='dual';
    install(api.measure(paired?pcmChannel(take,0):take,{
      sweep:take.settings,loopback:paired?pcmChannel(take,1):reference
    }),mode==='stereo'?'Captured stereo':'Captured mono');
    report('capture-status','Room response ready.');
  }catch(error){
    report('capture-status',error.name==='AbortError'?'Capture cancelled.':error.message,error.name!=='AbortError');
  }finally{
    stream?.getTracks().forEach(track=>track.stop());
    controller=undefined;
    if(abort.signal.aborted)report('capture-status','Capture cancelled.');
    ui.record.disabled=false;ui.layout.disabled=false;ui.example.disabled=false;ui.cancel.hidden=true;
  }
}

function stopAudio(){
  if(!playing)return;
  const {source,nodes,ending}=playing;
  ending.onended=null;
  source.stop();ending.stop();
  for(const node of nodes)node.disconnect();
  playing=undefined;
}
async function play(mode){
  if(!result||controller)return;
  try{
    const audio=audioContext(result.response.sampleRate);
    await audio.resume();
    stopAudio();
    const source=audio.createBufferSource(), output=audio.createGain();
    output.gain.value=.75;
    output.connect(audio.destination);source.connect(output);
    const rate=audio.sampleRate, signal=mode==='sweep'?api.sweep({sampleRate:rate}):strike(rate);
    const slot=mode==='sweep'?0:Math.round(.27*rate);
    const data=new Float32Array(signal.samples.length+slot);
    data.set(signal.samples,slot);
    source.buffer=buffer(audio,{sampleRate:rate,channels:1,samples:data});
    const nodes=[source,output], levels={};
    if(mode==='wet')for(const name of ['early','tail']){
      const convolver=audio.createConvolver(), level=audio.createGain();
      convolver.normalize=false;
      convolver.buffer=buffer(audio,layers[name]);
      level.gain.value=gain(name);
      source.connect(convolver);convolver.connect(level);level.connect(output);
      nodes.push(convolver,level);levels[name]=level;
    }
    const responseEnd=mode==='wet'?layers.tail.samples.length/layers.tail.channels/layers.tail.sampleRate:0;
    const length=source.buffer.duration+responseEnd, ending=audio.createBufferSource();
    ending.buffer=audio.createBuffer(1,1,rate);
    ending.connect(output);nodes.push(ending);
    const at=audio.currentTime+.02;
    source.start(at);ending.start(at+length);
    playing={source,nodes,levels,ending};
    ending.onended=()=>{
      if(playing?.source!==source)return;
      for(const node of nodes)node.disconnect();
      playing=undefined;
    };
  }catch(error){report('edit-status',error.message,true);}
}

function waveFile({sampleRate,channels,samples}){
  const file=new ArrayBuffer(58+samples.length*4), data=new DataView(file);
  const tag=(at,text)=>[...text].forEach((ch,i)=>data.setUint8(at+i,ch.charCodeAt(0)));
  const u16=(at,n)=>data.setUint16(at,n,true), u32=(at,n)=>data.setUint32(at,n,true);
  tag(0,'RIFF');u32(4,file.byteLength-8);tag(8,'WAVE');tag(12,'fmt ');u32(16,18);
  u16(20,3);u16(22,channels);u32(24,sampleRate);u32(28,sampleRate*channels*4);u16(32,channels*4);u16(34,32);u16(36,0);
  tag(38,'fact');u32(42,4);u32(46,samples.length/channels);
  tag(50,'data');u32(54,samples.length*4);
  samples.forEach((n,i)=>data.setFloat32(58+i*4,n,true));
  return new Blob([file],{type:'audio/wav'});
}
function save(kind){
  let file, body;
  if(kind==='edit'){
    file='room-impulse.json';
    const document=api.asset(result,{earlyGain:gain('early'),tailGain:gain('tail')});
    body=new Blob([JSON.stringify(document,null,2)+'\n'],{type:'application/json'});
  }else{
    file=kind+'.wav';
    body=waveFile(kind==='response'?result.response:api.level(layers[kind],gain(kind)));
  }
  const url=URL.createObjectURL(body), anchor=document.createElement('a');
  anchor.href=url;anchor.download=file;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function openAsset(){
  if(controller)return;
  try{
    const manifest=ui['edit-file'].files[0], wav=ui['response-file'].files[0];
    if(!manifest||!wav||manifest.size>16384||wav.size>5e6)throw new Error('Choose a room edit JSON and its response WAV');
    const doc=JSON.parse(await manifest.text()), {measurement}=doc;
    if(doc.format!==api.format||doc.version!==1||!Number.isFinite(measurement?.latencyMs)||
      !Number.isInteger(measurement.sampleRate)||measurement.sampleRate<8000||measurement.sampleRate>96000)
      throw new Error('Invalid room impulse capture asset');
    const decoder=new OfflineAudioContext(1,1,measurement.sampleRate);
    const response=fromBuffer(await decoder.decodeAudioData(await wav.arrayBuffer()));
    if(response.channels!==measurement.channels||response.samples.length/response.channels!==measurement.frames)
      throw new Error('Response WAV does not match the room edit');
    install({response,edit:doc.edit,report:measurement},response.channels===2?'Saved stereo':'Saved mono',doc.probeMix);
    report('capture-status','Opened the saved room asset.');
  }catch(error){report('capture-status',error.message,true);}
}

ui.example.addEventListener('click',sample);
ui.layout.addEventListener('change',layout);
ui.record.addEventListener('click',record);
ui.cancel.addEventListener('click',()=>controller?.abort());
ui['open-asset'].addEventListener('click',openAsset);
for(const input of editFields)input.addEventListener('change',edit);
for(const name of ['early','tail'])ui[name].addEventListener('input',updateMix);
for(const mode of ['wet','dry','sweep'])ui[mode].addEventListener('click',()=>play(mode));
for(const button of document.querySelectorAll('[data-save]'))button.addEventListener('click',()=>save(button.dataset.save));
window.addEventListener('resize',wave);
layout();
if(document.body.dataset.demo==='stairwell')sample();
