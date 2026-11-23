const test=require('node:test'),assert=require('node:assert/strict');
const {KIT}=require('..').load(), A=KIT.music.production, rate=8000;
const performance={type:'subtractive',saw:.25,pulse:.42,sub:.22,filter:{cutoff:2150},
  env:{attack:.06,decay:.16,sustain:.52,release:.37},
  echo:{delay:.19,feedback:.43,send:.21}};
const make=(notes,extras={})=>({seed:475,arrangement:{score:{key:{root:'D3'},tempoMap:{tempo:120},endFade:0,
  harmonies:{home:{root:'D3',quality:'unison'}}},motifs:{},parts:{reed:{role:'lead'}},
  sections:[{id:'phrase',bars:2,harmony:'home'}]},patches:{reed:performance},
  tracks:{reed:{patch:'reed',gain:-8,send:.65,clips:[{id:'source',beat:0,length:8,
    voices:[{id:'top',notes:notes.map(([beat,duration,midi],i)=>({id:'note-'+i,beat,duration,midi,velocity:.71}))}]}]}},
  room:{gain:0,size:1.21,decay:1.26,damping:.42},...extras});
const perform={tracks:['reed']};
const edge=(from,to,time,rule,layers)=>({kind:'music-transition',from,to,time,rule,layers});
const options={sampleRate:rate,stems:true};
const sources={outbound:make([[1,4.5,57]]),idle:make([]),answer:make([[0,.6,62],[1,1.7,64]])};
const scope={entry:'shore',end:4,segments:{shore:{source:'outbound',end:2,loop:false},
  gate:{source:'idle',loop:false}},transitions:[{from:'shore',to:'gate',fadeIn:.2,tail:.2}]};
const slice=(pcm,from,to)=>pcm.samples.slice(from*rate*2,to*rate*2);
const present=values=>values.some(value=>Math.abs(value)>.0001);

test('a scene change preserves held voices, echo and the room from the same continuous render',()=>{
  const turns=[edge('shore','gate',1.25,'step')];
  const continuous=A.renderTimeline(sources,{...scope,performers:perform},turns,{},options);
  const neutral=A.render(sources.outbound,{},options);
  assert.deepEqual(continuous.stems.reed.samples,neutral.stems.reed.samples);
  assert.deepEqual(continuous.stems.room.samples,neutral.stems.room.samples);
  assert.deepEqual(continuous.report.performers.joins[0].held.reed,{voices:1,pitches:[57]});
  assert.equal(continuous.report.performers.lanes.reed.notes,1);
  assert(present(slice(continuous.stems.room,2.75,3.25)));
  const old=A.renderTimeline(sources,scope,turns,{},options);
  assert(!present(slice(old.stems.reed,1.5,2.5)));
  assert(present(slice(continuous.stems.reed,1.5,2.5)));
  const window=A.renderTimeline(sources,{...scope,performers:perform},turns,{}, {...options,start:1.5,end:2.25});
  assert.deepEqual(window.value.samples,slice(continuous.value,1.5,2.25));
  assert.deepEqual(window.stems.room.samples,slice(continuous.stems.room,1.5,2.25));
});

test('held voices survive omitted or muted new material and honor real hard cuts',()=>{
  const turns=[edge('shore','gate',1.25,'step',{reed:0})];
  const scopeWithNotes={...scope,performers:perform,segments:{...scope.segments,gate:{source:'answer',loop:false}}};
  const muted=A.renderTimeline(sources,scopeWithNotes,turns,{},options);
  assert.equal(muted.report.performers.lanes.reed.notes,1);
  assert(present(slice(muted.stems.reed,1.5,2.5)));
  const noTrack=make([]);
  noTrack.tracks={rest:{...noTrack.tracks.reed}};
  noTrack.arrangement.parts={rest:{role:'lead'}};
  const missing=A.renderTimeline({...sources,answer:noTrack},scopeWithNotes,turns,{},options);
  assert.deepEqual(missing.stems.reed.samples,muted.stems.reed.samples);
  const cut=make([], {cueMap:{silence:[{from:0,to:1,mode:'cut'}]}});
  const cleared=A.renderTimeline({...sources,answer:cut},scopeWithNotes,turns,{},options);
  assert.equal(cleared.report.performers.joins[0].held.reed.voices,0);
  assert(!present(slice(cleared.stems.reed,1.25,2.5)));
  assert(!present(slice(cleared.stems.room,1.25,2.5)));
  const changed=make([[0,.5,62]]);
  changed.patches={reed:{...performance,type:'keys'}};
  delete changed.patches.reed.saw;
  delete changed.patches.reed.pulse;
  delete changed.patches.reed.sub;
  delete changed.patches.reed.filter;
  assert.throws(()=>A.renderTimeline({...sources,answer:changed},scopeWithNotes,turns,{},options),
    /same patch and desk defaults/);
});

const routine=make([[.2,.5,62]]);
const routeSources={shore:routine,tunnel:routine,walk:routine,gate:make([[.3,.52,64]]),
  familiar:make([[.4,.56,69]]),first:make([[.2,.8,72]]),development:make([[.46,.8,74]])};
