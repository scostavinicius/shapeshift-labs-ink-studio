const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const P=require('..').load().KIT.music.production;

function source() {
  return {seed:73,room:{gain:0,size:1,decay:1},arrangement:{
    score:{tempoMap:{tempo:120},key:{root:'C4',mode:'minor'},harmonies:{
      tonic:{root:'C4',quality:'minor7',voicing:{pad:'Eb4'}},
      turn:{root:'F4',quality:'minor7',voicing:{pad:'Ab4'}},
      suspend:{root:'G4',quality:'dominant7',voicing:{pad:'D4'}}
    },changes:[{id:'under',time:{beat:7},harmony:'turn'}]},
    motifs:{bass:{length:4,events:[
      {beat:0,duration:.6,degree:1,velocity:.9},{beat:1,duration:.5,degree:3,velocity:.38},
      {beat:2,duration:.6,degree:1,velocity:.8},{beat:3,duration:.6,degree:2,velocity:.45}
    ]},lead:{length:4,events:[{beat:0,duration:3.2,midi:69,velocity:.85}]}},
    parts:{bass:{role:'bass',material:'bass'},lead:{role:'lead',material:'lead'},
      pad:{role:'pad',material:{sustain:true}}},
    sections:[{id:'opening',bars:2,harmony:'tonic'},{id:'answer',bars:2,harmony:'suspend'}]
  },patches:{
    plain:{type:'analog',drive:.8,env:{attack:.008,decay:.15,sustain:.65,release:.3}},
    echo:{type:'fm',echo:{delay:.19,send:.7,feedback:.6}}
  },tracks:{
    bass:{patch:'plain',gain:-9,send:.2},
    lead:{patch:'echo',gain:-11,send:.4},
    pad:{patch:'plain',gain:-18,send:.2,pad:{voices:3,low:'C3',high:'G5',anchor:'E4',tie:false,spread:.02,
      rhythm:{every:1,length:.5}}}
  }};
}

test('groups and landmarks resolve independently of density, register and harmonic rhythm',()=>{
  const input=source(), initial=P.inspect(input);
  const map={
    groups:[{id:'whole',from:0,to:16},{id:'return',label:'Return',from:8,to:16,parent:'whole'}],
    landmarks:[{id:'pulse',beat:2,kind:'meter'},{id:'return',beat:8,kind:'statement',parts:['bass']}],
    density:[{from:0,to:4,parts:['bass'],value:.5,keep:[1]},{from:8,to:12,parts:['pad'],value:.5}],
    register:[{from:8,to:16,parts:['lead'],semitones:12}],
    harmony:[{from:6,to:8,chords:['suspend','tonic'],every:.5},{from:8,to:10,chords:['turn'],every:1}]
  };
  const {production,report}=P.mapCue(input,map);
  const inspected=P.inspect(production);
  assert.deepEqual(report,inspected.cueMap);
  assert.deepEqual(inspected.events.bass.filter(row=>row.beat<4).map(row=>row.beat),[0,1]);
  assert.deepEqual(report.harmony.map(({beat,harmony})=>[beat,harmony]),[
    [0,'tonic'],[6,'suspend'],[6.5,'tonic'],[7,'suspend'],[7.5,'tonic'],[8,'turn'],[9,'turn'],[10,'suspend']
  ]);
  assert.deepEqual(inspected.events.lead.map(row=>row.midi),[69,69,81,81]);
  assert.deepEqual(inspected.events.lead.map(row=>row.time),initial.events.lead.map(row=>row.time));
  assert.equal(inspected.events.pad.filter(row=>row.beat>=8 && row.beat<12).length,6);
  assert.deepEqual(report.landmarks[1].groups,['whole','return']);
  assert.equal(report.landmarks[1].time,4);
  assert.equal(report.groups[1].tracks.lead.firstBeat,8);
  assert.equal(input.cueMap,undefined);
  assert.throws(()=>P.mapCue(input,{register:[{from:0,to:5,semitones:12},{from:4,to:6,semitones:-12}]}),/overlap/);
  assert.throws(()=>P.mapCue(input,{groups:[{id:'a',from:0,to:16,parent:'b'},{id:'b',from:1,to:16}]}),/fit strictly/);
});

