const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ink=require('../..'), api=ink.roomImpulseCapture, kit=ink.load();
const {stairwell,strike}=require('./fixture.js');
const {save}=require('../../cli/room-impulse-capture.js');
const WAV=require('../../cli/wav.js');
const {json,write}=require('../../cli/asset-files.js');

const out=process.argv[2];
if(!out)throw Error('Use node examples/room-impulse-capture/demo.cjs <output-directory>');
const {room,loopback,sweep,expected}=stairwell(api), sampleRate=sweep.sampleRate;
const measured=api.measure(room,{sweep:sweep.settings,loopback});
assert.equal(measured.report.latencySamples,expected.latency);
assert.equal(measured.report.directSample,expected.arrival);
save(out,measured);
for(const [name,pcm] of Object.entries({sweep,recording:room,loopback,strike:strike(sampleRate)}))
  write(path.join(out,name+'.wav'),WAV.encode(pcm,{encoding:'float32'}));

const T=kit.KIT.procedural.takeTime, range={startPoint:T.read(0),endPoint:T.read(4.8)};
const world={dt:.032,commands:[8,55,98].map(tick=>({tick,action:'world/event',args:{kind:'audio-cue',cue:'strike',at:[0,1,-1]}}))};
json(path.join(out,'world.json'),world);
const listener=[0,1,0], assets={strike:'strike.wav',
  early:{roomImpulse:'room-impulse.json',layer:'early'},tail:{roomImpulse:'room-impulse.json',layer:'tail'}};
const soundtrack={format:'ink-studio/scene-audio',version:1,world:'world.json',assets,sampleRate,listener};
const cues={strike:{asset:'strike',gain:.75,distance:{rolloff:0}}};
for(const [name,earlyGain,tailGain] of [['captured-room',1,1],['early-only',1,0],['tail-only',0,1],['dry',0,0]]){
  const roomResponse={wet:.82,smoothing:0,rooms:{stairwell:{min:[-2,0,-2],max:[2,3,2],
    probes:[{at:listener,impulse:{early:'early',tail:'tail',earlyGain,tailGain}}]}}};
  const file=path.join(out,name+'.json');
  json(file,{...soundtrack,spatial:{cues,roomResponse}});
  write(path.join(out,name+'.wav'),ink.readSceneAudio(file,{kit}).render(range).waves.mix);
}

const read=(folder,name)=>fs.readFileSync(path.join(__dirname,folder,name),'utf8');
const worklet=read('../../src/webgl','room-impulse-capture-worklet.mjs');
const player=read('../../src/webgl','room-impulse-capture.mjs').replace(/^import[^\n]*\n/gm,'')
  .replaceAll('export ','').replace('shared.default??','')
  .replace("new URL('./room-impulse-capture-worklet.mjs',import.meta.url)",'captureWorkletURL');
const author=read('.','studio.mjs').replace(/^import[^\n]*\n/gm,'');
const assetsCode=[read('../../src','fft.js'),read('../../src','room-impulse-capture.js'),read('.','fixture.js'),
  'const captureWorkletURL=URL.createObjectURL(new Blob(['+JSON.stringify(worklet)+'],{type:"application/javascript"}));',
  player,'const api=roomImpulseCapture;',author].join('\n');
const html=read('.','index.html').replace('<main>','<body data-demo="stairwell">\n<main>')
  .replace('<script type="module" src="./studio.mjs"></script>',()=>'<script type="module">\n'+assetsCode+'</script>\n</body>');
write(path.join(out,'index.html'),html);
console.log(JSON.stringify(measured.report,null,2));
