const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createGraphProject, readGraphProject, load } = require('..');

const input = name => ({input:name});
const node = name => ({node:name});
const project = body => createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{},outputs:{},...body});
const example = path.join(__dirname,'../examples/headless-array-graph.json');
const sweepFile = path.join(__dirname,'../examples/headless-array-sweep.json');
const { KIT: kit } = load();

test('typed media ports carry native values through graphs and exports',()=>{
  const sources={
    raster:{width:1,height:1,data:Uint8Array.of(40,80,120,255)},
    field:kit.procedural.graph.material({height:3}),
    path:kit.curve.line([0,0,0],[1,0,1],2),
    mesh:{positions:Float32Array.of(0,0,0,1,0,0,0,0,1),indices:Uint32Array.of(0,1,2)},
    palette:{palette:['#285078',0xffffff,[.5,.25,0]]},
    atlas:{metadata:{width:1,height:1,frames:[{rect:{x:0,y:0,width:1,height:1}}]},
      images:{color:Uint8Array.of(40,80,120,255)}},
    audio:{sampleRate:48000,channels:2,samples:Float32Array.of(0,.5,1,-1)}
  };
  const types=Object.keys(sources);
  const p=project({
    inputs:Object.fromEntries(types.map(type=>[type,type])),
    nodes:{
      ...Object.fromEntries(types.map(type=>[type,{op:'data.typed',type,inputs:{value:input(type)}}])),
      atlasHandle:{op:'atlas.compile',inputs:{source:node('atlas')}},
      walk:{op:'meshPaths',inputs:{mesh:node('mesh'),sources:[0],targets:[1]}},
      sample:{op:'materialSample',inputs:{source:node('field'),uv:[0,0]}}
    },
    outputs:{...Object.fromEntries(types.map(type=>[type,node(type)])),
      atlasHandle:node('atlasHandle'),walk:{node:'walk',port:'curves'},height:{node:'sample',port:'height'}},
    exports:{pixel:{output:'raster',format:'png'},pcm:{output:'audio',format:'json'}}
  });
  const plan=p.plan(sources);
  for (const type of types) assert.equal(plan.outputs[type].type,type);
  assert.deepEqual(plan.resolvedInputs.raster,{kind:'image',width:1,height:1,samples:4});
  const result=p.run({inputs:sources});
  assert.deepEqual(result.outputs.raster.data,sources.raster.data);
  assert.deepEqual(result.outputs.path,sources.path);
  assert.deepEqual(result.outputs.walk[0].points,[[0,0,0],[1,0,0]]);
  assert.equal(result.outputs.height,3);
  const atlasHandle=result.outputs.atlasHandle;
  assert.deepEqual(atlasHandle.select(0,'card').rect,sources.atlas.metadata.frames[0].rect);
  assert.equal(p.run({inputs:{...sources,atlas:atlasHandle}}).outputs.atlasHandle,atlasHandle);
  assert.deepEqual(JSON.parse(result.artifacts[1].bytes),{sampleRate:48000,channels:2,samples:[0,.5,1,-1]});
  assert.equal(result.artifacts[0].format,'png');

  const malformed={
    raster:{width:2,height:2,data:[0,1,2]},
    field:{sample:2},
    path:[[0,0],[0,0,0]],
    mesh:{...sources.mesh,indices:[0,1,3]},
    palette:[0x1000000],
    atlas:{...sources.atlas,images:{color:[0,0,0,256]}},
    audio:{...sources.audio,samples:[0,1,-1]}
  };
  for (const [type,value] of Object.entries(malformed))
    assert.throws(()=>p.validate({...sources,[type]:value}),new RegExp('Wrong input value for graph socket '+type));
  assert.throws(()=>p.validate({...sources,audio:{...sources.audio,samples:[0,2]}}),/Wrong input value/);
});

