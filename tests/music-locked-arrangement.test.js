const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const K=require('..').load().KIT,A=K.music.production,WAV=require('../cli/wav.js'),rate=8000;
const source=()=>({seed:27,arrangement:{
  score:{tempoMap:{tempo:120},key:{root:'E4',mode:'minor'},endFade:.11,
    harmonies:{home:{root:'E3',quality:'minor7'},other:{root:'C3',quality:'major7'}},
    changes:[{id:'lift',time:{beat:10},harmony:'other'},{id:'resolve',time:{beat:18},harmony:'home'}]},
  parts:{lead:{role:'lead'},bass:{role:'bass'},keys:{role:'pad'},kick:{role:'percussion',material:'k'}},
  motifs:{k:{length:2,events:[{beat:0,duration:.11,velocity:.81}]}},
  sections:[{id:'entrance',bars:1,harmony:'home'},{id:'middle',bars:3},{id:'ending',bars:2}]},
  patches:{lead:{type:'graph',output:'voice',tail:.32,nodes:{
    sine:{type:'oscillator'},shape:{type:'envelope',env:{attack:.036,release:.29}},
    sweep:{type:'filter',input:'sine',cutoff:{base:470,by:{phase:780}}},
    voice:{type:'gain',input:'sweep',amount:{base:0,from:{shape:.63}}}
  }},bass:{type:'analog',body:.38},keys:{type:'keys',bite:.63},
  kick:{type:'drum',kind:'kick'}},
  tracks:{lead:{patch:'lead',gain:-13,send:.35,
    clips:line('theme',[[.23,.67,67],[2.1,1.4,71],[4.35,.38,74],[5.92,1.06,71],[7.38,1.24,69],
      [10.43,.7,67],[12.17,.86,69],[14.18,6.36,71],[22.02,1.8,64]])},
  bass:{patch:'bass',gain:-12,send:.1,clips:line('ground',[[0,2.4,40],[4.22,1.9,40],[7.1,1.7,43],
    [11.01,2.27,36],[14.64,1.62,43],[17.37,1.2,40],[21,2.2,40]])},
  keys:{patch:'keys',pan:-.12,gain:-13.5,send:.47,clips:line('beds',[[1,1.6,59],[4.16,1.08,62],[6.51,1.1,57],
    [8.14,1.8,59],[10.08,1.6,60],[12.07,1.38,64],[15.26,1.18,60],[18.71,2.2,59],[21.2,2.3,55]])},
  kick:{patch:'kick',gain:-15.4,send:.08}},
  room:{gain:-9,size:1.3,decay:.95,damping:.48}});
function line(id,rows) {
  return [{id,beat:0,length:24,voices:[{id:'one',notes:rows.map(([beat,duration,midi],i)=>
    ({id:'v'+i,beat,duration,midi,velocity:.7}))}]}];
}
const brief=()=>({range:{from:{bar:1},to:22},locks:{tracks:{lead:'all',bass:'all'},
  regions:[{id:'ending',from:18,to:24},{id:'pickup',from:8,to:10}]},fade:.035,seed:19});

test('search generates four kinds of native music edits with the outer lines and grid bounds intact',()=>{
  const initial=source(), plan=A.searchLockedArrangement(initial,brief());
  assert.deepEqual(plan.candidates.map(row=>row.id),['reference','counterline','harmony','orchestration','silence']);
  assert.deepEqual(plan.report.windows.map(row=>[row.from,row.to]),[[4,8],[10,18]]);
  const baseline=A.inspect(initial);
  for (const found of plan.candidates.slice(1)) {
    const printed=A.inspect(found.production);
    assert.deepEqual(printed.events.lead,baseline.events.lead);
    assert.deepEqual(printed.events.bass,baseline.events.bass);
    assert(printed.events.keys.some(row=>row.beat===1));
    assert.deepEqual(printed.events.keys.filter(row=>row.beat>=18).map(({beat,midi,note})=>[beat,midi,note]),
      baseline.events.keys.filter(row=>row.beat>=18).map(({beat,midi,note})=>[beat,midi,note]));
  }
  assert(plan.candidates.find(row=>row.id==='harmony').evidence.nativeGrid);
  assert(plan.candidates.find(row=>row.id==='orchestration').evidence.part.startsWith('answer-layer'));
  assert(plan.candidates.find(row=>row.id==='silence').evidence.removed>0);
  assert.deepEqual(plan,A.searchLockedArrangement(initial,brief()));
});

