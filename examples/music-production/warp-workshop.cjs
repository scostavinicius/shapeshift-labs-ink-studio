/* Run: node examples/music-production/warp-workshop.cjs output-directory [spoken-word.wav] */
const assert=require('node:assert/strict');
const path=require('node:path');
const {KIT:K}=require('../..').load(), A=K.procedural.mediaGraph;
const WAV=require('../../cli/wav.js');
const {write,json}=require('../../cli/asset-files.js');
const folder=path.resolve(process.argv[2] ?? 'warp-workshop');
const sampleRate=32000, tau=2*Math.PI, frame=n=>Math.round(n*sampleRate);
const rate={from:100,to:140}, fps=30;
const sample=name=>WAV.read(path.join(__dirname,'samples',name+'.wav')).samples;
const take=new Float64Array(frame(2.4)*2);
const kick=Float64Array.from({length:frame(.27)},(_,i)=>{
  const t=i/sampleRate, phase=49*t+59*(1-Math.exp(-t*43))/43;
  return Math.sin(tau*phase)*Math.exp(-t*15)*Math.min(t*1900,1);
});
function hit(source,time,level,pan) {
  const first=frame(time), length=Math.min(source.length,take.length/2-first);
  const left=Math.sqrt((1-pan)/2), right=Math.sqrt((1+pan)/2);
  for (let i=0;i<length;i++) {
    const value=source[i]*level*Math.min(1,(length-i)/92);
    take[2*(i+first)]+=value*left;
    take[2*(i+first)+1]+=value*right;
  }
}
for (const [at,gain] of [[0,.64],[.464,.38],[1.202,.66],[1.63,.42],[2.23,.39]]) hit(kick,at,gain,0);
hit(sample('snare-main'),.6,.84,.03);
hit(sample('snare-alt'),1.8,.86,-.03);
hit(sample('snare-ghost'),1.099,.4,-.12);
hit(sample('metal-soft'),1.352,.49,.37);
for (const [i,time] of [.142,.31,.764,.919,1.09,1.513,1.681,1.972,2.114,2.264].entries())
  hit(sample(i%3===1?'hat-closed-alt':'hat-closed'),time,i%2 ? .36 : .58,-.16);
hit(sample('hat-open'),2.31,.46,.21);

const peak=K.music.production.meters({samples:take,channels:2,sampleRate}).peak;
if (peak>.82) for (let i=0;i<take.length;i++) take[i]*=.82/peak;
const drum={sampleRate,channels:2,samples:take};
const chord={sampleRate,channels:2,samples:Float64Array.from({length:frame(1.43)*2},(_,i)=>{
  const t=(i>>1)/sampleRate, side=i%2, keys=[146.832,220,261.626,349.228];
  const env=Math.min(1,t/.083)*Math.min(1,(1.43-t)/.23)*Math.exp(-t*.46);
  return env*keys.reduce((sum,hz,k)=>{
    const pan=k%2===side?1:.48, phase=t*hz+k*.081;
    return sum+pan*(.135*Math.sin(tau*phase)+.046*Math.sin(tau*phase*2)*Math.exp(-t*3)+
      .026*Math.sin(tau*phase*3)*Math.exp(-t*4));
  },0);
})};

const reports={};
function save(name,audio) {
  write(path.join(folder,name+'.wav'),WAV.encode(audio,{encoding:'float64'}));
}
function warp(name,audio,settings) {
  const {value,report}=A.warpAudio(audio,settings);
  reports[name]={...report,settings};
  save(name,value);
  return {value,report};
}
save('break-original',drum);
const beat=warp('break-beats',drum,{mode:'beats',tempo:rate,detect:{minGap:.095,minStrength:.025}});
warp('break-repitch',drum,{mode:'repitch',tempo:rate});
const markers=[{id:'first-cut',sourceSample:frame(.6),targetFrame:17},
  {id:'second-cut',sourceSample:frame(1.8),targetFrame:43}];
const picture=warp('break-picture',drum,{mode:'beats',tempo:rate,fps,markers,
  detect:{minGap:.095,minStrength:.025}});
assert.equal(picture.report.targetFrames,beat.report.targetFrames);
for (const pin of picture.report.markers.filter(row=>row.kind==='pin')) {
  const at=pin.targetSample*2, from=pin.sourceSample*2;
  assert.equal(pin.targetSample,Math.floor(pin.targetFrame*sampleRate/fps));
  assert.deepEqual(picture.value.samples.slice(at,at+40),drum.samples.slice(from,from+40));
}
save('chord-original',chord);
warp('chord-warp',chord,{mode:'tones',speed:.69});
if (process.argv[3]) {
  const speech=WAV.read(path.resolve(process.argv[3]));
  save('speech-original',speech);
  warp('speech-warp',speech,{mode:'speech',speed:1.28});
}
json(path.join(folder,'report.json'),reports);
console.log(JSON.stringify({audio:Object.keys(reports),markers:picture.report.markers.filter(row=>row.kind==='pin')}));