test('reusable groups give arrays typed operations, original indices and stable sort keys',()=>{
  const callback=(inputs,nodes,value)=>({inputs,nodes,outputs:{value}});
  const groups={
    Score:callback({item:'record'},{
      get:{op:'data.get',inputs:{record:input('item'),key:'score'}},
      typed:{op:'data.typed',type:'number',inputs:{value:node('get')}}
    },node('typed')),
    Index:callback({item:'record',index:'number'},{},input('index')),
    Sum:callback({item:'number',accumulator:'number'},{
      add:{op:'add',inputs:{a:input('accumulator'),b:input('item')}}
    },node('add'))
  };
  const p=project({groups,inputs:{items:'array<record>'},nodes:{
    ordered:{op:'array.sort',group:'Score',inputs:{items:input('items'),direction:'desc'}},
    indices:{op:'array.map',group:'Index',inputs:{items:node('ordered')}},
    total:{op:'array.reduce',group:'Sum',inputs:{items:node('indices'),initial:10}}
  },outputs:{ordered:node('ordered'),indices:node('indices'),total:node('total')}});
  const items=[{name:'A',score:3},{name:'B',score:1},{name:'C',score:3}];
  assert.equal(p.plan().outputs.indices.type,'array<number>');
  const {outputs}=p.run({inputs:{items}});
  assert.deepEqual(outputs.ordered.map(item=>item.name),['A','C','B']);
  assert.deepEqual(outputs.indices,[0,1,2]);
  assert.equal(outputs.total,13);
  assert.equal(p.run({inputs:{items}}).report.cache.hits,3);
  assert.equal(p.run({inputs:{items:[]}}).outputs.total,10);
  assert.throws(()=>project({groups,inputs:{items:'array<string>'},nodes:{
    map:{op:'array.map',group:'Index',inputs:{items:input('items')}}
  }}),/Incompatible graph socket map.items/);
  assert.throws(()=>project({groups,nodes:{
    filter:{op:'array.filter',group:'Score',inputs:{items}}
  }}),/filter groups must return a boolean/);
  assert.throws(()=>project({groups:{Self:callback({item:'number'},
    {nested:{op:'array.map',group:'Self',inputs:{items:[]}}},node('nested'))}}),/group cycle/);
  const nested=project({inputs:{grid:'array<array<number>>'},outputs:{grid:input('grid')}});
  assert.deepEqual(nested.run({inputs:{grid:[[1],[],[2,3]]}}).outputs.grid,[[1],[],[2,3]]);
  assert.throws(()=>nested.validate({grid:[[1],['invalid']]}),/Wrong input value/);
});

test('explicit broadcasts align unequal arrays and traverse Cartesian products in either order',()=>{
  const {broadcast}=kit.procedural.graph.arrays;
  const a=[1,2], b=['x','y','z'];
  const rows=mode=>broadcast({b,a},{mode}).map(row=>[row.a,row.b]);
  assert.deepEqual(rows('cycle'),[[1,'x'],[2,'y'],[1,'z']]);
  assert.deepEqual(rows('hold'),[[1,'x'],[2,'y'],[2,'z']]);
  assert.deepEqual(rows('cartesian'),[[1,'x'],[1,'y'],[1,'z'],[2,'x'],[2,'y'],[2,'z']]);
  assert.deepEqual(rows('cartesianReverse'),[[1,'x'],[2,'x'],[1,'y'],[2,'y'],[1,'z'],[2,'z']]);
  assert.throws(()=>rows('zip'),/equal array lengths/);
  assert.throws(()=>rows(undefined),/explicit mode/);
  assert.throws(()=>broadcast({a,b},{mode:'cartesian',limit:5}),/row budget/);
  assert.deepEqual(broadcast({a:[],b},{mode:'hold'}),[]);
  const p=project({inputs:{a:{type:'array<number>',default:a}},nodes:{
    axes:{op:'data.record',inputs:{a:input('a'),b:['x','y']}},
    zip:{op:'array.broadcast',inputs:{arrays:node('axes'),mode:'zip'}}
  },outputs:{rows:node('zip')}});
  assert.deepEqual(p.run().outputs.rows,[{a:1,b:'x'},{a:2,b:'y'}]);
  assert.deepEqual(p.run({inputs:{a:[3,4]}}).outputs.rows,[{a:3,b:'x'},{a:4,b:'y'}]);
  assert.equal(p.plan().outputs.rows.type,'array<record>');
});

test('CLI Cartesian sweeps write reproducible cases, artifacts and assertion reports',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-array-sweep-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.join(__dirname,'../cli/ink-studio.js');
  const child=spawnSync(process.execPath,[cli,'graph','batch',example,sweepFile,'--out',dir],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(child.stdout);
  assert.equal(report.passed,true);
  assert.equal(report.sweep.count,6);
  assert.deepEqual(report.cases.map(row=>row.id),Array.from({length:6},(_,i)=>'signal-00'+(i+1)));
  assert.deepEqual(report.cases.map(row=>row.assertions[0].actual),[7,4,14,14,24,21]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'cases/signal-006/artifacts/values.json'))),[9,12]);
  const p=readGraphProject(example);
  const result=p.batch({sweep:{time:[0,1],seed:[2,3],inputs:{threshold:[3,100]}}});
  assert.equal(result.report.passed,false);
  assert.deepEqual(result.report.cases.map(row=>[row.seed,row.time,row.passed]),
    [[2,0,true],[2,1,true],[3,0,true],[3,1,true],[2,0,false],[2,1,false],[3,0,false],[3,1,false]]);
  assert.throws(()=>p.batch({sweep:{seed:[]}}),/at least one value/);
  assert.throws(()=>p.batch({sweep:{inputs:{gn:[1]}}}),/Unknown graph input gn/);
});
