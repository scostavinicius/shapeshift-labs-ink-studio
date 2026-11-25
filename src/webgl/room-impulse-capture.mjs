import '../fft.js';
import * as shared from '../room-impulse-capture.js';

export const roomImpulseCapture=shared.default??globalThis[Symbol.for('ink-studio.room-impulse-capture')];
const worklets=new WeakMap();
const interrupted=()=>new DOMException('Room capture cancelled','AbortError');

export async function requestRoomCaptureInput({channels=1,deviceId,signal}={}){
  if(![1,2].includes(channels))throw new RangeError('Room capture takes one or two input channels');
  if(!globalThis.navigator?.mediaDevices?.getUserMedia)throw new Error('Microphone capture needs a secure browser origin');
  if(signal?.aborted)throw interrupted();
  const pending=navigator.mediaDevices.getUserMedia({audio:{
    channelCount:{ideal:channels},echoCancellation:false,autoGainControl:false,noiseSuppression:false,
    ...(deviceId&&{deviceId:{exact:deviceId}})
  }});
  const stream=await (signal?new Promise((resolve,reject)=>{
    const cancel=()=>reject(interrupted());
    signal.addEventListener('abort',cancel,{once:true});
    pending.then(stream=>{
      signal.removeEventListener('abort',cancel);
      if(signal.aborted)stream.getTracks().forEach(track=>track.stop());
      else resolve(stream);
    },error=>{
      signal.removeEventListener('abort',cancel);
      reject(error);
    });
  }):pending);
  const info=stream.getAudioTracks()[0]?.getSettings()??{};
  if(['echoCancellation','autoGainControl','noiseSuppression'].some(key=>info[key]===true)){
    stream.getTracks().forEach(track=>track.stop());
    throw new Error('Disable echo cancellation, automatic gain and noise suppression on this input');
  }
  return stream;
}

/* The caller owns the stream and context. Capture never monitors the input. */
export async function captureRoomSweep(context,stream,{sweep,channels=1,signal,destination=context?.destination}={}){
  if(!context?.audioWorklet||typeof AudioWorkletNode!=='function'||!stream?.getAudioTracks||
    ![1,2].includes(channels)||destination?.context!==context)
    throw new TypeError('Room capture needs Web Audio, a media stream and a destination on the same context');
  if(signal?.aborted)throw interrupted();
  const stimulus=roomImpulseCapture.sweep({...sweep,sampleRate:context.sampleRate});
  const tracks=stream.getAudioTracks();
  if(!tracks.some(track=>track.readyState==='live'))throw new Error('The room capture input has ended');
  if(!worklets.has(context)){
    const module=context.audioWorklet.addModule(new URL('./room-impulse-capture-worklet.mjs',import.meta.url)).catch(error=>{
      worklets.delete(context);throw error;
    });
    worklets.set(context,module);
  }
  await Promise.all([worklets.get(context),context.resume()]);
  if(signal?.aborted)throw interrupted();
  const rate=context.sampleRate, first=Math.ceil((context.currentTime+.25)*rate/128)*128, frames=stimulus.samples.length;
  const input=context.createMediaStreamSource(stream);
  const player=context.createBufferSource();
  const buffer=context.createBuffer(1,stimulus.length,rate);
  buffer.getChannelData(0).set(stimulus.samples.subarray(stimulus.start,stimulus.start+stimulus.length));
  player.buffer=buffer;
  const recorder=new AudioWorkletNode(context,'ink-room-impulse-capture',{numberOfInputs:1,numberOfOutputs:1,
    outputChannelCount:[1],channelCountMode:'max',channelInterpretation:'discrete',processorOptions:{first,frames,channels}});
  let deadline, stop, ended;
  try{
    const result=new Promise((resolve,reject)=>{
      stop=()=>reject(interrupted());
      ended=()=>reject(new Error('Room capture input disconnected'));
      deadline=setTimeout(()=>reject(new Error('The audio device did not complete the room capture')),frames/rate*1000+4000);
      tracks.forEach(track=>track.addEventListener('ended',ended));
      signal?.addEventListener('abort',stop,{once:true});
      recorder.onprocessorerror=()=>reject(new Error('The room capture audio processor stopped'));
      recorder.port.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.samples);
    });
    input.connect(recorder);
    recorder.connect(context.destination);
    player.connect(destination);
    player.start((first+stimulus.start)/rate);
    const samples=await result;
    return {sampleRate:rate,channels,samples,settings:stimulus.settings};
  }finally{
    clearTimeout(deadline);
    tracks.forEach(track=>track.removeEventListener('ended',ended));
    signal?.removeEventListener('abort',stop);
    if(player.buffer)try{player.stop();}catch(error){if(error.name!=='InvalidStateError')throw error;}
    player.disconnect();
    input.disconnect();
    recorder.disconnect();
    recorder.port.close();
  }
}
