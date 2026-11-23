const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const K=require('..').load().KIT,P=K.procedural,A=K.music.production,rate=16000;
const bank=(name,seed=17)=>A.loadInstrumentPack(name,{sampleRate:rate,seed});
const score=(patch,notes)=>({arrangement:{
  score:{tempoMap:{tempo:120},key:{root:'C4'},endFade:0,harmonies:{c:{root:'C3',quality:'unison'}}},
  parts:{solo:{role:'lead'}},motifs:{},sections:[{id:'cue',bars:1,harmony:'c'}]},
  patches:{patch},tracks:{solo:{patch:'patch',gain:-11,clips:[{id:'line',beat:0,length:4,
    voices:[{id:'solo',notes:notes.map(([beat,duration,midi,velocity=.75,play],i)=>
      ({id:'note'+i,beat,duration,midi,velocity,...(play && {play})}))}]}]}}});
const power=(buffer,lo,hi)=>{
  const part=buffer.samples.subarray(Math.round(lo*buffer.sampleRate)*buffer.channels,Math.round(hi*buffer.sampleRate)*buffer.channels);
  return Math.sqrt(part.reduce((sum,x)=>sum+x*x,0)/part.length);
};
const take=({patches,assets,id},notes)=>A.render(score(patches[id],notes),assets,{sampleRate:rate,stems:true}).stems.solo;
const pad=(id,time,name,velocity=.8,articulation,duration)=>({id,time,pad:name,velocity,
  ...(articulation && {articulation}),...(duration && {duration})});
const kitHits=[
  pad('soft',0,'plate',.18),pad('middle',.42,'plate',.56),pad('hard',.87,'plate',.89),
  pad('choke',1.02,'plate',.48,'damp'),pad('scrape',1.32,'scrape',.74,undefined,.42),
  pad('scrape-cut',2,'scrape',.68,undefined,.8),pad('grab',2.27,'plate',.42,'damp'),
  pad('spring',2.4,'spring',.31,'ghost'),pad('last',2.62,'latch',.77,'flam')
];

test('flute and bass choose distinct quiet, repeating, directional and release gestures',()=>{
  assert.deepEqual(Object.keys(A.instrumentLibrary),['cinder-flute','rivet-box','copperline-bass']);
  const phrase=(a,b,c)=>[[.29,.4,a,.78],[.75,.38,a,.70],[1.18,.38,b,.85],[1.61,.39,c,.76],[2.96,.56,a,.32]];
  for (const [name,pitches,expected] of [
    ['cinder-flute',[69,74,72],['air','tongue','up','down','whisper','exhale']],
    ['copperline-bass',[33,38,36],['finger','rake','slide-up','slide-down','soft','lift']]
  ]) {
    const pack=bank(name),patch=pack.patches[name],production=score(patch,phrase(...pitches));
    const played=A.inspect(production,pack.assets).events.solo;
    assert.deepEqual(played.map(row=>row.performance.kind),['attack','repeat','legato','legato','attack']);
    assert.deepEqual(played.map(row=>row.play.articulation),expected.slice(0,5));
    assert.equal(played[0].performance.release,undefined);
    assert.equal(played[3].performance.release.articulation,expected[5]);
    assert(played[2].play.glide>.06);
    assert(A.inspectInstrumentGraph(patch,pack.assets).assets.length>=5);
    const strong=take(pack,[[.39,1.1,pitches[0],.82]]),quiet=take(pack,[[.39,1.1,pitches[0],.3]]);
    const deep=power(quiet,.25,.70),loud=power(strong,.25,.70);
    assert(loud>.01 && deep>.001 && deep<.65*loud,[name,deep,loud]);
    const off=A.render(production,pack.assets,{sampleRate:rate,stems:true}).stems.solo;
    const dry=structuredClone(production);
    dry.patches.patch.performance.rules=dry.patches.patch.performance.rules.filter(rule=>rule.when!=='release');
    const noOff=A.render(dry,pack.assets,{sampleRate:rate,stems:true}).stems.solo;
    assert.deepEqual(off.samples.slice(0,rate*2),noOff.samples.slice(0,rate*2),name);
    assert.notDeepEqual(off.samples.slice(rate*2),noOff.samples.slice(rate*2),name);
  }
});

test('prepared metal crossfades the real soft and hard takes, chokes and releases the scrape',()=>{
  const {kit,assets}=bank('rivet-box');
  const take=P.mediaGraph.sampleKit.render(kit,assets,kitHits,{sampleRate:rate,duration:3.1});
  const [soft,blend,hard,damp,slide,cut]=take.report.events;
  assert.deepEqual(soft.layers.map(row=>row.id),['felt']);
  assert.deepEqual(blend.layers.map(row=>row.id),['felt','bar']);
  assert(blend.layers.every(row=>Math.abs(row.weight-.5)<1e-6));
  assert.notEqual(soft.layers[0].take,blend.layers[0].take);
  assert.deepEqual(hard.layers.map(row=>row.id),['bar']);
  assert.equal(hard.chokeAt,damp.at);
  assert(slide.layers[0].release);
  assert(cut.chokeAt<cut.noteOff);
  assert(!cut.layers[0].release);
  assert(power(take.stems.scrape,1.78,1.84)>.001);
  const repeat=bank('rivet-box');
  const key=Object.keys(assets).find(name=>name.endsWith('bar-a'));
  assert.deepEqual(assets[key].samples,repeat.assets[key].samples);
  assert.notDeepEqual(assets[key].samples,bank('rivet-box',18).assets[key].samples);
});

test('CLI exports portable stock packs and renders the metal kit to aligned stems',t=>{
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-player-pack-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music','production',...args],{cwd,encoding:'utf8'}));
  const settings=path.join(cwd,'settings.json'),hits=path.join(cwd,'hits.json');
  fs.writeFileSync(settings,JSON.stringify({sampleRate:rate,seed:17}));
  fs.writeFileSync(hits,JSON.stringify({events:kitHits,options:{sampleRate:rate,duration:3.1}}));
  const result=run('instrument-pack','rivet-box',settings,'--out','box');
  const manifest=JSON.parse(fs.readFileSync(result.manifest));
  assert.equal(manifest.format,'ink-studio/instrument-pack');
  assert.equal(manifest.kit.pads.scrape.gated,true);
  const rendered=run('play-kit','box/instrument.json','hits.json','--out','print');
  assert(fs.existsSync(path.join(cwd,'print/stems/scrape.wav')));
  assert.equal(JSON.parse(fs.readFileSync(rendered.report)).events.length,kitHits.length);
});