const routeSegments=Object.fromEntries(['shore','tunnel','walk','gate'].map(source=>[source,{source,end:1}]));
const routeTimeline={entry:'shore',end:5,segments:routeSegments,phrasing:{listen:{tunnel:['reed'],gate:['reed']},routes:{gate:[
  {id:'developed',source:'development',when:{heard:[{phrase:'greeting'}]}},
  {id:'recognition',source:'familiar',when:{via:['shore','tunnel'],rule:'door',heard:[{phrase:'tunnel'}]}},
  {id:'greeting',source:'first',when:{heard:[{phrase:'greeting',max:0}]}}
]}}};
const select=(via,time,layers,rule='door')=>A.renderTimeline(routeSources,routeTimeline,[
  edge('shore',via,1,'walked',layers),edge(via,'gate',time,rule)
],{},options);

test('the route and completed audible phrases choose a new phrase on entry or at a loop boundary',()=>{
  const long=select('tunnel',2);
  assert.deepEqual(long.report.phrasing.decisions.map(row=>row.phrase),['recognition','recognition','recognition']);
  assert.deepEqual(long.report.phrasing.decisions[0].via,['shore','tunnel']);
  assert.equal(long.report.phrasing.decisions[0].heard.tunnel,1);
  const short=select('tunnel',1.75);
  assert.deepEqual(short.report.phrasing.decisions.map(row=>row.phrase),
    ['greeting','developed','developed','developed']);
  assert.equal(short.report.phrasing.heard.developed,2);
  assert.equal(short.report.phrasing.heard.greeting,1);
  assert.equal(short.report.phrasing.decisions[1].reason,'repeat');
  assert.equal(short.report.phrasing.decisions[1].heard.greeting,1);
  assert.equal(select('tunnel',2,{reed:0}).report.phrasing.decisions[0].phrase,'greeting');
  assert.equal(select('walk',2).report.phrasing.decisions[0].phrase,'greeting');
  const rule=select('tunnel',2,{},'other-door');
  assert.equal(rule.report.phrasing.decisions[0].phrase,'greeting');
  assert.notDeepEqual(long.value.samples,rule.value.samples);
});

test('the CLAP worker gets one persistent instrument job with note-offs at the original gates',()=>{
  const swap=source=>({...source,patches:{reed:{type:'clap',plugin:'glass'}}});
  const jobs=[];
  const host={adapters:{clap:{
    describe:()=>({latency:0,tail:150,sidechain:false,parameters:{},identity:'glass',notes:'clap'}),
    render:job=>{jobs.push(job);return new Float64Array(job.frames*2);}
  }}};
  const result=A.renderTimeline({outbound:swap(sources.outbound),idle:swap(sources.idle)},
    {...scope,performers:perform},[edge('shore','gate',1.25,'step')],{},options,host);
  assert.equal(jobs.length,1);
  assert.deepEqual(jobs[0].notes.map(({sample,type,id})=>[sample,type,id]),[[4000,-3,0],[22000,-2,0]]);
  assert.equal(result.report.performers.lanes.reed.instrument.plugin,'glass');
});

test('adaptive rehearsal can compare the kept performer against the existing placement renderer',()=>{
  const trace={format:'ink-studio/adaptive-score-trace',version:1,id:'walk',entry:'shore',end:4,
    intents:[edge('shore','gate',1.25,'step')]};
  const {report}=A.rehearsal.run(sources,{...scope,performers:perform},[trace],
    [{id:'clips',performers:null}],{}, {sampleRate:rate});
  const join=report.traces[0].cases.find(row=>row.kind==='transition');
  assert.equal(join.held.reed.voices,1);
  assert(report.traces[0].performers.lanes.reed.notes>0);
});

test('world soundtrack exports replay persistent audio through arbitrary sample trims',()=>{
  const {createSceneAudio}=require('../cli/scene-audio.js'), WAV=require('../cli/wav.js');
  const world={format:'ink-studio/world',id:'persistent-room',dt:.05,
    systems:{score:{kind:'adaptive-music',config:{entry:'shore',sections:{shore:{resource:'shore'},gate:{resource:'gate'}},
      parameters:{open:{default:0}},transitions:[{id:'approach',from:'shore',to:'gate',quantize:'beat',
        when:{path:'/parameters/open',op:'gte',value:.5}}]}}},
    commands:[{tick:16,action:'world/input',args:{port:'score/parameter.open',value:1}}]};
  const kit=require('..').load(), T=KIT.procedural.takeTime;
  const sampleRate=44100;
  const audio=createSceneAudio({format:'ink-studio/scene-audio',version:1,sampleRate,
    music:{system:'score',production:{sources,timeline:{...scope,performers:perform}}}},
    {kit,resolveAsset:()=>undefined,runtime:()=>KIT.world.runtime.create(world)});
  const full=WAV.decode(audio.render({startPoint:T.read(0),endPoint:T.read(4)}).waves.music);
  const first=80002, stop=110297;
  const trimmed=audio.render({startPoint:T.read({numerator:first,denominator:sampleRate}),
    endPoint:T.read({numerator:stop,denominator:sampleRate})});
  const window=WAV.decode(trimmed.waves.music).samples;
  assert(present(window));
  assert.deepEqual(window,full.samples.slice(first*2,stop*2));
});
