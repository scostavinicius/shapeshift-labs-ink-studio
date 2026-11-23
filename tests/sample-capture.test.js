const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ink = require('..'), kit = ink.load(), {KIT:K} = kit;
const {mediaGraph:A,takeTime:T} = K.procedural;
const WAV = require('../cli/wav.js');
const scratch = t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'ink-sample-test-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return folder;
};
const name = (id,fields={}) => ({id,label:id,material:'metal',articulation:'struck',pitch:'A4',
  license:{id:'CC0-1.0',credit:'Ink test'},...fields});
const rate = 8000;
const pcm = samples => ({sampleRate:rate,channels:1,samples:Float32Array.from(samples)});

test('rolling PCM keeps absolute stereo frames, rejects expired selections, and packages the take', async () => {
  const {createRollingAudio,normalizeCapture} = await import('../src/show/rolling-audio.mjs');
  const {sampleCaptureFiles} = await import('../show-control.mjs');
  const ring = createRollingAudio({sampleRate:8,channels:2,seconds:.5});
  ring.write([[0,.125,.25],[.375,.5,.625]],20);
  ring.write([[.75,1.5],[-.5,-.75]],23);
  assert.deepEqual(ring.range(),{sampleRate:8,channels:2,firstSample:21,endSample:25});
  assert.throws(()=>ring.capture({firstSample:20,endSample:25}), /retained PCM window/);
  const {value,range} = ring.capture({seconds:.5});
  assert.deepEqual([...value.samples],[.125,.5,.25,.625,.75,-.5,1.5,-.75]);
  const source = {kind:'bus',name:'test',...range,gain:normalizeCapture(value.samples)};
  const {wav,recipe} = sampleCaptureFiles({source,value},name('strike'));
  assert.equal(source.gain,2/3);
  assert.deepEqual([...WAV.decode(wav).samples],[...value.samples]);
  assert.deepEqual(recipe.provenance,source);
  ring.write([],40,2);
  assert.deepEqual([...ring.capture().value.samples],[0,0,0,0]);
  assert.equal(ring.range().firstSample,40);
});

test('catalog entries are independently published, discoverable by metadata, and resolve exact audio', t => {
  const library = ink.openSampleLibrary(scratch(t),{kit});
  const captured = A.sampleCatalog.capture(pcm([.125,.25,.5,.75]),{sample:name('strike'),
    source:{kind:'mic',name:'bench',firstSample:200,endSample:204},firstSample:1,endSample:4});
  const stored = library.add(captured);
  assert.deepEqual(library.add(captured),stored);
  assert.equal(stored.entry.source.firstSample,201);
  assert.equal(stored.entry.source.endSample,204);
  assert.equal(stored.entry.duration,3/rate);
  const second = library.add({...captured,entry:{...captured.entry,id:'other',material:'glass',pitch:69.14}});
  assert.equal(second.file,stored.file);
  assert.deepEqual([...library.load('strike').value.samples],[.25,.5,.75]);
  assert.throws(()=>library.add({...captured,entry:{...captured.entry,label:'collision'}}), /already exists/);
  const filter = {material:'METAL',articulation:'struck',sourceKind:'mic',sourceName:'Bench',pitch:'A4',
    license:'cc0-1.0',minDuration:3/rate,maxDuration:.001,query:'ink test'};
  assert.deepEqual(library.search(filter).items.map(row=>row.id),['strike']);
  assert.equal(library.search({pitch:69,cents:15}).total,2);
  assert.equal(library.search({pitch:69,cents:10}).total,1);
  assert.equal(library.search({maxDuration:.0001}).total,0);
});

test('CLI catalog captures from a WAV, graph, production instrument, world cue/emitter and soundtrack stem', t => {
  const folder = scratch(t), file = name=>path.join(folder,name), out = file('library');
  const save = (at,value)=>fs.writeFileSync(file(at),JSON.stringify(value));
  fs.writeFileSync(file('hit.wav'),WAV.encode(pcm([.25,.5,.125]),{encoding:'float32'}));
  save('graph.json',{format:'ink-studio/graph-project',version:1,
    nodes:{tone:{op:'audio.buffer',inputs:{sampleRate:rate,channels:1,samples:[.125,.25,.5,.75]}}},
    outputs:{tone:{node:'tone'}}});
  save('score.json',{production:{arrangement:{
    score:{key:{root:'A4'},harmonies:{home:{root:'A4',quality:'unison'}}},
    motifs:{hit:{length:4,events:[{beat:0,duration:.4,midi:69}]}},
    parts:{lead:{role:'lead',material:'hit'}},sections:[{id:'intro',bars:1,harmony:'home'}]},
  patches:{metal:{type:'fm'}},tracks:{lead:{patch:'metal'}}}});
  save('world.json',{id:'capture-world',dt:.01,commands:[
    {tick:4,action:'world/event',args:{kind:'audio-cue',cue:'hit',at:[1,0,0]}}
  ]});
  save('scene.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,world:'world.json',assets:{hit:'hit.wav'},
    spatial:{cues:{hit:'hit'},emitters:{fan:{cue:'hit',at:[-1,0,0]}}}});
  const command = (...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','samples',...args],{encoding:'utf8'}));
  const inputs = {
    file:{kind:'file',path:'hit.wav'},
    graph:{kind:'graph',path:'graph.json',output:'tone',firstSample:1,endSample:3},
    instrument:{kind:'instrument',path:'score.json',track:'lead',from:.01,to:.05,sampleRate:rate},
    cue:{kind:'world',path:'scene.json',cue:'hit',from:.04,to:.041},
    emitter:{kind:'world',path:'scene.json',emitter:'fan',from:.04,to:.041},
    stem:{kind:'stem',path:'scene.json',stem:'spatial',from:.04,to:.041}
  };
  for (const [id,input] of Object.entries(inputs)) {
    save('input.json',{input,sample:name(id)});
    const added = command('add',out,file('input.json'));
    assert.equal(added.entry.source.kind,input.kind);
    assert(fs.existsSync(added.file));
  }
  const library = ink.openSampleLibrary(out,{kit});
  assert.deepEqual([...library.load('graph').value.samples],[.25,.5]);
  assert.equal(library.get('instrument').entry.source.firstSample,80);
  assert(library.load('instrument').value.samples.some(value=>Math.abs(value)>.001));
  assert.deepEqual([...library.load('cue').value.samples.slice(0,2)],[0,.25]);
  assert.deepEqual([...library.load('emitter').value.samples.slice(0,2)],[.125,0]);
  assert.deepEqual([...library.load('stem').value.samples.slice(0,2)],[.125,.25]);
  save('filter.json',{sourceKind:'world',license:'CC0-1.0'});
  assert.equal(command('search',out,file('filter.json')).total,2);
  assert.equal(command('get',out,'cue').file,library.get('cue').file);
  const program = ink.readSceneAudio(file('scene.json'),{kit});
  assert.throws(()=>program.capture({startPoint:T.read(.04),endPoint:T.read(.05)},
    {source:{kind:'world',by:'emitter',name:'missing'}}),/No audible world source/);
});
