const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), A=KIT.music.production,C=A.critique;
const rate=8000;
const line=(notes)=>({length:2,events:notes.map(([beat,duration,midi,velocity],i)=>({id:'n'+i,beat,duration,midi,velocity}))});
const production={seed:329,arrangement:{score:{key:{root:'A4',mode:'minor'},tempoMap:{tempo:96},
  harmonies:{a:{root:'A3',quality:'minor'}}},sections:[{id:'intro',bars:1,harmony:'a'},{id:'return',bars:1,harmony:'a'}],
  parts:{hook:{role:'lead',material:'tune'},keys:{role:'pad',material:'chords'},bass:{role:'bass',material:'low'}},
  motifs:{tune:line([[0,.24,69,.88],[.5,.38,72,.84],[1,.68,76,.77]]),
    chords:line([[0,.83,69,.92],[1,.9,76,.87]]),low:line([[0,.8,45,.85],[1,.67,40,.72]])}},
  patches:{tune:{type:'fm',index:.15,env:{attack:.003,decay:.12,sustain:.8,release:.1}},
    chords:{type:'analog',body:.32,env:{attack:.003,decay:.16,sustain:.8,release:.12}},
    low:{type:'analog',env:{attack:.003,decay:.10,sustain:.6,release:.12}}},
  tracks:{hook:{patch:'tune',gain:-18},keys:{patch:'chords',gain:-7,send:.14},bass:{patch:'low',gain:-15}},
  room:{gain:-27,decay:.35}};
const brief={section:'return',goal:'Let the hook read clearly after the lead-in.',sampleRate:rate,
  leadInBeats:2,focusBeats:3,tags:['hook clarity']};
const choice=(key,move,reason='The small cut gives the hook space and keeps the keys audible.')=>{
  const take=Object.keys(key.labels).find(label=>key.labels[label]===move);
  const trial=key.test.trials.find(row=>row.takes.includes(take));
  return {token:key.test.token,take,reason,votes:[{trial:trial.id,listener:'editor',preferences:{identity:take,groove:'tie'}}]};
};

test('rendered evidence and five production edits share the exact cue clock',()=>{
  const plan=C.plan(production,brief);
  assert.deepEqual(plan.tracks.lead,'hook');
  assert.deepEqual(plan.tracks.layer,'keys');
  assert.deepEqual(plan.session.takes.map(row=>row.id),['reference','mute-layer','move-register','mix-cut','delay-bass','empty-beat']);
  assert.equal(plan.evidence.focus.firstSample,20000);
  assert.equal(plan.evidence.focus.endSample,35000);
  assert(plan.evidence.repeats.length>0);
  assert(plan.evidence.windows.some(row=>row.masking.some(hint=>hint.track==='keys' && hint.overlap>.4)));
  assert(plan.evidence.windows.every(row=>row.mix.peakSample>=row.range.firstSample && row.mix.peakSample<row.range.endSample));
  const alternate=name=>A.revise(production,plan.session.takes.find(row=>row.id===name).components[0].revision);
  const cut=alternate('mix-cut');
  const start=plan.evidence.context.start,end=plan.evidence.context.end;
  const preview=source=>A.render(source,{}, {start,end,sampleRate:rate,stems:true});
  const base=preview(production), lowered=preview(cut), first=plan.evidence.focus.firstSample-base.report.firstSample;
  assert.deepEqual(base.stems.hook.samples,lowered.stems.hook.samples);
  assert.deepEqual(base.stems.keys.samples.slice(0,2*first),lowered.stems.keys.samples.slice(0,2*first));
  const index=2*(first+800), before=base.stems.keys.samples[index], after=lowered.stems.keys.samples[index];
  assert(Math.abs(after/before-10**(-3/20))<.0001);
  const moved=A.inspect(alternate('move-register')).events.keys;
  assert.equal(moved.find(note=>note.beat===4).midi,57);
  assert.equal(moved.find(note=>note.beat===3).midi,76);
  assert(!A.inspect(alternate('delay-bass')).events.bass.some(note=>note.beat===4));
  assert(preview(alternate('empty-beat')).value.samples.slice(2*5000,2*10000).every(x=>x===0));
  const pinned=C.plan({...production,arrangement:{...production.arrangement,pins:['part:keys']}},brief);
  assert(pinned.blocked.some(row=>row.move==='mix-cut' && /pinned/.test(row.reason)));
});

