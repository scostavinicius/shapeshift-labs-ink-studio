const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), {KIT:K}=ink.load(), P=K.procedural,A=K.music.production;
const MIDI=require('../cli/midi-notes');
const WAV=require('../cli/wav');
const rate=8000, settings={id:'test-break',step:.25,length:4};
const note=(lane,beat,velocity,durationBeats)=>({lane,beat,velocity,durationBeats});
const near=(value,expected,tol=1e-8)=>assert(Math.abs(value-expected)<tol,value+' vs '+expected);

function midiFile() {
  const header=Buffer.from('4d546864000000060001000201e0','hex');
  const track=bytes=>{
    const head=Buffer.from('MTrk0000');
    head.writeUInt32BE(bytes.length,4);
    return Buffer.concat([head,Buffer.from(bytes)]);
  };
  return Buffer.concat([header,track([0,255,81,3,7,161,32,0,255,47,0]),
    track([19,153,36,110,80,36,0,127,38,57,96,38,0,0,255,47,0])]);
}

function makeSource() {
  const n=(beat,velocity=.72,play)=>({beat,duration:.2,velocity,...(play && {play})});
  const motif=(...events)=>({length:4,events});
  return {seed:15,arrangement:{
    score:{tempoMap:{tempo:80},key:{root:'F3',mode:'minor'},harmonies:{home:{root:'F3',quality:'minor'}}},
    motifs:{low:motif(n(0),n(1),n(2),n(2.5)),kick:motif(n(0),n(1),n(2)),
      snare:motif(n(1,.69),n(1.75,.39,{articulation:'ghost'}),n(3,.88))},
    parts:{bass:{role:'bass',material:'low'},kick:{role:'percussion',material:'kick',voice:{instrument:'kick'}},
      snare:{role:'percussion',material:'snare',voice:{instrument:'snare'}}},
    sections:[{id:'loop',bars:2,harmony:'home'}]
  },patches:{bass:{type:'analog'},kick:{type:'drum',kind:'kick'},snare:{type:'drum',kind:'snare'}},
    tracks:{bass:{patch:'bass',gain:-15,groove:{offset:.013}},kick:{patch:'kick',gain:-11},snare:{patch:'snare',gain:-12}}};
}
function mapping() {
  const {value:template}=P.performanceGroove.fit([
    note('kick',.04,.9,.10),note('kick',.94,.5,.16),note('kick',2.08,.8,.13),
    note('snare',1.06,.62,.12),note('snare',3.09,.86,.18),note('ghost',1.69,.29,.06)
  ],settings);
  return {template,anchors:[0,4],links:[{leader:'kick',followers:['bass']}],
    tracks:{kick:{lane:'kick',timing:1,accent:0,length:0},snare:{lane:'snare',timing:1,accent:.55,length:.4,
      articulations:{ghost:{lane:'ghost',timing:.7,accent:0,length:1}}}}};
}

test('MIDI PPQ notes preserve note lengths, running status and channel identity',()=>{
  const {format,ppq,tracks,notes}=MIDI.decode(midiFile());
  assert.deepEqual({format,ppq,tracks},{format:1,ppq:480,tracks:2});
  assert.deepEqual(notes,[
    {track:1,channel:10,pitch:36,beat:19/480,velocity:110/127,durationBeats:80/480},
    {track:1,channel:10,pitch:38,beat:226/480,velocity:57/127,durationBeats:96/480}
  ]);
  assert.throws(()=>MIDI.decode(midiFile().subarray(0,-1)),/extends past/);
});

test('fitting measures offsets against the source grid and folds repeated passes via medians',()=>{
  const {value,report}=P.performanceGroove.fit([
    note('rim',1.06,.9,.19),note('rim',5.04,.7,.17),note('rim',3.08,.52,.29),note('rim',7.10,.38,.31),
    note('rim',5.125,.9,.1),note('rim',8.01,.7,.1)
  ],{...settings,cycles:2});
  assert.equal(report.outside,1);
  assert.equal(report.unmatched,1);
  assert.deepEqual(value.lanes.rim,[
    {slot:4,offset:.05,accent:1.31147541,length:.18},
    {slot:12,offset:.09,accent:.737704918,length:.3}
  ]);
});

