/* Original ferry cue, two landings and their authored endings. */
const tempo=112,seconds=beats=>beats*60/tempo,rate=24000;
const patches={
  keys:{type:'keys',tine:.45,bite:.2,dust:.02,wear:.12,color:.60,
    env:{attack:.005,decay:.27,sustain:.28,release:.23}},
  bell:{type:'fm',ratio:2,index:1.7,indexDecay:.12,body:.15,color:.65,
    env:{attack:.005,decay:.17,sustain:.16,release:.21}},
  bass:{type:'analog',body:.55,env:{attack:.015,decay:.14,sustain:.71,release:.13}},
  bows:{type:'subtractive',saw:.14,pulse:.32,sub:.07,filter:{cutoff:840,resonance:.57,keyTrack:.24,envAmount:6},
    env:{attack:.055,decay:.16,sustain:.53,release:.22}}
};
const parts={keys:{role:'lead'},bell:{role:'pad'},bass:{role:'bass'},bows:{role:'pad'}};
const mix={keys:{gain:-6,pan:-.18,send:.18},bell:{gain:-9,pan:.31,send:.25},
  bass:{gain:-9,pan:0,send:.04},bows:{gain:-14,pan:.12,send:.25}};
const room={gain:-8,size:1.1,decay:.82,damping:.55};
const cluster=(at,hold,notes,velocity)=>notes.map((note,i)=>[at+i*.018,hold-i*.018,note,velocity-i*.045]);
function divideVoices(rows) {
  const voices=[];
  for (const [[beat,duration,midi,velocity],i] of rows.map((row,index)=>[row,index]).sort((a,b)=>a[0][0]-b[0][0])) {
    let voice=voices.find(row=>row.end<=beat);
    if (!voice) {
      voice={id:'voice-'+voices.length,notes:[],end:0};
      voices.push(voice);
    }
    voice.notes.push({id:'note-'+i,beat,duration,midi,velocity});
    voice.end=beat+duration;
  }
  return voices.map(({id,notes})=>({id,notes}));
}
function cue(tracks) {
  return {seed:383,arrangement:{score:{key:{root:'D3'},tempoMap:{tempo},harmonies:{cue:{root:'D3',quality:'unison'}}},
    parts,motifs:{},sections:[{id:'scene',bars:1,harmony:'cue'}]},patches,
    tracks:Object.fromEntries(Object.entries(tracks).map(([part,notes])=>[part,{patch:part,...mix[part],
      clips:[{id:'take',beat:0,length:4,voices:divideVoices(notes)}]}])),room};
}
const sources={
  ferry:cue({bass:[[0,1.47,38,.59],[2,.68,45,.43]],bows:cluster(0,3.63,[50,57],.45),
    keys:[[.08,.34,65,.63],[.58,.31,69,.55],[1.08,.31,72,.51],[2.59,.26,64,.44]],
    bell:[[.14,.16,77,.3],[1.27,.23,76,.34]]}),
  'ferry-return':cue({bass:[[0,1.49,38,.61],[2,.68,45,.41]],bows:cluster(0,3.63,[50,57],.47),
    keys:[[.08,.34,65,.59],[.58,.31,69,.61],[1.08,.26,74,.55],[2.59,.24,64,.36]],
    bell:[[.15,.16,81,.33],[1.23,.20,77,.31]]}),
  harbor:cue({bass:[[0,1.6,41,.65],[1.9,.95,48,.48]],bows:cluster(0,3.7,[53,57,60,65],.53),
    keys:[...cluster(0,.65,[65,69,72],.63),[.86,.43,76,.55],[1.56,.58,77,.58],[2.47,.57,72,.51]],
    bell:[[.22,.25,84,.45],[1.82,.3,81,.49],[3.05,.31,77,.40]]}),
  cliff:cue({bass:[[0,1.58,38,.66],[1.9,.95,45,.48]],bows:cluster(0,3.7,[50,57,62,66],.53),
    keys:[...cluster(0,.65,[66,69,74],.63),[.86,.43,76,.55],[1.56,.58,81,.58],[2.47,.57,78,.51]],
    bell:[[.22,.25,86,.43],[1.82,.3,81,.46],[3.05,.31,90,.39]]}),
  'harbor-pickup':cue({keys:[[0,.12,67,.7],[.23,.20,64,.83]],bell:[[.27,.17,76,.47]]}),
  'harbor-turn':cue({keys:[[0,.22,70,.76],[.27,.25,67,.68],[.61,.26,64,.83]],
    bass:[[.24,.62,48,.70]],bell:[[.31,.33,79,.48],[.72,.2,76,.51]]}),
  'harbor-full':cue({keys:[...cluster(0,.51,[55,58,62,65],.73),...cluster(.57,.58,[52,58,60,67],.77),
      ...cluster(1.24,.62,[53,57,60,65],.88)],
    bass:[[0,.51,43,.73],[.57,.61,48,.83],[1.24,.64,41,.89]],
    bell:[[.14,.31,77,.46],[.7,.28,79,.51],[1.3,.62,81,.57]]}),
  'cliff-pickup':cue({keys:[[0,.12,73,.72],[.24,.20,76,.84]],bell:[[.26,.18,85,.51]]}),
  'cliff-turn':cue({keys:[[0,.22,69,.72],[.29,.25,73,.68],[.64,.25,76,.83]],
    bass:[[.24,.62,45,.72]],bell:[[.32,.27,85,.48],[.73,.19,88,.51]]}),
  'cliff-full':cue({keys:[...cluster(0,.51,[52,55,59,62],.73),...cluster(.57,.58,[55,57,61,64],.77),
      ...cluster(1.24,.62,[50,57,62,66],.88)],
    bass:[[0,.51,40,.73],[.57,.61,45,.83],[1.24,.64,38,.89]],
    bell:[[.14,.30,79,.46],[.70,.28,85,.51],[1.30,.62,90,.57]]})
};
const labels={ferry:'Night ferry',harbor:'Lantern harbor',cliff:'Cliff light'};
const segments=Object.fromEntries(Object.keys(labels).map(name=>[name,{source:name,end:{beat:4}}]));
for (const branch of ['harbor','cliff']) {
  for (const [variant,length] of [['pickup',.5],['turn',1],['full',2]]) {
    const name=branch+'-'+variant;
    segments[name]={source:name,end:{beat:length},loop:false};
  }
}
const timeline={entry:'ferry',segments,phrasing:{
  routes:{ferry:[{id:'return-phrase',source:'ferry-return',when:{heard:[{phrase:'ferry'}]}}]}
},transitions:['harbor','cliff'].map(to=>({
  from:'ferry',to,exit:{beat:3.5},entry:{beat:0},tail:.07,
  cadences:[
    {id:'pickup',segment:to+'-pickup'},
    {id:'turn',segment:to+'-turn',when:{phrase:'return-phrase',phase:[.45,.7],minDwell:seconds(4)}},
    {id:'full',segment:to+'-full',when:{phrase:'return-phrase',phase:[.08,.42],minDwell:seconds(4)}}
  ]
}))};
const options={sampleRate:rate,foreground:['keys'],reservedVoices:3,maxVoices:24,masterGain:-5};
const event=(from,to,time)=>({observedAt:time,intent:{kind:'music-transition',time,from,to}});
const samples={
  pickup:{label:'Early departure',route:{end:3.1,events:[event('ferry','harbor',seconds(.65))]}},
  full:{label:'Long dwell',route:{end:5.17,events:[event('ferry','cliff',seconds(4.5))]}},
  turn:{label:'Mid-phrase',route:{end:5.17,events:[event('ferry','harbor',seconds(6.12))]}},
  late:{label:'Late notice',route:{end:5.17,events:[event('ferry','cliff',seconds(7.26))]}}
};
const excursion={end:13.2,events:[
  event('ferry','harbor',seconds(.65)),event('harbor','ferry',3),
  event('ferry','cliff',3+seconds(4.5)),event('cliff','ferry',8.05),
  event('ferry','harbor',8.05+seconds(6.12))
]};
module.exports={sources,timeline,options,labels,tempo,samples,excursion};
