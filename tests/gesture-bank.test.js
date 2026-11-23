const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),A=kit.KIT.procedural.mediaGraph,WAV=require('../cli/wav.js');

function workspace(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-gestures-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return {directory,bank:ink.openGestureBank(directory,{kit}),library:ink.openSampleLibrary(directory,{kit})};
}

function breath(parameters={},extra={}) {
  return {model:'breath',seed:23,duration:.55,parameters:{pitchStart:128,pitchEnd:205,roughTail:1,voice:.86,...parameters},...extra};
}

test('session indexing reuses originals, aligns signed mic offsets and keeps an exact playable slice',t=>{
  const {directory,library,bank}=workspace(t), sampleRate=16000, at=17*sampleRate;
  const live=A.synthesizeGesture(breath({}, {sampleRate})).value, length=live.samples.length;
  const record=(id,offset,gain,firstSample)=>{
    const samples=new Float64Array(at+length+1000);
    for (let i=0;i<length;i++) samples[at+offset+i]=gain*live.samples[i];
    return library.add(A.sampleCatalog.capture({sampleRate,channels:1,samples},{
      sample:{id,label:id,material:'voice',license:{id:'CC0-1.0'},tags:['practical']},
      source:{kind:'mic',name:id,firstSample}
    })).entry;
  };
  const close=record('close-source',+120,.8,30), room=record('room-source',-28,.31,0);
  const take={id:'t01',label:'Different recorder starts',perspectives:{
    close:{sample:close.id,offsetSamples:120},room:{sample:room.id,offsetSamples:-28}
  }};
  const session={id:'stage',label:'Recording stage'};
  bank.ingest({session,take,slices:[]});
  const raw={id:'last',label:'Lift',fromSample:at,toSample:at+length,analyze:'close',articulation:'breath',tags:['airy']};
  const result=bank.ingest({session,take,slices:[raw]});
  assert.deepEqual(bank.ingest({session,take,slices:[raw]}),result);
  const id='stage/t01/last', fresh=ink.openGestureBank(directory,{kit});
  fresh.ingest({session,take:{...take,id:'t02'},slices:[]});
  fresh.ingest({session,take,slices:[{...raw,id:'head',toSample:at+3000}]});
  assert.equal(fresh.inspect('stage')[0].takes.length,2);
  assert.deepEqual(fresh.inspect('stage')[0].takes[0].slices,['head','last']);
  assert.deepEqual(fresh.get(id),result.slices[0]);
  assert.equal(fresh.search({filters:{tag:'airy',perspective:'room',material:'voice',license:'CC0-1.0'}}).total,2);
  const {value,report}=fresh.audition([{id,perspective:'close'},{id,perspective:'room'}],{gapSeconds:0,targetRmsDb:-23});
  const [direct,distant]=report.clips;
  assert.equal(direct.sourceFirstSample,at+120);
  assert.equal(direct.absoluteFirstSample,at+150);
  assert.equal(distant.sourceFirstSample,at-28);
  assert.equal(direct.endSample,length);
  assert.equal(distant.startSample,length);
  for (let n=0;n<length*2;n++) assert(Math.abs(value.samples[n]-value.samples[n+length*2])<1e-12);
  assert(Math.abs(direct.rms-10**(-23/20))<1e-12);
  const kept=fresh.keep(id,'close',{id:'chosen'}).entry;
  assert.equal(kept.source.firstSample,at+150);
  assert.equal(kept.source.endSample,at+150+length);
  assert.equal(kept.source.reference,'gesture-bank/stage/t01/last/close');
  assert.deepEqual(kept.tags,['airy','practical']);
  assert.deepEqual(library.load(kept.id).value.samples,fresh.load(id,'close').value.samples);
  assert.equal(library.get(close.id).entry.asset,close.asset);
  assert.equal(library.get(close.id).entry.frames,at+length+1000);
  const playback=A.sampleKit.render({id:'gesture-kit',pads:{call:{articulations:{default:[{id:'voice',takes:[{asset:'chosen'}]}]}}}},
    {chosen:library.load('chosen').value},[{id:'note',pad:'call',time:0,velocity:.8}],{sampleRate,duration:.7});
  assert(playback.value.samples.some(value=>Math.abs(value)>.05));
  assert.throws(()=>fresh.ingest({session,take,slices:[{...raw,toSample:8}]}),/clock range/);
  assert.throws(()=>fresh.ingest({session,take,slices:[{...raw,label:'Changed'}]}),/already exists/);
  assert.throws(()=>fresh.ingest({session,take,slices:[{...raw,id:'missing',fromSample:0}]}),/clock range|aligned perspective/);
  assert.throws(()=>fresh.load('../t01/last'),/address/);
});