test('audio extraction measures attacks, relative accents and envelope lengths on each WAV lane',()=>{
  const wave=hits=>{
    const samples=new Float64Array(rate*2);
    for (const [time,level,span] of hits) {
      const first=Math.round(time*rate), n=Math.round(span*rate);
      for (let k=0;k<n;k++) samples[first+k]=level*Math.cos(k*1.12)*Math.exp(-k/n);
    }
    return {sampleRate:rate,channels:1,samples};
  };
  const {value,take,report}=P.mediaGraph.extractGroove({
    kick:wave([[.041,.74,.082],[.48,.51,.141]]),foley:{audio:wave([[.753,.48,.044],[1.485,.64,.076]]),articulation:'heel'}
  },{grid:settings,detect:{size:128,hop:24,minGap:.065,minStrength:.012,sensitivity:1}});
  assert.deepEqual(Object.keys(value.lanes),['kick','foley']);
  const [first,second]=value.lanes.kick;
  assert.deepEqual([first.slot,second.slot],[0,4]);
  near(first.offset,.082,.01);
  near(second.offset,-.04,.01);
  assert(first.accent>second.accent && second.length>first.length+.09);
  assert.equal(report.source,'audio');
  assert(take.lanes.foley.every(hit=>hit.articulation==='heel' && hit.length>0));
});

test('groove transfer is tempo-relative, leaves unmatched notes alone and links bass to the actual kick',()=>{
  const input=makeSource(), map=mapping(), baseline=A.inspect(input).events;
  const result=A.mapGroove(input,map), {events}=A.inspect(result.production);
  const at=(name,beat)=>events[name].find(row=>row.beat===beat);
  near(at('kick',2).time,1.56);
  near(at('kick',1).time,.705);
  near(at('bass',2).time,at('kick',2).time);
  near(at('bass',2.5).time,baseline.bass.find(row=>row.beat===2.5).time);
  near(at('bass',0).time,0);
  near(at('snare',1.75).time,(1.75-.06*.7)*.75);
  near(at('snare',1.75).gate,.06*.75);
  assert.equal(result.report.tracks.kick.resized,0);
  assert(result.report.tracks.snare.accented>0);
  assert(result.report.tracks.bass.moved>0);
  const straight={template:map.template,tracks:Object.fromEntries(Object.keys(map.tracks).map(name=>
    [name,{lane:map.tracks[name].lane,timing:0,accent:0,length:0}]))};
  assert.deepEqual(A.inspect(A.mapGroove(input,straight).production).events,baseline);
  const routed=mapping();
  routed.roles={bass:{lane:'kick',timing:.4,accent:0,length:0}};
  const onlyLanes=A.mapGroove(input,{...routed,links:[]}).production;
  near(A.inspect(onlyLanes).events.bass.find(row=>row.beat===2).time,1.537);
  input.arrangement.pins=['part:bass'];
  assert.throws(()=>A.mapGroove(input,map),/pinned part bass/);
  input.arrangement.pins=[];
  input.cueMap={silence:[{from:1.9,to:2.2,parts:['kick']}]};
  const muted=A.inspect(A.mapGroove(input,map).production).events;
  assert(!muted.kick.some(row=>row.beat===2));
  near(muted.bass.find(row=>row.beat===2).time,1.513);
});

test('CLI extracts a MIDI take by role and applies it as an ordinary production recipe',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-groove-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const save=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
  fs.writeFileSync(path.join(root,'take.mid'),midiFile());
  save('recipe.json',{input:{kind:'midi',file:'take.mid',lanes:[
    {lane:'low',track:1,channel:10,notes:[36]},{lane:'rim',notes:[38],articulation:'edge'}
  ]},grid:settings});
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'music',...args],
    {cwd:root,encoding:'utf8'});
  cli('groove','extract','recipe.json','--out','groove.json');
  const fit=JSON.parse(fs.readFileSync(path.join(root,'groove.json')));
  assert.equal(fit.report.midi.ppq,480);
  assert.equal(fit.take.lanes.rim[0].articulation,'edge');
  assert.equal(fit.take.lanes.rim[0].midi,38);
  near(fit.template.lanes.low[0].length,1/6);
  save('source.json',{production:makeSource(),options:{sampleRate:rate,end:.45}});
  save('map.json',{template:'groove.json',tracks:{kick:{lane:'low',timing:1,length:1}}});
  cli('production','groove','source.json','map.json','--out','target.json');
  const inspect=JSON.parse(cli('production','inspect','target.json'));
  near(inspect.events.kick[0].time,19/480*.75);
  near(inspect.events.kick[0].gate,.125);
  cli('production','render','target.json','--out','render');
  const mix=WAV.read(path.join(root,'render','mix.wav'));
  assert.equal(mix.sampleRate,rate);
  assert.equal(mix.samples.length/mix.channels,.45*rate);
  save('ensemble.json',{ensemble:{takes:{recorded:'groove.json'},transfers:[
    {track:'kick',take:'recorded',lane:'low',from:0,to:4}
  ]}});
  cli('production','groove','source.json','ensemble.json','--out','players.json');
  const ensemble=JSON.parse(cli('production','inspect','players.json'));
  near(ensemble.events.kick[0].time,inspect.events.kick[0].time);
  assert.equal(ensemble.ensemble.references.kick[0].hit,'hit-1');
});

