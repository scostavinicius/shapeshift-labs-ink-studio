const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {execFileSync}=require('node:child_process');
const {world:W}=require('..').load().KIT;
const {compile,format}=W.discretization, {transfer,prepare}=W.stateRemap;
const sourcePlan=(id,source)=>({format,version:1,id,revision:1,units:'m',source});
const grid=(id,size,options={})=>compile(sourcePlan(id,{kind:'grid',size,...options}));
const near=(value,expected,tol=1e-10)=>assert.ok(Math.abs(value-expected)<=tol,`${value} differs from ${expected}`);
const plain=value=>JSON.parse(JSON.stringify(value));

test('resolution-only change conserves nonuniform mass and heat and can reuse overlap geometry',()=>{
  const coarse=grid('coarse',[2,1,1]), fine=grid('fine',[4,2,2],{spacing:0.5});
  const mapping=prepare(coarse,fine), values=new Float64Array([5,11]);
  const result=mapping.transfer({mass:{units:'kg',values,initializeDensity:9},heat:{units:'J',values:[-60,200]}},{details:true});
  for(const [i,cell] of fine.cells.entries()){
    near(result.channels.mass.values[i],(cell.address[0]<2?5:11)/8);
    near(result.channels.heat.values[i],(cell.address[0]<2?-60:200)/8);
  }
  for(const [name,total] of [['mass',16],['heat',140]]){
    assert.equal(result.ledger[name].escaped,0);
    assert.equal(result.ledger[name].initialized,0);
    near(result.ledger[name].output,total);
    near(result.ledger[name].balanceError,0);
  }
  assert.equal(result.geometry.escaped,0);
  assert.equal(result.geometry.opened,0);
  assert.equal(result.coverage.target.length,16);
  assert.equal(result.coverage.links.length,16);
  assert.deepEqual(plain(result.coverage.links[0]),{from:0,to:0,measure:0.125});
  near(mapping.transfer({mass:{units:'kg',values:[1,1]}}).ledger.mass.output,2);
  const back=transfer(fine,coarse,result.channels);
  back.channels.mass.values.forEach((value,i)=>near(value,[5,11][i]));
  assert.deepEqual(Array.from(values),[5,11]);
});

test('a shifted planar boundary retains overlap, reports signed exports and seeds new area only',()=>{
  const before=grid('before',[2,1],{plane:'xz',origin:[0,4,0]});
  const after=grid('after',[2,1],{plane:'xz',origin:[0.5,4,0]});
  const result=transfer(before,after,{mass:{units:'kg',values:[2,8],initializeDensity:[200,5]},
    relativeHeat:{units:'J',values:[-2,10],initializeDensity:-4}},{details:true});
  assert.deepEqual(plain(result.coverage.source),[{id:'0,0',covered:0.5,escaped:0.5},{id:'1,0',covered:1,escaped:0}]);
  assert.deepEqual(plain(result.coverage.target),[{id:'0,0',covered:1,opened:0},{id:'1,0',covered:0.5,opened:0.5}]);
  assert.deepEqual(plain(result.channels.mass.values),[5,6.5]);
  assert.deepEqual(plain(result.channels.relativeHeat.values),[4,3]);
  assert.equal(result.ledger.mass.moved,9);
  assert.equal(result.ledger.mass.escaped,1);
  assert.equal(result.ledger.mass.initialized,2.5);
  assert.equal(result.ledger.relativeHeat.escaped,-1);
  assert.equal(result.ledger.relativeHeat.initialized,-2);
  assert.equal(result.ledger.relativeHeat.balanceError,0);
  assert.throws(()=>prepare(before,grid('wrong-plane',[1,1])),/matching dimension, units and plane/);
});

