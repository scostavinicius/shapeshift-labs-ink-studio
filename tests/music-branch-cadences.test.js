const {test}=require('node:test'),assert=require('node:assert/strict');
const {KIT}=require('..').load(),live=KIT.music.production.live,production=KIT.music.production;
const rate=8000,frame=seconds=>Math.round(seconds*rate);
function cue(notes,tempoMap={tempo:120}) {
  return {seed:21,arrangement:{score:{key:{root:'C4'},tempoMap,
    harmonies:{home:{root:'C4',quality:'unison'}}},motifs:{},parts:{tone:{role:'lead'}},
    sections:[{id:'phrase',bars:2,harmony:'home'}]},patches:{tone:{type:'fm',ratio:2,index:.5,
      env:{attack:.003,decay:.055,sustain:.55,release:.05}}},
    tracks:{tone:{patch:'tone',gain:-8,clips:[{id:'voice',beat:0,length:8,voices:[{id:'line',
      notes:notes.map(([beat,duration,midi],i)=>({id:'note-'+i,beat,duration,midi,velocity:.8}))}]}]}},
    room:{gain:-60}};
}
const sources={
  quay:cue([[.1,.3,60],[1.1,.3,63]]),mature:cue([[.1,.3,65],[1.1,.3,67]]),
  harbor:cue([[0,1.3,72]]),pickup:cue([[.25,.17,79],[.5,.16,83]]),
  shortened:cue([[0,.2,74],[.32,.2,77],[.62,.13,83]]),
  resolved:cue([[0,.2,67],[.40,.24,71],[.84,.22,74],[1.17,.2,84]])
};
const segments={quay:{source:'quay',end:2},harbor:{source:'harbor',end:2},
  pickup:{source:'pickup',start:.125,end:.375},shortened:{source:'shortened',end:.4},resolved:{source:'resolved',end:.7}};
const cadences=[
  {id:'pickup',segment:'pickup'},
  {id:'turn',segment:'shortened',when:{minDwell:2,phase:[.5,.7],phrase:'mature'}},
  {id:'full',segment:'resolved',when:{minDwell:2,phase:[.20,.48],phrase:'mature'}}
];
const edge={from:'quay',to:'harbor',exit:{beat:3},cadences};
const timeline={entry:'quay',segments,transitions:[edge],phrasing:{routes:{quay:[
  {id:'mature',source:'mature',when:{heard:[{phrase:'quay'}]}}
]}}};
const opts={sampleRate:rate};
const event=(time,observedAt=time,from='quay',to='harbor')=>
  ({intent:{kind:'music-transition',time,from,to},observedAt});
const replay=(time,observedAt=time,config=timeline,blockFrames)=>live.replay(sources,config,
  {events:[event(time,observedAt)],end:4.4,blockFrames},opts);
const without={...timeline,transitions:[{from:'quay',to:'harbor',exit:{beat:3}}]};
const selection=result=>result.report.joins[0].carry.cadence;

test('cadence selection uses branch, phrase, dwell and available samples without shifting the landing',async()=>{
  for (const row of [
    {time:.38,id:'pickup',first:1.25,join:1.5,phase:.19,phrase:'quay'},
    {time:2.45,id:'full',first:2.8,join:3.5,phase:.225,phrase:'mature'},
    {time:3.02,id:'turn',first:3.1,join:3.5,phase:.51,phrase:'mature'},
    {time:2.19,id:'pickup',first:3.25,join:3.5,phase:.095,phrase:'mature'},
    {time:3.25,id:'pickup',first:3.25,join:3.5,phase:.625,phrase:'mature'}
  ]) {
    const result=await replay(row.time), joined=result.report.joins[0], picked=selection(result);
    assert.equal(joined.frame,frame(row.join));
    assert.equal(picked.id,row.id);
    assert.equal(picked.phrase,row.phrase);
    assert(Math.abs(picked.phase-row.phase)<1e-9);
    assert.equal(picked.dwellFrames,frame(row.time));
    assert.equal(picked.availableFrames,frame(row.join)-frame(row.time));
    assert.equal(picked.startFrame,frame(row.first));
    assert.equal(picked.status,'started');
    assert.equal(result.report.trace.find(x=>x.kind==='transition-planned').cadence.status,'scheduled');
    assert.equal(result.report.trace.find(x=>x.kind==='cadence-start').frame,frame(row.first));
  }
  const early=selection(await replay(.38));
  assert.deepEqual(early.candidates.find(row=>row.id==='full').reasons,['phrase','phase','dwell']);
  const mutedByPhase=selection(await replay(2.19));
  assert.deepEqual(mutedByPhase.candidates.find(row=>row.id==='full').reasons,['phase']);
  const onlyPickup=selection(await replay(2.45,3.24));
  assert.equal(onlyPickup.id,'pickup');
  assert.deepEqual(onlyPickup.candidates.find(row=>row.id==='turn').reasons,['time']);
  assert.equal(onlyPickup.availableFrames,frame(.26));
  const different={...timeline,transitions:[{...edge,cadences:[{id:'other',segment:'pickup'}]}]};
  assert.equal(selection(await replay(.38,.38,different)).id,'other');
});

