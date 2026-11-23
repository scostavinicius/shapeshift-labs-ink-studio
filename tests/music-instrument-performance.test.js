const test=require('node:test'), assert=require('node:assert/strict');
const K=require('..').load().KIT, A=K.music.production, rate=8000;
const audio=(frames,signal)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:frames},(_,i)=>signal(i))});
const zone=(name,articulation)=>({samples:[name],root:60,oneShot:false,...(articulation && {articulation})});
const cue=(parts,motifs)=>({score:{tempoMap:{tempo:120},key:{root:'C4'},endFade:0,harmonies:{c:{root:'C4',quality:'unison'}}},
  parts,motifs,sections:[{id:'main',bars:1,harmony:'c'}]});
const motif=(rows)=>({length:4,events:rows.map(([beat,duration,midi,velocity=.8,play],i)=>
  ({id:'n'+i,beat,duration,midi,velocity,...(play && {play})}))});
const rms=(array,from,to)=>Math.sqrt(array.slice(from*2,to*2).reduce((sum,x)=>sum+x*x,0)/((to-from)*2));

test('sample phrasing compensates its attack, chooses directional transitions and releases at key-up',()=>{
  const body=audio(8000,i=>.25*Math.min(1,i/480)*Math.sin(i*Math.PI*.052));
  const pickups=audio(6400,i=>.25*Math.sin(i*Math.PI*.13));
  const release=audio(800,i=>.65*(1-i/800)*Math.sin(i*Math.PI*.29));
  const assets={body,pickups,release};
  const phrasing={connect:{gap:.075,interval:8,fade:.02},repeatGap:.16,rules:[
    {when:'attack',attackLead:.06},
    {when:'repeat',articulation:'tap'},
    {when:'legato',interval:[1,8],articulation:'up',attackLead:.028},
    {when:'legato',interval:[-8,-1],articulation:'down',attackLead:.015},
    {when:'release',articulation:'key-off',level:.9}
  ]};
  const source={arrangement:cue({lead:{role:'lead',material:'line'}},{line:motif([
    [.5,.4,60],[.96,.38,60],[1.36,.38,64],[1.76,.4,62],[3,.48,67]
  ])}),patches:{voice:{type:'sample',env:{attack:.003,release:.012},zones:[
    zone('body'),zone('pickups','tap'),zone('pickups','up'),zone('body','down'),
    {samples:['release'],articulation:'key-off'}],performance:phrasing}},tracks:{lead:{patch:'voice',gain:-12}}};
  const played=A.inspect(source,assets).events.lead;
  assert.deepEqual(played.map(note=>note.performance.kind),['attack','repeat','legato','legato','attack']);
  assert.deepEqual(played.map(note=>note.play.articulation),[undefined,'tap','up','down',undefined]);
  assert.deepEqual(played.map(note=>note.performance.interval),[null,0,4,-2,5]);
  assert.deepEqual(played.map(note=>Boolean(note.performance.release)),[false,false,false,true,true]);
  assert.equal(played[0].time,.25);
  assert.equal(played[0].start,.19);
  assert.equal(played[2].start,.652);
  assert.equal(played[1].choke,.672);
  assert.equal(played[1].chokeFade,.02);
  const {performance,...raw}=source.patches.voice;
  const plain={...source,patches:{voice:raw}};
  const flat=A.render(plain,assets,{sampleRate:rate}).value.samples;
  const shaped=A.render(source,assets,{sampleRate:rate}).value.samples;
  assert.equal(rms(flat,1640,1980),0);
  assert(rms(shaped,1640,1980)>.004);
  // The final sample release rings after the normal amp envelope is over.
  assert(rms(shaped,14200,14400)>.008);
  assert.equal(rms(flat,14200,14400),0);
  const crop=A.render(source,assets,{sampleRate:rate,start:.2,end:.4}).value.samples;
  assert.deepEqual(crop,shaped.slice(3200,6400));
});

