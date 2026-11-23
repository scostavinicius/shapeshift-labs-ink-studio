const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), kit=ink.load(), P=kit.KIT.procedural, A=P.mediaGraph;
const {printAudio,readAudioPrint}=require('../cli/audio-print');
const rate=8000;
const graphFormat='ink-studio/graph-project';
const sound=(length,channels=1)=>({sampleRate:rate,channels,samples:new Float64Array(length*channels)});
const marker=(id,at)=>({id,at,kind:'attack'});

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-print-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const save=(name,doc)=>{
    const at=path.join(root,name);
    fs.writeFileSync(at,JSON.stringify(doc));
    return at;
  };
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','samples',...args],{cwd:root,encoding:'utf8'}));
  const library=ink.openSampleLibrary(path.join(root,'library'),{kit});
  const pcm=sound(256);
  pcm.samples[40]=.5;
  const spec={id:'patch-kit',pads:{hit:{attack:0,sends:{room:1},
    articulations:{default:[{id:'strike',takes:[{asset:'source'}]}]}}},
    buses:{room:{inserts:[{type:'delay',seconds:.01,mix:1,feedback:.3}]}}};
  const link=(node,port)=>({node,...(port && {port})});
  const graph=save('graph.json',{format:graphFormat,version:1,seed:42,time:.25,
    inputs:{render:{type:'record',default:{sampleRate:rate,duration:.04}}},
    groups:{effects:{inputs:{source:'audio',settings:'record'},nodes:{bank:{op:'data.record',inputs:{source:{input:'source'}}},
      fx:{op:'music.renderSampleKit',inputs:{source:spec,assets:link('bank'),
        events:[{pad:'hit',time:0,velocity:1}],options:{input:'settings'}}}
    },outputs:{stems:link('fx','stems')}}},
    nodes:{original:{op:'audio.buffer',inputs:{...pcm,samples:Array.from(pcm.samples)}},
      unrelated:{op:'audio.buffer',inputs:{...pcm,samples:[0]}},
      rack:{op:'effects',inputs:{source:link('original'),settings:{input:'render'}}}
    },outputs:{clean:link('original'),wet:link('rack','stems'),other:link('unrelated')}});
  const recipe={graph:'graph.json',seed:711,inputs:{render:{sampleRate:rate,duration:.06}},
    taps:{dry:{output:'clean'},wet:{node:'rack/fx',port:'stems',field:['room']}},
    sample:{id:'station',label:'Station relay',material:'metal'},
    range:{firstSample:16,endSample:224},markers:[marker('hit',40),marker('echo',120)]};
  return {root,save,run,library,pcm,graph,recipe};
}

test('a paired print takes exact windows from one graph frame and preserves tap-specific chains, seed and markers',t=>{
  const {root,save,run,library,recipe}=fixture(t);
  save('recipe.json',recipe);
  const result=run('print','library','recipe.json','--out','prints');
  const pack=readAudioPrint(result.manifest,kit), clean=pack.load('dry'), wet=pack.load('wet');
  assert.deepEqual(result.entries,{dry:'station-dry',wet:'station-wet'});
  assert.equal(clean.value.channels,1);
  assert.equal(wet.value.channels,2);
  assert.equal(clean.value.samples[24],.5);
  assert.equal(wet.value.samples[24*2],0);
  assert.equal(wet.value.samples[104*2],.5);
  assert.deepEqual(wet.entry.print.markers,[marker('hit',24),marker('echo',104)]);
  assert.equal(wet.entry.print.seed,711);
  assert.equal(wet.entry.print.time,.25);
  assert.equal(wet.entry.source.firstSample,16);
  assert.equal(wet.entry.source.endSample,224);
  assert.deepEqual(clean.entry.print.chain.map(row=>row.node),['original']);
  assert.deepEqual(wet.entry.print.chain.map(row=>row.node),['original','rack/bank','rack/fx']);
  assert.equal(wet.entry.print.inputs.render.duration,.06);
  assert.equal(clean.entry.print.projectHash,wet.entry.print.projectHash);
  assert.deepEqual(library.load('station-wet').value,wet.value);
  const edit=run('slice','library','station-wet');
  assert.deepEqual(edit.markers.find(row=>row.id==='echo'),marker('echo',104));
  assert.deepEqual(run('print','library','recipe.json','--out','prints'),result);
  const separate=save('separate.json',{...recipe,sample:{id:'single',label:'Single'},
    taps:{wet:{output:'wet',field:['room']}}});
  printAudio(separate,path.join(root,'single'),library,kit);
  const single=readAudioPrint(path.join(root,'single','print.json'),kit).load();
  assert.equal(single.entry.id,'single');
  assert.deepEqual(single.entry.print.chain.map(row=>row.node),['original','rack/bank','rack/fx','rack']);
});