test('saved arrangement blends only the selected samples and preserves both locked stems exactly',()=>{
  const initial=source(), plan=A.searchLockedArrangement(initial,brief()), options={sampleRate:rate,stems:true};
  const original=A.render(initial,{},options);
  for (const take of plan.candidates.slice(1)) {
    const edit=A.keepLockedArrangement(plan,take.id), result=A.renderLockedArrangement(edit,{},options);
    const ranges=result.report.edit.spans, originalSamples=original.value.samples, samples=result.value.samples;
    assert.equal(samples.length,originalSamples.length);
    let end=0;
    for (const {from,to} of ranges) {
      assert.deepEqual(samples.slice(end*2,from*2),originalSamples.slice(end*2,from*2),take.id);
      assert.equal(samples[from*2],originalSamples[from*2]);
      assert.equal(samples[to*2-1],originalSamples[to*2-1]);
      end=to;
    }
    assert.deepEqual(samples.slice(end*2),originalSamples.slice(end*2),take.id);
    assert.deepEqual(result.stems.lead.samples,original.stems.lead.samples,take.id);
    assert.deepEqual(result.stems.bass.samples,original.stems.bass.samples,take.id);
    assert.notDeepEqual(samples.slice(ranges[0].from*2,ranges.at(-1).to*2),
      originalSamples.slice(ranges[0].from*2,ranges.at(-1).to*2),take.id);
    assert.equal(result.report.edit.preservedSamples,6*rate);
  }
});

test('saved selections reject changed pinned notes, protected endings and dependencies',()=>{
  const initial=source(), settings=brief();
  const plan=A.searchLockedArrangement(initial,settings);
  const edit=()=>structuredClone(A.keepLockedArrangement(plan,'harmony'));
  const changed=edit();
  changed.production.tracks.lead.clips[0].voices[0].notes[3].midi=66;
  assert.throws(()=>A.renderLockedArrangement(changed,{}, {sampleRate:rate}),/locked performance on lead/);
  const ending=edit();
  ending.production.tracks.keys.clips[0].voices[0].notes.at(-1).velocity=.31;
  assert.throws(()=>A.renderLockedArrangement(ending,{}, {sampleRate:rate}),/outside its range on keys/);

  const pitchPlan=A.searchLockedArrangement(initial,{...settings,locks:{...settings.locks,tracks:{lead:'pitch'}}});
  const tuned=structuredClone(A.keepLockedArrangement(pitchPlan,'reference'));
  tuned.production.tracks.lead.clips[0].voices[0].notes[3].play={brightness:.3};
  assert.doesNotThrow(()=>A.renderLockedArrangement(tuned,{}, {sampleRate:rate}));
  tuned.production.tracks.lead.clips[0].voices[0].notes[3].midi=66;
  assert.throws(()=>A.renderLockedArrangement(tuned,{}, {sampleRate:rate}),/pinned pitches on lead/);

  const duck=source();
  duck.tracks.lead.duck={from:'kick',depth:8};
  const rejected=A.searchLockedArrangement(duck,{...settings,kinds:['silence']});
  assert(!rejected.candidates.some(row=>row.id==='silence'));
  assert(rejected.report.families[0].candidates.some(row=>/sidechain/.test(row.reason)));
});

test('CLI search, keep and print retain the same reference fence',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-locked-arrangement-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','production',...args],{cwd:root,encoding:'utf8'}));
  const save=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  save('cue.json',{production:source(),options:{sampleRate:rate,stems:false}});
  save('brief.json',{...brief(),kinds:['orchestration']});
  save('pick.json',{take:'orchestration'});
  const found=run('search-locked','cue.json','brief.json','--out','takes','--render','--sample-rate',String(rate));
  assert.deepEqual(found.takes.map(row=>row.id),['reference','orchestration']);
  run('keep-locked','takes/search.json','pick.json','--out','kept.json');
  const selected=run('render','kept.json','--out','kept-print');
  const original=run('render','cue.json','--out','unchanged-print');
  const edited=WAV.read(selected.mix), base=WAV.read(original.mix);
  assert.equal(edited.sampleRate,rate);
  assert.deepEqual(edited.samples.slice(9*rate*2),base.samples.slice(9*rate*2));
  const repeat=run('render','kept-print/production.json','--out','replay');
  assert.deepEqual(fs.readFileSync(repeat.mix),fs.readFileSync(selected.mix));
});
