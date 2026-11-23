/* Run: node examples/music-production/cut-metal.cjs output-directory */
const assert=require('node:assert/strict');
const path=require('node:path');
const ink=require('../..'), kit=ink.load(), A=kit.KIT.procedural.mediaGraph, E=A.sampleEdit;
const {write,json}=require('../../cli/asset-files.js');
const WAV=require('../../cli/wav.js');
const folder=path.resolve(process.argv[2] ?? 'cut-metal');
const library=ink.openSampleLibrary(path.join(folder,'library'),{kit});
const sampleRate=32000, frame=seconds=>Math.round(seconds*sampleRate);
const hits=[
  [.145,'metal-soft',.64,-.18],[.82,'metal-hit',.89,.14],[1.49,'hat-closed',.43,-.21],
  [1.81,'metal-alt',.78,.21],[2.49,'snare-rim',.67,-.15]
];
const samples=new Float64Array(frame(3.08)*2);
for (const [time,name,gain,pan] of hits) {
  const wav=WAV.read(path.join(__dirname,'samples',name+'.wav'));
  assert.equal(wav.sampleRate,sampleRate);
  const onset=frame(time), stop=Math.min(wav.samples.length,samples.length/2-onset);
  for (let i=0;i<stop;i++) {
    const value=wav.samples[i]*gain*Math.min(1,(stop-i)/128);
    samples[(onset+i)*2]+=value*Math.sqrt((1-pan)/2);
    samples[(onset+i)*2+1]+=value*Math.sqrt((1+pan)/2);
  }
}
const input={sampleRate,channels:2,samples};
const stored=library.add(A.sampleCatalog.capture(input,{
  sample:{id:'metal-take',label:'Metal and rim take',material:'metal',articulation:'struck',
    tags:['brake drum','rim','hi-hat'],license:{id:'CC0-1.0',credit:'Versilian Studios recordings, arranged in Ink Studio',
      url:'https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'}},
  source:{kind:'file',name:'metal-take.wav',reference:'examples/music-production/samples/CREDITS.md'}
}));
const source=library.load(stored.entry.id).value;
const proposed=E.create(source,{source:{id:stored.entry.id,asset:stored.entry.asset},
  detect:{minGap:.17,sensitivity:2}});
const closest=time=>proposed.markers.reduce((best,row)=>
  Math.abs(row.at-frame(time))<Math.abs(best.at-frame(time)) ? row : best);
assert(proposed.markers.length>=4);
const originalOrigins=hits.filter((_,i)=>i!==2).map(hit=>closest(hit[0]));
assert.equal(new Set(originalOrigins.map(row=>row.id)).size,4);
const [soft,main,answer,rim]=originalOrigins, hatAt=frame(hits[2][0])-32;
const attack=main.at-48, body=attack+frame(.015), tail=attack+frame(.117);
const operations=[
  ...proposed.markers.filter(row=>!originalOrigins.includes(row) || row.id===answer.id)
    .map(row=>({op:'delete',id:row.id})),
  {op:'move',id:main.id,at:attack},
  {op:'add',id:'hat-manual',at:hatAt,label:'Hi-hat'},
  {op:'splitHit',id:main.id,body,tail,bodyId:'metal-body',tailId:'metal-tail'}
];
const corrected=E.edit(proposed,operations);
const exact=(first,end,sign)=>{
  let found=first;
  for (let at=first+1;at<end;at++) if (sign*source.samples[at*2]>sign*source.samples[found*2]) found=at;
  return found;
};
const leftEdge=exact(attack+frame(.028),attack+frame(.077),1);
const rightEdge=exact(answer.at+frame(.032),answer.at+frame(.060),-1);
const editOps=[
  ...operations,
  {op:'assemble',clips:[
    {id:'opening',from:soft.at-24,to:soft.at+frame(.27)},
    {id:'lift',slice:'metal-tail',reverse:true},
    {id:'ring',from:attack,to:attack+frame(.13)},
    {id:'answer',from:answer.at-24,to:rightEdge+1,reverse:true},
    {id:'hat',slice:'hat-manual'},
    {id:'rim',from:rim.at-24,to:rim.at+frame(.24)},
    {id:'last',from:body,to:body+frame(.3)}
  ]},
  {op:'trim',id:'lift',head:frame(.16),tail:frame(.018)},
  {op:'trim',id:'ring',tail:attack+frame(.13)-(leftEdge+1)},
  {op:'trim',id:'hat',tail:rim.at-hatAt-frame(.155)},
  {op:'slip',id:'rim',frames:22},
  {op:'reverse',id:'last'},
  {op:'crossfade',left:'lift',right:'ring',frames:frame(.015)},
  {op:'crossfade',left:'ring',right:'answer',frames:frame(.02)},
  {op:'crossfade',left:'answer',right:'hat',frames:frame(.006)}
];
const edited=E.edit(proposed,editOps), run=E.render(source,edited);
const join={left:'ring',right:'answer',before:frame(.19),after:frame(.21)};
const review=E.audition(source,edited,join);
const before=E.audition(source,proposed,{marker:main.id,before:frame(.09),after:frame(.24)});
const after=E.audition(source,corrected,{marker:main.id,before:frame(.09),after:frame(.24)});
const writeAudio=(name,value)=>write(path.join(folder,name),WAV.encode(value,{encoding:'float64'}));
for (const [name,value] of Object.entries({'metal-take.wav':source,'cut-metal.wav':run.value,
  'join-crossfade.wav':review.value,'join-hard-cut.wav':review.hardCut,
  'marker-proposed.wav':before.value,'marker-moved.wav':after.value}))
  writeAudio(name,value);
for (const [name,value] of Object.entries({'proposed.json':proposed,'edit.json':edited,'operations.json':editOps,
  'join.json':join,'render-report.json':run.report,'join-report.json':review.report}))
  json(path.join(folder,name),value);
assert.deepEqual(library.load(stored.entry.id).value.samples,source.samples);
console.log(JSON.stringify({proposals:proposed.markers.length,original:stored.entry.asset,
  clips:run.report.clips.length,crossfade:review.report.overlap/sampleRate}));
