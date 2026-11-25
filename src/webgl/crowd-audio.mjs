import * as shared from '../crowd-audio.js';
const mix=shared.default??globalThis[Symbol.for('ink-studio.crowd-audio')];
const modules=new WeakMap();

function load(context){
  if(!modules.has(context)){
    if(!context.audioWorklet||typeof AudioWorkletNode!=='function')
      throw new Error('Audio aggregation needs AudioWorklet in a secure context');
    const pending=context.audioWorklet.addModule(new URL('./crowd-audio-worklet.mjs',import.meta.url)).catch(error=>{
      modules.delete(context);throw error;
    });
    modules.set(context,pending);
  }
  return modules.get(context);
}

export function createCrowdAudio(context,{panning,asset,output,room,captionOffers,onGrains}){
  let active;
  const sources=new WeakMap();
  function mono(buffer){
    if(!sources.has(buffer)){
      const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
      sources.set(buffer,{sampleRate:buffer.sampleRate,duration:buffer.duration,sample(index){
        if(channels.length===1)return channels[0][index]??0;
        let total=0;
        for(const channel of channels)total+=channel[index]??0;
        return total/channels.length;
      }});
    }
    return sources.get(buffer);
  }
  function close(){
    if(!active)return;
    for(const {input,spatial,pinned} of active.nodes.values()){
      input.port.postMessage({clear:true});input.port.close();
      input.disconnect();spatial.disconnect();pinned?.node.port.close();
    }
    active=undefined;
  }
  function place(state,index,row){
    const location=mix.point(state.listener.position,mix.direction(index,state.seats));
    if(row.pinned)row.pinned.update(state.listener,location,22000);
    else if(row.spatial.positionX)location.forEach((n,i)=>row.spatial['position'+'XYZ'[i]].setValueAtTime(n,context.currentTime));
    else row.spatial.setPosition(...location);
    if(room.input&&row.room!==room.input){
      if(row.room)row.spatial.disconnect(row.room);
      row.spatial.connect(room.input);row.room=room.input;
    }
  }
  function stream(state,index,packets){
    const input=new AudioWorkletNode(context,'ink-crowd-audio',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],
      processorOptions:{packets}});
    const location=mix.point(state.listener.position,mix.direction(index,state.seats));
    const pinned=state.binaural?.open(state.listener,location,22000), spatial=pinned?.node??new PannerNode(context,{panningModel:panning,rolloffFactor:0,
      positionX:location[0],positionY:location[1],positionZ:location[2]});
    if(onGrains)input.port.onmessage=({data})=>{
      if(active!==state||!data.marks?.length)return;
      const at=mix.point(state.listener.position,mix.direction(index,state.seats));
      onGrains(data.marks.map(mark=>({...mark,at})),state.listener);
    };
    const row={input,spatial,pinned};
    place(state,index,row);
    input.connect(spatial);spatial.connect(output(state.config.bus));
    state.nodes.set(index,row);
    return row;
  }
  function update({seats,config,listener,binaural,voices,time,ready}){
    if(!seats||!listener){close();return;}
    const key=JSON.stringify([seats,config]);
    if(active&&(active.key!==key||active.binaural!==binaural))close();
    if(!active&&!voices.length)return;
    const state=active??={key,seats,config,listener,binaural,nodes:new Map(),until:new Map()};
    state.listener=listener;
    for(const [index,row] of state.nodes)place(state,index,row);
    if(!voices.length)return;
    const loaded=load(context);
    const rate=context.sampleRate, at=context.currentTime, groups=new Map(), unit=rate/4;
    for(const voice of voices){
      const index=mix.sector(voice.apparentSource??voice.position,listener.position,seats);
      const lag=voice.onset===undefined?0:Math.max(0,time-voice.onset);
      const start=Math.round(rate*(at+Math.max(.001,mix.monitorDelay+voice.delay+(voice.startDelay??0)-lag)));
      const bucket=index+':'+Math.floor(start/unit);
      if(!groups.has(bucket))groups.set(bucket,{index,members:[]});
      groups.get(bucket).members.push({voice,start});
      state.until.set(index,Math.max(state.until.get(index)??0,start/rate+config.grain));
    }
    let work=0;
    const packets=Array.from(groups.values(),async({index,members})=>{
      const buffers=await Promise.all(members.map(entry=>asset(entry.voice)));
      const origin=Math.min(...members.map(row=>row.start));
      let count=0;
      members.forEach((entry,i)=>{
        entry.source=mono(buffers[i]);
        entry.length=mix.grainFrames(entry.voice,entry.source,rate,config.grain);
        count=Math.max(count,entry.start-origin+entry.length);
        work+=entry.length*buffers[i].numberOfChannels;
        if(work>32e6)throw new RangeError('Preview voice aggregation exceeds its grain processing budget');
      });
      const samples=new Float32Array(count);
      for(const {source,length,voice,start} of members)
        mix.addGrain(samples,start-origin,length,source,{...voice,gain:voice.gain*config.gain},rate);
      const marks=captionOffers&&members.flatMap(({voice,start,length})=>{
        const {cue,selection,sourceEvent}=voice, family=selection?.family;
        return length&&captionOffers({cue,family})?[{cue,family,eventId:sourceEvent,offset:start-origin,length}]:[];
      });
      return {index,origin,samples,marks};
    });
    return Promise.all([loaded,ready,...packets]).then(([, ,...readyPackets])=>{
      if(active!==state)return;
      const bySector=new Map();
      for(const {index,origin:at,samples,marks} of readyPackets)if(samples.length){
        if(!bySector.has(index))bySector.set(index,[]);
        bySector.get(index).push({at,samples,...(marks?.length&&{marks})});
      }
      for(const [index,packets] of bySector){
        const row=state.nodes.get(index);
        if(!row)stream(state,index,packets);
        else for(const packet of packets)row.input.port.postMessage(packet,[packet.samples.buffer]);
      }
    }).catch(error=>{if(active===state){close();throw error;}});
  }
  return {update,reset:close,active:()=>active&&[...active.until.values()].some(time=>time>context.currentTime)};
}