test('changing a cut shape measures partial overlap and tracks the boundary ledger',()=>{
  const before=grid('old-cut',[2,2,2],{spacing:0.5,cutPlanes:[{id:'old',normal:[1,1,0],offset:1}]});
  const after=grid('new-cut',[2,2,2],{spacing:0.5,cutPlanes:[{id:'new',normal:[-1,1,0],offset:0}]});
  const masses=before.cells.map(cell=>12*cell.measure);
  const result=transfer(before,after,{mass:{units:'kg',values:masses,initializeDensity:8}},{details:true});
  near(result.geometry.source,0.5);
  near(result.geometry.target,0.5);
  near(result.geometry.overlap,0.25);
  near(result.geometry.escaped,0.25);
  near(result.geometry.opened,0.25);
  near(result.ledger.mass.input,6);
  near(result.ledger.mass.moved,3);
  near(result.ledger.mass.escaped,3);
  near(result.ledger.mass.initialized,2);
  near(result.ledger.mass.output,5);
  near(result.ledger.mass.balanceError,0);
});

test('tetrahedron remaps to a box and back, with empty material tracked separately',()=>{
  const solid=compile(sourcePlan('tet',{kind:'mesh',positions:[0,0,0,1,0,0,0,1,0,0,0,1],tetrahedra:[0,1,2,3]}));
  const lattice=grid('cubes',[2,2,2],{spacing:0.5});
  const toLattice=transfer(solid,lattice,{mass:{units:'kg',values:[6]}},{details:true});
  near(toLattice.geometry.opened,5/6);
  near(toLattice.ledger.mass.output,6);
  assert.equal(toLattice.ledger.mass.escaped,0);
  const back=transfer(lattice,solid,{mass:{units:'kg',values:lattice.cells.map(cell=>36*cell.measure)}});
  near(back.ledger.mass.output,6);
  near(back.ledger.mass.escaped,30);
  near(back.geometry.opened,0);
  near(transfer(solid,solid,{mass:{units:'kg',values:[6]}}).ledger.mass.output,6);
});

test('disconnected sparse cells allocate only active overlap and validate inputs and work limits',()=>{
  const before=grid('sparse',[10000,1,1],{blocks:{left:{index:[3,0,0],size:[1,1,1]}}});
  const after=grid('stranded',[10000,1,1],{blocks:{right:{index:[900,0,0],size:[1,1,1]}}});
  const mapping=prepare(before,after,{maxPairs:1});
  const result=mapping.transfer({mass:{units:'kg',values:[3],initializeDensity:2}});
  assert.equal(result.geometry.overlaps,0);
  assert.equal(result.geometry.candidates,0);
  assert.equal(result.ledger.mass.escaped,3);
  near(result.ledger.mass.initialized,2);
  near(result.ledger.mass.output,2);
  assert.throws(()=>mapping.transfer({mass:{units:'kg',values:[NaN]}}),/finite extensive value/);
  assert.throws(()=>mapping.transfer({mass:{units:'kg',values:[1],initializeDensity:[1,2]}}),/target cell order/);
  assert.throws(()=>prepare(grid('one',[1,1,1]),grid('two',[2,1,1],{spacing:0.5}),{maxPairs:1}),/overlap candidate budget/);
});

test('CLI accepts relative authored and compiled plans and returns replayable channel data',()=>{
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-state-remap-')), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const write=(file,value)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));
  const from=sourcePlan('one',{kind:'grid',size:[1,1,1]}), to=grid('two',[2,2,2],{spacing:0.5});
  const plan={format:W.stateRemap.format,version:1,source:'source.json',target:'compiled.json',
    channels:{heat:{units:'J',values:[32]}},options:{details:true}};
  try{
    write('source.json',from);
    write('compiled.json',to);
    write('remap.json',plan);
    execFileSync(process.execPath,[cli,'sim','remap','remap.json','--out','report.json'],{cwd});
    const report=JSON.parse(fs.readFileSync(path.join(cwd,'report.json'),'utf8'));
    assert.deepEqual(report.channels.heat.values,Array(8).fill(4));
    assert.equal(report.ledger.heat.balanceError,0);
    assert.equal(report.coverage.target.length,8);
  }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
