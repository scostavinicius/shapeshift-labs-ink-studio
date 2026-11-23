const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), P=KIT.procedural,A=KIT.music.production, F=A.foregroundMix;
const WAV=require('../cli/wav'), rate=16000;
const playable={
  type:'graph',tail:.88,output:'out',nodes:{
    body:{type:'oscillator',wave:'sine'},
    shape:{type:'envelope',env:{attack:.008,decay:.15,sustain:.84,release:.88}},
    out:{type:'gain',input:'body',amount:{base:0,from:{shape:.48}}}
  }
};
const seq=(name,rows)=>({patch:'tone',gain:-11,clips:[{id:name,beat:0,length:8,
  voices:[{id:'main',notes:rows.map(([beat,duration,midi,velocity],i)=>({id:'n'+i,beat,duration,midi,velocity}))}]}]});
function source() {
  return {seed:287,arrangement:{score:{key:{root:'C4'},tempoMap:{tempo:120,changes:[{beat:4,tempo:100}]},
    harmonies:{home:{root:'C4',quality:'unison'}},endFade:0},
    motifs:{},parts:{lead:{role:'lead'},reply:{role:'pad'},bass:{role:'bass'}},
    sections:[{id:'cue',bars:2,harmony:'home'}]},
  patches:{tone:playable}, tracks:{
    lead:seq('call',[[.1,.3,79,.84],[1.12,.36,79,.81],[2.15,.41,81,.67],[4,.46,79,.75],[5.01,.35,81,.72],[6,.3,76,.6]]),
    reply:seq('answer',[[.51,.22,79,.80],[1.08,.12,79,.81],[2.3,.41,81,.75],[4,.46,79,.83],[5.06,.35,81,.82],[6,.3,76,.66]]),
    bass:seq('floor',[[0,.21,41,.73],[1,.3,43,.68],[4,.50,40,.63],[5.12,.35,42,.64]])
  },room:{gain:-5,decay:.35,size:.8,damping:.4}};
}

const moments=[{id:'call',from:1,to:3,parts:['lead'],protect:['bass']},
  {id:'reply',from:4,to:6,parts:['reply'],protect:['bass']}];
const settings={moments,sampleRate:rate,move:{depthSend:.51,depthHz:540,tailSeconds:.075}};
const rms=(samples,start,end)=>Math.sqrt(samples.slice(start*2,end*2).reduce((sum,x)=>sum+x*x,0)/(2*(end-start)));
const pair=(row,id)=>row.moments.find(moment=>moment.id===id);
const frames=seconds=>Math.round(seconds*rate);
const render=score=>A.render(score,{}, {sampleRate:rate,stems:true});

test('foreground follows the score and the four takes target different rivals after the handoff',()=>{
  const original=source(), result=F.audition(original,settings);
  assert.deepEqual(result.production.cueMap.foreground,moments);
  assert.deepEqual(render(original).value.samples,render(result.production).value.samples);
  const {moments:map}=result.report;
  assert.deepEqual(map.map(row=>[row.id,row.selected.part]),[['call','reply'],['reply','lead']]);
  const {report,key,audio}=result.comparison;
  assert.deepEqual(report.takes.map(row=>row.id),['reference','ride','short-tail','depth','arrangement-cut']);
  assert.equal(new Set(Object.values(audio).map(pcm=>pcm.samples.length)).size,1);
  assert.equal(new Set(report.takes.map(row=>row.previewLufs)).size,1);
  const originalReport=report.takes[0], ride=report.takes[1], depth=report.takes[3];
  for (const {id} of moments) {
    const a=pair(originalReport,id), b=pair(ride,id);
    assert.equal(a.foregroundDbFS,b.foregroundDbFS);
    assert(b.foregroundOverRivalsDb>a.foregroundOverRivalsDb+1.9);
    assert(pair(depth,id).roomDbFS!==null);
  }
  const {production}=A.critique.applyEdit(result.production,key,
    {token:key.token,take:'arrangement-cut',reason:'Keep the answers distinct.'});
  const {events,cueMap}=A.inspect(production);
  assert(events.lead.some(note=>note.beat===1.12));
  assert(!events.lead.some(note=>note.beat===4));
  assert(events.reply.some(note=>note.beat===4));
  assert(!events.reply.some(note=>note.beat===1.08));
  assert.deepEqual(cueMap.foreground.map(row=>row.id),['call','reply']);
});

