const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const { measureContacts,compareSample }=require('../cli/palette-weather.js');

test('contact coverage uses adjacent rendered swatches and excludes overlaps and unknown alpha',()=>{
  const gray=[66,80,91], gold=[250,203,100];
  const scene={w:7,h:1,rgb:Uint8Array.from([gray,gray,gray,gray,gray,gold,gold].flat()),
    alpha:Uint8Array.of(255,255,255,255,255,255,130)};
  const visible=Uint8Array.of(1,2,3,1,1,2,1), marked={rgb:scene.rgb.slice()};
  const [row]=measureContacts(scene,visible,[{subjects:['Stone','Inlay'],a:1,b:2}],marked);
  assert.equal(row.samples,2);
  assert.equal(row.sameSwatch,1);
  assert.equal(row.sameSwatchShare,.5);
  assert.deepEqual(row.example,{a:[0,0],b:[1,0],swatch:'#42505b'});
  assert.deepEqual([...marked.rgb.subarray(0,3)],[255,110,200]);
  assert.deepEqual([...marked.rgb.subarray(6,9)],gray);
});

test('a baseline detects lost tonal variety, weakened landmark edges and new same-swatch contacts',()=>{
  const subject=(id,share,swatches,weak)=>({id,pixels:30,samples:12,palette:{tones:{midtones:{share,swatches}}},
    weakColorShare:weak,weakLightnessShare:.1,color:{p10:.08},lightness:{p10:.06}});
  const baseline={subjects:[subject('Paving',.8,6,.1),subject('Beacon',.5,3,.1)],
    contacts:[{subjects:['Paving','Inlay'],sameSwatchShare:.08},{subjects:['Beacon','Inlay'],sameSwatchShare:null}]};
  const after={subjects:[subject('Paving',.8,2,.1),subject('Beacon',.5,3,.85)],
    contacts:[{subjects:['Paving','Inlay'],sameSwatchShare:.92},{subjects:['Beacon','Inlay'],sameSwatchShare:1}]};
  const settings={midtoneShareDrop:.15,midtoneSwatchLoss:.5,weakEdgeGain:.2,sameSwatchGain:.2};
  const findings=compareSample(baseline,after,settings,.25);
  assert.deepEqual(findings.map(row=>row.kind),['midtone-loss','edge-contrast-loss','same-swatch-contact']);
  assert.equal(after.subjects[0].changes.midtoneShare,0);
  assert.equal(after.subjects[0].changes.midtoneSwatches,-4);
  assert.deepEqual(findings[1].metrics,[{metric:'color',before:.1,after:.85}]);
  assert.equal(after.contacts[1].sameSwatchChange,null);
});

test('export-sized weather review compares authored times, states and views with a named baseline',()=>{
  const {KIT,makeBuilder,makeSculpt}=ink.load(), b=makeBuilder(23,[0x172736,0xaaa397,0x7e90a5]);
  const s=KIT.sculpt(makeSculpt(b));
  s.amb=1; s.sunK=0; s.sky=0;
  s.box([-.55,0,0],[.55,.68,.10],{r:[1],materialId:'stone'},{res:.055,objectId:'beacon'});
  s.box([.55,0,0],[.55,.68,.10],{r:[2],materialId:'inlay'},{res:.055,objectId:'marker'});
  s.bake();
  const world=b.finish({cam:{target:[0,0,0],dist:4.2,yaw:0,pitch:0,sway:0},dither:0,
    atmosphere:[KIT.atmosphere.box({min:[-5,-4,-4],max:[5,4,6],density:1.8,color:'#172736'})]});
  const plan={
    subjects:[{id:'Stone',select:{material:'stone'}},{id:'Inlay',select:{material:'inlay'}}],
    views:[{id:'Front',yaw:0},{id:'Side',yaw:.56}],
    baseline:'Dry',
    states:[{id:'Fog',time:1},{id:'Dry',time:0,weather:{atmosphere:false}}]
  };
  const times=[];
  const {report,image}=ink.reviewPaletteWeather(world,{plan,width:144,height:92,view:{px:2,ortho:true},
    pose(posed,time) {times.push(time); posed.cam.target=[.2*time,0,0];} });
  assert.deepEqual(times,[0,1]);
  assert.deepEqual([report.width,report.height,report.pixelSize],[72,46,2]);
  assert.deepEqual(report.samples.map(row=>[row.view,row.state,row.isBaseline]),
    [['Front','Fog',false],['Side','Fog',false],['Front','Dry',true],['Side','Dry',true]]);
  assert(report.samples[2].subjects.every(row=>row.palette.tones.midtones.share>0));
  assert(report.samples[0].contacts[0].sameSwatchShare>report.samples[2].contacts[0].sameSwatchShare);
  assert(report.samples[1].findings.some(row=>row.kind==='same-swatch-contact'));
  assert.deepEqual(report.samples[1].camera,report.samples[3].camera);
  assert(report.samples[0].findings.some(row=>row.kind==='midtone-loss'));
  assert(image.rgb.some((n,i)=>i%3===0 && n===255 && image.rgb[i+1]===110 && image.rgb[i+2]===200));
});

test('palette weather CLI samples an authored weather track and writes its matched evidence', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-weather-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), scene=path.resolve(__dirname,'../examples/palette-field-weather.js');
  execFileSync(process.execPath,[cli,'palette','weather',scene,'--select','{"material":"rain-glaze"}',
    '--times','0,2.4','--w','150','--h','90','--px','2','--cols','2','--out',dir]);
  const report=JSON.parse(fs.readFileSync(path.join(dir,'review.json')));
  assert.deepEqual([report.width,report.height,report.baseline],[75,45,'0 s']);
  assert.deepEqual(report.samples.map(row=>row.skyTime),[0,2.4]);
  assert.notDeepEqual(report.samples[0].subjects[0].palette.brightness,report.samples[1].subjects[0].palette.brightness);
  assert(PNG.raster(path.join(dir,report.files.comparison)).w>150);
});
