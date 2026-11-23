/* Run: node examples/music-production/mixer-routing-workshop.cjs output-directory */
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), {execFileSync}=require('node:child_process');
const {KIT:K}=require('../..').load(), A=K.music.production, P=K.procedural;
const {write,json}=require('../../cli/asset-files'), WAV=require('../../cli/wav');
const session=require('./relay-glass.json');
const folder=path.resolve(process.argv[2] ?? 'mixer-routing-workshop'), at=file=>path.join(folder,file);
const sampleRate=24000, map=session.production.arrangement.score.tempoMap, {tempo}=map;
const clock=P.musicTiming.compile(map);
const source=structuredClone(session.production);
for (const track of Object.values(source.tracks)) {
  delete track.duck;
  track.send=0;
}
const assets=Object.fromEntries(Object.entries(session.assets).map(([name,file])=>[name,WAV.read(path.join(__dirname,file))]));
const rendered=A.render(source,assets,{sampleRate,stems:true});
const sources=Object.fromEntries(Object.keys(source.tracks).map(name=>{
  const relative='sources/'+name+'.wav';
  write(at(relative),WAV.encode(rendered.stems[name],{encoding:'pcm24'}));
  return [name,relative];
}));
const relay='sources/relay.wav';
write(at(relay),WAV.encode(assets['metal-alt'],{encoding:'pcm24'}));
sources.relay=relay;

const curve=(unit,points,shape='linear')=>({unit,curve:shape,points:points.map(([at,value])=>({at,value}))});
const beats=(...points)=>curve('beats',points);
const sec=(...points)=>curve('seconds',points);
const take=(source,extra={})=>({id:source+'-take',source,...extra});
const last=clock.timeAt({beat:24});
const relayAt=clock.timeAt({beat:23.875});
const mixer={
  id:'after-the-cut',sampleRate,map,end:{beat:24},output:'master',tail:'keep',peakPolicy:'error',
  strips:{
    kick:{clips:[take('kick',{gainDb:1.5})],output:'rhythm',fader:.93},
    snare:{clips:[take('snare',{gainDb:beats([0,1],[8,1],[14,3.2],[18,1.5])})],output:'rhythm',fader:.95},
    hat:{clips:[take('hat')],output:'rhythm',fader:.86},
    rhythm:{output:'drums',fader:.84,sends:{pressure:{tap:'pre',level:beats([0,0],[7.5,0],[8.25,.46],[21,.39])}}},
    pressure:{output:'drums',inserts:['drum-bite','parallel-dynamics'],fader:.83},
    drums:{fader:beats([0,.89],[22.5,.89],[23.45,.44],[24,.02])},
    bass:{clips:[take('bass',{gainDb:2.8})],fader:1.08},
    lead:{clips:[take('lead')],output:'score',fader:beats([0,.9],[17,1],[22.5,.94],[23.625,0]),
      sends:{room:{tap:'pre',level:beats([0,.04],[15,.06],[16.5,.43],[22.5,.7],[24,.94])}}},
    pad:{clips:[take('pad',{gainDb:5})],output:'score',fader:1.09},
    score:{inserts:[{processor:'kick-duck',sidechain:{strip:'kick',tap:'pre'}}],
      fader:beats([0,1.15],[20,1.36],[23.625,1.05],[24,0])},
    metal:{clips:[take('metal')],fader:beats([0,.69],[16,.87],[23,.35]),
      sends:{room:{tap:'post',level:beats([0,.16],[16,.43],[24,.57])}}},
    relay:{clips:[take('relay',{at:{beat:23.875},gainDb:curve('samples',[[0,9],[1150,3],[6000,0]])})],
      pan:.25,fader:sec([0,.44],[relayAt+.024,.44],[relayAt+.059,0]),sends:{room:{tap:'pre',level:1.55}}},
    room:{inserts:['space','room-top'],fader:beats([0,.85],[16,.95],[24,1.3])},
    master:{fader:1.15}
  },
  processors:{
    'drum-bite':{type:'drive',amount:5.8,wet:.72},
    'parallel-dynamics':{type:'compressor',thresholdDb:-26,ratio:5,attack:.006,release:.10,lookahead:.01875,wet:.84},
    'kick-duck':{type:'compressor',thresholdDb:-30,ratio:6,attack:.006,release:.125,lookahead:.0225,
      wet:beats([0,0],[11.75,0],[12.25,.85],[21,.96])},
    space:{type:'reverb',decay:2.1,size:1.29,damping:.56},
    'room-top':{type:'lowpass',hz:sec([0,7400],[last-.5,5200],[last+1.7,1200])}
  },
  taps:{
    dry:{strip:'rhythm'},pressure:{strip:'pressure'},bed:{strip:'score',tap:'input'},
    ducked:{strip:'score',tap:'pre'},kick:{strip:'kick',tap:'pre'},room:{strip:'room'},relay:{strip:'relay',tap:'pre'}
  }
};
json(at('session.json'),{mixer,assets:sources});
const cli=path.join(__dirname,'../../cli/ink-studio.js');
function exportTake(name) {
  return JSON.parse(execFileSync(process.execPath,[cli,'music','mix','render',at(name+'.json'),'--out',at(name)],
    {encoding:'utf8'}));
}
const mix=exportTake('session'), report=JSON.parse(fs.readFileSync(mix.report,'utf8'));
const noTail={...mixer,tail:'cut',taps:{}};
json(at('hard-cut.json'),{mixer:noTail,assets:sources});
const cut=exportTake('hard-cut');
const withTail=WAV.read(mix.mix), withoutTail=WAV.read(cut.mix);
assert.deepEqual(withTail.samples.slice(0,withoutTail.samples.length),withoutTail.samples);
assert.equal(report.strips.pressure.latency,450);
assert.equal(report.strips.score.latency,540);
assert.equal(report.latencySamples,540);
assert(report.tailFrames>2*sampleRate);
let tailPeak=0;
for (const value of withTail.samples.subarray(withoutTail.samples.length)) tailPeak=Math.max(tailPeak,Math.abs(value));
assert(tailPeak>.025);
write(at('after-the-cut.wav'),WAV.encode(withTail,{encoding:'pcm24'}));
json(at('demo.json'),{title:'After the Cut',sampleRate,tempo,sourceEnd:report.sourceEnd/sampleRate,
  duration:report.frames/sampleRate,latency:report.latencySamples,parallelLatency:report.strips.pressure.latency,
  tailPeak,mixPeak:report.peak,beats:[0,8,12,16,24].map(beat=>({beat,time:clock.timeAt({beat})}))});
console.log(JSON.stringify({frames:report.frames,latency:report.latencySamples,peak:report.peak,tailPeak}));
