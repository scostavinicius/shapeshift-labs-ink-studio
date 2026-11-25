/* Two routes carry the same motif identity with different rhythms and intervals. */
const ids=['call','rise','reach','return'];
const tempo=104;
const patches={
  reed:{type:'fm',ratio:2.02,index:1.55,indexDecay:.16,body:.13,width:11,color:.54,
    env:{attack:.014,decay:.14,sustain:.52,release:.16}},
  glass:{type:'keys',tine:.72,bite:.67,wear:.15,dust:.02,color:.62,
    env:{attack:.006,decay:.18,sustain:.29,release:.23}},
  cello:{type:'subtractive',saw:.38,pulse:.39,sub:.18,pulseWidth:.48,
    filter:{cutoff:1100,resonance:.64,keyTrack:.47,envAmount:9},
    env:{attack:.027,decay:.16,sustain:.63,release:.23}},
  bed:{type:'analog',body:.16,width:19,color:.34,env:{attack:.085,decay:.16,sustain:.62,release:.32}}
};
const desk={reed:{gain:-8,pan:-.16,send:.27},glass:{gain:-8,pan:.16,send:.26},
  cello:{gain:-7,pan:.21,send:.32},bed:{gain:-19,pan:-.24,send:.28}};
const notes={
  waterline:[[.24,.32,62,.83],[.69,.29,65,.76],[1.46,.27,69,.85],[1.94,.48,67,.88]],
  clocktower:[[.24,.46,64,.84],[1.02,.16,71,.82],[1.24,.38,69,.77],[2.19,.46,62,.85]]
};
const labels={waterline:'Waterline',clocktower:'Clock tower',junction:'Junction',overlook:'Overlook'};
function cue(root,quality,parts){
  const tracks=Object.fromEntries(Object.entries(desk).map(([part,mix])=>[part,{patch:part,...mix,
    clips:[{id:part,beat:0,length:4,voices:parts[part]?.length ? parts[part].map(([beat,duration,midi,velocity],i)=>({
      id:'line-'+i,notes:[{id:'hit-'+i,beat,duration,midi,velocity}]
    })) : [{id:'tacet',notes:[]}]}]}]));
  return {seed:441,arrangement:{score:{key:{root:'D4'},tempoMap:{tempo},harmonies:{opening:{root,quality}}},
    motifs:{},parts:{reed:{role:'lead'},glass:{role:'lead'},cello:{role:'lead'},bed:{role:'pad'}},
    sections:[{id:'phrase',bars:1,harmony:'opening'}]},patches,tracks,
    room:{gain:-12,size:1.15,decay:.85,damping:.59}};
}
const bed=pitches=>pitches.map(midi=>[0,3.9,midi,.47]);
const open=[
  [0,2.8,50,.45],[.54,1.52,57,.35],[1.34,.75,62,.32]
];
function project(A){
  const sources={
    junction:cue('D3','minor',{bed:open}),
    waterline:cue('D3','minor',{reed:notes.waterline,bed:bed([38,45,50])}),
    clocktower:cue('E3','minor',{glass:notes.clocktower,bed:bed([40,47,52])}),
    overlook:cue('G3','major',{bed:bed([43,50,55])})
  };
  const maps=Object.fromEntries([['waterline','reed'],['clocktower','glass']].map(([source,part])=>{
    const compiled=A.compile(sources[source]), rows=compiled.events[part];
    return [source,{themes:{beacon:ids},appearances:[{id:source+'-signal',theme:'beacon',section:'phrase',stage:'statement',
      tracks:[{part,count:ids.length,notes:rows.map(({beat,time,midi},i)=>({id:ids[i],event:'hit-'+i,beat,time,midi}))}]}]}];
  }));
  const timeline={entry:'junction',end:4.75,segments:Object.fromEntries(Object.keys(sources).map(name=>[
    name,{source:name,end:{beat:4},loop:false}
  ])),thematic:{maps,recalls:{overlook:{theme:'beacon',part:'cello',preserve:'both',offset:.26,length:3,
    anchor:'G3',level:.92,minNotes:3}}}};
  return {sources,timeline,labels};
}
const event=(from,to,time,extra)=>({observedAt:time,intent:{kind:'music-transition',from,to,time,...extra}});
function route(path,early=false){
  return {end:4.75,events:[event('junction',path,.42),event(path,'overlook',early?.94:2.29)]};
}
module.exports={project,route,event,ids,labels};
