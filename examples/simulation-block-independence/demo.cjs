const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const studio = require('../..');
const PNG = require('../../cli/png.js');
const {KIT: K} = require('./ink-studio.config.js').load();
const model = require('./vent.model.json');
const plan = require('./review.json');
const out = path.resolve(process.argv[2]??'studio/out/simulation-block-independence');
fs.mkdirSync(out,{recursive:true});
const read=file=>JSON.parse(fs.readFileSync(path.join(out,file),'utf8'));
const write=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');

const cli=path.join(__dirname,'../../cli/ink-studio.js');
const report=JSON.parse(execFileSync(process.execPath,[cli,'sim','block-check','vent.model.json','review.json',
  '--trace-out',path.join(out,'cli.trace.json')],{cwd:__dirname,encoding:'utf8'}));
assert.equal(report.status,'exact');
const reference=read('cli.trace.json');
const template=fs.readFileSync(path.join(__dirname,'playback.html'),'utf8');
const safe=source=>source.replace(/<\/script/gi,'<\\/script');
const html=template.replace('/*__INK_KIT__*/',()=>safe(studio.bundle()))
  .replace('/*__VENT_NETWORK__*/',()=>safe(fs.readFileSync(path.join(__dirname,'../simulation-prepared/vent-network.js'),'utf8')))
  .replace('/*__MODEL__*/null',()=>safe(JSON.stringify(model)))
  .replace('/*__REFERENCE__*/null',()=>safe(JSON.stringify(reference)));
fs.writeFileSync(path.join(out,'block-playback.html'),html);

const {capture,compare}=K.world.blockReview;
const browserFile=path.join(out,'browser.trace.json');
const browser=fs.existsSync(browserFile)?read('browser.trace.json'):
  capture(model,{samples:512,buffers:plan.buffers,path:'live',blocks:plan.cases[1].blocks});
const live=compare(reference,browser);
assert.equal(live.status,'exact');
const alternatePath=path.join(out,'browser-float32.trace.json');
const alternate=fs.existsSync(alternatePath)?read('browser-float32.trace.json'):undefined;
const tolerance={absolute:2e-6,relative:1e-6};
const precision=alternate&&{exact:compare(reference,alternate),tolerant:compare(reference,alternate,{tolerance})};
if(precision) {
  assert.equal(precision.exact.status,'diverged');
  assert.equal(precision.tolerant.status,'within-tolerance');
}
write('report.json',{...report,live:{source:fs.existsSync(browserFile)?'Chrome capture':'Node live path',
  request:browser.request,...live},...(precision&&{precision})});

const width=1120, height=745, marks=[];
const bg='#101b23', panel='#192d37', paper='#eaf4ed', dim='#adc2c8';
const green='#9cebc2', gold='#ffc589', grid='#395663';
const rect=(x,y,w,h,fill)=>marks.push({type:'rect',rect:[x,y,w,h],fill});
const label=(text,x,y,scale=2,color=paper)=>marks.push({type:'text',text:String(text),at:[x,y],scale,color});
const line=(points,stroke,width=2)=>marks.push({type:'path',points,stroke,width});
rect(0,0,width,height,bg);
rect(44,37,26,4,green);
label('INK STUDIO / SIMULATION',82,31,2,green);
label('Block-size independence',40,64,5);
label('48 KHZ VENT NETWORK / SAMPLE-INDEXED CONTROLS',44,126,2,dim);

rect(44,167,1032,303,panel);
label('OUTLET PRESSURE',64,188,2,green);
label('CLI REFERENCE',64,221,2,gold);
label('LIVE TRACE',307,221,2,green);
label('512 / 512 MATCHED',761,221,2,paper);
const samples=reference.tracks.trace.values, liveSamples=browser.tracks.trace.values;
const min=Math.min(...samples), max=Math.max(...samples), left=66, span=982;
const x=i=>left+span*i/(samples.length-1), y=n=>413-155*(n-min)/(max-min);
for(const command of reference.identity.commands) {
  rect(Math.round(x(command.sample)),249,1,167,grid);
}
line(samples.map((value,i)=>[x(i),y(value)]),gold,4);
line(liveSamples.map((value,i)=>[x(i),y(value)]),green,2);
label('0',left,439,2,dim);
label('SAMPLE INDEX / VERTICAL LINES MARK CONTROL CHANGES',242,439,2,dim);
label('511',1011,439,2,dim);

rect(44,490,1032,210,panel);
label('REQUESTS',64,512,2,green);
label('CLI: 1',65,550,2,gold);
label('LIVE: '+browser.request.requested,303,550,2,green);
label('MAX ABSOLUTE ERROR: 0',675,550,2,paper);
label('CLI EXECUTED '+reference.request.processed+' BLOCKS AT CONTROL AND CAPACITY BOUNDARIES',65,586,2,dim);
if(precision) {
  label('FLOAT32 MAX ERROR: '+precision.tolerant.maxAbsoluteError.toExponential(2),65,642,2,paper);
  label('WITHIN EXPLICIT TOLERANCE',662,642,2,green);
} else label('FLOAT64 RESULTS MATCHED WITH ZERO TOLERANCE',65,642,2,green);
fs.writeFileSync(path.join(out,'block-independence.png'),PNG.encodeFrame(PNG.packRGBA(
  K.procedural.drawing2d.render({width,height,commands:marks,edges:'hard'}))));
