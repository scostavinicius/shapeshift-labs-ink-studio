const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'),{KIT:K}=ink.load(),W=K.world,I=W.inputCompilers;
const plan=(sources,extra={})=>({format:I.planFormat,version:1,id:'inputs',sources,...extra});
const eq=(a,b,tol=1e-12)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const byKind=(score,kind)=>score.events.filter(e=>e.kind===kind);
function midi(tracks,ppq){
  const header=Buffer.from([77,84,104,100,0,0,0,6,0,tracks.length>1?1:0,0,tracks.length,ppq>>8,ppq&255]);
  return Buffer.concat([header,...tracks.map(bytes=>{
    const head=Buffer.from([77,84,114,107,0,0,0,0]);head.writeUInt32BE(bytes.length,4);
    return Buffer.concat([head,Buffer.from(bytes)]);
  })]);
}

test('text and IPA produce editable word, phone, and pause spans with target curves',()=>{
  const result=I.compile(plan({
    text:{kind:'text',text:'Ink, xyz!',lexicon:{ink:'ˈɪŋk'},targets:{ɪ:{jaw:.8},k:{jaw:.2}}},
    ipa:{kind:'ipa',offset:1,text:'/ˌt͡ʃaɪː/ | m̥ʰ',symbols:['aɪ'],targets:{'aɪ':{jaw:.7}}}
  }));
  assert.deepEqual(byKind(result,'word').map(row=>[row.value.text,row.value.pronunciation]),[['Ink','lexicon'],['xyz','unresolved']]);
  assert.equal(byKind(result,'word')[0].id,'text.0');
  const phones=byKind(result,'phoneme');
  assert.deepEqual(phones.map(row=>row.value.symbol),['ɪ','ŋ','k','t͡ʃ','aɪː','m̥ʰ']);
  assert.equal(phones[0].value.stress,'primary');
  assert.equal(phones[0].value.word,'text.0');
  assert.equal(phones[3].value.stress,'secondary');
  assert.equal(byKind(result,'pause').length,3);
  assert.ok(result.warnings.some(w=>w.code==='unresolved-pronunciation'&&w.count===1));
  const playback=I.prepare(result);
  eq(playback.sample(1.11).jaw,.7);
  const guessed=I.compile(plan({speech:{kind:'text',text:'chip',fallback:'english'}}));
  assert.equal(byKind(guessed,'phoneme')[0].value.symbol,'t͡ʃ');
  assert.equal(guessed.warnings[0].code,'heuristic-pronunciation');
  assert.throws(()=>I.compile(plan({speech:{kind:'ipa',text:'a͡'}})),/IPA tie/);
});

test('native MIDI uses tempo changes, pairs attacks and releases, preserves PPQ and builds controller curves',()=>{
  const bytes=midi([
    [0,255,81,3,7,161,32,0x83,0x60,255,81,3,11,113,176,0,255,47,0],
    [0x81,0x70,0x90,60,100,0x81,0x70,0xb0,74,90,0,0xe0,0,96,0x81,0x70,0x90,60,0,0,255,47,0]
  ],480);
  const result=I.compile(plan({m:{kind:'midi',bytes}}));
  const note=byKind(result,'note')[0];
  eq(note.time,.25);
  eq(note.end,.875);
  assert.deepEqual([note.value.track,note.value.tick,note.value.endTick,note.value.pitch],[1,240,720,60]);
  assert.equal(byKind(result,'tempo').length,2);
  const play=I.prepare(result);
  assert.equal(play.sample(.6)['m:t1:ch1:cc74'],90/127);
  const cc=result.events.find(row=>row.channel==='m:t1:ch1:cc74');
  assert.equal(cc.origin.tick,480);
  assert.equal(play.sample(.6)['m:t1:ch1:bend'],.5);
  assert.equal(play.sample(.875)['m:t1:ch1:note60'],0);
  assert.equal(play.events({after:.25,through:.875}).find(row=>row.kind==='note').phase,'end');
  const fractional=midi([[1,0x90,62,96,1,62,0,0,255,47,0]],3);
  const exact=I.compile(plan({m:{kind:'midi',bytes:fractional}}));
  assert.deepEqual(byKind(exact,'note')[0].timecode,{numerator:1,denominator:6});
  assert.deepEqual(byKind(exact,'note')[0].endTimecode,{numerator:1,denominator:3});
  assert.equal(I.prepare(exact).events().at(-1).phase,'end');
  assert.equal(I.prepare(exact).sample(1/3)['m:t0:ch1:note62'],0);
  assert.equal(I.prepare(exact).sample({numerator:333333,denominator:1000000})['m:t0:ch1:note62'],96/127);
});