test('ensemble transfers individual reference passes and reports actual articulation selection',()=>{
  const source=makeSource();
  source.patches.snare.articulations={rim:{decay:.12}};
  const {take}=P.performanceGroove.fit([
    {...note('drummer',1.06,.4,.12),articulation:'edge',midi:38},
    {...note('drummer',5.09,.8,.32),articulation:'brush',midi:38}
  ],{...settings,cycles:2});
  assert.deepEqual(take.lanes.drummer,[
    {id:'hit-1',beat:1,offset:.06,velocity:.4,length:.12,articulation:'edge',midi:38},
    {id:'hit-2',beat:5,offset:.09,velocity:.8,length:.32,articulation:'brush',midi:38}
  ]);
  const result=A.mapGroove(source,{ensemble:{id:'players',takes:{ref:take},transfers:[
    {track:'snare',take:'ref',lane:'drummer',from:0,to:8,articulations:{edge:'rim'}}
  ]}});
  const {events,ensemble}=A.inspect(result.production);
  const hit=beat=>events.snare.find(row=>row.beat===beat);
  near(hit(1).time,.795);
  near(hit(5).time,3.8175);
  near(hit(1).velocity,.69*2/3);
  near(hit(5).velocity,.69*4/3);
  near(hit(1).gate,.09);
  near(hit(5).gate,.24);
  assert.equal(hit(1).play.articulation,'rim');
  assert.equal(hit(5).play.articulation,undefined);
  assert.deepEqual(ensemble.references.snare.map(row=>[row.hit,row.articulation,row.applied]),
    [['hit-1','rim',true],['hit-2','brush',false]]);
  const cropped=A.mapGroove(source,{ensemble:{takes:{ref:take},transfers:[
    {track:'snare',take:'ref',lane:'drummer',from:0,to:2,sourceFrom:3,sourceTo:7,timing:.5,accent:0}
  ]}});
  near(A.inspect(cropped.production).events.snare.find(row=>row.beat===1).time,.766875);
});

test('shared pulse and player phrasing combine with balanced lead and lag and protected anchors',()=>{
  const source=makeSource();
  delete source.tracks.bass.groove;
  const seconds=points=>({unit:'seconds',points});
  const ensemble={pulse:seconds([[0,.02]]),players:{
    kick:{offset:seconds([[0,-.01]]),accent:[[0,.5]]},bass:{offset:seconds([[0,.03]]),length:[[0,1.5]]}
  },partners:[{tracks:['kick','bass'],offset:seconds([[1,-.04],[2,.06]])}]};
  const grooveMap={anchors:[0,4],ensemble}, {events,ensemble:report}=A.inspect({...source,grooveMap});
  const at=(name,beat)=>events[name].find(row=>row.beat===beat);
  near(at('kick',0).time,0);
  near(at('bass',4).time,3);
  near(at('kick',1).time,.80);
  near(at('bass',1).time,.76);
  near(at('kick',2).time,1.50);
  near(at('bass',2).time,1.56);
  near(at('bass',2.5).time,1.925);
  near(at('kick',1).velocity,.36);
  near(at('bass',1).gate,.225);
  assert.deepEqual(report.matches.slice(0,2).map(row=>row.realizedSeconds),[-.04,.06]);

  ensemble.partners[0].mobility=[0,1];
  const fixed=A.inspect({...source,grooveMap}).events;
  near(fixed.kick[1].time,.76);
  near(fixed.bass[1].time,.72);
  const reordered={...source,tracks:{snare:source.tracks.snare,bass:source.tracks.bass,kick:source.tracks.kick}};
  assert.deepEqual(A.inspect({...reordered,grooveMap}).events,fixed);
  assert.throws(()=>A.inspect({...source,grooveMap:{ensemble:{...ensemble,partners:[
    ...ensemble.partners,{tracks:['bass','kick']}
  ]}}}),/duplicated ensemble partnership/);
});
