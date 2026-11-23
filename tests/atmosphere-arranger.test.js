const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),A=kit.KIT.procedural.mediaGraph.atmosphere;
const rate=8000, n=rate*6, audio=(frames,fn)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:frames},(_,i)=>fn(i))});
const score=audio(n,i=>.14*Math.sin(i*Math.PI/40));
const assets={water:audio(4200,i=>.13*Math.sin(i*Math.PI/26)+.15*Math.cos(i*Math.PI/70)),
  bird:audio(800,i=>.46*Math.sin(i*Math.PI/9)), click:audio(400,i=>.36*Math.cos(i*Math.PI/15))};
const reference={sampleRate:rate,frames:n,map:{tempo:120},
  events:{lead:[{time:.45,gate:.5},{time:1.24,gate:.65},{time:4.65,gate:.95}],
    drums:[0,.5,1,1.5,4.5,5,5.5].map(time=>({time,gate:.09}))}};
const settings={seed:471,layers:[
  {id:'water',kind:'bed',assets:['water'],crossfade:.1,
    perspective:{far:{gainDb:-22,cutoffHz:1100,pan:-.25},near:{gainDb:-5,cutoffHz:3300,pan:.32},
      whenQuiet:['drums'],minQuiet:.85,tail:.11,attack:.2,release:.3}},
  {id:'calls',kind:'call',assets:['bird'],spacing:.64,density:1,avoid:['lead'],padding:.1,minGap:.12,
    perspective:{far:{gainDb:-11}}},
  {id:'pair',kind:'gesture',assets:['bird','click'],every:4,offset:1.5,density:1,
    pattern:[{beat:0,source:'click'},{beat:.5,source:'bird',gainDb:-4}]}
]};

test('beds overlap, calls fit protected note gaps and repeated gestures follow the musical clock',()=>{
  const result=A.plan(reference,assets,settings);
  assert.deepEqual(A.plan(reference,assets,settings),result);
  const [bed,calls,gestures]=result.layers;
  assert.equal(bed.clips[0].at,0);
  assert.equal(bed.clips.at(-1).end,n);
  for (const [i,clip] of bed.clips.slice(1).entries()) assert.equal(bed.clips[i].end-clip.at,800);
  assert.equal(bed.quietWindows.length,1);
  assert(Math.abs(bed.quietWindows[0][0]-13600)<=1);
  assert.equal(bed.quietWindows[0][1],36000);
  const strip=bed.mixer.strips.out;
  assert(Math.abs(Math.max(...strip.fader.points.map(row=>row.value))-10**(-5/20))<1e-12);
  assert.equal(Math.max(...bed.mixer.processors.color.hz.points.map(row=>row.value)),3300);
  assert.equal(Math.max(...strip.pan.points.map(row=>row.value)),.32);
  assert(calls.clips.length>=5);
  for (const placed of calls.clips) {
    assert(calls.windows.some(([lo,hi])=>placed.at>=lo && placed.end<=hi));
    assert(reference.events.lead.every(note=>placed.end<=Math.floor((note.time-.1)*rate) ||
      placed.at>=Math.ceil((note.time+note.gate+.1)*rate)-1));
  }
  assert.deepEqual(gestures.clips.map(row=>[row.occurrence,row.source,row.at]),
    [[0,'click',6000],[0,'bird',8000],[1,'click',22000],[1,'bird',24000],[2,'click',38000],[2,'bird',40000]]);
  const sparse=A.plan(reference,assets,{...settings,layers:settings.layers.map(row=>row.id==='calls' ? {...row,density:.28} : row)});
  assert.deepEqual(sparse.layers[2],gestures);
  assert(sparse.layers[1].clips.every(clip=>calls.clips.some(original=>original.slot===clip.slot && original.at===clip.at)));
  const rendered=A.render(JSON.parse(JSON.stringify(result)),score,assets,{stems:true});
  assert(rendered.value.samples.some(value=>Math.abs(value)>.2));
  for (const i of [0,7985,29041,68095,n*2-1])
    assert(Math.abs(rendered.atmosphere.samples[i]-Object.values(rendered.stems).reduce((sum,stem)=>sum+stem.samples[i],0))<1e-12);
  assert.throws(()=>A.plan(reference,assets,{layers:[{...settings.layers[1],avoid:['missing']}]}),/performed tracks/);
});

