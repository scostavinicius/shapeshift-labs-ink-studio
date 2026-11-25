/* Original struck-glass capture with simulated mic placement and recorder skew. */
const tau=2*Math.PI,hz=key=>440*2**((key-69)/12);
function capture(sampleRate=24000) {
  const tracks={
    close:{channels:1,offset:0,arrival:0,polarity:1},
    middle:{channels:1,offset:-241,arrival:12,polarity:1},
    room:{channels:2,offset:751,arrival:84,polarity:-1}
  };
  const positions=[[60,'soft'],[60,'firm'],[60,'firm'],[65,'soft'],[65,'firm'],[65,'firm'],[72,'soft'],[72,'firm']];
  const frames=Math.round((positions.length*1.13+1.1)*sampleRate),slate=Math.round(.31*sampleRate);
  const assets=Object.fromEntries(Object.entries(tracks).map(([name,{channels}])=>
    [name,{sampleRate,channels,samples:new Float64Array(frames*channels)}]));
  let seed=61103;
  const noise=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2147483648-1);
  const tick=Float64Array.from({length:Math.round(.008*sampleRate)},(_,i)=>.18*noise()*Math.exp(-380*i/sampleRate));
  for (const [name,track] of Object.entries(tracks)) {
    const {samples}=assets[name];
    for (let i=0;i<tick.length;i++) for (let ch=0;ch<track.channels;ch++)
      samples[(slate+track.offset+i)*track.channels+ch]=tick[i]*track.polarity*(ch ? .8 : 1);
  }
  const reflections=[
    [[0,.61],[.009,.14],[.027,-.1],[.046,.08],[.071,.06],[.12,-.04]],
    [[0,.64],[.017,-.21],[.037,.16],[.062,.12],[.11,-.13],[.16,.07],[.23,.055],[.31,-.028]],
    [[.00065,.46],[.012,.22],[.049,-.14],[.083,-.14],[.123,.12],[.177,-.08],[.248,.063],[.335,.033]]
  ];
  const takes=positions.map(([key,dynamic],index)=>{
    const onset=Math.round((.9+index*1.13)*sampleRate),firm=dynamic==='firm', root=hz(key);
    const source=new Float64Array(Math.round(.75*sampleRate));
    for (let i=0;i<source.length;i++) {
      const t=i/sampleRate,phase=tau*root*t, gain=firm ? .88 : .53;
      const strike=.55*noise()*Math.exp(-390*t);
      const body=.235*Math.sin(phase)*Math.exp(-7*t)+
        .092*Math.sin(phase*1.507+index*.2)*Math.exp(-11*t)+
        .066*Math.sin(phase*2.37+.1)*Math.exp(-17*t)+
        (firm ? .085 : .045)*Math.sin(phase*3.912)*Math.exp(-33*t);
      source[i]=gain*(strike+Math.min(1,t/.004)*body)*Math.min(1,(source.length-i)/(sampleRate*.04));
    }
    function place(name,ch,taps) {
      const {channels,offset,arrival,polarity}=tracks[name], {samples}=assets[name];
      for (const [time,gain] of taps) {
        const start=onset+offset+arrival+Math.round(time*sampleRate);
        for (let i=0;i<source.length;i++) samples[(start+i)*channels+ch]+=source[i]*gain*polarity;
      }
    }
    place('close',0,[[0,1]]);
    place('middle',0,reflections[0]);
    place('room',0,reflections[1]);
    place('room',1,reflections[2]);
    return {id:'strike-'+(index+1),key,dynamic,articulation:'glass',
      fromSample:onset-Math.round(.06*sampleRate),toSample:onset+Math.round(sampleRate*1.04)};
  });
  const session={format:'ink-studio/instrument-session',version:1,id:'glass-room',sampleRate,analyze:'close',
    perspectives:Object.fromEntries(Object.keys(tracks).map(name=>[name,{asset:name}])),
    registers:[60,65,72],range:[57,75],dynamics:[{id:'soft',velocity:.34},{id:'firm',velocity:.86}],
    articulations:['glass'],takes};
  return {session,assets,tracks,slate};
}
module.exports={capture};
