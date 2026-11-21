const {test}=require('node:test');
const assert=require('node:assert/strict');
const studio=require('..'), kit=studio.load(), {KIT:K}=kit;
const WAV=require('../cli/wav.js');
const {createSceneAudio}=require('../cli/scene-audio.js');
const P=K.music.production;
const notes=['first','rise','ring','drop','reach','home'];
const pitches=[60,63,67,65,70,72];
const source={
  arrangement:{
    score:{tempoMap:{tempo:120},key:{root:'C4',mode:'minor'},endFade:0,
      harmonies:{home:{root:'C4',quality:'minor',notes:[60,63,67]},
        open:{root:'G3',quality:'major',notes:[55,59,62]}},
      changes:[{id:'new-root',time:{beat:9},harmony:'home'}]},
    motifs:{tail:{length:4,events:[{beat:3.5,duration:.2,midi:72,velocity:.5}]}},
    parts:{metal:{role:'percussion'},bass:{role:'bass'},lead:{role:'lead',material:'tail'}},
    sections:[{id:'quay',bars:1,harmony:'home'},{id:'channel',bars:1,harmony:'open'},
      {id:'lights',bars:1,harmony:'open'}]
  },
  patches:{metal:{type:'drum',kind:'metal'},bass:{type:'analog'},lead:{type:'fm'}},
  tracks:{metal:{patch:'metal',gain:-15},bass:{patch:'bass',gain:-15},lead:{patch:'lead',gain:-14,send:.2}}
};
const themes={signal:{motif:{length:2.5,events:notes.map((id,i)=>({
  id,beat:[0,.25,.75,1.25,1.75,2.25][i],duration:.16,midi:pitches[i],velocity:.76
}))},root:'C4',fragments:{cell:notes.slice(0,3)}}};
const introduction=[
  {id:'quay-hint',theme:'signal',section:'quay',beat:.25,stage:'fragment',fragment:'cell',
    targets:[{part:'metal',pitch:'rhythm'}]},
  {id:'bass-call',theme:'signal',section:'channel',beat:1,stage:'development',fragment:'cell',
    targets:[{part:'bass',pitch:'chord',stretch:2,gate:.85}]}
];
const ending=(stage,fragment)=>({id:'arrival',theme:'signal',section:'lights',beat:.75,stage,
  ...(fragment && {fragment}),targets:[{part:'lead',pitch:'chord-tone',play:{vibrato:8}}]});
const make=(stage,fragment)=>P.developThemes(source,{themes,appearances:[...introduction,ending(stage,fragment)]});
const early={kind:'music-transition',from:'search',to:'reveal',time:2,beat:4};
const late={...early,time:4,beat:8};
const samplePoint=(n,rate)=>({numerator:n,denominator:rate});
const flat=rows=>rows.map(row=>row.id);

function timeline(fallback,statement,changes={}) {
  return {entry:'search',end:5.8,segments:{search:{source:'fragment',start:{bar:0},end:{bar:2},...changes},
    reveal:{source:'fragment',start:{bar:2},loop:false}},
    thematic:{maps:{fragment:fallback.themeMap,full:statement.themeMap},
      routes:{reveal:[{source:'full',when:{theme:'signal',stage:'development'}}]}}};
}

test('the same theme is recalled in percussion, reharmonized in bass and voiced against chord changes',()=>{
  const result=make('statement'), {themeMap,report}=result;
  assert.deepEqual(themeMap.themes.signal,notes);
  const [intro,answer,statement]=themeMap.appearances.map(row=>row.tracks[0].notes);
  assert.deepEqual(flat(intro),notes.slice(0,3));
  assert.deepEqual(intro.map(note=>note.midi),[36,36,36]);
  assert.deepEqual(flat(answer),notes.slice(0,3));
  assert.deepEqual(answer.map(note=>note.beat),[5,5.5,6.5]);
  assert.deepEqual(answer.map(note=>note.midi),[43,46,50]);
  assert.deepEqual(flat(statement),notes);
  assert.equal(statement[0].midi,55);
  assert.equal(statement[2].midi,67);
  assert.deepEqual(report.sections[1].after.signal.withheld,notes.slice(3));
  assert.deepEqual(report.sections[2].after.signal,{heard:notes,withheld:[],
    counts:{fragment:1,development:1,statement:1}});
  const plan=K.music.composer.compose(result.production.arrangement);
  assert(plan.cues.some(cue=>cue.part==='lead' && cue.beat===11.5 && cue.midi===72));
  assert.equal(source.arrangement.parts.lead.material,'tail');
  const pinned=structuredClone(source);
  pinned.arrangement.pins=['part:bass'];
  assert.throws(()=>P.developThemes(pinned,{themes,appearances:introduction}),/pinned/);
});

