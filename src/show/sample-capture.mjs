import { normalizeCapture } from './rolling-audio.mjs';

const modules = new WeakMap();

/** Record a Web Audio node or a live router's named post-fader bus. */
export async function createLiveSampleCapture(context, {
  node: input, router, bus = 'main', source = router ? {kind:'bus', name:bus} : undefined,
  historySeconds = 8, channels = 2
} = {}) {
  if (!context?.audioWorklet || Boolean(input) === Boolean(router) || input && input.context !== context ||
      router && typeof router.tap !== 'function' || !source || !['mic','world','instrument','stem','bus','graph','file'].includes(source.kind) ||
      typeof source.name !== 'string' || !source.name.trim() || source.name.length > 512 ||
      source.reference !== undefined && (typeof source.reference !== 'string' || !source.reference.trim() || source.reference.length > 512) ||
      ![1,2].includes(channels) || !Number.isFinite(historySeconds) || historySeconds <= 0 || historySeconds > 30 ||
      Math.round(context.sampleRate * historySeconds) < 1 || Math.round(context.sampleRate * historySeconds) * channels > 2e6)
    throw new TypeError('Live capture needs a Web Audio source or bus, provenance and bounded PCM history');
  const provenance = {kind:source.kind, name:source.name, ...(source.reference !== undefined && {reference:source.reference})};
  if (!modules.has(context)) modules.set(context, context.audioWorklet.addModule(new URL('./sample-capture-worklet.mjs', import.meta.url))
    .catch(error => { modules.delete(context); throw error; }));
  await modules.get(context);
  const node = new AudioWorkletNode(context, 'ink-sample-capture', {
    numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1], channelCount:channels, channelCountMode:'explicit',
    processorOptions:{channels, seconds:historySeconds}
  });
  let detach;
  try {
    if (router) detach = router.tap(bus, node);
    else { input.connect(node); detach = () => input.disconnect(node); }
    node.connect(context.destination);
  } catch (error) {
    detach?.();
    node.port.close();
    throw error;
  }
  const pending = new Map();
  let serial = 0, stopped;
  function close(error = new Error('Audio capture is closed')) {
    if (stopped) return;
    stopped = error;
    node.port.postMessage({operation:'stop'});
    node.port.close();
    node.disconnect();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    try { detach(); } catch (problem) { if (problem.name !== 'InvalidAccessError') throw problem; }
  }
  node.onprocessorerror = () => close(new Error('Audio capture processor failed'));
  node.port.onmessage = ({data:{id,result,error}}) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error) request.reject(new RangeError(error));
    else request.resolve(result);
  };
  function request(operation, options) {
    if (stopped) return Promise.reject(stopped);
    if (pending.size >= 32) return Promise.reject(new RangeError('Too many pending audio capture requests'));
    const id = ++serial;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve,reject});
      node.port.postMessage({id,operation,options});
    });
  }
  return Object.freeze({
    range: () => request('range'),
    async capture(options) {
      const {value,range} = await request('capture', options);
      return {value, source:{...provenance,...range,gain:normalizeCapture(value.samples)}};
    },
    close: () => close()
  });
}

/** Package a captured buffer as lossless float WAV plus a sample-library import recipe. */
export function sampleCaptureFiles(capture, sample, filename = 'capture.wav') {
  const {sampleRate, channels, samples} = capture.value;
  if (!(samples instanceof Float32Array) || ![1,2].includes(channels) || !samples.length || samples.length % channels ||
      samples.length > 2e6 ||
      !Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 768000 ||
      typeof filename !== 'string' || !/^[a-z0-9_-]+\.wav$/i.test(filename))
    throw new TypeError('Expected live recording PCM and a WAV filename');
  const bytes = new Uint8Array(58 + samples.length * 4), view = new DataView(bytes.buffer);
  const word = (at, text) => { for (let i = 0; i < text.length; i++) bytes[at+i] = text.charCodeAt(i); };
  const u16 = (at, value) => view.setUint16(at,value,true);
  const u32 = (at, value) => view.setUint32(at,value,true);
  word(0,'RIFF'); u32(4,bytes.length-8); word(8,'WAVEfmt '); u32(16,18);
  u16(20,3); u16(22,channels); u32(24,sampleRate); u32(28,sampleRate*channels*4); u16(32,channels*4); u16(34,32);
  word(38,'fact'); u32(42,4); u32(46,samples.length/channels);
  word(50,'data'); u32(54,samples.length*4);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (!Number.isFinite(value) || Math.abs(value)>1) throw new RangeError('Capture WAV needs normalized PCM');
    view.setFloat32(58+i*4,value,true);
  }
  return {wav:bytes, recipe:{input:{kind:'file',path:filename}, sample, provenance:capture.source}};
}
