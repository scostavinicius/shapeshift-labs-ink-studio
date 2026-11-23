const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), WAV=require('../cli/wav.js');
const W=K.world, R=W.reduction, P=K.procedural.pathSections;
const bake=(kind,source,settings)=>R.bake({format:R.format,version:1,id:'fixture',kind,source,settings});
const fixture=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'..','examples','simulation-branched-domains',name),'utf8'));

test('profile reduction allocates spans around area changes and retains exact storage and closure',()=>{
  const sections=[2,2,0,1,1].map((area,index)=>({span:[index,index+1],area,sectionLength:1}));
  const report={format:P.format,version:1,complete:true,source:'mesh',sections};
  const one=bake('profile',report,{segments:1,areaPower:2});
  assert.deepEqual(one.range,{arc:[0,5],sourceSections:5});
  assert.equal(one.spans[0].area,6/5);
  assert.equal(one.spans[0].minArea,0);
  assert.equal(one.spans[0].conductance,0);
  assert.equal(one.resistance,null);
  assert.equal(one.volume,6);
  const three=bake('profile',report,{segments:3});
  assert.equal(three.error.areaRMSE,0);
  assert.deepEqual(three.spans.map(row=>row.span),[[0,2],[2,3],[3,5]]);
  assert.ok(Object.isFrozen(three.spans[0]));
  assert.throws(()=>bake('profile',{...report,complete:false}),/complete measured/);
  assert.throws(()=>bake('profile',{...report,sections:sections.slice(0,1).concat(sections.slice(2))}),/contiguous/);
});

test('network reduction retains named ports, path references, probes and equivalent geometry',()=>{
  const run=W.runtime.create(fixture('bench.world.json'));
  const domain=W.domains.compile(fixture('bench.domain.json'),{query:run.query(),snapshot:{world:run.view().world.id,tick:0}});
  const asset=bake('network',domain,{segments:3});
  assert.equal(asset.source.revision,domain.revision);
  assert.deepEqual(asset.source.snapshot,domain.snapshot);
  assert.equal(asset.range.sourceSections,35);
  assert.equal(Object.keys(asset.links).length,8);
  const {links,observations,paths}=asset;
  assert.equal(asset.ports['feed-in'].node,'supply');
  assert.equal(observations['manifold-pressure'].node,'tee');
  const throat=observations['outlet-throat'];
  assert.equal(links[throat.link].tube,'upper');
  assert.ok(throat.distance>=links[throat.link].span[0]&&throat.distance<links[throat.link].span[1]);
  for(const [id,tube] of Object.entries(domain.tubes)){
    const {links:keys,resistance,volume,reference}=paths[id];
    assert.equal(links[keys[0]].from,tube.from.node);
    assert.equal(links[keys.at(-1)].to,tube.to.node);
    assert.deepEqual(reference,{path:tube.path,geometry:tube.geometry});
    assert.ok(Math.abs(volume-tube.volume)<1e-12);
    const original=tube.sections.reduce((sum,row)=>sum+row.sectionLength/row.area,0);
    assert.ok(Math.abs(resistance-original)<1e-12);
  }
});

test('impulse windows keep sample placement and quantify missing tails',()=>{
  const asset=bake('response',{sampleRate:10,samples:[9,8,7,6,5]},
    {fit:[1,4],validation:[4,5],fadeSamples:1});
  assert.deepEqual(asset.range,{fitSamples:[1,4],fitSeconds:[.1,.4],validationSamples:[4,5],validationSeconds:[.4,.5]});
  assert.deepEqual(Array.from(R.render(JSON.parse(JSON.stringify(asset)),{samples:7})),[0,8,7,0,0,0,0]);
  assert.equal(asset.error.validation.rmse,5);
  assert.equal(asset.error.full.peakError,9);
  assert.throws(()=>bake('response',{sampleRate:10,samples:[1,2,3]},{fit:[0,2],validation:[1,3]}),/follow the fit/);
});

test('modal fitting recovers damped modes and predicts a held-out tail',()=>{
  const sampleRate=8000, samples=Float64Array.from({length:3000},(_,i)=>{
    const t=i/sampleRate;
    return .7*Math.exp(-23*t)*Math.cos(2*Math.PI*450*t)+.3*Math.exp(-65*t)*Math.sin(2*Math.PI*771*t);
  });
  const asset=bake('modes',{sampleRate,samples},{fit:[0,2000],validation:[2000,3000],band:[150,1000],maxModes:2});
  assert.deepEqual(asset.modes.map(row=>Math.round(row.hz)),[450,771]);
  assert.deepEqual(asset.modes.map(row=>Math.round(row.decay)),[23,65]);
  assert.ok(asset.error.fit.relativeRMSE<.002);
  assert.ok(asset.error.validation.relativeRMSE<.02);
  assert.deepEqual(R.render(JSON.parse(JSON.stringify(asset))),R.render(asset));
});

test('capture uses the named ports of a versioned simulation model and subtracts the baseline',()=>{
  const model={format:W.models.format,version:1,id:'control-port',revision:3,seed:1,
    numerics:{dt:1/6000},domain:{},parameters:{},initial:{},boundaries:{},operators:{controller:{kind:'control',revision:1}},
    inputs:{drive:'controller/value'},outputs:{tap:'controller/value'},probes:{}};
  const result=R.capture(model,{input:'drive',output:'tap',baseline:.5,amplitude:.25,samples:5});
  assert.equal(result.sampleRate,6000);
  assert.deepEqual(result.samples,[1,0,0,0,0]);
  assert.deepEqual(result.origin,{id:'control-port',revision:3,seed:1,input:'controller/value',
    output:'controller/value',baseline:.5,amplitude:.25});
  assert.throws(()=>R.capture(model,{input:'unknown',output:'tap',samples:5}),/Expected system\/port|endpoint/);
});

test('sim reduce loads a relative stereo WAV and selects a channel',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-reduction-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'source.wav'),WAV.encode({sampleRate:8000,channels:2,samples:[1,.5,-1,-.25]}));
  fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify({format:R.format,version:1,id:'wav',kind:'response',
    source:{wav:'source.wav',channel:1}}));
  execFileSync(process.execPath,[path.join(__dirname,'..','cli','ink-studio.js'),'sim','reduce',
    'plan.json','--out','asset.json'],{cwd:root});
  const asset=JSON.parse(fs.readFileSync(path.join(root,'asset.json'),'utf8'));
  assert.equal(asset.format,R.assetFormat);
  assert.deepEqual(asset.source.reference,{file:'source.wav',channel:1});
  assert.deepEqual(asset.taps,[.5,-.25]);
});
