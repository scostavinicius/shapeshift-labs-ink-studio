const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT:K}=require('..').load(), W=K.world;
const {compile,trace,format}=W.domains;
const plain=o=>JSON.parse(JSON.stringify(o));
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const walls={kind:'contours',banks:{left:[[0,-1],[1,-1]],right:[[0,1],[1,1]],depth:1}};
const feedPath=[[0,0,0],[0,0,2]];
function specimen() {
  return {format,version:1,id:'splitter',revision:3,
    nodes:{
      supply:{kind:'reservoir',at:[0,0,0],volume:20,geometry:'tank'},
      junction:{kind:'junction',at:[0,0,2],sockets:{in:{},a:{},b:{offset:[0,0,0.25]}}},
      cavity:{kind:'cavity',at:[2,0,4],volume:5},
      end:{kind:'terminal',at:[-2,0,4]},
      isolated:{kind:'terminal',at:[-2,0,4]}
    },
    paths:{feed:{revision:5,points:feedPath},upper:{guides:[[1,0,3]]},lower:{guides:[]}},
    geometries:{bore:{revision:2,asset:'canal-profile',source:walls},tank:{revision:7,asset:'supply-body'}},
    tubes:{
      feed:{from:'supply/center',to:'junction/in',path:'feed',geometry:'bore',sampling:{distances:[0.5,1.5]}},
      upper:{from:'junction/a',to:'cavity/center',path:'upper',geometry:'bore',sampling:{samples:3}},
      lower:{from:'junction/b',to:'end/center',path:'lower',geometry:'bore',sampling:{samples:2}}
    },
    ports:{fill:{kind:'inlet',socket:'supply/center'},drain:{kind:'outlet',socket:'end/center'}},
    observations:{tap:{socket:'junction/in'},middle:{tube:'feed',distance:1},
      half:{tube:'upper',t:0.5},first:{tube:'feed',section:0}}
  };
}

test('socket attachments, named ports and observations form explicit connected components',()=>{
  let calls=0;
  const authored=specimen(), compiled=compile(authored,{resolveSource(source){calls++;return source;}});
  assert.equal(calls,1);
  assert.equal(compiled.complete,true);
  assert.equal(compiled.sectionCount,7);
  assert.deepEqual(plain(compiled.nodes.junction.tubes),['feed','lower','upper']);
  assert.deepEqual(plain(compiled.nodes.junction.sockets.b.tubes),['lower']);
  assert.deepEqual(plain(compiled.tubes.lower.points[0]),[0,0,2.25]);
  assert.equal(compiled.nodes.supply.geometry.id,'tank');
  assert.equal(compiled.nodes.cavity.volume,5);
  assert.deepEqual(plain(compiled.components),[
    {nodes:['cavity','end','junction','supply'],tubes:['feed','lower','upper']},
    {nodes:['isolated'],tubes:[]}
  ]);
  assert.equal(compiled.ports.fill.kind,'inlet');
  assert.equal(compiled.ports.drain.node,'end');
  assert.equal(compiled.observations.tap.node,'junction');
  assert.equal(compiled.observations.middle.section,'feed/1');
  assert.deepEqual(plain(compiled.observations.middle.point),[0,0,1]);
  assert.equal(compiled.observations.first.distance,0.5);
  close(compiled.tubes.feed.volume,4);

  const detail=trace(plain(compiled),'feed/1');
  assert.deepEqual(plain(detail.path.points),feedPath);
  assert.equal(detail.section.origin.path.revision,5);
  assert.equal(detail.section.origin.geometry.revision,2);
  assert.equal(detail.section.origin.geometry.asset,'canal-profile');
  assert.equal(detail.section.origin.station,1);
  assert.equal(detail.section.area,2);
  assert.equal(detail.section.sectionLength,1);
  assert.equal(detail.from.node,'supply');
  assert.equal(detail.to.socket,'in');
  assert.throws(()=>trace(compiled,'feed/9'),/Unknown domain section/);
  assert.equal(Object.isFrozen(authored.geometries.bore.source),false);
  assert.deepEqual(compile(authored),compiled);
});

