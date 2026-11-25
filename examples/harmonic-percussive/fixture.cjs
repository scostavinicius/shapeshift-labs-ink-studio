/* Original stereo break with known tonal and percussive references for the demo. */
const tau=2*Math.PI;
const hz=midi=>440*2**((midi-69)/12);
const drumRows=[
  [.16,'kick',.88,0], [.39,'hat',.26,-.54], [.62,'snare',.73,.12], [.83,'hat',.30,.56],
  [1.08,'kick',.70,0], [1.31,'hat',.25,-.60], [1.54,'snare',.76,.18], [1.75,'hat',.31,.49],
  [1.98,'kick',.84,0], [2.18,'hat',.27,-.55], [2.41,'snare',.81,.17], [2.62,'hat',.26,.50],
  [2.86,'kick',.61,0], [3.03,'rim',.43,-.41], [3.31,'snare',.73,.15], [3.51,'hat',.31,.47],
  [3.77,'kick',.81,0], [3.96,'rim',.37,-.35], [4.23,'snare',.71,.18], [4.45,'hat',.30,.48]
];
const chordRows=[
  [0,1.38,[57,64,69],.93], [1.22,1.44,[53,60,67],1],
  [2.45,1.38,[55,62,70],.91], [3.64,1.16,[57,64,72],1]
];
function make(sampleRate=32000){
  const duration=4.8, length=Math.round(duration*sampleRate), channels=2;
  const tonal=new Float64Array(length*2), transient=tonal.slice(), samples=tonal.slice();
  let seed=74931;
  const noise=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2147483648-1);
  for(const [seconds,span,notes,level] of chordRows){
    const begin=Math.round(seconds*sampleRate), end=Math.min(length,begin+Math.round(span*sampleRate));
    for(let i=begin;i<end;i++){
      const t=(i-begin)/sampleRate, left=(end-i)/sampleRate;
      const envelope=Math.min(1,t/.061,left/.27)*Math.exp(-.84*t)*level;
      for(const [voice,note] of notes.entries()){
        const p=t*hz(note)*tau, lane=voice%2;
        const bell=.103*Math.sin(p)+.031*Math.sin(2*p+voice*.11)*Math.exp(-2.3*t)+
          .013*Math.sin(3*p+.16)*Math.exp(-4.8*t)+.015*Math.sin(5.008*p)*Math.exp(-8*t);
        tonal[i*2+lane]+=envelope*bell;
        tonal[i*2+1-lane]+=envelope*bell*.59;
      }
    }
  }
  for(const [seconds,kind,level,pan] of drumRows){
    const begin=Math.round(seconds*sampleRate), span={kick:.16,snare:.102,rim:.075,hat:.075}[kind];
    const end=Math.min(length,begin+Math.round(span*sampleRate)), left=Math.sqrt((1-pan)/2), right=Math.sqrt((1+pan)/2);
    let prior=0, soft=0;
    for(let i=begin;i<end;i++){
      const t=(i-begin)/sampleRate, current=noise(), high=current-prior;
      prior=current;soft+=(current-soft)*.45;
      let v;
      if(kind==='kick'){
        const sweep=54*t+88*(1-Math.exp(-39*t))/39;
        v=.61*Math.sin(tau*sweep)*Math.exp(-24*t)+high*.15*Math.exp(-115*t);
      }else if(kind==='snare'){
        v=.59*soft*Math.exp(-43*t)+.19*high*Math.exp(-100*t)+.29*Math.sin(tau*174*t)*Math.exp(-48*t);
      }else if(kind==='rim'){
        v=.38*high*Math.exp(-104*t)+.42*Math.sin(tau*640*t)*Math.exp(-78*t);
      }else v=.46*high*Math.exp(-67*t);
      const attack=Math.min(1,(i-begin+1)/(sampleRate*.00065)), endFade=Math.min(1,(end-i)/(sampleRate*.005));
      v*=level*attack*endFade;
      transient[i*2]+=v*left;transient[i*2+1]+=v*right;
    }
  }
  for(let i=0;i<samples.length;i++)samples[i]=tonal[i]+transient[i];
  const audio=samples=>({sampleRate,channels,samples});
  return {source:audio(samples),tonal:audio(tonal),transient:audio(transient),
    hits:drumRows.map(([time,kind])=>({time,kind,sample:Math.round(time*sampleRate)}))};
}
module.exports={make};
