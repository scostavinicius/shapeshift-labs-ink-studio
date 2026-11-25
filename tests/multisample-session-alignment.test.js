const assert=require('node:assert/strict'),{test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const P=require('..').load().KIT.procedural,I=P.musicInstruments,S=P.mediaGraph.instrumentSession;
const WAV=require('../cli/wav'),{capture}=require('../examples/multisample-session/fixture.cjs');
const order=['close','middle','room'];
const micSettings={retainDelaySamples:{middle:12,room:84}};
const near=(got,want,tolerance=1e-10)=>assert(Math.abs(got-want)<tolerance,got+' vs '+want);

test('take attacks estimate signed offsets and polarity without rewriting the raw captures',()=>{
  const {session,assets,tracks,slate}=capture(), original=structuredClone(session);
  const auto=S.align(session,assets);
  for (const name of order.slice(1)) {
    const {offset,arrival,polarity}=tracks[name], row=auto.report.perspectives[name];
    assert.equal(row.status,'aligned');
    assert.equal(row.offsetSamples,offset+arrival);
    assert.equal(row.polarity,polarity);
    assert(row.votes>=5);
  }
  const retained=S.align(session,assets,micSettings);
  const slates=S.align(session,assets,{syncSamples:[slate]});
  assert.equal(slates.report.method,'slate');
  for (const name of order.slice(1)) {
    assert.equal(retained.value.perspectives[name].offsetSamples,tracks[name].offset);
    assert.deepEqual(retained.value.perspectives[name],slates.value.perspectives[name]);
  }
  assert.deepEqual(S.align(retained.value,assets,micSettings).value,retained.value);
  const unchanged=S.align(session,assets,{correctPolarity:false,syncSamples:[slate]});
  assert.equal(unchanged.value.perspectives.room.polarity,undefined);
  assert.equal(unchanged.report.perspectives.room.offsetSamples,751);
  assert.deepEqual(session,original);
});

test('silent, ambiguous and nonstationary evidence does not commit a guess',()=>{
  const {session,assets,slate}=capture(16000);
  const room=assets.room,quiet={...room,samples:new Float64Array(room.samples.length)};
  assert.equal(S.align(session,{...assets,room:quiet}).report.perspectives.room.status,'unresolved');
  assert.throws(()=>S.build(session,{...assets,room:quiet},{perspectives:order,alignment:{}}),
    /Review unresolved microphone alignment for.*room/);
  const shifted=room.samples.slice(), secondHalf=session.takes[4].fromSample*2;
  shifted.copyWithin(secondHalf+88,secondHalf,shifted.length-88);
  const drift=S.align(session,{...assets,room:{...room,samples:shifted}},{windowMs:12});
  assert.equal(drift.report.perspectives.room.status,'inconsistent');
  assert.equal(drift.value.perspectives.room.offsetSamples,undefined);

  const repeat=quiet.samples.slice();
  const marker=assets.close.samples.slice(slate,slate+128);
  for (const from of [slate+300,slate+800]) for (let i=0;i<marker.length;i++) repeat[(from+i)*2]=marker[i];
  const ambiguous=S.align(session,{...assets,room:{...room,samples:repeat}},{syncSamples:[slate],windowMs:8});
  assert.equal(ambiguous.report.perspectives.room.evidence[0].status,'ambiguous');
  assert.equal(ambiguous.value.perspectives.room.offsetSamples,undefined);
  const cut=S.align(session,{...assets,room:{...room,samples:room.samples.subarray(0,room.samples.length-16000)}},
    {syncSamples:[slate]});
  assert.equal(cut.report.perspectives.room.status,'incomplete');
});

test('the playable mic blend keeps same-take timing, levels, stereo and transposed tails',()=>{
  const {session,assets,slate}=capture(),rate=session.sampleRate,snapshot=assets.room.samples.slice();
  const result=S.build(session,assets,{perspectives:order,alignment:{syncSamples:[slate]}});
  assert.deepEqual(result.report.perspectives,order.map((name,i)=>({name,position:i/2})));
  const cell=result.report.models['key-60.firm.glass'];
  assert.equal(cell.method,'multimic-recording');
  assert.equal(cell.alternates.length,2);
  for (const [name,clips] of Object.entries(cell.samples)) {
    const mic=result.session.perspectives[name],raw=assets[name],n=raw.channels;
    for (const [turn,asset] of clips.entries()) {
      const {from,to}=cell.ranges[turn],clip=result.assets[asset];
      assert.equal(clip.samples.length,(to-from)*n);
      const start=(from+(mic.offsetSamples ?? 0))*n,gain=(mic.polarity ?? 1)*result.report.sharedGain;
      assert(clip.samples.every((sample,i)=>sample===raw.samples[start+i]*gain));
    }
  }
  assert(assets.room.samples.every((x,i)=>x===snapshot[i]));
  const player=P.musicGestures.patch(result.value.patch,result.assets).player;
  const voice=(room,roundRobin=0,midi=60,curve=false)=>{
    const gate=.2;
    return player.prepare({midi,frequency:I.hz(midi),roundRobin,velocity:1,play:{room},
      ...(curve && {expression:P.musicNoteExpression.compile({room:[[0,0],[1,1]]},gate,rate)})},rate,gate);
  };
  const [close,firstBlend,middle,secondBlend,room,sweep]=[voice(0),voice(.25),voice(.5),voice(.75),voice(1),voice(0,0,60,true)];
  const at=(sound,frame,ch)=>sound.signal(frame/rate,frame,ch);
  for (const frame of [180,470,1980,3901,6417]) for (const ch of [0,1]) {
    const a=at(close,frame,ch),b=at(middle,frame,ch),c=at(room,frame,ch);
    near(at(firstBlend,frame,ch),(a+b)/2);
    near(at(secondBlend,frame,ch),(b+c)/2);
    const position=Math.min(1,frame/rate/.2)*2;
    near(at(sweep,frame,ch),position<1 ? a+(b-a)*position : b+(c-b)*(position-1));
  }
  assert(Math.abs(at(room,470,0)-at(room,470,1))>.001);
  assert(Math.abs(at(close,470,0)-at(voice(0,1),470,0))>.001);
  const lower=voice(1,0,57);
  const rawDuration=result.assets[cell.samples.room[0]].samples.length/2/rate*I.hz(60)/I.hz(57);
  assert(lower.duration>=rawDuration-1e-10);
  const review=S.audition(result.value,result.assets,{cases:[
    {id:'moving',key:60,velocity:.9,articulation:'glass',play:{curves:{room:[[0,0],[1,1]]}}}
  ]});
  assert(review.report.probes[0].peak>.01);
});

test('CLI aligns the raw files and exports a portable production patch',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-multimic-')),file=name=>path.join(dir,name);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {session,assets,slate}=capture(), paths={};
  for (const [name,pcm] of Object.entries(assets)) {
    paths[name]=name+'.wav';
    fs.writeFileSync(file(paths[name]),WAV.encode(pcm,{encoding:'float32'}));
  }
  const set=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  set('raw.json',{session,assets:paths});
  set('alignment.json',{syncSamples:[slate]});
  set('blend.json',{perspectives:order,alignment:{syncSamples:[slate]}});
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','instrument',...args],{cwd:dir,encoding:'utf8'}));
  const aligned=run('align-session','raw.json','alignment.json','--out','review');
  const resolved=JSON.parse(fs.readFileSync(aligned.session));
  assert.equal(resolved.session.perspectives.room.offsetSamples,751);
  assert.equal(resolved.assets.room,'../room.wav');
  const built=run('build-session','raw.json','blend.json','--out','bank');
  const review=run('audition-session',built.instrument,'--out','audition');
  const recipe=JSON.parse(fs.readFileSync(review.production));
  assert(Object.values(recipe.assets).every(name=>fs.existsSync(file('audition/'+name))));
  assert(WAV.read(review.audio).samples.some(x=>Math.abs(x)>.03));
});