test('controller curves preserve initial states and equal-time capture order across native replay',()=>{
  const recording=K.procedural.mediaGraph.recording({initial:{axis:[.2,.4],switch:false},events:[
    {time:1/3,timecode:{numerator:1,denominator:3},channel:'axis',value:[.5,.7]},
    {time:1/3,timecode:{numerator:1,denominator:3},channel:'axis',value:[.9,.1]},
    {time:.4,channel:'switch',value:true},
    {time:.4,channel:'cue',kind:'pulse',value:'tap'}
  ]});
  const compiled=I.compile(plan({desk:{kind:'controller',recording}},{
    lanes:{'desk:axis.x':{interpolation:'linear'}}
  }));
  const player=I.prepare(compiled);
  eq(player.sample({numerator:1,denominator:6})['desk:axis.x'],.55);
  assert.equal(player.sample(.4)['desk:switch'],1);
  const control=compiled.events.find(row=>row.channel==='desk:switch');
  const changed=I.edit(compiled,[{op:'set',id:control.id,patch:{value:false}}]);
  assert.equal(I.prepare(changed).sample(.4)['desk:switch'],0);
  const result=player.recording();
  assert.deepEqual(result.initial['desk:axis'],[.2,.4]);
  assert.deepEqual(result.events.slice(0,2).map(row=>row.value),[[.5,.7],[.9,.1]]);
  assert.equal(result.events.at(-1).value.value,'tap');
  const shifted=I.prepare(I.compile(plan({desk:{kind:'controller',recording,offset:.25}})));
  assert.equal(shifted.sample(.2)['desk:axis.x'],0);
  assert.equal(shifted.sample(.25)['desk:axis.x'],.2);
});

test('cue edits preserve identities and durations and update overlapping control curves',()=>{
  const original=I.compile(plan({scene:{kind:'cues',tempoMap:{tempo:90},items:[
    {id:'idle',time:0,controls:{light:.4}},
    {id:'warn',time:{beat:1},end:{beat:2},controls:{light:.9}},
    {id:'check',time:1,end:1.2,controls:{light:.1}}
  ]}}));
  assert.equal(I.prepare(original).sample(1.1).light,.1);
  assert.equal(I.prepare(original).sample(1.25).light,.9);
  const revised=I.edit(original,[{op:'move',id:'scene.check',time:.25}]);
  assert.equal(revised.revision,2);
  const span=revised.events.find(row=>row.id==='scene.check');
  assert.deepEqual([span.time,span.end],[.25,.45]);
  assert.equal(I.prepare(revised).sample(.4).light,.1);
  assert.equal(I.prepare(revised).sample(1.1).light,.9);
  assert.equal(I.prepare(original).sample(.4).light,.4);
  const manual=JSON.parse(JSON.stringify(revised));
  manual.curves.light.keys[0].value=.6;
  eq(I.prepare(manual).sample(.1).light,.6);
  const gesture=I.prepare(revised).gestures({rate:120,bindings:{lamp:{curve:'light'}}});
  const run=W.gestureScores.prepare(gesture).open();
  run.advance(48);
  assert.equal(run.values().lamp,.1);
});

test('world ports deliver exact edge phases once and resume without replaying old events',()=>{
  const compiled=I.compile(plan({scene:{kind:'cues',items:[
    {id:'pre',time:0,controls:{signal:.2}},
    {id:'mark',time:{numerator:1,denominator:30},end:{numerator:1,denominator:15},controls:{signal:.9}}
  ]}}));
  const world={dt:1/30,systems:{score:{kind:'input-score',operatorRevision:1,
    config:{score:compiled,bindings:{level:{curve:'signal',quantity:{unit:'1'}}}}}}};
  const run=W.runtime.create(world);
  run.step();
  const first=run.view().signals;
  assert.deepEqual(first['score/events'].map(row=>[row.id,row.phase]),[['scene.pre','point'],['scene.mark','start']]);
  assert.equal(first['score/events'][1].timing.time,1/30);
  assert.equal(first['score/level'],.9);
  const checkpoint=JSON.parse(JSON.stringify(run.checkpoint())), resume=W.runtime.create(checkpoint.world,{checkpoint});
  run.step();resume.step();
  assert.deepEqual(resume.checkpoint(),run.checkpoint());
  assert.deepEqual(run.view().signals['score/events'].map(row=>row.phase),['end']);
  assert.equal(run.view().signals['score/level'],.2);
});

test('CLI compiles relative UTF-8 and MIDI files, edits and exports an ordinary input recording',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-input-score-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=(name,data)=>fs.writeFileSync(path.join(folder,name),data);
  const save=(name,data)=>file(name,JSON.stringify(data));
  file('voice.ipa','a͡ɪ');
  file('notes.mid',midi([[0,0x90,60,80,3,0x80,60,0,0,255,47,0]],3));
  save('plan.json',plan({voice:{kind:'ipa',file:'voice.ipa'},music:{kind:'midi',file:'notes.mid'}}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const call=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'sim',...args],{cwd:folder,encoding:'utf8'}));
  const result=call('input-compile','plan.json');
  assert.equal(byKind(result,'phoneme')[0].value.symbol,'a͡ɪ');
  save('inputs.json',result);
  const note=byKind(result,'note')[0];
  save('edits.json',[{op:'move',id:note.id,time:.25}]);
  const edited=call('input-edit','inputs.json','edits.json');
  save('edited.json',edited);
  const output=call('input-export','edited.json','--kind','recording');
  assert.equal(output.events.find(row=>row.value.id===note.id).time,.25);
  assert.deepEqual(output,I.prepare(edited).recording());
});