test('withheld entries, note rests and full tail cuts replay identically in trimmed renders',()=>{
  const input=source();
  const map={
    silence:[{from:0,to:4,parts:['bass']},{from:5,to:7,mode:'cut'}],
    room:[{from:0,to:5,send:0},{from:7,to:16,send:[.8,1]}]
  };
  const {production,report}=P.mapCue(input,map);
  assert.equal(report.tracks.bass.firstBeat,4);
  assert.deepEqual(report.roomCuts,[{startTime:2.5,endTime:3.5}]);
  const {events}=P.inspect(production);
  assert.equal(events.lead.find(row=>row.beat===4).gate,.5);
  assert(events.lead.every(row=>row.time<2.5 || row.time>=3.5));
  const rate=8000, options={sampleRate:rate,stems:true};
  const full=P.render(production,{},options);
  const frames=(a,b)=>[a*rate*2,b*rate*2];
  const cut=frames(2.5,3.5);
  assert(full.value.samples.slice(...cut).every(value=>value===0));
  assert(Object.values(full.stems).every(stem=>stem.samples.slice(...cut).every(value=>value===0)));
  assert(full.stems.room.samples.slice(...frames(0,2.5)).every(value=>value===0));
  assert(full.stems.room.samples.slice(...frames(4.15,5)).some(value=>Math.abs(value)>.0002));
  const trim=P.render(production,{}, {...options,start:2.25,end:4.25});
  assert.deepEqual(trim.value.samples,full.value.samples.slice(...frames(2.25,4.25)));
  assert.deepEqual(trim.stems.room.samples,full.stems.room.samples.slice(...frames(2.25,4.25)));
  const rest=P.mapCue(input,{silence:[{from:5,to:7}]}).production;
  const tails=P.render(rest,{},options);
  assert(tails.value.samples.slice(...frames(2.5,2.8)).some(value=>Math.abs(value)>.001));
});

test('changing only the return room leaves performed events alone and cue maps honor pins',()=>{
  const input=source(), original=P.inspect(input), dry=P.render(input,{}, {sampleRate:8000,stems:true});
  const neutral=P.render({...input,cueMap:{}},{},{sampleRate:8000,stems:true});
  assert.deepEqual(neutral,dry);
  const map={room:[{from:8,to:16,parts:['lead'],send:.9}]};
  const mapped=P.revise(input,{cueMap:map});
  assert.deepEqual(P.inspect(mapped).events,original.events);
  const wet=P.render(mapped,{}, {sampleRate:8000,stems:true});
  assert.deepEqual(wet.stems.lead.samples,dry.stems.lead.samples);
  assert.notDeepEqual(wet.stems.room.samples,dry.stems.room.samples);
  input.arrangement.pins=['part:lead'];
  assert.throws(()=>P.mapCue(input,map),/pinned part lead/);
  assert.throws(()=>P.mapCue(input,{silence:[{from:0,to:1,parts:['lead']}]}),/pinned part lead/);
  const other=P.mapCue(input,{register:[{from:8,to:16,parts:['bass'],semitones:-12}]});
  assert.deepEqual(P.inspect(other.production).events.lead,original.events.lead);
});

test('the cue-map CLI writes a recipe that the ordinary production renderer can play',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-cue-map-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  function save(file,value) {fs.writeFileSync(path.join(root,file),JSON.stringify(value));}
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','production',...args],{cwd:root,encoding:'utf8'});
  save('source.json',source());
  save('map.json',{landmarks:[{id:'bass-enters',beat:4,kind:'entry'}],silence:[{from:0,to:4,parts:['bass']}]});
  cli('cue-map','source.json','map.json','--out','mapped.json');
  const report=JSON.parse(cli('inspect','mapped.json')).cueMap;
  assert.equal(report.tracks.bass.firstBeat,4);
  const take=JSON.parse(cli('render','mapped.json','--out','render'));
  assert(fs.existsSync(take.mix));
});
