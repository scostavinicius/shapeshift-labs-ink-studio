const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), kit=ink.load(), A=kit.KIT.procedural.mediaGraph;
const {render}=A.sampleKit;
const rate=8000, options={sampleRate:rate}, tau=2*Math.PI;
const mono=(n,signal)=>({sampleRate:rate,channels:1,samples:Float64Array.from({length:n},(_,i)=>
  typeof signal==='function' ? signal(i) : signal)});
const take=asset=>({asset});
const layer=(id,...assets)=>({id,takes:assets.map(take)});
const play=(pad,time,extra)=>({pad,time,velocity:1,...extra});
const at=(audio,frame,channel=0)=>audio.samples[frame*2+channel];

test('note and pad mappings layer crossfaded velocities and advance round robins per articulation',()=>{
  const assets={soft:mono(128,.1),a:mono(128,.2),b:mono(128,.3),accent:mono(128,.05),rim:mono(128,.4)};
  const kit={id:'metal',pads:{snare:{notes:[38,38],attack:0,articulations:{
    default:[{...layer('soft','soft'),velocity:[0,0,.3,.7]},
      {...layer('hard','a','b'),velocity:[.3,.7,1,1]},layer('impact','accent')],
    rim:[layer('edge','rim')]
  }}}};
  const sequence=[play('snare',.08),{note:38,time:{beat:.04},velocity:.5},
    play('snare',0),play('snare',.06,{articulation:'rim'}),play('snare',.04,{velocity:0}),
    play('snare',.07,{velocity:.2})];
  const {value,report}=render(kit,assets,sequence,options);
  assert.deepEqual(report.events.map(row=>[row.at,row.roundRobin,row.layers.map(p=>p.take)]),[
    [0,0,['a','accent']],[160,1,['soft','b','accent']],[480,0,['rim']],
    [560,2,['soft','accent']],[640,3,['a','accent']]
  ]);
  assert.equal(report.events[4].layers[0].roundRobin,2);
  assert(Math.abs(report.events[1].layers[0].weight-.5)<1e-12);
  assert(Math.abs(report.events[1].layers[1].weight-.5)<1e-12);
  assert(Math.abs(at(value,160)-.25*.5**.65)<1e-12);
  assert.throws(()=>render(kit,assets,[play('snare',0,{articulation:'missing'})],options),/articulation/);
});

test('gated voices smooth a sustain seam, transpose to MIDI notes and sound a release sample at note-off',()=>{
  const assets={reed:mono(800,i=>.05+i*.001),release:mono(160,.2),
    pitch:mono(1000,i=>.2*Math.sin(tau*250*i/rate))};
  const gate={id:'wind',pads:{key:{notes:[48,72],gated:true,attack:0,release:.01,articulations:{default:[{
    id:'reed',takes:[{asset:'reed',loop:{from:80,to:240,crossfade:40}}],releases:[take('release')]
  }]}},tuned:{attack:0,articulations:{default:[{id:'pitched',takes:[{asset:'pitch',root:'C4'}]}]}}}};
  const {value,stems,report}=render(gate,assets,[
    {note:'C4',time:0,until:{beat:.24},velocity:1},play('tuned',.2,{note:'C5'})
  ],options);
  assert.equal(report.events[0].noteOff,960);
  assert.equal(report.events[0].layers[0].release,'release');
  assert(Math.abs(at(value,239)-at(value,240))<.004);
  assert(Math.abs((at(value,960)-at(value,959))-.2)<.004);
  assert.equal(at(value,1041),.2);
  assert.equal(at(value,1120),0);
  const tone=stems.tuned;
  assert(at(tone,1604)>.18 && at(tone,1612)<-.18 && at(tone,1620)>.18);
});

test('kit routes preserve performed timing and accent and can override a track’s pad and articulation',()=>{
  const events=A.sampleKit.route({lead:[{time:.1,gate:.2,midi:67,velocity:.58,play:{articulation:'mute'}}],
    hats:[{time:.05,gate:.02,midi:42,velocity:.76,play:{articulation:'loose'}}]},{
    lead:{pad:'keys'},hats:{articulation:'default'}
  });
  assert.deepEqual(events,[
    {time:.05,duration:.02,note:42,velocity:.76,articulation:'default'},
    {time:.1,duration:.2,note:67,velocity:.58,pad:'keys',articulation:'mute'}
  ]);
});

