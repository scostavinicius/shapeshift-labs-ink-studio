const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const {KIT:K}=require('..').load(), W=K.world,B=W.boundaryConditions;
const close=(a,b,tol=1e-11)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);
const set=rules=>({format:B.format,version:1,id:'boundary-bench',revision:2,rules});
const pulse={kind:'pulse',at:.125,duration:.25,amplitude:4};
const domain=(x,y)=>W.discretization.compile({format:W.discretization.format,version:1,id:'bench',revision:1,
  source:{kind:'grid',size:[x,y],spacing:[1/x,1/y]},regions:[{tag:'west',side:'x0'}]});
const seat={seat:{points:[[0,0,0],[1,0,0],[0,0,1]],triangles:[[0,2,1]],normal:[0,1,0]},
  moving:[[0,.1,0],[1,.1,0],[0,.1,1]]};
const wall={kind:'moving-wall',geometry:seat,motion:{keys:[{time:0,value:0},{time:.01,value:-.02},{time:.02,value:0}]}};
const tube={format:W.waveNetworks.format,version:1,id:'guide',nodes:{a:{},b:{}},ports:{entrance:'a',exit:'b'},
  tubes:{line:{from:'a',to:'b',sections:[{length:1.2,area:.02}]}},observations:{a:{node:'a'},b:{node:'b'}}};
const sampleRate=1000, soundSpeed=200,density=1.2,Y=.02/(density*soundSpeed);
const options={method:'delay',sampleRate,soundSpeed,density};

test('boundary tapes report instantaneous values and exact interval averages',()=>{
  const asset=B.prepare(set({
    heat:{kind:'fixed-value',signal:{keys:[{time:.25,value:2},{time:.75,value:6}],outside:'zero'}},
    tap:{kind:'disturbance',signal:pulse},
    valve:{kind:'flux',signal:{keys:[{time:0,value:2},{time:.5,value:0}],interpolation:'step'}}
  }));
  const view=asset.sample(0,1);
  close(view.rules.heat.value,0);
  close(view.rules.heat.integral,2);
  close(view.rules.tap.integral,.5);
  close(view.rules.valve.integral,1);
  close(asset.level('heat',.5),4);
  close(asset.level('tap',.15,.07)*.07+asset.level('tap',.22,.91)*.91,asset.level('tap',.15,.98)*.98);
  assert.throws(()=>asset.sample(-1),/time interval/);
});

test('grid keeps integral flux and localized disturbances conservative through refinement',()=>{
  const asset=set({feed:{kind:'flux',basis:'total',signal:pulse},
    tracer:{kind:'disturbance',signal:{kind:'pulse',at:.2,duration:.2,amplitude:3,shape:'box'}}});
  const selected={min:[.51,0,0],max:[1,1,0]};
  for(const [x,y] of [[2,2],[8,8]]){
    const grid=W.gridOperators.prepare(domain(x,y),{conditions:{asset,boundaries:{west:'feed'},
      disturbances:{salt:{rule:'tracer',target:selected}}}});
    const result=grid.transport(new Float64Array(x*y),{time:0,dt:1});
    close(result.ledger.netOut,-.5);
    close(result.ledger.source,.6);
    close(result.ledger.after,1.1);
    close(result.ledger.error,0);
    assert.ok(result.values.every(v=>v>0)||x===8);
  }
});

test('a fixed grid value samples at the requested time and supports local override',()=>{
  const asset=set({warm:{kind:'fixed-value',signal:{keys:[{time:0,value:1},{time:1,value:3}]}}});
  const grid=W.gridOperators.prepare(domain(2,1),{conditions:{asset,boundaries:{west:'warm'}}});
  close(grid.applyBoundaries([0,0],{time:.5}).find(row=>row.region==='west').value,2);
  close(grid.applyBoundaries([0,0],{time:.5,boundary:{west:{kind:'value',value:9}}}).find(row=>row.region==='west').value,9);
  close(grid.transport([0,0],{dt:.25,time:.25,diffusivity:.1}).ledger.boundary.west.in,.175);
  assert.throws(()=>W.gridOperators.prepare(domain(2,1),{conditions:{asset,boundaries:{missing:'warm'}}}),/Invalid grid boundary/);
});

