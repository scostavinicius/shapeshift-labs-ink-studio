const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {execFileSync}=require('node:child_process');
const ink=require('..'), K=ink.load().KIT, A=K.music.production;
const motif=(rows)=>({length:4,events:rows.map(([beat,duration,midi],i)=>({id:'n-'+i,beat,duration,midi,velocity:.72}))});
const source={arrangement:{
  score:{key:{root:'D4',mode:'minor'},tempoMap:{tempo:120,swing:.54},harmonies:{
    d:{root:'D3',quality:'minor',notes:[62,38,65,69]},g:{root:'G3',quality:'minor',notes:[67,43,70,74]}},
  changes:[{id:'turn',time:{beat:8},harmony:'g'}]},
  motifs:{
    hook:motif([[.2,.34,69],[1.1,.42,72],[2.8,.45,74]]),bass:motif([[0,.58,38],[1.5,.41,38],[2.5,.32,41]]),
    pad:motif([[0,3.7,65]]),pulse:motif([[.2,.18,36],[1.1,.18,36],[2.8,.19,36]])
  },
  parts:{lead:{role:'lead',material:'hook'},bass:{role:'bass',material:'bass'},inner:{role:'pad',material:'pad'},
    drums:{role:'percussion',material:'pulse'}},
  sections:[{id:'call',bars:1,harmony:'d'},{id:'return',bars:2,harmony:'d'}]
},patches:{tone:{type:'subtractive',articulations:{muted:{filter:{cutoff:2100}}}},bass:{type:'analog'},
  inner:{type:'fm'},drums:{type:'drum',kind:'rim'}},
tracks:{lead:{patch:'tone',gain:-13},bass:{patch:'bass',gain:-12},inner:{patch:'inner',gain:-20},drums:{patch:'drums',gain:-17}}};
const brief={section:'return',seed:103,constraints:{scale:{root:'D4',mode:'minor'},chord:'strict',
  ranges:{bass:[26,51],inner:[54,70]}},preferences:{gesture:'short',articulation:'muted'}};
const native=(shortlist,name)=>shortlist.winners.find(row=>row.id===name);
const musical=(production,part)=>A.compile(production).events[part];
const at=(row,lo,hi)=>row.beat>=lo && row.beat<hi;
const shape=rows=>rows.map(row=>[row.beat,row.midi]);

test('search independently realizes one distinct winner per kind and makes actual musical edits',()=>{
  const result=A.searchComposition(source,brief);
  assert.deepEqual(A.searchComposition(source,brief),result);
  assert.deepEqual(result.winners.map(row=>row.id),
    ['exposed','handoff','bass-move','pedal','suspension','drum-answer','note-gesture']);
  for (const row of result.report.families) assert.equal(row.candidates.filter(x=>x.status==='selected').length,1);
  assert.deepEqual(new Set(result.winners.map(row=>row.level)),new Set(['cue','phrase','note']));
  const played=name=>A.compile(A.revise(source,native(result,name).revision)).events;
  const base=A.compile(source).events;
  for (const name of ['bass-move','pedal','suspension','drum-answer','exposed'])
    assert.deepEqual(played(name).lead,base.lead);
  assert.deepEqual(played('bass-move').drums,base.drums);
  assert(new Set(native(result,'bass-move').details.pitches).size>1);
  const pedal=played('pedal').bass.find(row=>at(row,4,12));
  assert.equal(pedal.beat,4);
  assert(pedal.time+pedal.gate>4.5);
  const suspend=native(result,'suspension');
  assert.equal(suspend.evidence.heldAcrossBeat,8);
  assert(Math.abs(suspend.details.hold-suspend.details.resolve)<=2);
  const handed=native(result,'handoff'), {from,to,beats}=handed.details, real=played('handoff');
  assert.deepEqual(real.drums.filter(row=>at(row,from,to)).map(row=>row.beat),beats);
  assert(!real.lead.some(row=>at(row,from,to)));
  const shaped=played('note-gesture').lead;
  assert.deepEqual(shape(shaped),shape(base.lead));
  assert(shaped.some(row=>row.play.articulation==='muted'));
  assert(shaped.some((row,i)=>row.gate<base.lead[i].gate));
});

test('composition constraints reject unsuitable attacks and preserve pinned tracks',()=>{
  const result=A.searchComposition(source,{...brief,kinds:['exposed','handoff','bass-move','note-gesture','late-pulse'],
    constraints:{scale:{root:'C#4',mode:[0]},chord:'strict',pins:{lead:'pitch',drums:'all'}}});
  assert.deepEqual(result.winners.map(row=>row.id),['exposed','note-gesture']);
  assert.match(result.report.families.find(row=>row.kind==='bass-move').blocked,/scale/);
  assert.match(result.report.families.find(row=>row.kind==='handoff').blocked,/unlocked/);
  assert.match(result.report.families.find(row=>row.kind==='late-pulse').blocked,/unlocked/);
  const onset=musical(source,'lead');
  for (const row of result.winners) {
    const revised=A.revise(source,row.revision);
    assert.deepEqual(musical(revised,'drums'),musical(source,'drums'));
    assert.deepEqual(shape(musical(revised,'lead')),shape(onset));
  }
  const restrictive=A.searchComposition(source,{...brief,kinds:['bass-move'],constraints:{dissonance:[.99,1]}});
  assert.equal(restrictive.winners.length,0);
  assert(restrictive.report.families[0].candidates.every(row=>row.reason?.includes('roughness')));
  const delayed=native(A.searchComposition(source,{...brief,kinds:['late-pulse']}),'late-pulse');
  const shifted=A.revise(source,delayed.revision);
  assert.deepEqual(musical(shifted,'lead'),onset);
  assert.equal(musical(shifted,'drums')[0].beat,delayed.evidence.pulseReturnsAt);
  assert(delayed.evidence.pulseReturnsAt>=delayed.details.to);
});

test('the CLI audits search results as producer takes and keeps independent revisions',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-search-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=name=>path.join(folder,name);
  const doc=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>execFileSync(process.execPath,[cli,'music','production',...args],{cwd:folder,encoding:'utf8'});
  doc('source.json',{production:source});
  doc('brief.json',{...brief,kinds:['exposed','bass-move','note-gesture']});
  run('search','source.json','brief.json','--out','search.json');
  doc('listen.json',{session:'search.json',options:{start:{beat:3},end:{beat:9},sampleRate:8000}});
  run('review-audition','source.json','listen.json','--out','review');
  const report=read('review/manifest.json');
  assert.deepEqual(report.takes.map(row=>row.id),['reference','exposed','bass-move','note-gesture']);
  assert.equal(new Set(report.takes.map(row=>row.lufs)).size,1);
  doc('keep.json',{session:'search.json',reason:'Leave the tune intact and let the bass turn.',
    keep:[{take:'bass-move',component:'move'},{take:'note-gesture',component:'move'}]});
  run('keep-audition','source.json','keep.json','--out','kept');
  const {production}=read('kept/production.json');
  assert(production.tracks.bass.clips.length);
  assert.deepEqual(shape(musical(production,'lead')),shape(musical(source,'lead')));
  assert.notDeepEqual(musical(production,'lead'),musical(source,'lead'));
  assert.equal(read('kept/reference.json').selected.length,2);
});
