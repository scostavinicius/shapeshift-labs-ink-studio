const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const ink=require('..'), wav=require('../cli/wav.js');
const A=ink.load().KIT.procedural.mediaGraph.sampleMotif;
const rate=8000, audio=(frames,fn)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:frames},(_,i)=>fn(i))});
const sample=audio(3200,i=>.4*Math.sin(2*Math.PI*250*i/rate)*Math.sin(Math.PI*i/3200));
const score=audio(48000,i=>.14*Math.sin(2*Math.PI*120*i/rate));
const settings={map:{tempo:120,swing:.6,changes:[{beat:4,tempo:60}]},
  range:{from:{beat:2},to:{beat:7}},seed:123,
  raw:{at:0},lead:{notes:[{beat:.5,note:'C4',duration:2},{beat:3,note:'F4',duration:.5}]},
  accent:{hits:[{beat:1,note:'C4',duration:.5,play:{tune:200}}]},
  texture:{at:1,until:4,grains:{semitones:-9,spread:.8}}};

test('all four roles share one sample clock and expose editable performances',()=>{
  const plan=A.plan(sample,score,settings);
  assert.deepEqual(A.plan(sample,score,settings),plan);
  assert.equal(plan.root.kind,'detected');
  assert(Math.abs(plan.root.analysis.hz-250)<1);
  assert.deepEqual([plan.firstSample,plan.endSample],[8000,40000]);
  const [raw,lead,accent,texture]=plan.roles.map(({id})=>A.render(plan,sample,score,id));
  assert.equal(raw.report.events[0].at,0);
  assert.deepEqual(lead.report.events.map(({at,noteOff,pitch})=>[at,noteOff,pitch]),
    [[2400,12800,60],[16000,20800,65]]);
  assert.equal(accent.report.events[0].noteOff,6400);
  assert.equal(texture.report.events[0].at,4000);
  assert.equal(texture.material.samples.length,2*20000);
  assert(texture.stem.samples.slice(40000,46500).some(value=>Math.abs(value)>.01));
  assert(texture.stem.samples.slice(48000).every(value=>value===0));
  assert.deepEqual(texture.material.samples,A.render(plan,sample,score,'texture').material.samples);
  for (const row of [raw,lead,accent,texture]) {
    assert.equal(row.value.samples.length,64000);
    assert.equal(row.value.samples[11021],score.samples[13510]+row.stem.samples[11021]);
    assert(row.stem.samples.some(value=>Math.abs(value)>.01));
  }
});

test('score baseline and all alternatives play at a common gain',()=>{
  const plan=A.plan(sample,score,settings), roles=['score','raw','lead','accent','texture'];
  const take=A.audition(plan,sample,score,{roles,levels:{targetRmsDb:-24,gapSeconds:.125}});
  const {sharedGain,headroom,clips}=take.report;
  assert.deepEqual(clips.map(clip=>[clip.id,clip.startSample,clip.endSample]),
    roles.map((id,i)=>[id,i*33000,i*33000+32000]));
  assert(clips.every(clip=>clip.gain===sharedGain));
  assert.equal(take.value.samples[6886],score.samples[11443]*headroom*sharedGain);
  assert.throws(()=>A.render(plan,sample,{...score,samples:score.samples.subarray(1)},'raw'),/does not match/);
  const impulse=audio(256,i=>i===12 ? 1 : 0);
  assert.deepEqual(A.plan(impulse,score,{tonic:'A4'}).root,{midi:69,kind:'reference',analysis:null});
  assert.equal(A.plan(impulse,score,{lead:{root:45}}).root.kind,'authored');
});

test('CLI keeps the audition edit with portable audio and a regular playable kit',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-sample-motif-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=name=>path.join(root,name);
  const doc=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const read=name=>JSON.parse(fs.readFileSync(file(name)));
  const args=(...argv)=>[path.resolve(__dirname,'../cli/ink-studio.js'),'music',...argv];
  const run=(...argv)=>JSON.parse(execFileSync(process.execPath,args(...argv),{cwd:root,encoding:'utf8'}));
  fs.writeFileSync(file('bird.wav'),wav.encode(sample,{encoding:'float64'}));
  fs.writeFileSync(file('score.wav'),wav.encode(score,{encoding:'float64'}));
  doc('recipe.json',{source:'bird.wav',score:'score.wav',settings});
  run('motif','audition','recipe.json','--out','audition');
  const plan=read('audition/plan.json');
  plan.roles[1].performance.events[0].note=72;
  doc('audition/plan.json',plan);
  const license={id:'CC0-1.0',credit:'Test'};
  doc('choice.json',{role:'lead',plan:'audition/plan.json',sample:{id:'tone',license},note:'The upper octave answers the score.'});
  const kept=run('motif','keep','recipe.json','choice.json','--out','kept');
  assert.deepEqual(read('kept/plan.json'),plan);
  assert.equal(read('kept/report.json').events[0].pitch,72);
  assert.deepEqual(read('kept/library/entries/tone.json').license,license);
  fs.unlinkSync(file('bird.wav'));
  fs.unlinkSync(file('score.wav'));
  const replay=run('motif','render','kept/project.json','kept/selection.json','--out','reopen');
  assert.deepEqual(fs.readFileSync(kept.audio),fs.readFileSync(replay.audio));
  assert.deepEqual(fs.readFileSync(kept.stem),fs.readFileSync(replay.stem));
  const kit=run('samples','kit','kept/library','kept/kit.json','kept/performance.json','--out','reuse');
  assert.deepEqual(wav.encode(wav.read(kit.audio),{encoding:'pcm24'}),fs.readFileSync(kept.stem));
  fs.appendFileSync(file(path.join('kept',read('kept/project.json').source.wav)),Buffer.from([0]));
  const rejected=spawnSync(process.execPath,args('motif','render','kept/project.json','kept/selection.json','--out','reopen'),
    {cwd:root,encoding:'utf8'});
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/hash/i);
});
