const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), kit=ink.load(), A=kit.KIT.procedural.mediaGraph;
const {perform,capture,edit}=A.padPattern;
const rate=8000, options={sampleRate:rate};
const step=(id,beat,extra)=>({id,beat,pad:'hat',...extra});
const rational=(numerator,denominator)=>({numerator,denominator});
const mono=(n,signal)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:n},(_,i)=>signal(i))});
const at=(audio,index,ch=0)=>audio.samples[index*2+ch];

test('pad programs keep beat-exact rolls, named replace/add fills, and stable condition decisions',()=>{
  const pattern={id:'quay',length:4,seed:22,steps:[
    step('start',0),step('odd',1,{when:{every:2,phase:1}}),step('never',.5,{when:{chance:0}}),
    step('chance',2,{when:{chance:.45}}),step('anticipate',1.75,{when:{fill:true}}),
    step('roll',2.5,{gate:.25,velocity:.8,offset:-.006,roll:{
      count:4,spacing:rational(1,4),velocity:[.25,1],tune:[0,-300]
    }})
  ],fills:[
    {id:'cut',from:3,to:4,steps:[step('rim',3.5)]},
    {id:'overlay',from:3,to:4,mode:'add',steps:[step('tick',3.5)]}
  ]};
  const settings={cycles:16,fills:[{cycle:1,id:'cut'},{cycle:2,id:'overlay'}],
    render:{sampleRate:rate,map:{tempo:120,swing:.58}}};
  const result=perform(pattern,settings);
  assert.deepEqual(result,perform(pattern,settings));
  const {events,report}=result;
  assert(!report.events.some(row=>row.step==='never'));
  assert.equal(report.events.filter(row=>row.step==='odd').length,8);
  assert.deepEqual(report.events.filter(row=>row.step==='anticipate').map(row=>row.cycle),[1,2]);
  const rolls=cycle=>report.events.filter(row=>row.step==='roll' && row.cycle===cycle).map(row=>row.sub);
  assert.deepEqual(rolls(1),[0,1]);
  assert.deepEqual(rolls(2),[0,1,2,3]);
  assert(report.events.some(row=>row.id==='p1-rim-0' && row.fill==='cut'));
  assert.deepEqual(events.find(row=>row.id==='p0-roll-3'),{
    id:'p0-roll-3',pad:'hat',velocity:.8,time:{beat:rational(13,4),offset:rational(-3,500)},
    until:{beat:rational(7,2),offset:rational(-3,500)},play:{gate:true,tune:-300}
  });
  const choices=run=>run.report.events.filter(row=>row.step==='chance').map(row=>row.id);
  assert(choices(result).length>0 && choices(result).length<16);
  const inserted={...pattern,steps:[step('unrelated',.25),...pattern.steps]};
  assert.deepEqual(choices(perform(inserted,settings)),choices(result));
  assert.throws(()=>perform({...pattern,steps:[step('over',3.75,{roll:{count:2,spacing:.25}})]}),/window/);
});

test('pad pulses and their exact times become portable performance events with ID-based edits',()=>{
  const pulse=(channel,time,value)=>({kind:'pulse',channel,time,value});
  const recording=A.recording({events:[
    pulse('hat',rational(1,3),{velocity:.55,play:{pan:-.7}}),
    pulse('other',.42,true),pulse('hat',.5,false),pulse('hat',.61,.85),
    {channel:'hat',time:.82,value:.77}
  ]});
  const take=capture(recording,{hat:{pad:'hat',duration:.08,play:{gate:true,sends:{echo:.4}}}},options);
  assert.deepEqual(take.events.map(row=>row.id),['pulse-0','pulse-3']);
  assert.deepEqual(take.events[0].time,rational(1,3));
  assert.deepEqual(take.events[0].play,{gate:true,pan:-.7,sends:{echo:.4}});
  const change=edit(take,[{op:'set',id:'pulse-0',changes:{time:.72,play:{pan:null,tune:200}}},
    {op:'delete',id:'pulse-3'},{op:'add',event:{id:'answer',pad:'hat',time:.49,velocity:.35}}]);
  assert.deepEqual(change.events.map(row=>row.id),['answer','pulse-0']);
  assert.deepEqual(change.events[1].play,{gate:true,tune:200,sends:{echo:.4}});
  assert.equal(take.events[0].play.pan,-.7);
  assert.throws(()=>edit(take,[{op:'set',id:'pulse-0',changes:{duration:null}}]),/gate/);
});

