const test=require('node:test'),assert=require('node:assert/strict');
const ink=require('..'),kit=ink.load(),K=kit.KIT,W=K.world,A=W.outputAdapters;
const types=K.procedural.graphTypes, link=(node,port='value')=>({node,port});
const array=values=>Array.from(values);
const wave=(pressure,flow={})=>({format:W.waveNetworks.traceFormat,version:1,info:{sampleRate:24000},
  start:10,end:14,pressure,flow});

test('sampled grids preserve component order, world coordinates and numeric slices',()=>{
  const source={probes:{level:{status:'ok',value:{
    shape:[3,2,2],components:2,origin:[7,8,9],spacing:[1,2,3],unit:'Pa',frame:'duct',
    data:Float64Array.from({length:24},(_,i)=>i*.5)
  }}}};
  const field=A.field(source,{path:'/probes/level'});
  assert.ok(types.validator('gridField')(field));
  const slice=A.fieldRaster(field,{axis:'x',index:1,component:0});
  assert.deepEqual(array(slice.value.data),[1,4,7,10]);
  assert.deepEqual(slice.report,{axes:[1,2],origin:[8,9],spacing:[2,3],unit:'Pa',frame:'duct',axis:'x',index:1});
  const mesh=A.fieldMesh(field,{axis:'x',index:1,component:0,heightScale:2,heightOffset:1});
  assert.deepEqual(array(mesh.pos),[8,3,9,10,9,9,8,15,12,10,21,12]);
  assert.deepEqual(array(mesh.tri),[0,2,1,1,2,3]);
  assert.throws(()=>A.fieldRaster(field,{axis:'x',index:3}),/outside the grid/);
  assert.throws(()=>A.fieldMesh(field),/scalar plane/);
  assert.throws(()=>A.field({status:'missing',reason:'outside'}),/outside/);
  const image={width:2,height:1,channels:1,data:new Float32Array([.2,.5])};
  const normalized=A.field(image);
  assert.deepEqual(normalized.origin,[.5,.5]);
  assert.equal(normalized.frame,'art-pixels');
  normalized.data[0]=100;
  assert.notEqual(image.data[0],100);
  assert.throws(()=>A.field([0,1,2],{shape:[2,2]}),/matching data/);
});

test('point buffers keep IDs and distinguish unmeasured velocity from measured zero',()=>{
  const points=A.points([{id:'a',point:[4,5],velocity:[0,0]},{id:'b',position:[1,2,3]}],{frame:'machine',unit:'cm'});
  assert.ok(types.validator('pointBuffer')(points));
  assert.deepEqual(array(points.positions),[4,5,0,1,2,3]);
  assert.deepEqual(array(points.velocityValid),[1,0]);
  assert.deepEqual(A.pointRecords(points),[{id:'a',point:[4,5,0],velocity:[0,0,0]},{id:'b',point:[1,2,3]}]);
  assert.deepEqual(array(A.points(new Float64Array([1,2,3,4,5,6])).positions),[1,2,3,4,5,6]);
  assert.equal(A.points([]).count,0);
  assert.equal(A.points(new Float64Array()).count,0);
  assert.throws(()=>A.points([{id:1,point:[0,0]},{id:1,point:[0,0]}]),/pointBuffer/);
});

test('native traces preserve clocks and calibrated units through slicing and interleaving',()=>{
  const native=wave({left:[0,1,-1,0],right:[0,0,.25,-.5]},{bell:[0,1,2,3]});
  const pressure=A.trace(native), flow=A.trace(native,{measure:'flow'});
  assert.equal(pressure.channels.left.unit,'Pa');
  assert.equal(flow.channels.bell.unit,'m^3/s');
  const cropped=A.traceWindow(pressure,{from:11,to:14});
  const result=A.audio(cropped,{channels:['right','left'],gain:.5});
  assert.deepEqual(result.report,{startSample:11,endSample:14,frames:3,sampleRate:24000,channels:2});
  assert.deepEqual(array(result.value.samples),[0,.5,.125,-.5,-.25,0]);
  assert.throws(()=>A.audio(cropped,{gain:2}),/normalized PCM/);
  assert.throws(()=>A.audio(cropped),/explicit finite gain/);
  assert.throws(()=>A.traceWindow(pressure,{from:9}),/within the native/);
  const modal=A.trace({format:W.resonantModes.traceFormat,version:1,info:{sampleRate:8000},
    start:10,end:12,pickups:{port:[.01,.04]}});
  assert.equal(modal.channels.port.unit,'model-unit');
  const contact=A.trace({format:W.contactExciters.traceFormat,version:1,info:{sampleRate:8000},
    start:10,end:12,tracks:{shoe:{slip:[1,2,3,4,5,6]}}},{track:'shoe',measure:'slip'});
  assert.deepEqual(array(contact.channels.y.samples),[2,5]);
  assert.equal(contact.channels.y.unit,'m/s');
  const sensor=A.trace({format:W.virtualSensors.reportFormat,version:1,kind:'wave',sampleRate:8000,start:10,end:11,
    readings:{tap:[2]},rig:{sensors:{tap:{quantity:{unit:'kPa'}}}}});
  assert.equal(sensor.channels.tap.unit,'kPa');
});

