const test=require('node:test'), assert=require('node:assert/strict');
const P=require('..').load().KIT.procedural, A=P.mediaGraph, J=A.timbreComposition;
const rate=24000;
function tone() {
  let phase=0;
  return {sampleRate:rate,channels:1,samples:Float64Array.from({length:rate},(_,i)=>{
    const t=i/rate;
    const rise=t<.36 ? 540 : t<.58 ? 880 : 990;
    phase+=2*Math.PI*rise/rate;
    const up=Math.min(1,Math.max(0,(t-.06)*80)), down=Math.min(1,Math.max(0,(.86-t)*6));
    const tick=(t>.37 && t<.387 ? .28*Math.sin(i*.61)*Math.exp(-(t-.37)*172) : 0);
    return .32*up*down*(Math.sin(phase)+.08*Math.sin(phase*2))+tick;
  })};
}
function impacts() {
  let n=371;
  return {sampleRate:rate,channels:1,samples:Float64Array.from({length:rate},(_,i)=>{
    const t=i/rate, local=t-(t>=.58 ? .58 : t>=.31 ? .31 : .10);
    n=(Math.imul(n,1664525)+1013904223)>>>0;
    return local>=0 ? .9*(n/2147483648-1)*Math.exp(-local*53) : 0;
  })};
}
const source=tone(), analysis={id:'call',tailSample:16000,pitch:{lowHz:350,highHz:1800}};
const projection={beats:2,tonic:'A4',scale:'minor',tailBeats:.8};
const backing={sampleRate:rate,channels:1,samples:new Float64Array(rate*3)};

test('recording contour, attack coordinates and decay project independently with stable identities',()=>{
  const gesture=J.extract(source,analysis);
  assert.deepEqual(gesture,J.extract(source,analysis));
  assert(gesture.pitchTrack.length>20);
  assert(gesture.attacks.length>=2);
  assert(gesture.pitchTrack.at(-3).midi-gesture.pitchTrack[3].midi>8);
  const notation=J.project(JSON.parse(JSON.stringify(gesture)),projection);
  const notes=notation.motifs.contour.events;
  assert(notes.length>=2);
  assert(notes.at(-1).midi>notes[0].midi);
  assert(notes.every(row=>[0,2,3,5,7,8,10].includes(((row.midi-69)%12+12)%12) && row.play.curves.gainDb.length===4));
  assert.equal(notation.tail.fromSample,16000);
  assert.deepEqual(notation.motifs.attacks.events.map(row=>row.id),notation.attacks.map(row=>row.id));
  const noisy=J.extract(impacts(),{id:'percussion',confidence:.95});
  assert.equal(J.project(noisy).motifs.contour,null);
  assert(J.project(noisy).motifs.attacks.events.length>=3);
  const ranking=J.compare(gesture,[noisy,{...gesture,id:'same'}]);
  assert.deepEqual(ranking[0],{id:'same',distance:0,phases:{attack:0,body:0,tail:0}});
  assert(ranking[1].distance>0);
});

test('sample-to-motif derives editable attacks and stretches just the measured tail',()=>{
  const plan=A.sampleMotif.plan(source,backing,{derive:{analysis,projection}});
  const [raw,lead,accent,texture]=plan.roles;
  assert.equal(lead.performance.events.length,plan.gesture.motifs.contour.events.length);
  assert.deepEqual(accent.performance.events.map(row=>row.play.startSample),plan.gesture.attacks.map(row=>row.sample));
  assert.equal(texture.transform.range.fromSample,16000);
  const reel=A.sampleMotif.audition(plan,source,backing,{roles:['raw','lead','accent','texture']});
  assert.deepEqual(reel.report.gesture,plan.gesture);
  assert(reel.report.clips.every(row=>row.rms>0));
  const bare=impacts();
  const unvoiced=A.sampleMotif.plan(bare,backing,{derive:{analysis:{confidence:.95}}});
  assert.equal(unvoiced.roles[1].performance.events.length,0);
  assert(A.sampleMotif.render(unvoiced,bare,backing,'lead').stem.samples.every(n=>n===0));
  assert.equal(A.sampleMotif.render(plan,source,backing,raw.id).value.sampleRate,rate);
});

test('orchestration holds contour and raw attacks while routing the tail and retaining editable takes',()=>{
  const production={arrangement:{score:{tempoMap:{tempo:96},key:{root:'A4',mode:'minor'},
    harmonies:{a:{root:'A3',quality:'unison'}}},motifs:{},parts:{lead:{role:'lead'},
      drum:{role:'percussion'},wash:{role:'pad'}},sections:[{id:'cue',bars:2,harmony:'a'}]},
    patches:{voice:{type:'analog'},strike:{type:'drum',kind:'rim'},air:{type:'fm'}},
    tracks:{lead:{patch:'voice',gain:-16},drum:{patch:'strike',gain:-14},wash:{patch:'air',gain:-19}}};
  const routes={contour:{part:'lead'},attacks:{part:'drum',material:'source'},tail:{part:'wash'}};
  const settings={analysis,projection,placements:[{id:'opening',section:'cue',beat:.25},
    {id:'return',section:'cue',beat:4.25,transpose:12}],takes:[
    {id:'coast',palette:'coastal',...routes,tail:{part:'wash',material:'source'}},
    {id:'metal',palette:'metal-breath',...routes}]};
  const take=J.audition(source,production,settings,{}, {start:0,end:5,sampleRate:16000});
  assert.equal(take.takes.length,2);
  assert.equal(take.report.takes[0].lufs,take.report.takes[1].lufs);
  const [coast,metal]=take.takes;
  const paths=row=>P.musicProduction.inspect(row.production,take.plan.assets).events.lead.map(note=>[note.beat,note.midi]);
  assert.deepEqual(paths(coast),paths(metal));
  assert.notDeepEqual(coast.value.samples,metal.value.samples);
  const wash=coast.production.patches[coast.production.tracks.wash.patch].zones[0];
  assert.equal(wash.root,take.plan.projection.motifs.tail.events[0].midi);
  assert(coast.report.stems.wash.rms>.001);
  const {id,range}=take.plan.projection.attacks[0];
  const key=Object.keys(take.plan.assets).find(name=>name.endsWith('-'+id));
  assert.deepEqual(take.plan.assets[key].samples,source.samples.slice(range.fromSample,range.toSample));
  assert(take.plan.report.takes[0].appearances.every(row=>row.tracks[0].notes.length>0));
  assert(take.plan.report.takes[1].appearances.every(row=>row.tracks[0].notes.length>0));
  assert.equal(A.timbrePalettes.load('broken-beat',{sampleRate:8000}).patches.attacks.type,'sample');
});