test('note-level curves change pitch and gain independently and presets render normally',()=>{
  const lead=motif([[.25,1.5,60,1,{curves:{pitchCents:[[0,1200],[1,1200]],gainDb:[[0,-20],[1,0]]}}]]);
  const source={arrangement:cue({lead:{role:'lead',material:'line'}},{line:lead}),patches:{
    voice:{type:'analog',body:0,width:0,grain:0,env:{attack:.003,decay:.1,sustain:1,release:.07}}
  },tracks:{lead:{patch:'voice',gain:-12}}};
  const shaped=A.render(source,{}, {sampleRate:rate}).value.samples;
  const crossings=(a,from,to)=>{
    let count=0;
    for (let i=from+1;i<to;i++) if (a[2*i]>0 && a[2*(i-1)]<=0) count++;
    return count;
  };
  assert(Math.abs(crossings(shaped,2400,4000)-104.65)<2);
  assert(rms(shaped,4500,5000)>rms(shaped,1500,2000)*2);
  const excerpt=A.render(source,{}, {sampleRate:rate,start:.25,end:.5}).value.samples;
  assert.deepEqual(excerpt,shaped.slice(4000,8000));
  for (const [name,voice] of Object.entries(A.instrumentPresets)) {
    const rendered=A.render({...source,patches:{voice}}, {},{sampleRate:rate});
    assert(rendered.report.rms>.004,name);
  }
  const bad=motif([[.5,.6,60,.7,{curves:{pitchCents:[[.5,2],[.2,0]]}}]]);
  assert.throws(()=>A.compile({...source,arrangement:cue({lead:{role:'lead',material:'line'}},{line:bad})}),/curve point/);
});

test('pocket audition isolates written attacks from linked timing, keeps ghost alternates and chokes',()=>{
  const parts={kick:{role:'percussion',material:'foot'},bass:{role:'bass',material:'sub'},
    hat:{role:'percussion',material:'ticks'}};
  const foot=motif([[0,.1,36],[1,.13,36],[2,.13,36],[3,.13,36]]),
    sub=motif([[0,.2,36],[1,.21,36],[2,.22,36],[3,.21,36]]),
    ticks=motif([[0,.1,36,.7,{articulation:'open'}],[1,.1,36,.25,{articulation:'ghost'}],
      [2,.1,36,.8,{articulation:'closed'}],[3,.1,36,.7,{articulation:'open'}]]);
  const source={arrangement:cue(parts,{foot,sub,ticks}),patches:{kick:{type:'drum',kind:'kick'},bass:{type:'analog'},
    hats:{type:'sample',zones:[{samples:['a','b'],articulation:'open'},
      {samples:['b'],articulation:'ghost'},{samples:['b'],articulation:'closed'}],performance:{}}},
    tracks:{kick:{patch:'kick'},bass:{patch:'bass'},hat:{patch:'hats',choke:'cymbals'}}};
  const strike=audio(7200,i=>.16*Math.sin(i*.4)), assets={a:strike,b:strike};
  const rhythm={edits:[{part:'kick',scope:'section',section:'main',
    adopt:motif([[0,.1,36],[.75,.12,36],[2,.13,36],[3,.13,36]])}]};
  const groove={template:{format:'ink-studio/performance-groove',version:1,id:'late',step:.25,length:4,lanes:{
    footprint:[{slot:4,offset:.055,accent:.6,length:.45},{slot:8,offset:-.026,accent:1.4}]}},
    anchors:[0],tracks:{kick:{lane:'footprint'}},links:[
      {leader:'kick',followers:['bass'],offset:{unit:'seconds',points:[[0,.024],[2,-.016],[4,.008]]}},
      {leader:'kick',followers:['hat'],offset:{unit:'beats',points:[[0,-.06],[4,.10]]}}
    ]};
  const plan=A.planPocket(source,{rhythm,groove},assets);
  assert.deepEqual(plan.variants.map(row=>row.id),['reference','written','timing','combined']);
  const [,written,timing,combined]=plan.variants.map(row=>A.inspect(A.revise(source,row,assets),assets).events);
  const flat=A.inspect(source,assets).events, addresses=rows=>rows.map(n=>[n.beat,n.midi,n.velocity]);
  for (const name of Object.keys(flat)) {
    assert.deepEqual(addresses(timing[name]),addresses(flat[name]));
    assert.deepEqual(addresses(combined[name]),addresses(written[name]));
  }
  assert.equal(written.kick[1].beat,.75);
  assert.equal(timing.kick[1].time,.5275);
  assert.equal(timing.bass[2].time,.971);
  assert.equal(timing.hat[2].time,.997);
  assert.equal(timing.hat[0].choke,timing.hat[1].time);
  assert.deepEqual(timing.hat.map(note=>note.roundRobin),[0,0,0,1]);
  assert.equal(plan.report.timing.bass.moved,3);
});
