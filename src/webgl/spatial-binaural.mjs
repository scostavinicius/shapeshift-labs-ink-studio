import * as shared from '../binaural-profile.js';
const B=shared.default??globalThis[Symbol.for('ink-studio.binaural-profile')];
const modules=new WeakMap();

export async function decodeBinauralProfile(bytes,{sha256}={}){
  if(!(bytes instanceof ArrayBuffer)&&!ArrayBuffer.isView(bytes))throw new TypeError('Expected binaural profile bytes');
  if(!B.hash(sha256))throw new TypeError('Expected a lowercase SHA-256 for the binaural profile');
  if(!bytes.byteLength||bytes.byteLength>B.maxBytes)throw new RangeError('Binaural profile exceeds its byte budget');
  // Snapshot the bytes so that the hashed content is the content we decode.
  const input=bytes instanceof ArrayBuffer?new Uint8Array(bytes).slice():
    new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength).slice();
  const digest=await globalThis.crypto.subtle.digest('SHA-256',input);
  if(Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')!==sha256)
    throw new Error('Binaural profile SHA-256 mismatch');
  return B.decode(input,sha256);
}

export function prepareBinaural(context,raw){
  const profile=B.compile(raw), plan=B.prepare(profile,context.sampleRate);
  if(!context.audioWorklet||typeof AudioWorkletNode!=='function')
    throw new Error('Pinned binaural preview needs AudioWorklet support in a secure context');
  function loaded(){
    if(!modules.has(context)){
      const pending=context.audioWorklet.addModule(new URL('./spatial-binaural-worklet.mjs',import.meta.url)).catch(error=>{
        modules.delete(context);throw error;
      });
      modules.set(context,pending);
    }
    return modules.get(context);
  }
  return {get ready(){return loaded();},open(listener,point,cutoff){
    let direction=B.direction(listener,point), level=cutoff;
    const node=new AudioWorkletNode(context,'ink-binaural-profile',{numberOfInputs:1,numberOfOutputs:1,
      channelCount:1,channelCountMode:'explicit',outputChannelCount:[2],
      processorOptions:{kernel:plan.kernel(direction),transition:plan.transition,cutoff}});
    return {node,update(listener,point,cutoff){
      const next=B.direction(listener,point), changed=next.some((n,i)=>Math.abs(n-direction[i])>1e-8);
      if(!changed&&level===cutoff)return;
      if(changed)direction=next;
      level=cutoff;
      node.port.postMessage({at:Math.round(context.currentTime*context.sampleRate),cutoff,
        ...(changed&&{kernel:plan.kernel(direction)})});
    }};
  }};
}