test('tail edits affect already-ringing voices and preserve the hold and unrelated stems',()=>{
  const score=source(), base=render(score);
  // The earlier reply ended its gate at beat .73, before this moment begins.
  const shortened=A.revise(score,{cueMap:{tail:[{parts:['reply'],from:.88,to:1,seconds:.045,fadeSeconds:.014}]}});
  const cooked=render(shortened);
  const raw=base.stems.reply.samples, cut=cooked.stems.reply.samples;
  assert(raw.slice(0,2*frames(.44)).every((x,i)=>x===cut[i]));
  assert(rms(cut,frames(.49),frames(.52))<rms(raw,frames(.49),frames(.52))*.28);
  assert.deepEqual(cooked.stems.lead.samples,base.stems.lead.samples);
  assert.deepEqual(A.inspect(score).events,A.inspect(shortened).events);
  const part=A.renderCompiled(A.compile(shortened),{start:.51,end:.68,sampleRate:rate,stems:true},false,A.compile(shortened).end);
  assert.deepEqual(part.stems.reply.samples,cut.slice(frames(.51)*2,frames(.68)*2));
});

test('depth lowers direct brightness and raises a source-specific send through the production and session',()=>{
  const score=source(), base=render(score);
  const modified=A.revise(score,{cueMap:{depth:[{parts:['reply'],from:1,to:2.5,cutoffHz:230,send:.58,fadeSeconds:.035}]}});
  const printed=render(modified), first=frames(.57), last=frames(.77);
  assert(rms(printed.stems.reply.samples,first,last)<rms(base.stems.reply.samples,first,last)*.5);
  assert(rms(printed.stems.room.samples,first,last)>.001);
  assert(base.stems.room.samples.every(sample=>sample===0));
  assert.deepEqual(printed.stems.lead.samples,base.stems.lead.samples);
  const deck=P.mediaGraph.musicSession.create(), session={format:'ink-studio/music-edit-session',version:1,id:'depth',
    sampleRate:rate,production:modified};
  const live=deck.prepareTransport(session), sampled=live.media.reply.materials.reference.value;
  assert(Math.abs(sampled.roomLevel[frames(.68)]-.58)<1e-7);
  assert(sampled.roomSpec);
  const desk=deck.render(session);
  assert(rms(desk.value.samples,first,last)>0);
});

test('quiet or protected foreground maps retain the original and measure without inventing moves',()=>{
  const original=source();
  const result=F.audition(original,{sampleRate:rate,moments:[{id:'quiet',from:0,to:.08,parts:['lead'],protect:['reply','bass']}]});
  assert.equal(result.report.moments[0].selected,null);
  assert.deepEqual(Object.keys(result.comparison.audio),['reference']);
  assert.throws(()=>F.plan(original,{moments:[...moments,{...moments[0],id:'overlap',from:2.9,to:3.1}]}),
    /foreground windows overlap/);
  const protectedCue={...original,arrangement:{...original.arrangement,pins:['part:reply']}};
  assert.equal(F.plan(protectedCue,{...settings,select:['call']}).report.moments[0].selected,null);
});

test('CLI saves a foreground audition and applies one native comparison without losing the authored marks',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-foreground-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'music',...args],
    {cwd:dir,encoding:'utf8'}));
  save('cue.json',{production:source(),options:{sampleRate:rate}});
  save('settings.json',settings);
  const audition=cli('critique','foreground','cue.json','settings.json','--out','audition');
  assert.equal(WAV.read(path.join(dir,'audition','comparison',audition.files.depth)).sampleRate,rate);
  save('decision.json',{token:audition.token,take:'depth',reason:'Keep the chord farther behind the phrase.'});
  const kept=cli('critique','apply',audition.production,audition.key,'decision.json','--out','kept');
  const {production}=JSON.parse(fs.readFileSync(kept.production));
  assert.equal(production.cueMap.depth.length,2);
  assert.deepEqual(production.cueMap.foreground,moments);
});
