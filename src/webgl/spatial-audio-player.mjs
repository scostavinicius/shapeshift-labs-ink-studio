/* Play spatial mix frames through caller-owned Web Audio resources. */
import {createRoomResponse,validateRoomResponse} from './spatial-room-response.mjs';
import {prepareBinaural} from './spatial-binaural.mjs';
import {createCrowdAudio} from './crowd-audio.mjs';
import * as sharedBudget from '../world-voice-budget.js';
import * as sharedRadiation from '../spatial-radiation.js';
import * as sharedPulse from '../contact-pulse.js';
import * as sharedCaptions from '../directional-captions.js';
const voiceBudget=sharedBudget.default??globalThis[Symbol.for('ink-studio.world-voice-budget')];
const radiation=sharedRadiation.default??globalThis[Symbol.for('ink-studio.spatial-radiation')];
const contactPulse=sharedPulse.default??globalThis[Symbol.for('ink-studio.contact-pulse')];
const captionRules=sharedCaptions.default??globalThis[Symbol.for('ink-studio.directional-captions')];
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const buses=['dialogue','foley','effects','ambience','music'];
const bands=['low','mid','high'];
const bandLevels=value=>bands.every(band=>finite(value?.[band],0,16384));
const position=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

export function createSpatialAudioPlayer(context, {
  resolveAsset, destination=context?.destination, destinations={}, panning='HRTF', maxVoices, smoothing=.025, captions
}={}) {
  if(typeof context?.createBufferSource!=='function'||!context.listener||!destination||
    typeof resolveAsset!=='function'||!['HRTF','equalpower'].includes(panning)||
    (maxVoices!==undefined&&(!Number.isSafeInteger(maxVoices)||maxVoices<1||maxVoices>128))||!finite(smoothing,0,1))
    throw new TypeError('Spatial audio needs a Web Audio context, asset resolver, and valid mix settings');

  if(!destinations||![Object.prototype,null].includes(Object.getPrototypeOf(destinations))||
    Object.entries(destinations).some(([name,node])=>!buses.includes(name)||node?.context!==context||typeof node.connect!=='function'))
    throw new TypeError('Spatial audio bus destinations must be AudioNodes on the player context');
  const outputs=new Map(Object.entries(destinations)), output=voice=>outputs.get(voice.bus)??destination;
  const voices=new Map(), seen=new Set(), assets=new Map(), retiring=new Set(), tails=new Set();
  const captionTrack=captions===undefined?null:captionRules.live(captions,context.sampleRate);
  const room=createRoomResponse(context,outputs.get('effects')??destination,asset);
  const crowd=createCrowdAudio(context,{panning,asset:sourceAsset,output:bus=>outputs.get(bus)??destination,room,
    captionOffers:captionTrack?.offers,
    onGrains:captionTrack&&((marks,ear)=>marks.forEach(mark=>captionTrack.confirm(mark,ear)))});
  const monoAssets=new WeakMap(), pulseAssets=new Map();
  const fallback=voiceBudget.compile({maxVoices:maxVoices??32,reservedVoices:0});
  let disposed=false, previousTime=-Infinity, policy=fallback, configured=false, listener, profile, profileKey, binaural;
  let inspection=Object.freeze({selected:[],rejected:[]});
  function remember(id){
    seen.add(id);
    if(seen.size>8192)seen.delete(seen.values().next().value);
  }
  function asset(id){
    if(!assets.has(id)){
      const pending=Promise.resolve().then(()=>resolveAsset(id)).then(buffer=>{
        if(!buffer||!finite(buffer.duration,Number.EPSILON,1e9)||typeof buffer.getChannelData!=='function')
          throw new TypeError('Audio asset resolver must return an AudioBuffer for '+id);
        return buffer;
      }).catch(error=>{if(assets.get(id)===pending)assets.delete(id);throw error;});
      assets.set(id,pending);
      if(assets.size>512)assets.delete(assets.keys().next().value);
    }
    return assets.get(id);
  }
  function sourceAsset(voice){
    if(!voice.stickSlip)return asset(voice.asset);
    return Promise.resolve().then(()=>{
      const key=contactPulse.key(voice.stickSlip);
      if(!pulseAssets.has(key)){
        const {samples,sampleRate}=contactPulse.render(voice.stickSlip,context.sampleRate);
        const buffer=context.createBuffer(1,samples.length,sampleRate);
        buffer.getChannelData(0).set(samples);
        pulseAssets.set(key,buffer);
        if(pulseAssets.size>128)pulseAssets.delete(pulseAssets.keys().next().value);
      }
      return pulseAssets.get(key);
    });
  }
  function parameter(param,value,time,immediate=false){
    param.cancelScheduledValues(time);
    if(smoothing&&!immediate)param.setTargetAtTime(value,time,smoothing);
    else param.setValueAtTime(value,time);
  }
  function coordinates(node,name,value,time,immediate){
    value.forEach((n,i)=>parameter(node[name+'XYZ'[i]],n,time,immediate));
  }
  function listen(listener,immediate){
    if(!listener)return;
    const native=context.listener, at=context.currentTime;
    if(native.positionX){
      coordinates(native,'position',listener.position,at,immediate);
      coordinates(native,'forward',listener.forward,at,immediate);
      coordinates(native,'up',listener.up,at,immediate);
    }else{
      native.setPosition(...listener.position);
      native.setOrientation(...listener.forward,...listener.up);
    }
  }
  function tune(row,immediate){
    if(!row.source)return;
    const {voice,gain,low,high,filter,panner,radiationTrim}=row, at=context.currentTime;
    if(voice.contact){
      const start=Math.max(at,row.started), {remaining,targetGain}=voice.contact;
      row.source.playbackRate.setValueAtTime(voice.rate,start);
      gain.gain.cancelScheduledValues(start);
      gain.gain.setValueAtTime(voice.gain,start);
      if(remaining)gain.gain.linearRampToValueAtTime(targetGain,start+remaining);
    }else{
      parameter(gain.gain,voice.gain,at,immediate);
      if(voice.propagation?.arrival!==undefined)row.source.playbackRate.setValueAtTime(voice.rate,Math.max(at,row.started));
    }
    const relative=band=>voice.gain>0?
      clamp(20*Math.log10(Math.max(1e-8,voice.bands[band]/voice.gain)),-60,40):0;
    if(radiationTrim){
      const db=radiation.shelf(voice.bands,voice.gain);
      parameter(low.gain,db.low,at,immediate);
      parameter(high.gain,db.high,at,immediate);
      parameter(radiationTrim.gain,db.mid,at,immediate);
    }else if(filter){
      parameter(low.gain,relative('low'),at,immediate);
      parameter(high.gain,relative('high'),at,immediate);
    }
    if(filter)parameter(filter.frequency,radiationTrim&&voice.cutoff===22000?context.sampleRate/2:
      Math.min(voice.cutoff,context.sampleRate*.49),at,immediate);
    if(row.tone){
      const {highpass,lowpass,peaks}=row.tone, plan=voice.processing;
      const limit=context.sampleRate/2;
      parameter(highpass.frequency,Math.min(plan.highpass,limit*.98),at,immediate);
      parameter(lowpass.frequency,plan.lowpass===22000?limit:Math.min(plan.lowpass,limit*.98),at,immediate);
      peaks.forEach((node,i)=>{
        const peak=plan.peaks[i];
        parameter(node.gain,peak?.gainDb??0,at,immediate);
        if(peak){
          parameter(node.frequency,Math.min(peak.hz,limit*.98),at,immediate);
          parameter(node.Q,peak.q,at,immediate);
        }
      });
    }
    if(panner){
      const point=voice.apparentSource??voice.position;
      if(panner.positionX)coordinates(panner,'position',point,at,immediate);
      else panner.setPosition(...point);
    }
  }
  function release(part){
    if(part.disconnected)return;
    part.disconnected=true;
    tails.delete(part);
    part.binaural?.node.port.close();
    for(const node of part.nodes)node.disconnect();
  }
  function disconnect(row){
    for(const part of row.branches??[])release(part);
  }
  function stop(row,fade=false){
    if(voices.get(row.voice.id)===row)voices.delete(row.voice.id);
    captionTrack?.advance(captionTrack.stamp(context.currentTime),listener);
    captionTrack?.cancel(row);
    if(!row.source)return;
    const now=context.currentTime, tail=fade&&context.state==='running'&&row.started<=now?
      (configured?policy.stealFade:smoothing*3):0;
    if(tail){
      while(retiring.size>=policy.maxVoices)stop(retiring.values().next().value);
      for(const branch of row.branches)if(!branch.ended){
        const param=branch.gain.gain;
        if(configured){
          if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);
          else parameter(param,param.value,now,true);
          param.linearRampToValueAtTime(0,now+tail);
        }else parameter(param,0,now);
      }
      retiring.add(row);
    }
    else retiring.delete(row);
    for(const branch of row.branches)if(!branch.ended)branch.source.stop(now+tail);
    if(!tail)disconnect(row);
  }
  function reset(){
    for(const row of voices.values())stop(row);
    for(const row of retiring)stop(row);
    for(const part of tails)release(part);
    crowd.reset();
    room.reset();
    listener=undefined;
    seen.clear();
    captionTrack?.reset();
    inspection=Object.freeze({selected:[],rejected:[]});
    previousTime=-Infinity;
  }
  function binauralBuffer(buffer){
    if(buffer.numberOfChannels<=2)return buffer;
    if(!monoAssets.has(buffer)){
      const mono=context.createBuffer(1,buffer.length,buffer.sampleRate), audio=mono.getChannelData(0);
      const count=buffer.numberOfChannels;
      for(let channel=0;channel<count;channel++){
        const data=buffer.getChannelData(channel), gain=.5/Math.ceil((count-channel%2)/2);
        for(let i=0;i<audio.length;i++)audio[i]+=data[i]*gain;
      }
      monoAssets.set(buffer,mono);
    }
    return monoAssets.get(buffer);
  }
  function branch(live, buffer, scheduled) {
    const when=Math.max(context.currentTime,scheduled), late=when-scheduled;
    let offset=live.offset+late*live.rate;
    const remaining=live.duration===undefined?undefined:live.duration-late;
    if(live.mode==='loop')offset%=buffer.duration;
    if(offset>=buffer.duration||remaining!==undefined&&remaining<=0)return;
    const source=context.createBufferSource(), gain=context.createGain();
    const pinned=live.position&&binaural?.open(listener,live.apparentSource??live.position,live.cutoff);
    const shelves=live.radiation||!pinned;
    const low=shelves?context.createBiquadFilter():null, high=shelves?context.createBiquadFilter():null,
      filter=pinned?null:context.createBiquadFilter(), radiationTrim=live.radiation?context.createGain():null;
    source.buffer=pinned?binauralBuffer(buffer):buffer;
    source.loop=live.mode==='loop';
    source.playbackRate.value=live.rate;
    const nodes=[source,gain];
    let tail=source, tone;
    if(shelves){
      const [lowHz,highHz]=radiation.crossovers(context.sampleRate);
      low.type='lowshelf';low.frequency.value=lowHz;
      high.type='highshelf';high.frequency.value=radiationTrim?highHz:Math.min(2600,context.sampleRate*.4);
    }
    if(filter){filter.type='lowpass';filter.Q.value=-3;}
    for(const node of [low,high,radiationTrim,filter])if(node){
      tail.connect(node);nodes.push(node);tail=node;
    }
    if(live.processing){
      const highpass=context.createBiquadFilter(), lowpass=context.createBiquadFilter();
      highpass.type='highpass';lowpass.type='lowpass';
      highpass.Q.value=lowpass.Q.value=-3.01029995664;
      const peaks=Array.from({length:4},()=>{
        const node=context.createBiquadFilter();
        node.type='peaking';
        return node;
      });
      for(const node of [highpass,...peaks,lowpass]){
        tail.connect(node);nodes.push(node);tail=node;
      }
      tone={highpass,peaks,lowpass};
    }
    tail.connect(gain);
    let panner, spatialNode;
    if(pinned)spatialNode=pinned.node;
    else if(live.position){
      panner=context.createPanner();
      panner.panningModel=panning;
      panner.rolloffFactor=0;
      spatialNode=panner;
    }
    if(spatialNode){
      gain.connect(spatialNode);spatialNode.connect(output(live));nodes.push(spatialNode);
      if(room.input)spatialNode.connect(room.input);
    }else gain.connect(output(live));
    const part={voice:live,source,low,high,filter,gain,panner,spatialNode,binaural:pinned,nodes,tone,radiationTrim,started:when,offset,remaining};
    if(pinned)spatialNode.port.onmessage=()=>release(part);
    return part;
  }

  function start(voice,at,positionedReady,frameTime){
    const late=(voice.propagation||voice.stickSlip)&&voice.onset!==undefined?Math.max(0,frameTime-voice.onset):0;
    const when=at+voice.delay+(voice.startDelay??0)+(voice.stickSlip?contactPulse.monitorDelay:0)-late;
    const row={voice,when:voice.stickSlip?Math.max(at,when):when,branches:[]};
    voices.set(voice.id,row);
    const sound=sourceAsset(voice);
    row.pending=(positionedReady&&voice.position ? Promise.all([sound,positionedReady]).then(([buffer])=>buffer) :
      sound).then(buffer=>{
      if(disposed||voices.get(voice.id)!==row)return;
      const live=row.voice;
      row.direct=branch(live,buffer,row.when);
      if(row.direct)row.branches.push(row.direct);
      for(const tap of live.reflections??[]){
        const {gain,cutoff,apparentSource,radiation}=tap;
        const echo=branch({...live,gain,cutoff,apparentSource,radiation,bands:radiation?tap.bands:{low:gain,mid:gain,high:gain}},
          buffer,row.when+tap.delay);
        if(echo)row.branches.push(echo);
      }
      let left=row.branches.length;
      if(!left){
        voices.delete(live.id);
        if(live.mode==='clip')remember(live.id);
        return;
      }
      row.source=row.branches[0].source;
      row.started=row.branches[0].started;
      for(const part of row.branches){
        const {source,started,offset,remaining}=part;
        tune(part,true);
        source.onended=()=>{
          part.ended=true;
          if(part.binaural&&!part.disconnected){
            tails.add(part);
            part.spatialNode.port.postMessage({end:true});
          }else release(part);
          if(--left)return;
          retiring.delete(row);
          if(voices.get(live.id)===row){
            voices.delete(live.id);
            if(live.mode==='clip')remember(live.id);
          }
        };
        if(remaining===undefined)source.start(started,offset);
        else source.start(started,offset,remaining*live.rate);
      }
      if(captionTrack&&live.mode==='cue'){
        const first=row.branches.filter(part=>part.voice.gain>0).reduce((a,b)=>!a||b.started<a.started?b:a,null);
        if(first){
          const {cue,selection,sourceEvent,acousticOpening,apparentSource,position}=first.voice;
          captionTrack.queue(row,{sample:captionTrack.stamp(first.started),cue,family:selection?.family,
            eventId:sourceEvent,opening:acousticOpening,at:apparentSource??position});
        }
      }
    }).catch(error=>{
      if(voices.get(voice.id)!==row)return;
      voices.delete(voice.id);
      if(voice.mode==='cue')seen.delete(voice.id);
      disconnect(row);
      throw error;
    });
    return row.pending;
  }
  function validProcessing(plan){
    return plan&&finite(plan.highpass,0,4000)&&finite(plan.lowpass,40,22000)&&
      Array.isArray(plan.peaks)&&plan.peaks.length<=4&&Array.from(plan.peaks).every(peak=>
        peak&&finite(peak.hz,40,16000)&&finite(peak.q,.25,12)&&finite(peak.gainDb,-24,18));
  }
  function validRadiation(plan){
    return plan&&typeof plan.profile==='string'&&finite(plan.angle,0,180)&&position(plan.forward)&&
      bands.every(band=>finite(plan.db?.[band],-72,0));
  }
  function validPropagation(voice){
    const plan=voice.propagation;
    return plan&&voice.position&&['loop','cue'].includes(voice.mode)&&finite(plan.travelSeconds,0,1e13)&&
      finite(plan.delaySeconds,0,30)&&finite(plan.rateScale,.25,4)&&finite(plan.cents,-2400,2400)&&
      (plan.arrival===undefined?voice.mode==='cue':voice.mode==='loop'&&finite(plan.arrival,0,30))&&
      (voice.onset===undefined||finite(voice.onset,0,1e9));
  }
  function validate(frame){
    if(!frame||!finite(frame.time,0,1e9)||!Array.isArray(frame.active)||!Array.isArray(frame.cues)||
      frame.active.length+frame.cues.length>4096||
      frame.listener&&![frame.listener.position,frame.listener.forward,frame.listener.up].every(position))
      throw new TypeError('Expected a spatial audio mix frame');
    validateRoomResponse(frame.roomResponse);
    const ids=new Set();
    for(const [rows,modes] of [[frame.active,['loop','clip']],[frame.cues,['cue']]])for(const row of rows){
      if(typeof row?.id!=='string'||ids.has(row.id)||typeof row.asset!=='string'||!modes.includes(row.mode)||
        !voiceBudget.validVoice(row)||!finite(row.gain,0,16384)||!bandLevels(row.bands)||
        !finite(row.rate,.001,64)||!finite(row.offset,0,65e9)||!finite(row.cutoff,20,22000)||
        (row.contact&&(row.mode!=='loop'||!finite(row.contact.targetGain,0,16384)||
          !finite(row.contact.remaining,0,10.000001)))||
        (row.startDelay!==undefined&&(row.mode!=='cue'||!finite(row.startDelay,0,10)))||
        (row.processing!==undefined&&!validProcessing(row.processing))||
        (row.radiation!==undefined&&(!row.position||!validRadiation(row.radiation)))||
        (row.propagation!==undefined&&!validPropagation(row))||
        (row.stickSlip!==undefined&&(row.mode!=='cue'||!contactPulse.valid(row.stickSlip)||!finite(row.onset,0,frame.time)))||
        (row.reflections!==undefined&&(row.mode!=='cue'||!row.position||!Array.isArray(row.reflections)||
          row.reflections.length>8||!Array.from(row.reflections).every(tap=>
            tap&&finite(tap.gain,0,16384)&&finite(tap.cutoff,20,22000)&&finite(tap.delay,.0001,.25)&&position(tap.apparentSource)&&
            (tap.radiation===undefined||validRadiation(tap.radiation)&&bandLevels(tap.bands)))))||
        !finite(row.delay,0,1e9)||row.position!==null&&!position(row.position)||
        row.apparentSource!==undefined&&!position(row.apparentSource)||
        (row.mode==='clip'?!finite(row.duration,0,1e9):
          row.mode==='cue'&&row.sound?!finite(row.duration,.001,3600):row.duration!==undefined))
        throw new TypeError('Invalid spatial audio voice');
      ids.add(row.id);
    }
  }
  return Object.freeze({
    update(frame,{seek=false}={}){
      if(disposed)throw new Error('Spatial audio player is disposed');
      validate(frame);
      const authored=frame.voiceBudget===undefined?null:voiceBudget.compile(frame.voiceBudget);
      configured=authored!==null;
      const capacity=maxVoices===undefined?authored?.maxVoices:Math.min(maxVoices,authored?.maxVoices??maxVoices);
      policy=authored?{...authored,maxVoices:capacity,reservedVoices:Math.min(authored.reservedVoices,capacity)}:fallback;
      const nextProfile=frame.binauralProfile;
      const changed=profile!==nextProfile&&(profile===undefined||nextProfile===undefined||
        JSON.stringify(nextProfile)!==(profileKey??=JSON.stringify(profile)));
      const nextBinaural=changed ? nextProfile===undefined?undefined:prepareBinaural(context,nextProfile) : binaural;
      if(seek||frame.time<previousTime||changed&&previousTime!==-Infinity)reset();
      if(changed)profileKey=undefined;
      binaural=nextBinaural;
      profile=nextProfile;
      captionTrack?.advance(captionTrack.stamp(context.currentTime),listener);
      listener=frame.listener;
      const hadRoom=Boolean(room.input), roomReady=room.update(frame.roomResponse);
      if(!hadRoom&&room.input)for(const row of [...voices.values(),...retiring])
        for(const part of row.branches)if(part.spatialNode&&!part.ended)part.spatialNode.connect(room.input);
      listen(frame.listener,previousTime===-Infinity);
      previousTime=frame.time;
      const desired=new Map();
      for(const row of voices.values())if(row.voice.mode==='cue')desired.set(row.voice.id,row.voice);
      for(const voice of frame.active){
        const sustained=voice.contact&&(voice.contact.targetGain>0||!configured&&voices.has(voice.id));
        if((voice.gain>0||sustained)&&!seen.has(voice.id))desired.set(voice.id,voice);
      }
      for(const voice of frame.cues)if(!seen.has(voice.id)){
        remember(voice.id);
        if(voice.gain>0)desired.set(voice.id,voice);
      }
      const candidates=[...desired.values()].map(voice=>({...voice,incumbent:voices.has(voice.id),
        gain:configured?Math.max(voice.gain,voice.contact?.targetGain??0):voice.gain}));
      const stable=configured||candidates.some(voice=>voice.priority!==undefined||voice.protected!==undefined);
      const priority=frame.jointPriority;
      const scoped=voiceBudget.prioritize(candidates,policy,priority&&voiceBudget.compilePriority(priority.sound));
      const ranked=scoped.policy.aggregation&&listener?
        voiceBudget.selectWithTextures(scoped.candidates,scoped.policy,crowd.active(),stable):
        voiceBudget.select(scoped.candidates,scoped.policy,stable);
      const promoted=new Set(priority?.sound.cues);
      const selected=new Map([...ranked.selected].map(id=>[id,desired.get(id)]));
      const info=(id,decision)=>{
        const {cue,priority=0,protected:critical=false,group}=desired.get(id);
        const focused=promoted.has(cue);
        return Object.freeze({id,cue,priority:focused?100:priority,protected:focused||critical,
          ...(focused&&{promoted:true}),...(group!==undefined&&{group}),...decision});
      };
      inspection=Object.freeze({time:frame.time,limit:policy.maxVoices,reservedVoices:scoped.policy.reservedVoices,
        ...(priority&&{priorityWindow:priority.id}),
        selected:Object.freeze([...selected.keys()].map(id=>info(id,{}))),
        ...(scoped.policy.aggregation&&{aggregation:Object.freeze({slots:ranked.seats??0,count:ranked.overflow?.size??0})}),
        rejected:Object.freeze([...ranked.rejected].map(([id,reason])=>info(id,{reason,
          action:ranked.overflow?.has(id)?'aggregated':voices.has(id)?'displaced':desired.get(id).mode==='cue'?'dropped':'virtual'})))});
      while(retiring.size>policy.maxVoices)stop(retiring.values().next().value);
      for(const row of voices.values())if(!selected.has(row.voice.id))stop(row,true);
      const preparations=[roomReady,binaural?.ready].filter(Boolean);
      const positionedReady=preparations.length?Promise.all(preparations):undefined;
      const pending=positionedReady?[positionedReady]:[], at=context.currentTime;
      const texture=crowd.update({seats:ranked.seats,config:scoped.policy.aggregation,listener,binaural,time:frame.time,
        ready:positionedReady,voices:ranked.overflow?[...ranked.overflow].map(id=>desired.get(id)):[]});
      if(texture)pending.push(texture);
      for(const [id,voice] of selected){
        let row=voices.get(id);
        if(row&&(row.voice.asset!==voice.asset||(!voice.contact&&voice.propagation?.arrival===undefined&&row.voice.rate!==voice.rate)||
          Boolean(row.voice.processing)!==Boolean(voice.processing)||Boolean(row.voice.radiation)!==Boolean(voice.radiation)||
          output(row.voice)!==output(voice)||Boolean(row.voice.position)!==Boolean(voice.position))){
          stop(row);
          row=undefined;
        }
        if(row){
          if(!row.source){
            if(voice.mode!=='cue')row.when=context.currentTime+voice.delay;
            pending.push(row.pending);
          }
          row.voice=voice;
          if(row.direct&&!row.direct.ended){
            row.direct.voice=voice;
            tune(row.direct,false);
          }
          for(const part of row.branches)if(part.binaural&&!part.ended){
            const {position,apparentSource,cutoff}=part.voice;
            part.binaural.update(listener,apparentSource??position,cutoff);
          }
        }else pending.push(start(voice,at,positionedReady,frame.time));
      }
      return Promise.all(pending).then(()=>undefined);
    },
    reset,
    inspectVoices:()=>inspection,
    ...(captionTrack&&{readCaptions:()=>captionTrack.read(captionTrack.stamp(context.currentTime),listener)}),
    dispose(){if(!disposed){disposed=true;reset();binaural=profile=profileKey=undefined;assets.clear();pulseAssets.clear();}}
  });
}
