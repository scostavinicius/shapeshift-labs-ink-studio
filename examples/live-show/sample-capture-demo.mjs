import {createLiveAudioRouter,createLiveSampleCapture,sampleCaptureFiles} from '../../show-control.mjs';

const byId = id => document.getElementById(id);
const bench = byId('bench'), mic = byId('mic'), strike = byId('strike'), recover = byId('recover');
const stop = byId('stop'), status = byId('status'), save = byId('save');
const wave = byId('wave'), draw = wave.getContext('2d');
let context, router, recorder, stream, test, player, take, links = [];

function showWave(audio) {
  draw.clearRect(0,0,wave.width,wave.height);
  const half = wave.height/2, {samples,channels} = audio;
  const frames = samples.length/channels;
  draw.strokeStyle = '#faca88';
  draw.beginPath();
  for (let x=0; x<wave.width; x++) {
    const first = Math.floor(x*frames/wave.width), end = Math.floor((x+1)*frames/wave.width);
    let lo = 0, hi = 0;
    for (let n=first; n<end; n++) for (let c=0; c<channels; c++) {
      lo = Math.min(lo,samples[n*channels+c]);
      hi = Math.max(hi,samples[n*channels+c]);
    }
    draw.moveTo(x,half-hi*half);
    draw.lineTo(x,half-lo*half);
  }
  draw.stroke();
}
async function endCapture() {
  if (player) {player.stop();player = undefined;}
  recorder?.close();
  router?.dispose();
  for (const track of stream?.getTracks() ?? []) track.stop();
  if (context && context.state!=='closed') await context.close();
  context = router = recorder = stream = undefined;
  bench.disabled = mic.disabled = false;
  recover.disabled = strike.disabled = stop.disabled = true;
  status.textContent = 'Capture stopped';
}
async function begin(input) {
  bench.disabled = mic.disabled = true;
  try {
    test = input==='bench';
    context ??= new AudioContext();
    await context.resume();
    router = createLiveAudioRouter(context);
    router.addBus(input,{gain:test ? .72 : 1,pan:test ? -.15 : 0});
    router.send(input,'main');
    if (test) router.setMonitor(.36);
    else {
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      router.attach(input,context.createMediaStreamSource(stream));
    }
    const source = test ? {kind:'bus',name:'bench',reference:'Ink Studio test instrument'} :
      {kind:'mic',name:'microphone'};
    recorder = await createLiveSampleCapture(context,{router,bus:input,source,historySeconds:3,channels:test?2:1});
    recover.disabled = stop.disabled = false;
    strike.disabled = !test;
    status.textContent = test ? 'Rolling capture on the instrument bus' : 'Rolling microphone capture';
  } catch (error) {
    await endCapture();
    status.textContent = error.message;
  }
}
function play(data, monitor = false) {
  const {channels,samples,sampleRate} = data, count = samples.length/channels;
  const buffer = context.createBuffer(channels,count,sampleRate);
  for (let c=0;c<channels;c++) {
    const lane = buffer.getChannelData(c);
    for (let i=0;i<count;i++) lane[i] = samples[i*channels+c];
  }
  const node = context.createBufferSource();
  node.buffer = buffer;
  if (monitor) node.connect(context.destination);
  else node.onended = router.attach('bench',node);
  node.start();
  return node;
}
bench.onclick = () => begin('bench');
mic.onclick = () => begin('mic');
strike.onclick = () => {
  const sampleRate = context.sampleRate;
  const samples = Float32Array.from({length:Math.round(.66*sampleRate)},(_,frame)=>{
    const t = frame/sampleRate;
    const tone = (frequency,decay) => Math.cos(2*Math.PI*t*frequency)*Math.exp(-t*decay);
    return Math.min(t*1800,1)*(.44*tone(440,10)+.21*tone(1393,22)+.095*tone(2847,61));
  });
  play({sampleRate,channels:1,samples});
};
recover.onclick = async () => {
  try {
    take = await recorder.capture({seconds:1.6});
    showWave(take.value);
    const sample = test ? {id:'bench-strike',label:'Bench strike',material:'metal',articulation:'struck',pitch:'A4',
      tags:['test instrument','resonance'],license:{id:'CC0-1.0'}} :
      {id:'mic-take',label:'Microphone take',tags:['field recording']};
    const {wav,recipe} = sampleCaptureFiles(take,sample);
    for (const link of links) URL.revokeObjectURL(link);
    links = [URL.createObjectURL(new Blob([wav],{type:'audio/wav'})),
      URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)+'\n'],{type:'application/json'}))];
    byId('wav').href = links[0];
    byId('recipe').href = links[1];
    save.hidden = false;
    status.textContent = 'Recovered '+(take.value.samples.length/take.value.channels/take.value.sampleRate).toFixed(2)+' seconds';
  } catch (error) {status.textContent = error.message;}
};
byId('audition').onclick = async () => {
  context ??= new AudioContext();
  await context.resume();
  if (player) player.stop();
  player = play(take.value,true);
  player.onended = ({target}) => {if (player===target) player=undefined;};
};
stop.onclick = endCapture;