test('event logs preserve payloads, clock fractions and half-open frame ownership',()=>{
  const exact=W.timedEvents.at(.05,{kind:'hit',tag:'sampled'},{sample:400,fraction:0});
  const native={info:{sampleRate:8000},dropped:2,events:[
    {tick:2,kind:'hit',tag:'world',at:[2,0,1]},exact,
    {timecode:{numerator:1,denominator:20},kind:'hit',tag:'authored'}
  ]};
  const normalized=A.events(native,{dt:1/20});
  assert.deepEqual(normalized.entries.map(row=>row.at),[
    {numerator:1,denominator:20},{numerator:1,denominator:20},{numerator:1,denominator:10}]);
  assert.deepEqual(normalized.entries.map(row=>row.event.tag),['sampled','authored','world']);
  assert.equal(normalized.dropped,2);
  const g=ink.createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{
    log:{op:'sim.outputEvents',inputs:{source:native,options:{dt:1/20}}},
    frame:{op:'sim.eventWindow',inputs:{source:link('log')}}
  },outputs:{events:link('frame','events')}},{kit});
  const clock=K.timeDomains.take({fps:20});
  assert.deepEqual(g.run({take:clock.at(0)}).outputs.events,[]);
  assert.deepEqual(g.run({take:clock.at(1)}).outputs.events.map(row=>row.tag),['sampled','authored']);
  assert.deepEqual(g.run({take:clock.at(2)}).outputs.events.map(row=>row.tag),['world']);
  const nearCut=W.timedEvents.at(.05,{kind:'cut'},{sample:399,fraction:.9999999999999999});
  const wide=A.events({info:{sampleRate:8000},events:[nearCut]});
  assert.equal(wide.entries[0].at,.05);
  assert.ok(wide.entries[0].exact);
  assert.equal(A.eventWindow(wide,0,.05).entries.length,1);
  assert.equal(A.eventWindow(wide,.05,.1).entries.length,0);
  assert.throws(()=>A.events([{kind:'untimed',tick:3}]),/explicit period/);
});

test('stock simulation ports feed typed field, point, raster, geometry and WAV consumers',()=>{
  const g=ink.createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{
    recipe:{op:'sim.define',inputs:{kind:'particles',settings:{width:12,height:12,emitters:[{at:[4,4],rate:60}]},
      clock:{dt:1/60}}},
    simulation:{op:'sim.run',inputs:{recipe:link('recipe')}},
    view:{op:'sim.fieldRaster',inputs:{source:link('simulation','grid')}},
    surface:{op:'sim.fieldMesh',inputs:{source:link('simulation','grid')}},
    mesh:{op:'sim.outputMesh',inputs:{source:link('surface')}},
    image:{op:'sim.outputRaster',inputs:{source:link('simulation')}},
    points:{op:'sim.pointRecords',inputs:{source:link('simulation','pointBuffer')}},
    trace:{op:'sim.outputTrace',inputs:{source:wave({left:[0,.5,0,-.5]})}},
    sound:{op:'sim.outputAudio',inputs:{source:link('trace'),options:{gain:1}}}
  },outputs:{
    raster:link('image'),density:link('view'),mesh:link('mesh'),points:link('points'),sound:link('sound'),
    grid:link('simulation','grid'),pointBuffer:link('simulation','pointBuffer')
  },exports:{sound:{output:'sound',format:'wav'}}},{kit});
  const result=g.run({time:.1});
  assert.equal(g.plan().outputs.grid.type,'gridField');
  assert.equal(g.plan().outputs.pointBuffer.type,'pointBuffer');
  assert.ok(result.outputs.points.length>0);
  assert.equal(result.outputs.mesh.pos.length,12*12*3);
  assert.equal(result.outputs.raster.channels,4);
  assert.ok(result.outputs.density.data.some(n=>n>0));
  assert.deepEqual(array(result.outputs.sound.samples),[0,.5,0,-.5]);
  assert.deepEqual(array(ink.decodeWav(result.artifacts[0].bytes).samples),[0,.5,0,-.5]);
  assert.equal(types.compatible('trace','audio'),false);
  assert.equal(types.compatible('gridField','raster'),false);
});

test('sim.model exposes only the selected tick events through its typed event port',()=>{
  W.runtime.register('adapter-event-test',()=>({
    initial:()=>0,
    step(state,{emit}) {
      emit('tap',{at:[0,1,2],count:state+1});
      return state+1;
    }
  }),{revision:1});
  const model={format:W.models.format,version:1,id:'event-fixture',revision:1,seed:2,numerics:{dt:1/60},
    domain:{},parameters:{},initial:{},boundaries:{},inputs:{},outputs:{},probes:{},
    operators:{driver:{kind:'adapter-event-test',revision:1}}};
  const graph=ink.createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{
    simulation:{op:'sim.model',inputs:{model}}
  },outputs:{log:link('simulation','events')}},{kit});
  const pairs=[3,1,3].map(tick=>graph.run({time:tick/60}).outputs.log.entries);
  assert.equal(graph.plan().outputs.log.type,'eventLog');
  assert.deepEqual(pairs[0],pairs[2]);
  assert.equal(pairs[0].length,1);
  assert.deepEqual(pairs[0][0].at,{numerator:1,denominator:20});
  assert.equal(pairs[0][0].event.count,3);
  assert.deepEqual(pairs[1][0].event.at,[0,1,2]);
  assert.equal(pairs[1][0].event.count,1);
});