test('world socket selectors anchor ends and resolve offsets in the node frame',()=>{
  const authored=specimen();
  authored.nodes.supply.at={entity:'tank',socket:'out'};
  authored.nodes.junction.at={entity:'fitting',socket:'core'};
  authored.nodes.junction.sockets.a={offset:[1,0,0]};
  authored.paths.feed={guides:[{entity:'anchor',socket:'edge'}]};
  const query={frame({entity,socket}) {
    if(entity==='tank'&&socket==='out')return {point:[1,0,0]};
    if(entity==='anchor'&&socket==='edge')return {point:[1,0,0.75]};
    if(entity==='fitting'&&socket==='core')return {point:[1,0,2],rotation:K.M.rot([0,1,0],Math.PI/2)};
    return null;
  }};
  const compiled=compile(authored,{query,snapshot:{world:'yard',tick:12}});
  assert.deepEqual(plain(compiled.snapshot),{world:'yard',tick:12});
  assert.deepEqual(plain(compiled.paths.feed.placements),[{entity:'anchor',socket:'edge'}]);
  assert.deepEqual(plain(compiled.tubes.feed.points),[[1,0,0],[1,0,0.75],[1,0,2]]);
  close(compiled.nodes.junction.sockets.a.point[0],1);
  close(compiled.nodes.junction.sockets.a.point[2],1);
  assert.throws(()=>compile(authored),/cannot resolve/);
});

test('explicit gaps are diagnosed and incomplete source sections keep their provenance',()=>{
  let authored=specimen();
  authored.tubes.feed.to='junction/missing';
  assert.throws(()=>compile(authored),/unknown socket/);
  authored=specimen();
  authored.paths.feed.points=[[0,0,0],[0,0,1.5]];
  assert.throws(()=>compile(authored),/endpoints do not match/);
  authored=specimen();
  authored.geometries.bore.source={kind:'sdf',field:()=>-1,bounds:{min:[-1,-1],max:[1,1]}};
  const partial=compile(authored), failure=trace(partial,'feed/0').section;
  assert.equal(partial.complete,false);
  assert.equal(partial.tubes.feed.volume,null);
  assert.equal(failure.status,'clipped');
  assert.equal(failure.origin.geometry.kind,'sdf');
  authored.maxWork=2;
  assert.throws(()=>compile(authored),/work budget/);
});

test('an embedded compiled domain supplies geometry and named sites to an ordinary simulation model',()=>{
  const domain=compile(specimen());
  const model={format:W.models.format,version:1,id:'pipe-split',revision:1,seed:8,numerics:{dt:0.05},
    domain,parameters:{},initial:{},boundaries:{},inputs:{},
    outputs:{flow:'pipe/flow.feed'},probes:{junction:{field:'pipe/nodes',args:{node:domain.observations.tap.node}}},
    operators:{pipe:{kind:'pipe-network',revision:1,config:{
      nodes:{supply:{capacity:{$model:'/domain/nodes/supply/volume'},initial:10},
        junction:{position:{$model:'/domain/nodes/junction/point'},capacity:1}},
      pipes:{feed:{from:'supply',to:'junction',conductance:{$model:'/domain/tubes/feed/sections/0/area'}}}
    }}}};
  const run=W.runtime.create(plain(model));
  run.advance(3);
  const sample=W.models.sample(run);
  assert.ok(sample.outputs.flow>0);
  assert.ok(sample.probes.junction.value.volume>0);
});

test('CLI compiles scene sockets and traces a saved portable domain',()=>{
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'ink-branched-domain-'));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const authored=specimen();
  authored.nodes.supply.at={entity:'source',socket:'bore'};
  authored.paths.feed={guides:[]};
  const world={format:W.format,version:1,id:'station',entities:{source:{position:[0,0,-1],sockets:{bore:[0,0,1]}}}};
  const write=(name,value)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(value));
  const invoke=(...args)=>execFileSync(process.execPath,[cli,'sim','domain',...args],{cwd,encoding:'utf8'});
  try {
    write('branch.json',authored);
    write('world.json',world);
    invoke('branch.json','--world','world.json','--out','baked.json');
    const compiled=JSON.parse(fs.readFileSync(path.join(cwd,'baked.json'),'utf8'));
    assert.deepEqual(compiled.snapshot,{world:'station',tick:0});
    const one=JSON.parse(invoke('baked.json','--section','feed/0'));
    const two=JSON.parse(invoke('branch.json','--world','world.json','--section','feed/0'));
    assert.deepEqual(one,two);
    assert.deepEqual(one.domain.snapshot,compiled.snapshot);
    assert.equal(one.section.origin.geometry.id,'bore');
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
});
