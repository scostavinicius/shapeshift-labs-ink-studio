const test=require('node:test'), assert=require('node:assert/strict');
const {KIT}=require('..').load(), live=KIT.music.production.live, rate=8000;
const commonPatch={type:'analog',body:0,env:{attack:.008,decay:.09,sustain:.75,release:.18}};
function source(root,quality,tracks,patch=commonPatch) {
  return {seed:381,arrangement:{score:{key:{root:'C4'},tempoMap:{tempo:120},
    harmonies:{opening:{root,quality}}},motifs:{},
    parts:{bow:{role:'pad'},pluck:{role:'lead'},inner:{role:'pad'},bass:{role:'bass'}},
    sections:[{id:'phrase',bars:2,harmony:'opening'}]},patches:{tone:patch},
    tracks:Object.fromEntries(Object.entries(tracks).map(([part,notes])=>[part,{patch:'tone',gain:-16,pan:part==='bow'?-1:1,
      clips:[{id:'notes',beat:0,length:8,voices:notes.map(([beat,duration,midi],i)=>({id:'voice-'+i,
        notes:[{id:'hit-'+i,beat,duration,midi,velocity:.75}]}))}]}])),room:{gain:-60}};
}
const sources={
  quay:source('C4','major',{bow:[[0,2.12,60]],pluck:[[.05,3.1,67],[1,2,64]]}),
  harbor:source('Db4','major7',{bow:[[0,2.7,60]],pluck:[[0,2.4,65],[0,1.34,68]]}),
  north:source('G3','major',{bow:[[0,2,59]],pluck:[[0,2,67]]}),
  muted:source('Db4','major7',{bow:[[0,2.7,60]],pluck:[[0,2.4,65],[0,1.34,68]]},
    {...commonPatch,body:.3})
};
const bridge={track:'pluck',lead:.32,steps:2,velocity:.6,range:[58,75]};
const segments={quay:{source:'quay',end:2}, harbor:{source:'harbor',end:2},north:{source:'north',end:2}};
const timeline={entry:'quay',segments,transitions:[{from:'quay',to:'harbor',exit:1,harmonicBridge:bridge}]};
const intent=(from,to,time,rule)=>({observedAt:time,intent:{kind:'music-transition',from,to,time,rule}});
const route={end:2.6,events:[intent('quay','harbor',.4,'go')]};
const opts={sampleRate:rate,masterGain:-3};
const render=(spec=timeline,settings=route,options=opts)=>live.replay(sources,spec,settings,options);
const window=(output,from,to,ch)=>Array.from(output.value.samples.slice(from*rate*2,to*rate*2)).filter((_,i)=>i%2===ch);
const rms=xs=>Math.sqrt(xs.reduce((sum,x)=>sum+x*x,0)/xs.length);

test('pickup is played causally and a shared sustaining voice keeps its exact waveform and extends its gate',async()=>{
  const out=await render(), [join]=out.report.joins, {pickup,held}=join.carry.harmonicBridge;
  assert.equal(join.frame,rate);
  assert.deepEqual(pickup.sounding,[60,64,67]);
  assert.equal(pickup.firstFrame,Math.round(.68*rate));
  assert.deepEqual(pickup.notes.map(note=>[note.midi,note.status]),[[68,'played'],[65,'played']]);
  assert.deepEqual(held,[{part:'bow',pitch:60,firstFrame:0,fromGateEndFrame:Math.round(1.06*rate),gateEndFrame:Math.round(2.35*rate),
    openingAttackReused:true}]);
  const reference=await live.replay({...sources,quay:source('C4','major',{bow:[[0,4.7,60]]})},
    {entry:'quay',segments:{quay:{source:'quay',end:3}}},{end:2.6,events:[]},opts);
  const a=window(out,.90,1.83,0), b=window(reference,.90,1.83,0);
  assert(Math.max(...a.map((x,i)=>Math.abs(x-b[i])))<2e-5,'the shared oscillator must retain phase and its original attack through the join');
  const opener=await render({...timeline,transitions:[{from:'quay',to:'harbor',exit:1}]});
  assert.deepEqual(window(out,0,.68,1),window(opener,0,.68,1));
  const baseline=window(opener,.72,.80,1);
  assert(rms(window(out,.72,.80,1).map((x,i)=>x-baseline[i]))>.01);
  assert.equal(out.report.profile.clippedFrames,0);
});

test('replay block size, late notices, cancellation and held-voice budgets are causal',async()=>{
  const normal=await render(), irregular=await render(timeline,{...route,blockFrames:137});
  assert.deepEqual(irregular.value.samples,normal.value.samples);
  const cancelled=await render(timeline,{end:2,events:[route.events[0],intent('harbor','quay',.82,'cancel')]});
  assert.equal(cancelled.report.joins.length,0);
  assert.deepEqual(cancelled.report.trace.find(row=>row.kind==='harmonic-pickup').pickup.notes.map(note=>note.status),
    ['played','cancelled']);
  const close=await render(timeline,{...route,events:[intent('quay','harbor',.98,'late')]});
  assert.equal(close.report.joins[0].frame,rate);
  assert.equal(close.report.joins[0].carry.harmonicBridge.pickup,null);
  const limited=await render(timeline,route,{...opts,maxVoices:3,reservedVoices:0,foreground:['bow']});
  assert.equal(limited.report.joins[0].carry.harmonicBridge.pickup.notes[0].status,'dropped');
  assert.equal(limited.report.profile.stolen,0);
  assert.equal(limited.report.profile.foregroundDropped,0);
});

test('unmarked edges allow a short pickup and use the actual selected destination phrase',async()=>{
  const actual={...timeline,segments:{...segments,harbor:{source:'north',end:2}},
    transitions:[{from:'quay',to:'harbor',harmonicBridge:bridge}],
    phrasing:{routes:{harbor:[{id:'detour',source:'harbor',when:{via:['quay'],rule:'go'}}]}}};
  const out=await render(actual);
  const join=out.report.joins[0];
  assert.equal(join.frame,Math.round(.72*rate));
  assert.equal(join.entry.source,'harbor');
  assert.equal(join.entry.phrase,'detour');
  assert.equal(join.carry.harmonicBridge.pickup.chord,'opening');
  const other={...timeline,segments:{...segments,harbor:{source:'muted',end:2}}};
  const changed=await render(other);
  assert.equal(changed.report.joins[0].carry.harmonicBridge.held[0].openingAttackReused,false);
  assert.throws(()=>live.open(sources,{...timeline,transitions:[{...timeline.transitions[0],harmonicBridge:{track:'unknown'}}]},opts),
    /pitched track/);
});