test('swing, tempo changes and half-open ranges survive plan and render',()=>{
  const source={...reference,map:{tempo:120,swing:.6,changes:[{beat:4,tempo:60}]}};
  const plan=A.plan(source,assets,{layers:[
    {...settings.layers[2],offset:.5,range:{from:{beat:0},to:{beat:7}}}
  ]});
  assert.deepEqual(plan.layers[0].clips.map(row=>row.at),[2400,4000,20800,24000]);
  const upsampled=audio(509,i=>.2*Math.sin(i/7));
  upsampled.sampleRate=11025;
  const region=A.plan(reference,{short:upsampled},{layers:[{...settings.layers[0],assets:['short'],range:{from:{samples:19},to:{samples:8150}}}]});
  const take=A.render(region,score,{short:upsampled});
  assert(take.atmosphere.samples.slice(0,38).every(value=>value===0));
  assert(take.atmosphere.samples.slice(16300).every(value=>value===0));
});

test('comparison pins score gain and emits exact excerpt positions',()=>{
  const options={range:{from:1.9,to:4.81},levels:{targetRmsDb:-24,gapSeconds:.15},
    variants:[{id:'bare',muted:true},{id:'thin',layers:{water:{trimDb:-10},calls:{density:.33}}},{id:'full'}]};
  const take=A.audition(reference,score,assets,settings,options);
  assert.deepEqual(take.report.sourceRange,[15200,38480]);
  assert(take.report.clips.every(row=>row.gain===take.report.sharedGain));
  const playbackGain=take.report.sharedGain*take.report.headroom;
  assert(playbackGain>0);
  for (const i of [0,113,799,23279]) assert.equal(take.value.samples[2*i],score.samples[15200+i]*playbackGain);
  assert(take.report.variants[0].layers.every(row=>!row.clips.length));
  assert(take.report.variants[2].layers[1].clips.length>=take.report.variants[1].layers[1].clips.length);
  assert.throws(()=>A.audition(reference,score,assets,settings,{...options,variants:[{id:'bad',layers:{water:{density:0}}}]}),/layer/);
});

test('CLI plans from an existing mix and performed events, renders the saved plan and auditions it',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-atmosphere-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const file=name=>path.join(folder,name);
  const doc=(name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>execFileSync(process.execPath,[cli,'music','atmosphere',...args],{cwd:folder,encoding:'utf8'});
  fs.writeFileSync(file('score.wav'),ink.encodeWav(score,{encoding:'float64'}));
  for (const [id,pcm] of Object.entries(assets)) fs.writeFileSync(file(id+'.wav'),ink.encodeWav(pcm,{encoding:'float64'}));
  doc('performed.json',{events:reference.events});
  doc('recipe.json',{score:'score.wav',performance:'performed.json',map:reference.map,
    assets:{water:'water.wav',bird:'bird.wav',click:'click.wav'},atmosphere:settings});
  run('plan','recipe.json','--out','plan.json');
  const mixed=JSON.parse(run('render','recipe.json','plan.json','--out','mix'));
  assert.deepEqual(JSON.parse(fs.readFileSync(mixed.plan)),JSON.parse(fs.readFileSync(file('plan.json'))));
  assert.equal(ink.readWav(mixed.stems.bed).samples.length,n*2);
  doc('compare.json',{variants:[{id:'dry',muted:true},{id:'room'}],range:{from:{beat:1},to:{beat:7}}});
  const review=JSON.parse(run('audition','recipe.json','compare.json','--out','review'));
  assert.deepEqual(JSON.parse(fs.readFileSync(review.report)).sourceRange,[4000,28000]);
  doc('production.json',{arrangement:{score:{key:{root:'D4'},tempoMap:{tempo:120},harmonies:{d:{root:'D3',quality:'unison'}}},
    motifs:{phrase:{length:4,events:[{beat:0,duration:1,midi:62}]}},
    parts:{lead:{role:'lead',material:'phrase'}},sections:[{id:'cue',bars:1,harmony:'d'}]},
    patches:{tone:{type:'analog'}},tracks:{lead:{patch:'tone'}}});
  doc('from-score.json',{production:'production.json',productionOptions:{sampleRate:8000},
    assets:{bird:'bird.wav'},atmosphere:{layers:[{id:'bird',kind:'call',assets:['bird'],avoid:['lead']}]}});
  const automatic=JSON.parse(run('plan','from-score.json'));
  assert.equal(automatic.frames,16000);
  assert.equal(automatic.sampleRate,8000);
  assert(automatic.layers[0].windows[0][0]>4000);

});
