/* Build a searchable bank, audition it, and arrange its kept samples. */
const path=require('node:path');
const ink=require('../..');
const {json,write}=require('../../cli/asset-files');
// Optional second argument is a WAV conversion of Wikimedia Commons' Breathing man.
const [directory='gesture-bank-workshop',recording]=process.argv.slice(2);
const at=name=>path.resolve(directory,name);
const kit=ink.load(),A=kit.KIT.procedural.mediaGraph;
const bank=ink.openGestureBank(at('library'),{kit}),library=ink.openSampleLibrary(at('library'),{kit});
const rate=32000, session={id:'foundry',label:'Foundry / exciter bench'};
const save=(name,value)=>write(at(name),ink.encodeWav(value,{encoding:'pcm24'}));

const breath=(pitchStart,pitchEnd,roughTail,voice,throat=1060)=>({
  model:'breath',parameters:{pitchStart,pitchEnd,roughTail,voice,throat}
});
const models={
  lift:['Rising exhale',.52,23,.82,breath(146,187,.90,.8)],
  relay:['Second rising exhale',.65,77,.65,breath(123,167,.90,.82,880)],
  clear:['Clear upward tone',.47,23,0,breath(133,183,.04,.96)],
  fall:['Falling exhale',.55,91,.46,breath(204,141,1,.86)],
  long:['Long swell',1.52,314,0,breath(120,172,.98,.83)],
  air:['Unvoiced breath',.54,60,.36,breath(140,185,0,0)],
  scrape:['Friction scrape',.81,588,.7,{model:'scrape',parameters:{body:345,speed:.48,pressure:.74,grain:.72}}],
  chalk:['Finer scrape',.51,484,0,{model:'scrape',parameters:{body:670,speed:.73,pressure:.62,grain:.83}}],
  metal:['Struck metal',1.16,102,.75,{model:'metal',parameters:{body:321,hardness:.60,decay:.99,strike:.23}}],
  rib:['Low metal rib',1.60,221,.7,{model:'metal',parameters:{body:87,hardness:.45,decay:1.37,strike:.31}}]
};
for (const [id,[label,duration,seed,room,model]] of Object.entries(models)) {
  bank.generate({session,id,label,samplePrefix:'src-'+id,
    material:['scrape','metal'].includes(model.model) ? 'steel' : 'air',
    tags:['exciter-study'],synthesis:{...model,duration,seed,room,sampleRate:rate}});
}

let field;
if (recording) {
  const value=ink.readWav(recording);
  library.add(A.sampleCatalog.capture(value,{
    sample:{id:'practical-breath',label:'Breathing man',material:'voice',articulation:'breath',tags:['field-recording'],
      license:{id:'Public domain',credit:'hugh / Wikimedia Commons',url:'https://commons.wikimedia.org/wiki/File:Breathing_man.ogg'}},
    source:{kind:'file',name:'Breathing man',reference:'https://commons.wikimedia.org/wiki/File:Breathing_man.ogg'}
  }));
  const frames=value.samples.length/value.channels;
  const width=Math.min(frames,Math.round(.68*value.sampleRate)), stride=Math.round(width*.68);
  const windows=[];
  for (let from=0;from+width<=frames;from+=stride) {
    let power=0;
    for (let i=from*value.channels;i<(from+width)*value.channels;i++) power+=value.samples[i]**2;
    windows.push({from,power});
  }
  windows.sort((a,b)=>b.power-a.power);
  const selected=[];
  for (const row of windows) {
    if (row.power>0 && selected.every(other=>Math.abs(other.from-row.from)>=width)) selected.push(row);
    if (selected.length===4) break;
  }
  const result=bank.ingest({session:{id:'field',label:'Breathing man / field recording'},
    take:{id:'continuous',label:'Continuous recording',perspectives:{field:{sample:'practical-breath'}}},
    slices:selected.map(({from},i)=>({id:'breath-'+(i+1),label:'Recorded breath '+(i+1),fromSample:from,toSample:from+width,
      analyze:'field',material:'voice',articulation:'breath',tags:['field-recording']}))});
  field={duration:frames/value.sampleRate,id:result.slices[0]?.id};
}

