const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), {KIT:K}=ink.load(), A=K.music.production;

function source() {
  const harmony=(root,quality,voicing)=>({root,quality,voicing:{inner:voicing}});
  return {
    seed:195,arrangement:{score:{key:{root:'D4',mode:'minor'},tempoMap:{tempo:120,swing:.55},harmonies:{
      home:harmony('D3','minor7','F4'),blue:harmony('Bb2','major7','F4'),
      fall:harmony('G2','minor7','Bb4'),turn:harmony('A2','dominant7','G4')
    }},motifs:{
      lead:{length:4,events:[{beat:0,duration:.62,midi:77,velocity:.8},{beat:1.3,duration:.42,midi:76},
        {beat:2.5,duration:.55,midi:81,velocity:.72}]},
      bass:{length:4,events:[{beat:0,duration:2,degree:1,velocity:.83},{beat:2.2,duration:1.22,degree:5}]}
    },parts:{melody:{role:'lead',material:'lead'},bass:{role:'bass',material:'bass'},inner:{role:'pad'}},
    sections:['home','blue','fall','turn'].map(key=>({id:key,bars:1,harmony:key}))},
    patches:{slow:{type:'analog',body:.33,drive:1,env:{attack:.013,release:.12}},
      key:{type:'fm',ratio:1.99,index:1.1}},
    tracks:{melody:{patch:'key',gain:-13},bass:{patch:'slow',gain:-16},inner:{patch:'slow',gain:-14,send:.35}}
  };
}
const settings={track:'inner',melody:'melody',bass:'bass',voices:[
  {id:'tenor',low:52,high:62,anchor:57},{id:'alto',low:62,high:73,anchor:67}
],pedals:[{voice:'tenor',from:0,to:8,midi:'C4'}],
suspensions:[{voice:'alto',at:4,delay:.5,hold:'C5',resolve:'Bb4'}]};

test('polyphonic note clips preserve simultaneous independent voices and make adjacent ties a single attack',()=>{
  const input=source(), make=(name,beat,notes)=>({id:name,beat,length:4,voices:notes});
  input.tracks.inner.clips=[
    make('entry',0,[
      {id:'tenor',notes:[{id:'open',beat:0,duration:4,midi:'C4'}]},
      {id:'alto',notes:[{id:'reply',beat:.5,duration:1,midi:67}]}
    ]),
    make('continuation',4,[
      {id:'tenor',notes:[{id:'hold',beat:0,duration:2,midi:60,tie:true},{id:'walk',beat:2,duration:1,midi:62}]}
    ])
  ];
  const {events}=A.inspect(input), inner=events.inner;
  assert.deepEqual(inner.map(note=>[note.voice,note.beat,note.midi]),[['tenor',0,60],['alto',.5,67],['tenor',6,62]]);
  assert.equal(inner[0].gate,3);
  assert.deepEqual(inner[0].ties,[{clip:'continuation',note:'hold'}]);
  const rate=8000, mix=A.render(input,{}, {sampleRate:rate,stems:true});
  assert(mix.stems.inner.samples.slice(2*rate*2,2*rate*2+200).some(sample=>Math.abs(sample)>.002));
  input.tracks.inner.clips[1].voices[0].notes[0].midi=61;
  assert.throws(()=>A.inspect(input),/same voice and pitch/);
});

test('search produces three distinct editable paths and retains fixed notes through their resolution beat',()=>{
  const input=source(), baseline=A.inspect(input).events;
  const result=A.voiceLead(input,settings);
  assert.deepEqual(result,A.voiceLead(input,settings));
  assert.deepEqual(result.variants.map(row=>row.id),['connected','suspensions','counterline']);
  assert.deepEqual(result.report.locked,['melody','bass']);
  assert.equal(result.variants[1].metrics.delayed[0].until,4.5);
  assert(result.variants[1].metrics.delayed.some(row=>row.beat!==4));
  assert(result.variants[2].metrics.answerNotes>0);
  const answers=result.variants[2].clip.voices[1].notes.filter(row=>row.beat>=8);
  assert(answers.length && answers.every(note=>result.report.gaps.some(gap=>
    note.beat>=gap.from-1e-8 && note.beat+note.duration<=gap.to+1e-8)));
  const stems=[];
  for (const {revision} of result.variants) {
    assert.deepEqual(Object.keys(revision.tracks),['inner']);
    const next=A.revise(input,revision), events=A.inspect(next).events;
    assert.deepEqual(events.melody,baseline.melody);
    assert.deepEqual(events.bass,baseline.bass);
    assert(events.inner.find(note=>note.voice==='tenor' && note.beat===0).gate>=4);
    assert.equal(events.inner.find(note=>note.voice==='alto' && note.beat===4.5).midi,70);
    stems.push(A.render(next,{}, {sampleRate:8000,stems:true}).stems);
  }
  assert.deepEqual(stems[0].melody.samples,stems[2].melody.samples);
  assert.deepEqual(stems[0].bass.samples,stems[2].bass.samples);
  assert.notDeepEqual(stems[0].inner.samples,stems[1].inner.samples);
  assert.notDeepEqual(stems[1].inner.samples,stems[2].inner.samples);
});

test('roughness and nonchord preferences affect the choice and work with already mapped outer lines',()=>{
  const input=source();
  input.cueMap={register:[{from:8,to:16,parts:['melody'],semitones:12}]};
  const clean=A.voiceLead(input,{...settings,preferences:{tension:0,dissonance:.08}}).variants[0];
  const dark=A.voiceLead(input,{...settings,preferences:{tension:.82,dissonance:.77}}).variants[0];
  assert(dark.metrics.tension>clean.metrics.tension);
  assert(dark.metrics.dissonance>clean.metrics.dissonance);
  assert.deepEqual(A.inspect(A.revise(input,dark.revision)).events.melody,A.inspect(input).events.melody);
  input.arrangement.pins=['part:inner'];
  assert.throws(()=>A.voiceLead(input,settings),/target inner track is pinned/);
});

test('voice-leading CLI publishes revisions the production renderer can audition and render',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-voicing-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const save=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','production',...args],{cwd:root,encoding:'utf8'});
  save('base.json',source());
  save('settings.json',settings);
  cli('voice-lead','base.json','settings.json','--out','search.json');
  const found=JSON.parse(fs.readFileSync(path.join(root,'search.json')));
  save('pick.json',found.variants[1].revision);
  cli('revise','base.json','pick.json','--out','take.json');
  const {mix}=JSON.parse(cli('render','take.json','--out','take'));
  assert(ink.readWav(mix).samples.some(value=>value!==0));
});
