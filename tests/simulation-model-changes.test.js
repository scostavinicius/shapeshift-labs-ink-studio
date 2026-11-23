const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..');

const own=value=>JSON.parse(JSON.stringify(value));
let fixtureNumber=0;
function fixture({changes=[],commands=[],newType='Float64Array'}={}) {
  const {world:W}=ink.load().KIT;
  let prepared=0, fault=false;
  const kind='change-fixture-'+(++fixtureNumber);
  W.kernels.register(kind,{
    inputs:{width:{type:'number',default:2},step:{type:'number',default:1}},outputs:{level:'number'},
    processing:{maxSamples:16,maxWork:90,maxBytes:1024},
    prepare({initial=10,stride=1,count=1,type='Float64Array',canFail=false},{allocate,capacity}) {
      prepared++;
      const memory=allocate('memory',type,count,'state');
      const width=allocate('width','Float64Array',capacity.maxSamples,'input');
      const signal=allocate('signal','Float64Array',capacity.maxSamples,'output');
      const bore=allocate('bore','Float64Array',capacity.maxSamples,'output');
      return {workPerSample:2, reset(output){
        memory[0]=initial;
        if (count>1) memory[1]=20;
        output.level=initial;
      },process({start,end,input,output}){
        for (let i=0;i<end-start;i++) {
          memory[0]+=stride*input.step;
          signal[i]=memory[0];
          bore[i]=width[i];
        }
        if (canFail && fault) throw Error('fixture fault');
        output.level=memory[0];
      }};
    }
  });
  const model=(id,config={},commands=[])=>({
    format:W.models.format,version:1,id,revision:1,seed:41,
    numerics:{dt:1/48000,blockSize:13},domain:{},parameters:{},initial:{},boundaries:{},
    operators:{op:{kind,revision:1,config}},inputs:{width:'op/width',step:'op/step'},
    outputs:{level:'op/level'},probes:{},commands
  });
  const plan={format:W.modelChanges.format,version:1,id:'experiment',initial:'tube',
    variants:{tube:model('tube',{},commands),fork:model('fork',{initial:100,stride:2,count:2,type:newType,canFail:true})},
    parameters:{width:{buffer:'width',min:0,max:8}},outputs:{air:'signal',bore:'bore'},changes};
  return {W,plan,prepared:()=>prepared,fail:flag=>{fault=flag;}};
}
const parameter=(sample,value,duration,curve)=>({type:'parameter',parameter:'width',sample,value,duration,...(curve&&{curve})});
const swap=(sample,policy,extra={})=>({type:'swap',variant:'fork',sample,policy,...extra});
function capture(W,plan,blocks,checkpoint) {
  const air=[],bore=[];
  const play=W.modelChanges.create(plan,{checkpoint,onBlock(start,end,buffers){
    for (let i=0;i<end-start;i++) {
      air.push(buffers.air[i]);
      bore.push(buffers.bore[i]);
    }
  }});
  for (const count of blocks) play.process(count);
  return {play,air,bore};
}

test('parameter ramps are exact across chunk sizes and interrupted ramps start at their sampled value',()=>{
  const {W,plan}=fixture({changes:[parameter(2,6,4),parameter(5,0,2,'smoothstep'),parameter(9,4,4,'smoothstep')],
    commands:[{tick:7,input:'step',value:2}]});
  const one=capture(W,plan,[15]), split=capture(W,plan,[1,4,2,3,5]);
  assert.deepEqual(one.bore,[2,2,2,3,4,5,2.5,0,0,0,0.625,2,3.375,4,4]);
  assert.deepEqual(split.bore,one.bore);
  assert.deepEqual(split.air,one.air);
  assert.equal(one.air[5],16);
  assert.equal(one.air[6],18);
  assert.throws(()=>one.play.schedule(parameter(14,3,2)),/unprocessed sample/);
  assert.throws(()=>one.play.schedule(parameter(15,10,2)),/Invalid parameter change/);
  assert.equal(one.play.inspect().parameters.width,4);
});

test('a queued live parameter ramp can run before a later authored key',()=>{
  const {W,plan}=fixture({changes:[parameter(8,0,2)]});
  const run=capture(W,plan,[3]);
  run.play.schedule(parameter(4,6,8));
  assert.throws(()=>run.play.schedule(parameter(8,3,2)),/already has a change/);
  run.play.process(9);
  assert.deepEqual(run.bore,[2,2,2,2,2,2.5,3,3.5,4,2,0,0]);
});

