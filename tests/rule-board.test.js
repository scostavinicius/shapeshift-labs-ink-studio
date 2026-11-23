const assert = require('node:assert/strict');
const test = require('node:test');
const { KIT: K } = require('..').load();
const { compile } = K.ruleBoard;
const tracks = {
  ns:{paths:['NS']}, ew:{paths:['EW']}, nw:{paths:['NW']}, ne:{paths:['NE']},
  sw:{paths:['SW']}, se:{paths:['ES']}
};
const placed = (part,id,state) => ({part,id,state});

test('turning a paired tile sends the source to the other glyph and turns its exact cel', ()=>{
  const { variants:{b} }=K.pixelTiles.pairedArcs(12);
  const board=compile({width:3,height:3,size:12,parts:{...tracks,
    selector:{paths:b.pairs,cel:b.cel}, west:{outputs:'E'}, east:{outputs:'W'},
    upper:{inputs:'S'}, lower:{inputs:'N'}},
  cells:[null,placed('upper','iris'),null,placed('west','ember',1),'selector',placed('east','moon',0),
    null,placed('lower','bell'),null]});
  const turned=board.edit([{op:'turn',at:[1,1]}]);
  assert.deepEqual(board.graph.edges.map(({id})=>id),['ember:E>iris:S','moon:W>bell:N']);
  assert.deepEqual(turned.graph.edges.map(({id})=>id),['ember:E>bell:N','moon:W>iris:S']);
  const {added,removed}=board.diff(turned);
  assert.deepEqual(added.map(({id})=>id),['ember:E>bell:N','moon:W>iris:S']);
  assert.deepEqual(removed.map(({id})=>id),['ember:E>iris:S','moon:W>bell:N']);
  assert.deepEqual(added[0].data.path,[
    {at:[0,1],side:'E'},{at:[1,1],side:'W'},{at:[1,1],side:'S'},{at:[1,2],side:'N'}
  ]);
  const run=turned.create();
  run.step();
  assert.equal(run.get('bell'),1);
  assert.equal(run.get('iris'),0);
  const original=board.raster(), rotated=turned.raster();
  for (let y=0;y<12;y++) for(let x=0;x<12;x++){
    const at=(u,v)=>4*((v+12)*original.w+u+12);
    assert.deepEqual(rotated.rgba.slice(at(11-y,x),at(11-y,x)+4),original.rgba.slice(at(x,y),at(x,y)+4));
  }
  assert.throws(()=>turned.edit([{op:'move',from:[1,2],to:[0,1]}]),/empty destination/);
  const moved=turned.edit([{op:'move',from:[1,2],to:[0,2]}]);
  assert.deepEqual(turned.diff(moved).moved,[{id:'bell',from:[1,2],to:[0,2]}]);
  assert.deepEqual(turned.diff(moved).removed.map(({id})=>id),['ember:E>bell:N']);
  assert(moved.unmatched.some(({id,side})=>id==='bell' && side==='N'));
  assert.deepEqual(turned.cells[7],{part:'lower',id:'bell',turn:0});
});

test('a closed wire loop gives one logical edge and reports a new route when the used arc opens', ()=>{
  const board=compile({width:5,height:3,parts:{...tracks,split:{paths:['NSW']},join:{paths:['NES']},
    source:{outputs:'E'}, lamp:{inputs:'W'}},cells:[
    null,'se','ew','sw',null,
    placed('source','furnace',1),'split',null,'join',placed('lamp','lamp'),
    null,'ne','ew','nw',null
  ]});
  assert.equal(board.graph.edges.length,1);
  const edge=board.graph.edges[0];
  const bypass=board.edit([{op:'set',at:[2,0],cell:null}]), report=board.diff(bypass);
  assert.equal(report.added.length,0);
  assert.equal(report.removed.length,0);
  assert.equal(report.rerouted.length,1);
  assert.equal(report.rerouted[0].after.id,edge.id);
  assert(report.rerouted[0].before.data.path.some(({at})=>at[0]===2&&at[1]===0));
  assert(report.rerouted[0].after.data.path.some(({at})=>at[0]===2&&at[1]===2));
  assert(Object.isFrozen(report.rerouted[0].after.data.path[0].at));
  assert.throws(()=>compile({width:1,height:1,parts:{bad:{paths:['NW','NS']}},cells:['bad']}),/socket more than once/);
});

test('glyphs drive the existing graph rules and unconnected inputs of all stay low', ()=>{
  const board=compile({width:3,height:2,parts:{west:{outputs:'E'}, north:{outputs:'S'},
    gate:{inputs:'WN',outputs:'E',type:'all'}, active:{inputs:'W'}},cells:[
    null,placed('north','rain',1),null,
    placed('west','heat',1),placed('gate','relay'),placed('active','seal')
  ]});
  const graph=board.create();
  graph.step();
  assert.equal(graph.get('relay'),1);
  assert.equal(graph.get('seal'),0);
  graph.step();
  assert.equal(graph.get('seal'),1);
  graph.edit([{id:'rain',state:0}]);
  graph.step(2);
  assert.equal(graph.get('seal'),0);
  const open=board.edit([{op:'set',at:[1,0],cell:null}]).create();
  open.step(2);
  assert.equal(open.get('relay'),0);
  const custom=board.create({rule:K.cellular.graph.rules.pulse({refractory:2})});
  assert.equal(custom.states,4);
  custom.step(2);
  assert.equal(custom.get('seal'),1);
  const blank={width:8,height:8,rows:Array(8).fill('........'),palette:['#ffffff']};
  assert.throws(()=>compile({width:1,height:1,parts:{bad:{inputs:'E',cel:blank}},cells:[placed('bad','bad')]}),
    /center pair of pixels/);
});
