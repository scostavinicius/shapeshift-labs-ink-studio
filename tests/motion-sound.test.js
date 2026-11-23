const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),K=kit.KIT,W=K.world,S=W.soundMeasurements,A=W.motionSound;
const CLI=require('../cli/motion-sound.js');
const lane=(source,opts)=>({source,input:[0,4],output:[0,1],...opts});
const plan=(lanes,opts)=>({format:A.format,version:1,id:'measured-sound',sampleRate:48000,lanes,...opts});
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,a+' differs from '+b);

test('projection, wrapped rotation, missing inputs and cuts retain source evidence',()=>{
  const turn=S.rows([{at:0,angle:350},{at:.1,angle:10},{at:.2,angle:30},{at:.3,angle:290,cut:true},
    {at:.4,angle:300},{at:.5},{at:.6,angle:320}],{unit:'deg',path:'/angle',rate:true,wrap:360});
  assert.deepEqual(turn.points.map(x=>x.value),[null,200,200,null,100,null,null]);
  assert.equal(turn.unit,'deg/s');
  assert.equal(turn.points[3].detail.raw,290);
  const velocity=S.rows([{at:0,value:[-3,4,0]},{at:.1,value:[0,0,0]}],{unit:'m/s',project:'magnitude'});
  assert.deepEqual(velocity.points.map(x=>x.value),[5,0]);
  const direction=S.rows([{at:0,value:[-3,4,0]}],{unit:'m/s',project:[-2,0,0]});
  assert.equal(direction.points[0].value,3);
  assert.throws(()=>S.rows([{at:1,value:1},{at:1,value:0}],{unit:'1'}),/increasing timestamps/);
});

test('sample-aligned lanes smooth deterministically, preserve cuts, and expose neighboring measurements',()=>{
  const track=S.series('m/s',[
    {at:{numerator:1001,denominator:30000},value:4},
    {at:.1,value:0},{at:.2,value:null},{at:.3,value:null,cut:true},{at:.4,value:4}
  ]);
  const recipe=plan({motor:lane('speed',{release:.1,attack:.1,missing:'hold'})});
  const result=A.compile(recipe,{speed:track});
  const rows=result.report.motor.observations;
  assert.equal(rows[0].sample,1601);
  assert.deepEqual(result.lanes.motor.points.slice(0,3),
    [{at:0,value:0},{at:1600,value:0},{at:1601,value:1}]);
  near(rows[1].value,Math.exp(-(4800-1601)/4800));
  near(rows[2].value,rows[1].value);
  assert.equal(rows[2].raw,null);
  assert.equal(rows[3].value,0);
  near(rows[4].value,1-Math.exp(-1));
  near(A.sample(result,{sample:14399}).values.motor,rows[2].value);
  assert.equal(A.sample(result,{at:.3}).values.motor,0);
  const inspected=A.sample(result,{sample:19200});
  assert.equal(inspected.lanes.motor.previous.raw,4);
  assert.equal(inspected.lanes.motor.next,null);
  const tooClose=S.series('m/s',[{at:0,value:1},{at:.0000001,value:2}]);
  assert.throws(()=>A.compile(recipe,{speed:tooClose}),/multiple observations at audio sample/);
});

test('raw depth, masks and part motion use native pixels, labels and validity',()=>{
  const frame={passes:{w:3,h:2,depth:[1,2,Infinity,4,5,9],previousDepth:[1,2,Infinity,8,6,9],
    previousDepthValid:[255,255,0,0,255,255],mask:[0,.6,0,1,.5,.8],
    partId:[1,1,0,1,1,2],parts:[null,{part:'wheel'},{part:'border'}],
    objectId:[1,1,0,1,1,1],objects:[null,'case'],partMotion:[1,0,0,2,0,0,30,40,3,4,9,9],
    partMotionValid:[255,255,0,0,255,255]}};
  const reduce=options=>W.renderSoundMeasurements.prepare(options);
  const track=reduce({channel:'partMotion',part:'wheel',object:'case',perSecond:true,reduce:'mean'});
  assert.deepEqual(track.channels,['partMotion','objectId','partId']);
  assert.equal(track.unit,'art-px/s');
  const result=track.measure(frame,{at:.1,interval:.1});
  near(result.value,80/3);
  assert.equal(result.detail.eligible,4);
  assert.equal(result.detail.used,3);
  assert.equal(result.detail.part,'wheel');
  assert.equal(result.detail.interval,.1);
  assert.equal(track.measure(frame,{at:.3,cut:true}).value,null);
  assert.equal(reduce({channel:'depth',part:'wheel',weight:'mask',reduce:'mean'}).measure(frame,{at:0}).value,
    (2*.6+4+5*.5)/2.1);
  assert.equal(reduce({channel:'previousDepth',part:'wheel',reduce:'max'}).measure(frame,{at:0}).value,6);
  assert.equal(reduce({channel:'mask',region:[0,0,2,2],reduce:'fraction',above:.5}).measure(frame,{at:0}).value,.75);
  assert.throws(()=>reduce({channel:'partMotion',region:[2,0,2,2]}).measure(frame,{at:0}),/exceeds the native art grid/);
});