test('an adaptive reveal consults what played, so late reveals can state the theme and muted or early ones use a fragment',()=>{
  const fragment=make('fragment','cell'), full=make('statement'), spec=timeline(fragment,full);
  const bank={fragment:fragment.production,full:full.production};
  const at={sampleRate:8000,stems:true};
  const first=P.renderTimeline(bank,spec,[early],{},at);
  const second=P.renderTimeline(bank,spec,[late],{},at);
  const mute=P.renderTimeline(bank,timeline(fragment,full,{layers:{bass:0}}),[late],{},at);
  const onlySome=P.renderTimeline(bank,spec,[{...late,time:3,beat:6}],{},at);
  const decision=result=>result.report.themes.decisions[0];
  assert.equal(decision(first).source,'fragment');
  assert.equal(decision(second).source,'full');
  assert.equal(decision(mute).source,'fragment');
  assert.equal(decision(onlySome).source,'fragment');
  assert.equal(decision(second).history.signal.counts.development,1);
  assert.equal(decision(second).history.signal.counts.statement,0);
  assert.deepEqual(second.report.themes.final.signal.heard,notes);
  assert.deepEqual(first.report.themes.final.signal.withheld,notes.slice(3));
  assert(second.report.placements.some(row=>row.segment==='reveal' && row.source==='full'));
  const trim=P.renderTimeline(bank,spec,[late],{},
    {...at,start:samplePoint(30011,8000),end:samplePoint(40007,8000)});
  assert.deepEqual(trim.value.samples,second.value.samples.slice(60022,80014));
  assert.deepEqual(trim.report.themes,second.report.themes);
});

test('multiple targets share one occurrence and stale maps are rejected',()=>{
  const fragment=make('fragment','cell');
  const plan={themes,appearances:[{...ending('statement'),targets:[
    {part:'lead',pitch:'original'},{part:'bass',pitch:'chord',offset:.14}
  ]}]};
  const chosen=P.developThemes(source,plan);
  assert.equal(chosen.report.sections[2].after.signal.counts.statement,1);
  const stale=structuredClone(chosen.production);
  stale.tracks.lead.groove={offset:.03};
  assert.throws(()=>P.renderTimeline({fragment:fragment.production,full:stale},timeline(fragment,chosen),[early],
    {},{sampleRate:8000}),/must match the source notes/);
});

test('scene soundtrack export uses the thematic route from a real adaptive score',()=>{
  const fragment=make('fragment','cell'), full=make('statement'), spec=timeline(fragment,full);
  const sources={fragment:fragment.production,full:full.production};
  const score={tempo:120,entry:'search',sections:{search:{resource:'search'},reveal:{resource:'reveal'}},
    parameters:{lights:{default:0}},transitions:[{id:'show',from:'search',to:'reveal',quantize:'bar',
      when:{path:'/parameters/lights',op:'gte',value:1}}]};
  const run=sceneTick=>{
    const world={format:'ink-studio/world',id:'theme-world',dt:.05,systems:{score:{kind:'adaptive-music',config:score}},
      commands:[{tick:sceneTick,action:'world/input',args:{port:'score/parameter.lights',value:1}}]};
    const movie=createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate:8000,
      music:{system:'score',production:{sources,timeline:spec}}},
    {kit,resolveAsset:()=>undefined,runtime:()=>K.world.runtime.create(world)});
    const T=K.procedural.takeTime, from=T.read(4.25), to=T.read(5.75);
    return WAV.decode(movie.render({startPoint:from,endPoint:to}).waves.music).samples;
  };
  for (const [tick,intent] of [[29,early],[61,late]]) {
    const authored=P.renderTimeline(sources,spec,[intent],{}, {start:4.25,end:5.75,sampleRate:8000});
    const expected=WAV.decode(WAV.encode(authored.value,{encoding:'pcm24'})).samples;
    assert.deepEqual(run(tick),expected);
  }
});