const query='a short breath with a rising pitch and a rough tail';
const search=bank.search({phrase:query,limit:3}), winner=search.items[0], reelOptions={sampleRate:rate,targetRmsDb:-20,gapSeconds:.75};
const pick=winner.perspectives.includes('room') ? 'room' : winner.analyze;
const clips=[
  ...(field?.id ? [{id:field.id,perspective:'field'}] : []),
  ...search.items.map(row=>({id:row.id,perspective:row.analyze})),
  {id:winner.id,perspective:winner.analyze},{id:winner.id,perspective:pick}
];
const shortlist=bank.audition(clips,reelOptions);
save('search.wav',shortlist.value);
json(at('shortlist.json'),{clips,options:reelOptions});
json(at('search.json'),search);
const kept={id:winner.id,perspective:pick,sample:{id:'chosen-breath',label:winner.label+' / '+pick}};
bank.keep(kept.id,kept.perspective,kept.sample);
json(at('keep.json'),kept);

const modelIds=['lift','scrape','metal'], demo=(id,perspective='direct')=>({id:'foundry/'+id+'/gesture',perspective});
const modelClips=modelIds.map(id=>demo(id));
const modelsReel=bank.audition(modelClips,{...reelOptions,gapSeconds:.54});
save('models.wav',modelsReel.value);
const sources={voice:'chosen-breath'};
for (const [name,id,perspective] of [
  ['second','relay','direct'],['iron','rib','room'],['plate','metal','direct'],['drag','scrape','direct'],['fleck','chalk','direct']
]) {
  const sample='kept-'+name;
  bank.keep(demo(id).id,perspective,{id:sample});
  sources[name]=sample;
}
const layer=(id,takes)=>({id,takes:takes.map(take=>typeof take==='string' ? {asset:take} : take)});
const definition={
  id:'foundry-kit',
  buses:{wall:{gain:-8,pan:.28,inserts:[{type:'lowpass',hz:1900},{type:'delay',seconds:.327,feedback:.46,mix:1}]}},
  pads:{
    breath:{gain:-5,pan:-.13,articulations:{default:[layer('air',['voice',{asset:'second',gain:-1}])]},
      inserts:[{type:'highpass',hz:78}],sends:{wall:.76}},
    friction:{gain:-13,pan:.32,gated:true,release:.1,articulations:{default:[layer('stones',['drag','fleck'])]},
      inserts:[{type:'highpass',hz:191}],sends:{wall:.52}},
    bell:{gain:-5,pan:.16,articulations:{default:[layer('shell',['plate'])]},sends:{wall:.65}},
    rib:{gain:-2,pan:-.065,articulations:{default:[layer('body',['iron'])]},
      inserts:[{type:'lowpass',hz:880},{type:'drive',amount:1.8,mix:.32}],sends:{wall:.36}}
  }
};
const parts={
  breath:[[.18,.74,-300,-.21],[1.58,.62,450,.26],[2.58,.42,-550,-.26],[4.02,.74,0,.08],
    [4.72,.52,700,.32],[6.44,.82,-300,-.31],[7.55,.74,400,.19],[9.02,.64,-570,-.17],[10.87,.85,-800,.02]],
  friction:[[.82,.57,-520,.41,.36],[2.15,.44,210,-.12,.18],[3.23,.64,-550,.47,.48],[5.26,.61,-810,.26,.42],
    [5.44,.38,320,-.3,.18],[6.91,.48,110,.29,.19],[8.63,.60,-429,.37,.40],[10.29,.74,-620,-.35,.64]],
  bell:[[1.04,.65,0,.29],[2.72,.29,700,-.28],[3.75,.70,-100,.36],[4.98,.68,500,-.27],[6.13,.63,300,.29],
    [6.88,.35,800,.38],[7.96,.72,0,-.30],[9.63,.56,-400,.30],[11.77,.66,-900,-.14]],
  rib:[[.03,.85,0],[1.96,.60,-200],[3.11,.76,-500],[3.95,.87,-100],[5.22,.77,0],[5.98,.70,200],
    [7.52,.78,-500],[8.56,.79,-200],[10.15,.91,0],[11.38,.61,-500]]
};
const events=Object.entries(parts).flatMap(([pad,rows])=>rows.map(([time,velocity,tune,pan,duration],i)=>({
  id:pad+'-'+i,pad,time,velocity,play:{tune,...(pan!==undefined && {pan})},...(duration!==undefined && {duration})
})));
const options={sampleRate:rate,duration:13.6}, assets=Object.fromEntries(Object.entries(sources)
  .map(([name,id])=>[name,library.load(id).value]));
const piece=A.sampleKit.render(definition,assets,events,options);
save('foundry.wav',piece.value);
json(at('kit.json'),{kit:definition,assets:Object.fromEntries(Object.entries(sources).map(([asset,id])=>[asset,{sample:id}]))});
json(at('performance.json'),{events,options});
json(at('demo.json'),{query,search,field,winner:winner.id,kept,
  shortlist:shortlist.report,models:modelsReel.report,piece:piece.report});
console.log(at('demo.json'));