test('inspect and replay render only a complete cadence, with deterministic audio across block sizes',async()=>{
  const score=live.open(sources,timeline,opts);
  score.dispatch(event(.38).intent,{observedAt:.38});
  score.pull(frame(.5));
  assert.equal(score.inspect().pending.cadence.id,'pickup');
  assert.equal(score.inspect().pending.cadence.status,'scheduled');
  const result=await replay(.38), baseline=await replay(.38,.38,without);
  const first=frame(1.25)*2,land=frame(1.5)*2;
  assert.deepEqual(result.value.samples.slice(0,first),baseline.value.samples.slice(0,first));
  assert(result.value.samples.slice(first,land).some((sample,i)=>Math.abs(sample-baseline.value.samples[first+i])>.01));
  const jitter=await replay(.38,.38,timeline,137);
  assert.deepEqual(jitter.value.samples,result.value.samples);
  const missed=await replay(1.49);
  assert.equal(selection(missed).status,'no-fit');
  assert.equal(selection(missed).id,null);
  assert.equal(selection(missed).startFrame,null);
  assert.equal(missed.report.joins[0].frame,frame(1.5));
  assert.deepEqual(missed.value.samples,(await replay(1.49,1.49,without)).value.samples);
});

test('reversals cancel queued cadences and release an already started cadence using the accessory path',async()=>{
  const reverse=time=>live.replay(sources,timeline,{end:2,events:[event(.38),event(time,time,'harbor','quay')]},opts);
  const clean=await live.replay(sources,timeline,{end:2,events:[]},opts);
  const queued=await reverse(1.2);
  assert.equal(queued.report.joins.length,0);
  assert.equal(queued.report.trace.find(row=>row.kind==='transition-cancelled').cadence.status,'scheduled');
  assert.deepEqual(queued.value.samples,clean.value.samples);
  const started=await reverse(1.31);
  assert.equal(started.report.joins.length,0);
  assert.equal(started.report.trace.find(row=>row.kind==='transition-cancelled').cadence.status,'started');
  assert(started.value.samples.slice(frame(1.25)*2,frame(1.31)*2).some((x,i)=>
    Math.abs(x-clean.value.samples[frame(1.25)*2+i])>.01));
  const atExit=await reverse(1.5);
  assert.equal(atExit.report.joins.length,0);
  assert.equal(atExit.report.profile.cancellations,1);
});

test('phase follows musical beats across tempo changes and selection rejects invalid authorship',async()=>{
  const tempoMap={tempo:120,changes:[{beat:1,tempo:60}]};
  const source={...sources,quay:cue([[.1,.3,60]],tempoMap)};
  const spec={entry:'quay',segments:{...segments,quay:{source:'quay',end:{beat:4}}},
    transitions:[{...edge,exit:{beat:4},cadences:[{id:'musical',segment:'resolved',when:{phase:[.45,.58]}},cadences[0]]}]};
  const result=await live.replay(source,spec,{end:4.6,events:[event(1.5)]},opts);
  assert.equal(selection(result).beat,2);
  assert.equal(selection(result).phase,.5);
  assert.equal(selection(result).id,'musical');
  assert.equal(result.report.joins[0].frame,frame(3.5));
  for (const [change,message] of [
    [{exit:undefined},/exit marker/],
    [{bridge:'pickup'},/other bridge/],
    [{harmonicBridge:{}},/other bridge/],
    [{cadences:[cadences[0],cadences[0]]},/unique IDs/],
    [{cadences:[{id:'ghost',segment:'missing'}]},/known segments/],
    [{cadences:[{...cadences[0],when:{phase:[.6,.2]}}]},/phase or dwell/],
    [{cadences:[{...cadences[0],when:{phrase:'harbor'}}]},/phase or dwell/]
  ]) assert.throws(()=>live.open(sources,{...timeline,transitions:[{...edge,...change}]},opts),message);
  assert.throws(()=>production.renderTimeline(sources,{...timeline,end:4.4},[]),/music live replay/);
});
