const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {test}=require('node:test');
const ink=require('..'),kit=ink.load(), A=kit.KIT.procedural.mediaGraph;
const share={pad:'tap',play:{sample:'hit'}};
const hit=(id,beat,slice='tap',rest={})=>({id,beat,slice,...rest});
const phrase=(length,...hits)=>({op:'phrase',length,hits});
const third={numerator:1,denominator:3};
const grid=(patterns,output)=>({id:'score',patterns,output,slices:{tap:share,
  tail:{pad:'tail',play:{sample:'baked-tail',pan:.4,sends:{space:.3}}}},
  tail:.25,render:{sampleRate:8000,map:{tempo:120,changes:[{beat:2,tempo:60}]}}});
const stamps=result=>result.events.map(row=>row.time.beat);

test('loop clocks drift by exact amounts and preserve gates and binding across tempo changes',()=>{
  const score=grid({
    pulse:phrase(1,hit('tap',0,'tap',{gate:third})),
    steady:{op:'loop',source:'pulse',length:4},
    phase:{op:'loop',source:'pulse',length:4,period:{numerator:13,denominator:12},phase:-.125},
    mix:{op:'stack',layers:{steady:{source:'steady'},phase:{source:'phase'}}}
  },'mix');
  const result=A.sliceComposition.compose(score);
  assert.deepEqual(stamps(result),[0,{numerator:23,denominator:24},1,2,
    {numerator:49,denominator:24},3,{numerator:25,denominator:8}]);
  assert.deepEqual(result.events[0].until,{beat:third});
  assert.deepEqual(result.options.duration,{numerator:13,denominator:4});
  assert.equal(result.report.events[2].hit,'tap');
  assert.equal(result.report.events[2].sample,'hit');
  assert.deepEqual(A.sliceComposition.compose(JSON.parse(JSON.stringify(score))),result);
  score.patterns.mix.layers.late={source:'pulse',at:.25};
  const changed=A.sliceComposition.compose(score);
  assert.deepEqual(changed.events.filter(row=>!changed.report.events.find(trace=>trace.id===row.id).path.startsWith('mix/late/')),
    result.events);
});

test('a cut-up and pitched answer reuse the same source IDs through a sample-kit render and pad edits',()=>{
  const score=grid({
    call:phrase(1,hit('one',0),hit('two',third),hit('three',.75,'tap',{velocity:.6})),
    build:{op:'additive',source:'call',counts:[1,2,3]},
    cut:{op:'cut',source:'call',length:1,slots:[{id:'last',pick:2,beat:0},{id:'first',pick:0,beat:.5}]},
    tail:{op:'voice',source:'cut',slices:{tap:'tail'},notes:['C4','G4'],gate:.2,gain:.5,
      play:{sends:{echo:.4},filter:{type:'lowpass',hz:1400}}},
    cue:{op:'sequence',sources:['build','tail'],gap:.25}
  },'cue');
  const result=A.sliceComposition.compose(score);
  assert.deepEqual(stamps(result),[0,1,{numerator:4,denominator:3},2,
    {numerator:7,denominator:3},{numerator:11,denominator:4},{numerator:13,denominator:4},
    {numerator:15,denominator:4}]);
  assert.deepEqual(result.report.events.slice(-2).map(row=>[row.hit,row.slice,row.note]),
    [['three','tail','C4'],['one','tail','G4']]);
  assert.equal(result.events.at(-2).velocity,.3);
  assert.deepEqual(result.events.at(-2).play.sends,{space:.3,echo:.4});
  const pad=(name,root)=>({articulations:{default:[{id:'one',takes:[{asset:name,...(root && {root})}]}]}});
  const source={id:'kit',pads:{tap:pad('hit'),tail:pad('baked-tail','C4')},buses:{space:{},echo:{}}};
  const audio={sampleRate:8000,channels:1,samples:Array.from({length:160},(_,i)=>.4*Math.cos(i*.3))};
  const doc={format:'ink-studio/graph-project',version:1,nodes:{
    score:{op:'music.composeSlices',inputs:{source:score}},
    render:{op:'music.renderSampleKit',inputs:{source,assets:{hit:audio,'baked-tail':audio},
      events:{node:'score',port:'events'},options:{node:'score',port:'options'}}}
  },outputs:{value:{node:'render'},report:{node:'render',port:'report'}}};
  const {outputs}=ink.createGraphProject(doc,{kit}).run();
  assert.equal(outputs.report.events.at(-2).at,18000);
  assert.equal(outputs.report.events.at(-1).pitch,67);
  assert(outputs.value.samples.some(value=>Math.abs(value)>.01));
  const edit=A.padPattern.edit(result.value,[{op:'set',id:result.events.at(-1).id,changes:{velocity:.2}}]);
  assert.equal(edit.events.at(-1).velocity,.2);
});

test('slice compositions reject cycles, unknown slices, invalid picks and unbounded expansion',()=>{
  const recipe=patterns=>grid(patterns,'a');
  assert.throws(()=>A.sliceComposition.compose(recipe({a:{op:'loop',source:'a',length:1}})),/cyclic/);
  assert.throws(()=>A.sliceComposition.compose(recipe({a:phrase(1,hit('tap',0,'unknown'))})),/known slice/);
  assert.throws(()=>A.sliceComposition.compose(recipe({a:{op:'cut',source:'b',length:1,
    slots:[{id:'hold',pick:1,beat:0}]},b:phrase(1,hit('one',0))})),/existing hit/);
  assert.throws(()=>A.sliceComposition.compose(recipe({a:{op:'loop',source:'b',length:64,period:.001},
    b:phrase(1,hit('one',0))})),/cycle or length budget/);
});

test('CLI writes a regular editable performance and a separate slice trace',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-slices-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const score=grid({pulse:phrase(1,hit('one',0))},'pulse');
  fs.writeFileSync(path.join(root,'score.json'),JSON.stringify(score));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  execFileSync(process.execPath,[cli,'music','pads','compose','score.json','--out','take.json','--report','trace.json'],
    {cwd:root});
  const read=file=>JSON.parse(fs.readFileSync(path.join(root,file)));
  const result=A.sliceComposition.compose(score);
  assert.deepEqual(read('take.json'),result.value);
  assert.deepEqual(read('trace.json'),result.report);
});