test('a portable print is reusable as a named sampler slice and its marker can be pinned to a picture frame',t=>{
  const {root,save,run,recipe}=fixture(t);
  save('recipe.json',recipe);
  run('print','library','recipe.json','--out','prints');
  const packed=readAudioPrint(path.join(root,'prints/print.json'),kit);
  assert.equal(packed.load('wet','echo').value.samples[0],.5);
  save('kit.json',{assets:{newHit:{print:'prints/print.json',take:'wet',slice:'echo'}},
    kit:{id:'reuse',pads:{pad:{attack:0,articulations:{default:[{id:'recorded',takes:[{asset:'newHit'}]}]}}}}});
  save('performance.json',{events:[{pad:'pad',velocity:1,time:0}],options:{sampleRate:rate}});
  fs.renameSync(path.join(root,'library'),path.join(root,'offline-library'));
  const sampled=run('kit','library','kit.json','performance.json','--out','reused');
  assert.equal(ink.readWav(sampled.audio).samples[0],.5);
  const fps={numerator:30000,denominator:1001}, frame=20;
  const soundtrack=save('soundtrack.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,
    assets:{relay:{print:'prints/print.json',take:'wet'}},tracks:[{asset:'relay',frame,fps,marker:'echo'}]});
  const T=P.takeTime;
  const render=ink.readSceneAudio(soundtrack,{kit});
  const {value}=render.capture({startPoint:T.read(0),endPoint:T.read(1)},{source:{kind:'stem',name:'tracks'}});
  const at=Math.floor(frame*1001*rate/30000);
  assert.equal(value.samples[2*at-2],0);
  assert.equal(value.samples[2*at],.5);
  const wav=path.join(root,'prints/wet.wav'), bytes=fs.readFileSync(wav);
  bytes[bytes.length-1]^=1;
  fs.writeFileSync(wav,bytes);
  assert.throws(()=>readAudioPrint(path.join(root,'prints/print.json'),kit).load('wet'),/hash/);
});

test('invalid print ranges and an existing conflicting take fail before publishing a pair',t=>{
  const {root,save,recipe,library,pcm}=fixture(t);
  const make=(name,changes)=>save(name+'.json',{...recipe,...changes});
  assert.throws(()=>printAudio(make('bad-range',{range:{firstSample:16,endSample:500}}),
    path.join(root,'bad'),library,kit),/outside/);
  assert.throws(()=>printAudio(make('no-end',{range:{firstSample:16}}),
    path.join(root,'bad'),library,kit),/explicit end/);
  library.add(A.sampleCatalog.capture(pcm,{sample:{id:'station-wet',label:'Existing sample'},
    source:{kind:'file',name:'existing.wav'}}));
  assert.throws(()=>printAudio(make('conflict',{}),path.join(root,'bad'),library,kit),/already exists/);
  assert.throws(()=>library.get('station-dry'),/Unknown sample/);
  assert.equal(fs.existsSync(path.join(root,'bad','print.json')),false);
});