test('recorded and procedural descriptors support explainable search, aperiodic sources and synthesis recall',t=>{
  const {bank}=workspace(t), session={id:'models'};
  for (const [id,synthesis] of Object.entries({
    lift:breath({}, {room:.65}), fall:breath({pitchStart:205,pitchEnd:128}), smooth:breath({roughTail:.02,voice:.93}),
    noise:breath({voice:0}), long:breath({}, {duration:1.5}), scrape:{model:'scrape',seed:23},metal:{model:'metal',seed:23}
  })) {
    const result=bank.generate({session,id,samplePrefix:id,synthesis});
    const generated=A.synthesizeGesture(synthesis);
    assert.deepEqual(result.take.synthesis,generated.report);
    assert.deepEqual(bank.load(result.slices[0].id).value,generated.value);
    assert(generated.value.samples.some(x=>Math.abs(x)>.03));
  }
  const query='a short breath with a rising pitch and a rough tail';
  const search=bank.search({phrase:query,limit:6});
  assert.equal(search.total,5);
  assert.equal(search.items[0].id,'models/lift/gesture');
  assert.equal(search.query.filters.articulation,'breath');
  assert(search.items[0].descriptors.pitchMotion>3);
  assert(search.items[0].descriptors.tailRoughness>0.5);
  assert.equal(bank.get('models/noise/gesture').descriptors.pitchMotion,null);
  assert(bank.get('models/fall/gesture').descriptors.pitchMotion<-3);
  assert(search.items[0].distance<search.items[1].distance);
  assert(!Object.values(search.items[0].distances).some(n=>!Number.isFinite(n)));
  assert.equal(bank.search({phrase:'breath',filters:{perspective:'room',origin:'procedural'}}).total,1);
  assert.throws(()=>bank.search({phrase:'a dangerous sounding breath'}),/Unknown gesture query/);
  assert.throws(()=>bank.search({phrase:'short long breath'}),/once/);
  assert.deepEqual(bank.generate({session,id:'lift',samplePrefix:'lift',synthesis:breath({}, {room:.65})}).slices[0],
    bank.get('models/lift/gesture'));
  assert.notDeepEqual(A.synthesizeGesture({model:'metal',seed:1}).value,A.synthesizeGesture({model:'metal',seed:2}).value);
  const signed=A.synthesizeGesture({model:'metal',seed:-23});
  assert.equal(signed.report.seed,-23);
  assert.deepEqual(A.synthesizeGesture({model:signed.report.model,seed:signed.report.seed}).value,signed.value);
});

test('music gestures CLI generates, searches, auditions and keeps across processes',t=>{
  const {directory}=workspace(t);
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(mode,extra=[])=>JSON.parse(execFileSync(process.execPath,[cli,'music','gestures',mode,directory,...extra],{encoding:'utf8'}));
  const settings=(name,doc)=>{
    const file=path.join(directory,name+'.json');
    fs.writeFileSync(file,JSON.stringify(doc));
    return file;
  };
  run('generate',[settings('model',{session:{id:'shelf'},id:'lamp',samplePrefix:'lamp',synthesis:{model:'metal',seed:571,room:.5}})]);
  const [{id}]=run('search',['short metal']).items;
  assert.equal(id,'shelf/lamp/gesture');
  assert.equal(run('inspect',['shelf'])[0].takes[0].slices[0],'gesture');
  const selection=settings('matches',{clips:[id,{id,perspective:'room'}],options:{sampleRate:16000}});
  const {audio,report}=run('audition',[selection,'--out',path.join(directory,'reel')]);
  const manifest=JSON.parse(fs.readFileSync(report));
  assert.equal(WAV.read(audio).samples.length,2*manifest.clips[1].endSample);
  assert.equal(manifest.clips[1].perspective,'room');
  assert.equal(run('keep',[settings('selection',{id,perspective:'room',sample:{id:'lamp-mic'}})]).entry.channels,2);
});
