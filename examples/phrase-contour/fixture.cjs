/* Two original melodies and a sample-addressed pass through Ink's MIDI capture path. */
const recording=require('../../cli/music-session-recording.js');
const timeline={tempo:108,swing:.54,changes:[{beat:4,tempo:120,swing:.5}]};
const notes=[
  {id:'air',beat:.17,duration:.42,midi:67,velocity:.62},
  {id:'step',beat:.71,duration:.37,midi:69,velocity:.64},
  {id:'lift',beat:1.27,duration:.63,midi:72,velocity:.68},
  {id:'settle',beat:2.10,duration:.56,midi:71,velocity:.64},
  {id:'rest',beat:2.94,duration:.83,midi:67,velocity:.61}
];
const melody=[
  {id:'near',beat:.16,duration:.29,midi:62,velocity:.62,play:{articulation:'tongue'}},
  {id:'step',beat:.45,duration:.28,midi:65,velocity:.59,play:{articulation:'air'}},
  {id:'lift',beat:.83,duration:.22,midi:67,velocity:.64,play:{articulation:'tongue'}},
  {id:'apex',beat:1.17,duration:.34,midi:74,velocity:.63,play:{articulation:'air'}},
  {id:'answer',beat:1.74,duration:.27,midi:72,velocity:.68,play:{articulation:'tongue'}},
  {id:'turn',beat:2.22,duration:.33,midi:69,velocity:.63,play:{articulation:'air'}},
  {id:'held',beat:2.76,duration:.43,midi:65,velocity:.61,play:{articulation:'tongue'}},
  {id:'tie',beat:3.19,duration:.58,midi:65,velocity:.61,tie:true}
];
const gesture=[
  {delay:.026,velocity:.46,breath:[[0,.13],[.27,.37],[.65,.64],[1,.35]]},
  {delay:-.043,velocity:.42,breath:[[0,.21],[.43,.46],[.84,.50],[1,.27]]},
  {delay:.011,velocity:.91,breath:[[0,.46],[.23,.83],[.51,.98],[.84,.91],[1,.62]]},
  {delay:.021,velocity:.80,breath:[[0,.53],[.29,.78],[.76,.72],[1,.38]]},
  {delay:-.037,velocity:.38,breath:[[0,.32],[.26,.43],[.63,.25],[1,.10]]}
];
function reed({width,cutoff,breath}) {
  return {type:'graph',tail:.22,output:'out',controls:{breath},
    nodes:{
      pipe:{type:'oscillator',wave:'pulse',width},
      round:{type:'oscillator',wave:'sine'},
      sum:{type:'mix',inputs:['pipe','round']},
      color:{type:'filter',input:'sum',cutoff:{base:cutoff,by:{breath:1750}},resonance:1.12},
      gate:{type:'envelope',env:{attack:.022,decay:.17,sustain:.92,release:.18}},
      swell:{type:'gain',input:'color',amount:{base:.14,by:{breath:.20}}},
      out:{type:'gain',input:'swell',amount:{base:0,from:{gate:1}}}
    },articulations:{
      tongue:{nodes:{gate:{env:{attack:.008,decay:.105,sustain:.76,release:.095}}}},
      air:{nodes:{gate:{env:{attack:.039,decay:.14,sustain:.89,release:.15}}}}
    }};
}
function track(patch,clip,beat,notes, gain=-4) {
  return {patch,gain,pan:patch==='reed' ? -.12 : .10,send:.14,
    clips:[{id:clip,beat,length:4,voices:[{id:'line',notes}]}]};
}
function make(P,sampleRate=24000) {
  const base={format:'ink-studio/music-edit-session',version:1,id:'paper-wind',sampleRate,
    pins:{answer:'pitch'},production:{seed:91,arrangement:{
      score:{tempoMap:timeline,key:{root:'C4'},harmonies:{base:{root:'C4',quality:'unison'}},endFade:0},
      sections:[{id:'call',bars:1,harmony:'base'},{id:'answer',bars:1,harmony:'base'}],motifs:{},
      parts:{call:{role:'lead'},answer:{role:'lead'}}
    },patches:{reed:reed({width:.31,cutoff:540,breath:.36}),pipe:reed({width:.43,cutoff:600,breath:.33})},
    tracks:{call:track('reed','call',0,notes),answer:track('pipe','answer',4,melody)},room:{gain:-14,size:1.05,decay:.66}},
    mixer:{output:'master',strips:{master:{}},taps:{answer:{strip:'answer'}}}};
  const clock=P.musicTiming.compile(timeline), frame=beat=>Math.round(clock.timeAt({beat})*sampleRate), to=frame(4);
  const capture=recording.capture(P,base,{sampleRate,loop:{from:0,to}},{id:'81a52ff1ba11493fbc039eb2',lane:'call',pass:0,
    from:0,to,notes:notes.map((note,i)=>{
      const shape=gesture[i],delay=Math.round(shape.delay*sampleRate),start=frame(note.beat)+delay,
        end=frame(note.beat+note.duration)+delay;
      return {start,end,midi:note.midi,velocity:shape.velocity,curves:{breath:shape.breath.map(([phase,value])=>
        [Math.round(phase*(end-start)),value])}};
    })},Buffer.alloc(0),base.pins);
  const editor=P.mediaGraph.musicSession.create(), captured=editor.edit(base,capture.changes);
  const borrow={op:'borrow-phrase',lane:'answer',take:'borrowed',phrase:'answer-contour',from:4,to:8,
    source:{lane:'call',take:capture.take,from:0,to:4}};
  return {base,captured,borrow,editor,clock,donorTake:capture.take};
}
module.exports={make};