test('wave ends and shared volume drives run directly with saved state and explicit override',()=>{
  const asset=set({feed:{kind:'flux',basis:'total',quantity:{unit:'m^3/s'},signal:{kind:'pulse',at:0,duration:.001,
    amplitude:2*Y,shape:'box'}},quiet:{kind:'absorbing'},load:{kind:'impedance',value:3/Y}});
  const settings={...options,conditions:{asset,ends:{entrance:'quiet',exit:'load'},drives:{tap:{rule:'feed',port:'entrance'}}}};
  const wave=W.waveNetworks.prepare(tube,settings), full=wave.process(24);
  close(full.pressure.a[0],1);
  close(full.pressure.b[6],1.5);
  close(full.pressure.a[12],.5);
  const short=W.waveNetworks.prepare(tube,settings);
  short.process(5);
  const replay=W.waveNetworks.prepare(tube,settings);
  replay.restore(JSON.parse(JSON.stringify(short.snapshot())));
  assert.deepEqual(replay.process(19).pressure.b,full.pressure.b.subarray(5));
  const quiet=W.waveNetworks.prepare(tube,settings).process(24,{inputs:{tap:0}});
  assert.ok(quiet.pressure.b.every(v=>v===0));
  assert.throws(()=>W.waveNetworks.prepare(tube,{...settings,conditions:{...settings.conditions,revision:99}}),/mismatched/);
});

test('fixed pressure bindings and wave kernels can play intrinsic disturbances',()=>{
  const asset=set({fixed:{kind:'fixed-value',quantity:{unit:'Pa'},signal:2},quiet:{kind:'absorbing'}});
  const settings={...options,conditions:{asset,ends:{exit:'quiet'},drives:{tone:{rule:'fixed',node:'a'}}}};
  const wave=W.waveNetworks.prepare(tube,settings);
  close(wave.process(7).pressure.b[6],2);
  const kernel=W.kernels.prepare('acoustic-wave-network',1,{domain:tube,settings,probe:'b'},{dt:.001});
  close(kernel.advanceBlock({start:0,end:7}).pressure,2);
  const incompatible=set({fixed:{kind:'fixed-value',quantity:{unit:'m'},signal:2}});
  assert.throws(()=>W.waveNetworks.prepare(tube,{...settings,conditions:{...settings.conditions,ends:{},asset:incompatible}}),
    /Incompatible physical ports/);
});

test('the wall law reuses geometric volume in the grid, wave, and moving boundary operator',()=>{
  const asset=set({wall,quiet:{kind:'absorbing'}});
  const rules=B.prepare(asset);
  close(rules.sample(0,.01).rules.wall.measurement.pocketVolume,.05);
  close(rules.level('wall',0,.01),1);
  close(rules.level('wall',.01,.01),-1);
  const grid=W.gridOperators.prepare(domain(2,1),{conditions:{asset,boundaries:{west:'wall'}}});
  close(grid.transport([0,0],{time:0,dt:.01}).ledger.after,.01);
  const wave=W.waveNetworks.prepare(tube,{...options,conditions:{asset,ends:{exit:'quiet'},
    drives:{piston:{rule:'wall',node:'a'}}}});
  close(wave.process(7).pressure.b[6],1/Y,1e-8);
  const world=W.runtime.create({dt:.01,systems:{seat:{kind:'moving-boundaries',config:{conditions:{asset},
    boundaries:{piston:{rule:'wall'}}}}}});
  world.step();
  close(world.view().signals['seat/volume-change.piston'],.01);
});

test('CLI resolves relative revision-pinned assets for waves and grids and can inspect laws',t=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'ink-boundaries-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const asset=set({feed:{kind:'flux',basis:'total',signal:pulse},quiet:{kind:'absorbing'}});
  const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value));
  write('conditions.json',asset);
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>spawnSync(process.execPath,[cli,'sim',...args],{cwd:out,encoding:'utf8'});
  const inspected=run('boundaries','conditions.json','--t','0.1','--dt','0.4');
  assert.equal(inspected.status,0,inspected.stderr);
  close(JSON.parse(inspected.stdout).rules.feed.integral,.5);
  const binding={asset:'conditions.json',revision:2};
  const grid={format:W.gridOperators.planFormat,version:1,domain:domain(2,1),operation:'transport',values:[0,0],
    conditions:{...binding,boundaries:{west:'feed'}},settings:{dt:.4,time:.1}};
  write('grid.json',grid);
  const moved=run('grid-ops','grid.json');
  assert.equal(moved.status,0,moved.stderr);
  close(JSON.parse(moved.stdout).result.ledger.after,.5);
  const wave={format:W.waveNetworks.runFormat,version:1,network:tube,samples:160,settings:{...options,
    conditions:{...binding,ends:{exit:'quiet'},drives:{tap:{rule:'feed',node:'a'}}}}};
  write('wave.json',wave);
  const sounded=run('waves','wave.json');
  assert.equal(sounded.status,0,sounded.stderr);
  assert.ok(JSON.parse(sounded.stdout).pressure.b.some(v=>v>0));
  write('wave.json',{...wave,settings:{...wave.settings,conditions:{...wave.settings.conditions,revision:3}}});
  const invalid=run('waves','wave.json');
  assert.notEqual(invalid.status,0);
  assert.match(invalid.stderr,/revision does not match/);
});
