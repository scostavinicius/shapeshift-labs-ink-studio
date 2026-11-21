const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { createGraphProject, readGraphProject } = require('..');
const PNG = require('../cli/png.js');

const root=path.resolve(__dirname,'..'), cli=path.join(root,'cli/ink-studio.js');
const example=path.join(root,'examples/headless-graph.json');
const spec=body=>({format:'ink-studio/graph-project',version:1,nodes:{},outputs:{},...body});
const command=(...args)=>spawnSync(process.execPath,[cli,'graph',...args],{cwd:root,encoding:'utf8'});
function temp(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-graph-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}

test('planning resolves reusable group ports without instantiating host operations',()=>{
  let created=0;
  const operations={source:{outputs:{value:'string'},instantiate(){created++;return ()=>({value:'ink'});}}};
  const group={nodes:{inner:{op:'source'}},outputs:{text:{node:'inner'}}};
  const p=createGraphProject(spec({groups:{Label:group},
    nodes:{outer:{op:'Label'}},outputs:{name:{node:'outer',port:'text'}}}),{operations});
  assert.equal(p.validate().nodes,2);
  const plan=p.plan();
  assert.equal(created,0);
  assert.equal(plan.outputs.name.type,'string');
  assert.equal(plan.groups.Label.nodes[0].id,'inner');
  assert.throws(()=>createGraphProject(spec({groups:{Label:group},nodes:{
    outer:{op:'Label'},bad:{op:'add',inputs:{a:{node:'outer',port:'text'},b:1}}
  }}),{operations}),/Incompatible graph socket bad.a/);
  assert.throws(()=>createGraphProject(spec({groups:{
    A:{nodes:{inner:{op:'B'}},outputs:{}},B:{nodes:{inner:{op:'A'}},outputs:{}}
  }})),/group cycle/);
  assert.throws(()=>createGraphProject(spec({nodes:{a:{op:'add',inputs:{a:{node:'a'},b:1}}}})),/dependency cycle/);
  const result=p.run();
  assert.equal(created,1);
  assert.equal(result.outputs.name,'ink');
  assert.deepEqual(result.report.cache.nodes,{outer:'evaluated','outer/inner':'evaluated'});
  assert.equal(p.inspect({node:'outer/inner'}).value,'ink');
  assert.equal(p.run().report.cache.hits,2);
  p.clear();
  assert.equal(p.run().report.cache.hits,0);
  assert.equal(created,2);
});

test('named options, keyed values and warm caches drive actual graph outputs',()=>{
  const p=readGraphProject(example), first=p.run({time:.5,inputs:{base:4}});
  assert.equal(first.outputs.intensity,9);
  assert.equal(first.report.cache.misses,3);
  const repeat=p.run({time:.5,inputs:{base:4}});
  assert.equal(repeat.report.cache.hits,3);
  assert.deepEqual(repeat.artifacts[0].bytes,first.artifacts[0].bytes);
  const failed=p.run({time:.5,inputs:{base:1}});
  assert.equal(failed.report.passed,false);
  assert.equal(failed.report.assertions[0].actual,3);
  assert.equal(p.plan({base:8}).resolvedInputs.base,8);
  assert.throws(()=>p.run({inputs:{bass:1}}),/Unknown graph input/);
  assert.throws(()=>p.validate({base:'not a number'}),/Wrong input value/);
});

test('CLI validates, plans, inspects and exports PNG with assertions',t=>{
  const dir=temp(t), asset=path.join(dir,'asset.png'), project=path.join(dir,'project.json');
  const pixels=Uint8Array.of(46,62,112,255,255,198,133,128);
  const png=PNG.encode(2,1,pixels,4);
  fs.writeFileSync(asset,png);
  fs.writeFileSync(project,JSON.stringify(spec({
    assets:{strip:{format:'png',file:'asset.png'}},
    nodes:{source:{op:'pngAsset',inputs:{name:'strip'}}},outputs:{image:{node:'source'}},
    exports:{strip:{output:'image',format:'png'}},
    assertions:[{id:'width',output:'image',path:['width'],op:'eq',value:2}]
  })));
  const invoke=(mode,...args)=>{
    const child=command(mode,project,...args);
    assert.equal(child.status,0,child.stderr);
    return JSON.parse(child.stdout);
  };
  assert.equal(invoke('validate').valid,true);
  assert.equal(invoke('plan').outputs.image.type,'image');
  const out=path.join(dir,'run'), run=invoke('run','--out',out);
  assert.equal(run.assertions[0].actual,2);
  assert.deepEqual(fs.readFileSync(path.join(out,run.artifacts[0].file)),png);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'report.json'))),run);
  const inspected=invoke('inspect','--output','image','--out',path.join(dir,'preview'));
  assert.equal(inspected.value.width,2);
  assert.equal(inspected.artifacts[0].sha256,run.artifacts[0].sha256);
  assert.equal(invoke('inspect','--node','source','--port','value').value.kind,'image');
});

test('batch preserves passing and failing evidence and returns CI status 2',t=>{
  const dir=temp(t), cases=path.join(dir,'cases.json');
  fs.writeFileSync(cases,JSON.stringify([
    {id:'default',time:.5},{id:'repeat',time:.5},{id:'regression',inputs:{base:1},time:.5}
  ]));
  const child=command('batch',example,cases,'--out',dir,'--json');
  assert.equal(child.status,2,child.stderr);
  const report=JSON.parse(child.stdout);
  assert.deepEqual(report.cases.map(row=>row.passed),[true,true,false]);
  assert.equal(report.cases[1].cache.hits,3);
  const regression=path.join(dir,report.cases[2].directory);
  assert.equal(JSON.parse(fs.readFileSync(path.join(regression,report.cases[2].artifacts[0].file))),3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(regression,'report.json'))).passed,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'report.json'))),report);
});

test('NDJSON session answers before EOF, preserves warm caches and recovers from errors',{timeout:10000},async t=>{
  const child=spawn(process.execPath,[cli,'graph','session',example,'--protocol','ndjson'],
    {cwd:root,stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill());
  const done=once(child,'exit');
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
  async function send(request) {
    child.stdin.write(JSON.stringify(request)+'\n');
    return JSON.parse((await lines.next()).value);
  }
  const first=await send({id:1,op:'run',time:.5});
  assert.equal(first.report.outputs.intensity,9);
  assert.equal((await send({id:2,op:'run',inputs:{missing:5}})).code,1);
  const warm=await send({id:3,op:'inspect',node:'gain/scale',time:.5});
  assert.equal(warm.report.cache.hits,3);
  assert.equal(warm.report.value,8);
  assert.equal((await send({id:4,op:'run',inputs:{base:1}})).code,2);
  assert.equal((await send({op:'clear'})).code,0);
  assert.equal((await send({op:'run'})).report.cache.hits,0);
  assert.equal((await send({op:'quit'})).code,0);
  const [code]=await done;
  assert.equal(code,0);
});