test('sample, start point, filter, one-shot gate, pan and sends apply only to their locked hit',()=>{
  const asset=name=>({asset:name});
  const spec={id:'hit-locks',pads:{hat:{attack:0,release:.004,inserts:[{type:'gain',db:-6}],
    articulations:{default:[
      {id:'regular',takes:[asset('a'),asset('b')]},
      {id:'soft',velocity:[0,0,.25,.4],takes:[asset('soft')]}
    ]}
  }},buses:{echo:{inserts:[{type:'delay',seconds:.01,mix:1,feedback:0}]}}};
  const assets={
    a:mono(180,()=>.07),b:mono(180,()=>.08),soft:mono(240,i=>i<100 ? .7 : .2)
  };
  const events=[
    {id:'locked',time:0,pad:'hat',velocity:1,duration:.008,play:{sample:'soft',startSample:100,
      filter:{type:'lowpass',hz:400},gate:true,pan:1,sends:{echo:.5}}},
    {id:'plain-a',time:.002,pad:'hat',velocity:1},
    {id:'plain-b',time:.032,pad:'hat',velocity:1}
  ];
  const {stems,report,value}=A.sampleKit.render(spec,assets,events,options);
  assert.deepEqual(report.events.map(e=>[e.id,e.layers[0].take]),[['locked','soft'],['plain-a','a'],['plain-b','b']]);
  assert.equal(report.events[0].noteOff,64);
  assert.equal(report.events[0].layers[0].locked,true);
  const left=at(stems.hat,0), right=at(stems.hat,0,1);
  const first=.2*(1-Math.exp(-2*Math.PI*400/rate))*Math.SQRT2;
  assert.equal(left,0);
  assert(Math.abs(right-first*10**(-6/20))<1e-12);
  assert.equal(at(stems.echo,80),0);
  assert(Math.abs(at(stems.echo,80,1)-first*.5)<1e-12);
  assert.equal(at(stems.echo,176,1),0);
  assert(value.samples.every((sample,i)=>sample===stems.hat.samples[i]+stems.echo.samples[i]));
  const bad=(play)=>[{...events[0],play:{...events[0].play,...play}}];
  assert.throws(()=>A.sampleKit.render(spec,assets,bad({startSample:240}),options),/outside take/);
  assert.throws(()=>A.sampleKit.render(spec,assets,bad({sends:{elsewhere:1}}),options),/named kit bus/);
  assert.throws(()=>A.sampleKit.render(spec,assets,bad({sample:'missing'}),options),/identify one take/);
});

test('per-hit cents transpose a sample with no assigned root and leave adjacent hits unchanged',()=>{
  const spec={id:'tone',pads:{note:{attack:0,articulations:{default:[{id:'tone',takes:[{asset:'tone'}]}]}}}};
  const tone=mono(800,i=>.4*Math.sin(2*Math.PI*250*i/rate));
  const {value}=A.sampleKit.render(spec,{tone},[
    {pad:'note',time:0,velocity:1,play:{tune:1200}},
    {pad:'note',time:.12,velocity:1}
  ],options);
  assert(at(value,4)>.39 && at(value,12)<-.39);
  assert(at(value,968)>.39 && at(value,984)<-.39);
});

test('CLI programs, captures and edits portable kit performance JSON',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-pad-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(file,data)=>fs.writeFileSync(path.join(root,file),JSON.stringify(data));
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music',...args],{cwd:root,encoding:'utf8'});
  write('pattern.json',{id:'one',length:1,steps:[step('touch',0,{roll:{count:3,spacing:.25}})]});
  write('settings.json',{render:options});
  cli('pads','program','pattern.json','settings.json','--out','take.json');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'take.json'))).events.length,3);
  write('pulses.json',{events:[{kind:'pulse',time:.15,channel:'tap',value:.7}]});
  write('routes.json',{routes:{tap:{pad:'hat'}},options});
  cli('pads','capture','pulses.json','routes.json','--out','played.json');
  write('edits.json',[{op:'set',id:'pulse-0',changes:{play:{sample:'hit',pan:.2}}}]);
  cli('pads','edit','played.json','edits.json','--out','revised.json');
  const library=ink.openSampleLibrary(path.join(root,'library'),{kit});
  library.add(A.sampleCatalog.capture(mono(150,()=>.2),{
    sample:{id:'hit',label:'Hit'},source:{kind:'graph',name:'test-tone'}
  }));
  write('kit.json',{assets:{hit:{sample:'hit'}},kit:{id:'kit',pads:{hat:{articulations:{
    default:[{id:'base',takes:[{asset:'hit'}]}]
  }}}}});
  const result=JSON.parse(cli('samples','kit','library','kit.json','revised.json','--out','render'));
  assert(at(ink.readWav(result.audio),1210,1)>at(ink.readWav(result.audio),1210));
  assert.equal(JSON.parse(fs.readFileSync(result.report)).events[0].at,1200);
});