test('mix evidence measures over-range peaks and cancellation before preview attenuation',()=>{
  const samples=Float64Array.from({length:6400},(_,i)=>.78*Math.sin(Math.floor(i/2)*Math.PI*.06)*(i%2 ? -1 : 1));
  const score={...production.arrangement.score,harmonies:{a:{root:'A3',quality:'unison'}}};
  const source={arrangement:{...production.arrangement,score,parts:{hook:{role:'lead',material:'tune'}}},
    patches:{hook:{type:'sample',zones:[{samples:['phase']}]}},tracks:{hook:{patch:'hook',gain:13,send:0}}};
  const assets={phase:{sampleRate:rate,channels:2,samples}};
  const plan=C.plan(source,{...brief,kind:'arrival'},assets);
  const before=plan.evidence.mix;
  assert(before.truePeakDbTP>0);
  assert(before.clippedFrames>0);
  assert(before.correlation<-.99 && before.monoNull);
  const test=C.blind(source,plan,assets);
  assert(test.evidence.gain<1);
  assert(test.evidence.audio.mono.samples.every(x=>Math.abs(x)<1e-6));
  const altered={phase:{...assets.phase,samples:Float64Array.from(samples,x=>x*.9)}};
  assert.throws(()=>C.keep(source,test.key,choice(test.key,'empty-beat'),altered),/original audio assets/);
});

test('public trials hide identities, keep valid pair votes, and surface a tagged prior decision',()=>{
  const {test,key,audio,evidence}=C.blind(production,C.plan(production,brief),{}, {seed:821,id:'hook-test',target:-19});
  assert.equal(test.trials.length,15);
  assert.equal(new Set(test.trials.map(row=>row.takes.slice().sort().join(''))).size,15);
  for (const forbidden of Object.values(key.labels))
    assert(!JSON.stringify(test).includes('"'+forbidden+'"'));
  assert.equal(test.range.endSample-test.range.firstSample,audio.a.samples.length/2);
  assert.equal(evidence.audio.focus.samples.length/2,test.focus.endSample-test.focus.firstSample);
  assert.equal(evidence.audio.mono.channels,1);
  for (const value of Object.values(audio))
    assert(Math.abs(A.loudness(value)-test.lufs)<.00001);
  const selection=choice(key,'mix-cut');
  const kept=C.keep(production,key,selection);
  assert.equal(kept.reference.move,'mix-cut');
  assert.equal(kept.reference.counts[selection.take].identity,1);
  assert.deepEqual(kept.production,A.revise(production,kept.revision));
  assert.throws(()=>C.keep(production,key,{...selection,token:'other'}),/token/);
  assert.throws(()=>C.keep(production,key,{...selection,votes:[...selection.votes,...selection.votes]}),/once/);
  assert.throws(()=>C.keep(production,key,{...selection,votes:[{...selection.votes[0],preferences:{replay:'z'}}]}),/either take/);
  const ref=C.tagReference(evidence.audio.focus,{id:'reference',title:'Clear entry',source:'Reference recording',
    tags:['hook clarity'],note:'The keys wait before answering the hook.',firstSample:10,endSample:231});
  assert.equal(ref.value.samples.length,442);
  assert.equal(C.findReferences([ref.reference,kept.reference],{tags:['Hook Clarity']}).length,2);
  assert.equal(C.findReferences([ref.reference,kept.reference],{text:'keys wait'})[0].kind,'clip');
  assert.equal(C.plan(production,{...brief,references:[ref.reference,kept.reference]}).session.takes[1].id,'mix-cut');
});

test('CLI packages separate evidence and blind audio, then publishes an ordinary production',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-critique-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const write=(file,value)=>fs.writeFileSync(path.join(dir,file),JSON.stringify(value));
  const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','critique',...args],{cwd:dir});
  write('score.json',{production});
  write('brief.json',{...brief,kind:'hook'});
  cli('plan','score.json','brief.json','--out','plan.json');
  cli('listen','score.json','plan.json','--out','review');
  const key=read('review/review-key.json'), publicTest=read('review/public/test.json');
  assert.equal(publicTest.files.a,'a.wav');
  assert(!JSON.stringify(publicTest).includes('mute-layer'));
  assert(fs.existsSync(path.join(dir,'review/public/index.html')));
  assert(fs.existsSync(path.join(dir,'review/evidence/focus.wav')));
  write('decision.json',choice(key,'move-register'));
  cli('keep','score.json','review/review-key.json','decision.json','--out','chosen');
  assert.equal(read('chosen/reference.json').move,'move-register');
  assert.deepEqual(read('chosen/production.json').production.cueMap.register[0].parts,['keys']);
  write('index.json',['chosen/reference.json']);
  const hits=JSON.parse(cli('find','index.json'));
  assert.equal(hits[0].kind,'decision');
});