test('contact slip and virtual gauges carry native times and validity into sound controls',()=>{
  const contact={format:W.contactExciters.traceFormat,version:1,info:{sampleRate:1000},start:10,end:15,
    tracks:{shoe:{active:[0,1,1,0,0],slip:[9,0,0,3,0,0,4,0,0,9,0,0,9,0,0]}}};
  const slip=S.contacts(contact,{track:'shoe',windowSamples:2,reduce:'mean'});
  assert.deepEqual(slip.points.map(x=>x.value),[null,3,4,null]);
  assert.deepEqual(slip.points[1].at,{numerator:12,denominator:1000});
  assert.equal(slip.points[1].detail.activeSamples,1);
  const report={format:W.virtualSensors.reportFormat,version:1,kind:'world',dt:1/60,
    rig:{sensors:{cable:{quantity:{unit:'%'}}}},frames:[
      {tick:1,time:1/60,sensors:{cable:{value:4,valid:true,status:'ok'}}},
      {tick:2,time:2/60,sensors:{cable:{value:4,valid:false,status:'missing'}}}
    ]};
  const strain=S.sensor(report,'cable'), result=A.compile(plan({load:lane('strain')}),{strain});
  assert.deepEqual(result.report.load.observations.map(x=>[x.sample,x.raw]),[[800,4],[1600,null]]);
  assert.equal(result.report.load.observations[1].detail.status,'missing');
});

test('world fields supply angular speed and velocity with exact tick addressing',()=>{
  const mechanics={dt:1/60,systems:{body:{kind:'mechanics',config:{gravity:[0,0,0],drag:0,ground:-5,
    bodies:{part:{position:[0,1,0],velocity:[3,4,0],angular:[0,0,2],half:[.1,.1,.1],mass:1}}}}}};
  const tracks=S.world(W.runtime.create(mechanics),{
    speed:{field:'body/bodies',path:'/part/velocity',project:'magnitude',unit:'m/s'},
    spin:{field:'body/bodies',path:'/part/angular',project:2,unit:'rad/s'}
  },{steps:2});
  assert.deepEqual(tracks.speed.points.map(x=>x.value),[5,5,5]);
  assert.equal(tracks.spin.points[0].value,2);
  assert.equal(A.compile(plan({spin:lane('spin')}),tracks).report.spin.observations[2].sample,1600);
  const control={dt:1/30,systems:{drive:{kind:'control',config:{op:'scale',scale:0,offset:2},
    portQuantities:{outputs:{value:{unit:'m/s'}}}}}};
  const data=S.world(W.runtime.create(control),{speed:{signal:'drive/value'}},{steps:2});
  assert.equal(data.speed.unit,'m/s');
  assert.deepEqual(data.speed.points.map(x=>x.value),[0,2,2]);
});

test('graph automation drives the stock mixer at the same samples as the inspector',()=>{
  const link=(node,port='value')=>({node,port});
  const sampleRate=8000, automation=plan({level:lane('speed')},{sampleRate});
  const pcm={sampleRate,channels:1,samples:Array(2400).fill(.5)};
  const project=ink.createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{
    capture:{op:'audio.soundMeasurements',inputs:{rows:[{at:0,value:0},{at:.1,value:4},{at:.2,value:0}],options:{unit:'m/s'}}},
    assets:{op:'data.record',inputs:{speed:link('capture')}},
    control:{op:'audio.motionControls',inputs:{plan:automation,measurements:link('assets')}},
    inspect:{op:'audio.sampleMotionControls',inputs:{source:link('control'),options:{sample:400}}}
  },outputs:{controls:link('control'),inspection:link('inspect')}},{kit});
  const outputs=project.run().outputs;
  assert.equal(outputs.inspection.values.level,.5);
  const mixer={id:'route-dial',output:'master',sampleRate,end:{samples:2400},strips:{
    motor:{clips:[{id:'bed',source:'tone'}],fader:outputs.controls.lanes.level},master:{}
  }};
  const audio=K.procedural.mediaGraph.mixer.render(mixer,{tone:pcm}).value;
  near(audio.samples[400*2],.25);
  near(audio.samples[800*2],.5);
  near(audio.samples[1600*2],0);
});

test('CLI captures a real scene pass sequence, resets picture correspondence, and inspects the saved result',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-motion-sound-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const name=file=>path.join(directory,file);
  const example=path.resolve(__dirname,'../examples/part-motion.js');
  const source={format:CLI.runFormat,version:1,plan:plan({motion:lane('pixels'),depth:lane('distance',{input:[1,9]})}),sources:{
    picture:{kind:'render',scene:path.relative(directory,example),clock:{fps:12,cuts:[{frame:2,id:'cut'}]},frames:5,
      options:{width:96,height:64},measures:{
        pixels:{channel:'partMotion',part:'servo-wheel'},distance:{channel:'depth',part:'servo-wheel'}
      }}
  }};
  fs.writeFileSync(name('take.json'),JSON.stringify(source));
  const exe=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>spawnSync(process.execPath,[exe,'sim','sound-controls',...args],{encoding:'utf8'});
  const rendered=run(name('take.json'),'--out',name('controls.json'));
  assert.equal(rendered.status,0,rendered.stderr);
  const saved=JSON.parse(fs.readFileSync(name('controls.json'),'utf8'));
  assert.equal(saved.report.motion.observations[0].raw,null);
  assert.ok(saved.report.motion.observations[1].raw>0);
  assert.equal(saved.report.motion.observations[2].raw,null);
  assert.ok(saved.report.motion.observations[2].cut);
  assert.ok(saved.report.depth.observations[2].raw>0);
  const read=run(name('controls.json'),'--sample','8000');
  assert.equal(read.status,0,read.stderr);
  assert.equal(JSON.parse(read.stdout).values.motion,0);
});