test('choke groups end old voices, preserve simultaneous layers and suppress choked note-off samples',()=>{
  const assets={sustain:mono(2400,.2),close:mono(160,.4),tail:mono(320,.3)};
  const spec={id:'hats',pads:{
    open:{gated:true,choke:'hat',attack:0,articulations:{default:[{...layer('body','sustain'),releases:[take('tail')]}]}},
    close:{choke:'hat',attack:0,articulations:{default:[{...layer('tick','close'),velocity:[.6,.6,1,1]}]}}
  }};
  const {stems,report}=render(spec,assets,[play('open',0,{duration:.25}),play('close',0),
    play('close',.05,{velocity:.1}),play('close',.1)],{...options,duration:.28});
  assert.equal(report.events[0].chokeAt,800);
  assert.equal(report.events[0].layers[0].release,undefined);
  assert.equal(at(stems.open,500),.2);
  assert.equal(at(stems.open,800),.2);
  assert.equal(at(stems.open,816),.1);
  assert.equal(at(stems.open,832),0);
  assert.equal(at(stems.open,2000),0);
});

test('per-pad insert order, panning and post-fader sends survive stem export with shared headroom',()=>{
  const assets={hit:mono(80,i=>i===0 ? .4 : 0)};
  const pad={attack:0,pan:1,inserts:[{type:'gain',db:12},{type:'drive',amount:2}],sends:{echo:.5},
    articulations:{default:[layer('hit','hit')]}};
  const definition={id:'desk',pads:{hit:pad},buses:{echo:{inserts:[{type:'delay',seconds:.01,mix:1,feedback:.5}]}}};
  const rows=[play('hit',0)];
  const {value,stems,report}=render(definition,assets,rows,options);
  assert(report.gain<1);
  assert(value.samples.length>300);
  assert.equal(at(stems.hit,0),0);
  assert.equal(at(stems.hit,0,1),1);
  assert.equal(at(stems.echo,0,1),0);
  assert.equal(at(stems.echo,80,1),.5);
  assert.equal(at(stems.echo,160,1),.25);
  const compact=render(definition,assets,rows,{...options,stems:false});
  assert.deepEqual(compact.value.samples,value.samples);
  assert(value.samples.every((sample,i)=>sample===stems.hit.samples[i]+stems.echo.samples[i]));
  const reverse={...definition,pads:{hit:{...pad,inserts:[...pad.inserts].reverse()}}};
  assert.notEqual(render(reverse,assets,rows,options).report.gain,report.gain);
});

test('kit CLI loads a named edit slice by hash and exports replayable stems without changing the recording',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-kit-test-')), libraryPath=path.join(root,'library');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const library=ink.openSampleLibrary(libraryPath,{kit});
  const source=mono(256,i=>i<128 ? .1 : .28);
  const {entry}=library.add(A.sampleCatalog.capture(source,{sample:{id:'hit',label:'Metal hit'},
    source:{kind:'file',name:'hit.wav'}}));
  const edit=A.sampleEdit.edit(A.sampleEdit.create(source,{source:{id:entry.id,asset:entry.asset}}),[
    {op:'add',id:'second',at:128}
  ]);
  const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  write('edit.json',edit);
  write('kit.json',{kit:{id:'steel',pads:{hit:{attack:0,articulations:{default:[layer('body','slice')]}}}},
    assets:{slice:{edit:'edit.json',slice:'second'}}});
  write('performance.json',{events:[play('hit',0)],options});
  const {audio,stems,report}=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','samples','kit','library','kit.json','performance.json','--out','render'],{cwd:root,encoding:'utf8'}));
  assert.equal(at(ink.readWav(audio),0),.28);
  assert.deepEqual(ink.readWav(stems.hit),ink.readWav(audio));
  assert.deepEqual(JSON.parse(fs.readFileSync(report,'utf8')).sources.slice,
    {id:'hit',asset:entry.asset,edit:'edit.json',slice:'second'});
  assert.deepEqual(library.load('hit').value.samples,source.samples);
});
