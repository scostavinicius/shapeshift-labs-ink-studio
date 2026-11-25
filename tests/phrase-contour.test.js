const {test}=require('node:test'),assert=require('node:assert/strict');
const {KIT}=require('..').load(),P=KIT.procedural,A=P.musicProduction,{make}=require('../examples/phrase-contour/fixture.cjs');
const rate=8000,eps=2e-8,near=(a,b)=>assert(Math.abs(a-b)<eps,a+' vs '+b);
const played=(session,take,lane)=>A.compile(take==='reference' ? session.production :
  A.revise(session.production,session.takes[take])).events[lane];

test('borrow fits a played MIDI contour to a longer melody with different rhythm and pitches',()=>{
  const {base,captured,borrow,editor,donorTake}=make(P,rate);
  const result=editor.edit(captured,[borrow]), before=played(captured,'reference','answer'),
    after=played(result,'borrowed','answer');
  const phrase=editor.inspect(result).lanes.answer.performances.borrowed[0];
  assert.equal(played(captured,donorTake,'call').length,5);
  assert.equal(after.length,7);
  assert.deepEqual(after.map(n=>[n.note,n.beat,n.midi,n.play.articulation,n.ties]),
    before.map(n=>[n.note,n.beat,n.midi,n.play.articulation,n.ties]));
  assert.deepEqual(phrase.borrowed,borrow.source);
  assert(phrase.drivers.breath.some(knot=>knot.value>.93));
  assert(phrase.drivers.breath.every(knot=>knot.beat>=4 && knot.beat<=8));
  assert(before.some((row,i)=>Math.abs(row.time-after[i].time)>.008));
  assert(after.some((row,i)=>row.velocity>before[i].velocity+.10));
  assert(after.some((row,i)=>row.velocity<before[i].velocity-.10));
  assert(phrase.notes.find(row=>row.note==='step').delay<0);
  assert.equal(after.find(row=>row.note==='step').time,before.find(row=>row.note==='step').time);
  for (const [i,row] of after.entries()) {
    near(row.time+row.gate,before[i].time+before[i].gate);
    assert(row.gate>0);
    if (i) assert(row.time>=after[i-1].time+after[i-1].gate-eps);
    if (row.ties) assert.equal(row.time,before[i].time);
    assert(row.phrase.lanes.breath.length);
  }
  assert.deepEqual(result.production,base.production);
  assert.deepEqual(result.takes[donorTake],captured.takes[donorTake]);
  assert.deepEqual(editor.edit(result,[borrow]),result);
  const {audio}=editor.auditionPhrase(result,{lane:'answer',phrase:borrow.phrase,takes:['borrowed']});
  assert(audio.borrowed.samples.some((sample,i)=>Math.abs(sample-audio.reference.samples[i])>.015));
  const knot=phrase.drivers.breath.find(row=>row.value>.93), changed=editor.edit(result,[
    {op:'phrase-point',lane:'answer',take:'borrowed',phrase:borrow.phrase,driver:'breath',point:knot.id,set:{value:.25}}
  ]);
  assert.notDeepEqual(editor.render(changed).value.samples,editor.render(result).value.samples);
});

test('borrow can read gesture takes, retain neighboring notes and leave disabled dimensions alone',()=>{
  const {captured,borrow,editor}=make(P,rate);
  const source=editor.edit(captured,[{op:'record-phrase',lane:'call',take:'gesture',phrase:{
    id:'visit',from:0,to:4,
    drivers:{air:[{id:'quiet',beat:0,value:.12},{id:'peak',beat:1.45,value:.94},{id:'fall',beat:4,value:.15}]},
    mapping:{breath:{base:0,from:{air:1}}},
    notes:[{clip:'call',voice:'line',note:'lift',delay:.036,accent:1.4}]
  }}]);
  const shape={...borrow,source:{...borrow.source,take:'gesture'},timing:0,accent:0,activate:false};
  const result=editor.edit(source,[shape]), before=played(source,'reference','answer'),after=played(result,'borrowed','answer');
  assert(!result.comp);
  assert.deepEqual(after.map(({time,gate,velocity})=>[time,gate,velocity]),before.map(({time,gate,velocity})=>[time,gate,velocity]));
  assert(after.some(row=>row.phrase.lanes.breath.some(([,value])=>value>.8)));
  const dry=editor.edit(source,[{...shape,breath:false}]);
  assert.deepEqual(editor.auditionPhrase(dry,{lane:'answer',phrase:borrow.phrase}).audio.borrowed.samples,
    editor.auditionPhrase(dry,{lane:'answer',phrase:borrow.phrase}).audio.reference.samples);
  assert.throws(()=>editor.edit({...source,pins:{answer:'all'}},[borrow]),/unpinned/);
  assert.throws(()=>editor.edit(source,[{...borrow,to:7.3}]),/through key-up/);
});

test('an improvised donor can use a beat grid and absence of breath keeps the destination controls',()=>{
  const {captured,borrow,editor,donorTake}=make(P,rate);
  const clips=structuredClone(captured.takes[donorTake].tracks.call.clips);
  const donor=clips[0].voices.flatMap(voice=>voice.notes).sort((a,b)=>a.beat-b.beat);
  donor[0].midi=64;
  for (const row of donor) delete row.play;
  const session=editor.edit(captured,[{op:'score-take',take:'improv',revision:{tracks:{call:{clips}}}}]);
  const source={...borrow.source,take:'improv'};
  assert.throws(()=>editor.edit(session,[{...borrow,source}]),/same pitch sequence/);
  const result=editor.edit(session,[{...borrow,source:{...source,grid:.25}}]);
  const after=played(result,'borrowed','answer'),before=played(session,'reference','answer');
  assert(after.every(note=>note.phrase.lanes.breath===undefined));
  assert(after.some((note,i)=>Math.abs(note.time-before[i].time)>.01));
});

test('borrowing from the same donor onto a destination alternate retains that take’s voicing and edits',()=>{
  const {captured,borrow,editor}=make(P,rate), clips=structuredClone(captured.production.tracks.answer.clips);
  clips[0].voices[0].notes[0].play.articulation='air';
  const session=editor.edit(captured,[{op:'score-take',take:'alternate',revision:{tracks:{answer:{clips,gain:-9}}}}]);
  const result=editor.edit(session,[{...borrow,targetTake:'alternate',activate:false}]);
  const before=played(session,'alternate','answer'),after=played(result,'borrowed','answer');
  assert.deepEqual(after.map(note=>note.play.articulation),before.map(note=>note.play.articulation));
  assert.equal(result.takes.borrowed.tracks.answer.gain,-9);
  assert.equal(after[0].play.articulation,'air');
  assert.deepEqual(result.takes.alternate,session.takes.alternate);
  assert.throws(()=>editor.edit(result,[borrow]),/new take name/);
});
