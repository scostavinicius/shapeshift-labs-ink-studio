const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), A=KIT.music.production,WAV=require('../cli/wav.js');

test('an empty brief realizes three distinct long forms around one heard hook',()=>{
  const {value,assets}=A.composeWholePiece();
  assert.equal(value.format,'ink-studio/whole-piece');
  assert.deepEqual(value.candidates.map(row=>row.id),['afterimage','withheld','exchange']);
  assert(Object.keys(assets).length>0);
  const [early,late,trade]=value.candidates.map(row=>row.report);
  assert(early.firstHook.time<2);
  assert(late.firstHook.time>55);
  assert.equal(late.firstEntries.lead,late.firstHook.time);
  assert.equal(trade.firstHook.tracks[0].part,'bass');
  assert(trade.firstEntries.lead>trade.firstHook.time+5);
  assert(early.firstPulse.time>early.firstHook.time+4);
  assert(late.firstPulse.time<late.firstHook.time-35);
  assert.deepEqual(value.candidates.map(row=>row.report.ending.kind),['dissolve','cut','suspend']);
  assert.equal(trade.ending.harmony,'suspended-five');
  const motif=value.report.hook.events.map(row=>row.id);
  for (const {report,themeMap,production} of value.candidates) {
    assert(Math.abs(report.duration-104)<1e-4);
    assert(report.sections.every((row,i)=>i===0 || row.startTime===report.sections[i-1].endTime));
    assert.equal(production.arrangement.score.tempoMap.changes.length,report.sections.length-1);
    assert(new Set(report.sections.map(section=>section.pulse)).size>=4);
    const signature=themeMap.appearances.find(row=>row.id==='first-hook').tracks[0].notes.map(note=>note.id);
    assert.deepEqual(signature,motif);
    assert(report.return.time>report.firstHook.time);
    assert(report.listen.every(row=>row.to>row.from && row.at>=row.from && row.at<=row.to));
    const map=production.cueMap.landmarks;
    assert.equal(map.find(row=>row.id==='first-hook').beat,report.firstHook.beat);
  }
  assert(late.sections.filter(section=>section.endTime<late.firstHook.time).every(section=>section.withheld.includes('lead')));
  assert(late.ending.cutAt>late.ending.lastAttack && late.ending.cutAt<late.duration);
});

test('a custom hook, seed and duration reproduce their own native score',()=>{
  const source={duration:120,tempo:80,palette:'electric',key:{root:'F#',mode:'major'},forms:['exchange'],seed:159,
    hook:{length:4,events:[{id:'rise',beat:0,duration:.56,midi:66},{id:'peak',beat:.77,duration:.7,midi:73},
      {id:'fall',beat:2.04,duration:1.2,midi:68}]}};
  const {value,assets}=A.composeWholePiece(source), [result]=value.candidates;
  assert.equal(Object.keys(assets).length,0);
  assert.deepEqual(value,A.composeWholePiece(source).value);
  assert(Math.abs(result.report.duration-120)<1e-4);
  const played=result.themeMap.appearances.find(row=>row.id==='first-hook').tracks[0].notes;
  assert.deepEqual(played.map(row=>row.midi-played[0].midi),[0,7,2]);
  assert.notDeepEqual(result.production,A.composeWholePiece({...source,seed:160}).value.candidates[0].production);
  assert.throws(()=>A.composeWholePiece({duration:85}),/whole-piece title, duration/);
  assert.throws(()=>A.composeWholePiece({forms:['exchange','exchange']}),/whole-piece title, duration/);
});

test('full-length native printing at 48 kHz preserves an authored stop without visual-only cues',()=>{
  const {value,assets}=A.composeWholePiece({duration:90,palette:'electric',forms:['withheld'],tempo:92,seed:88});
  const [take]=value.candidates, sampleRate=48000;
  const result=A.render(take.production,assets,{sampleRate,stems:false});
  assert(Math.abs(result.value.samples.length/2/sampleRate-90)<.001);
  const cuts=Math.ceil(take.report.ending.cutAt*sampleRate), samples=result.value.samples;
  assert(samples.slice((cuts-2200)*2,(cuts-500)*2).some(x=>Math.abs(x)>.02));
  assert(samples.slice((cuts+10)*2).every(value=>value===0));
  assert.equal(result.report.clipped,0);
  assert.deepEqual(result.stems,{});
});

test('CLI creates a self-contained form with a reproducible master and audition addresses',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-piece-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const call=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','production',...args],{cwd:dir,encoding:'utf8'}));
  fs.writeFileSync(path.join(dir,'brief.json'),JSON.stringify({duration:90,forms:['afterimage'],seed:72}));
  const made=call('compose-piece','brief.json','--out','drafts','--render','--sample-rate','8000');
  const manifest=JSON.parse(fs.readFileSync(made.manifest));
  const [row]=manifest.candidates, recipe=path.join('drafts',row.production);
  assert.equal(row.id,'afterimage');
  assert(fs.existsSync(path.join(dir,'drafts',row.form)));
  assert(Object.keys(JSON.parse(fs.readFileSync(path.join(dir,recipe))).assets).length>10);
  const replay=call('render',recipe,'--out','print');
  assert(!fs.existsSync(path.join(dir,'print','stems')));
  assert.equal(WAV.read(replay.mix).sampleRate,8000);
  assert.deepEqual(fs.readFileSync(replay.mix),fs.readFileSync(path.join(dir,'drafts',row.mix)));
});