test('swaps are prepared before processing and explicitly retain state, reset, or blend observations',()=>{
  const remap=swap(3,'remap',{mapping:[{from:'memory',to:'memory',target:1,count:1}]});
  const {W,plan,prepared}=fixture({changes:[remap]});
  const run=W.modelChanges.create(plan);
  assert.equal(prepared(),2);
  run.process(3);
  assert.equal(run.inspect().variant,'tube');
  run.process(1);
  assert.equal(prepared(),2);
  assert.equal(run.inspect().variant,'fork');
  assert.deepEqual(Array.from(W.kernels.inspectBuffers(run.checkpoint().current).memory),[102,13]);
  assert.throws(()=>W.modelChanges.create({...plan,changes:[swap(3,'remap',{mapping:[
    remap.mapping[0],remap.mapping[0]]})]}),/ranges overlap/);
  assert.throws(()=>W.modelChanges.create({...plan,changes:[swap(3,'remap',{mapping:[
    {...remap.mapping[0],count:2}]})]}),/type or range/);

  const reset=capture(W,{...plan,changes:[swap(3,'reset')]},[8]);
  const fadePlan={...plan,changes:[swap(3,'crossfade',{duration:4})]};
  const fade=capture(W,fadePlan,[3,1,4]), single=capture(W,fadePlan,[8]);
  assert.deepEqual(reset.air,[11,12,13,102,104,106,108,110]);
  assert.deepEqual(fade.air,[11,12,13,14,37.25,61,85.25,110]);
  assert.deepEqual(single.air,fade.air);
  assert.deepEqual(own(single.play.checkpoint()),own(fade.play.checkpoint()));
  assert.throws(()=>W.modelChanges.create({...fadePlan,changes:[...fadePlan.changes,swap(6,'reset')]}),/overlap/);
  const different=fixture({changes:[remap],newType:'Float32Array'});
  assert.throws(()=>different.W.modelChanges.create(different.plan),/type or range/);
});

test('live edits and both fading states survive portable checkpoint replay',()=>{
  const {W,plan,prepared}=fixture();
  const run=W.modelChanges.create(plan);
  run.process(2);
  run.schedule(parameter(2,5,8));
  run.schedule(swap(3,'crossfade',{model:plan.variants.fork,duration:5}));
  assert.equal(prepared(),2);
  run.process(3);
  const saved=own(run.checkpoint());
  assert.equal(saved.previous.steps,5);
  assert.equal(saved.current.steps,2);
  assert.equal(run.inspect().fadingFrom,'tube');
  const resumed=capture(W,plan,[1,1,6],saved);
  run.process(8);
  assert.deepEqual(own(resumed.play.checkpoint()),own(run.checkpoint()));
  assert.throws(()=>W.modelChanges.create(plan,{checkpoint:{...saved,sample:6}}),/kernel positions/);
  assert.throws(()=>W.modelChanges.create({...plan,id:'other'},{checkpoint:saved}),/does not match/);
});

test('failure in the incoming half of an overlap rolls back the outgoing state and output',()=>{
  const {W,plan,fail}=fixture({changes:[swap(3,'crossfade',{duration:6})]});
  const run=W.modelChanges.create(plan);
  run.process(5);
  const before=own(run.checkpoint()), air=Array.from(run.buffers.air);
  fail(true);
  assert.throws(()=>run.process(2),/fixture fault/);
  assert.deepEqual(own(run.checkpoint()),before);
  assert.deepEqual(Array.from(run.buffers.air),air);
  fail(false);
  run.process(2);
  const continuous=capture(W,plan,[7]);
  assert.deepEqual(own(run.checkpoint()),own(continuous.play.checkpoint()));
});

test('CLI resolves pinned variants and resumes through the checkpoint store',()=>{
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), cwd=path.resolve(__dirname,'../examples/simulation-model-changes');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-model-changes-'));
  const invoke=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'sim','model-changes','tube.changes.json',...args],
    {cwd,encoding:'utf8'}));
  try {
    const state=path.join(folder,'state.json'), store=path.join(folder,'blocks');
    const info=invoke();
    assert.equal(info.sample,0);
    assert.equal(info.budget.preparedKernels,3);
    assert.equal(info.swaps[1].stateElements,7);
    const saved=invoke('--samples','69000','--checkpoint',state,'--checkpoint-store',store);
    assert.equal(saved.fadingFrom,'tube');
    assert.ok(saved.storage.checkpoint.writtenBlocks>0);
    assert.deepEqual(invoke('--samples','111000','--resume',state),invoke('--samples','111000'));
  } finally { fs.rmSync(folder,{recursive:true,force:true}); }
});
