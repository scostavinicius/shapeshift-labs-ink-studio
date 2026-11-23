const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const kit=require('./ink-studio.config.js').load(),K=kit.KIT,W=K.world;
const PNG=require('../../cli/png.js'),files=require('../../cli/asset-files.js');
const out=path.resolve(process.argv[2]??'studio/out/simulation-budgets'),file=name=>path.join(out,name);
const write=(name,bytes)=>files.write(file(name),bytes);
const save=(name,value)=>files.json(file('bench/'+name),value);
const vent=require('../simulation-prepared/vent.model.json'),voice=require('../simulation-fast-checkpoints/voice.model.json');
save('vent.model.json',vent);save('voice.model.json',voice);
write('bench/ink-studio.config.js',fs.readFileSync(path.join(__dirname,'ink-studio.config.js')));
save('host.world.json',{format:W.format,version:1,id:'studio-host',dt:1/60,
  modules:{vent:{file:'vent.model.json',revision:1},voice:{file:'voice.model.json',revision:1}},
  instances:{vent:{module:'vent'},voice:{module:'voice'}},
  systems:{meter:{kind:'checkpoint-note-meter',schedule:{every:4}}},
  connections:[{from:'voice/notes',to:'meter/notes',signal:'event'},
    {from:'voice/voice',to:'meter/level',sample:'hold',delay:2}]});
const host={mode:'world',source:'host.world.json',steps:40,detail:true};
const eventCase={mode:'blocks',path:'offline',source:'voice.model.json',samples:1800,requests:[400],detail:true};
const baseline={
  host:{...host,limits:{maxQueuedEvents:2,maxPreparedBytes:1496}},
  vent:{mode:'blocks',source:'vent.model.json',samples:4096,requests:[64,128,192,96],detail:true,
    limits:{maxPreparedBytes:1496,maxWorkPerBlock:1152}},
  drained:{...eventCase,events:{capacity:1,drainEvery:1},limits:{maxQueueOverflows:0}}
};
const overruns={
  'tight-deadline':{...host,deadlineMs:.000001,limits:{maxMissedDeadlines:0}},
  'unread-queue':{...eventCase,events:{capacity:1,drainEvery:0},limits:{maxQueueOverflows:0}}
};
function benchmark(name,cases,exit){
  const input=name+'.budget.json', output=file(name+'-report.json');
  save(input,{format:W.performanceBudgets.format,version:1,id:name,cases});
  const run=spawnSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),
    'sim','budget',file('bench/'+input),'--out',output,'--require-budget'],{cwd:__dirname,encoding:'utf8'});
  assert.equal(run.status,exit,run.stderr||('Inspect '+output));
  return JSON.parse(fs.readFileSync(output,'utf8'));
}
const pass=benchmark('baseline',baseline,0),failed=benchmark('overruns',overruns,2);
const actual=pass.cases.host, ventCase=pass.cases.vent, drained=pass.cases.drained,
  tight=failed.cases['tight-deadline'], full=failed.cases['unread-queue'];
assert.ok(tight.steps.deadlines.missed>0);
assert.equal(full.queues.overflows,1);
assert.equal(full.completedSamples,1200);

const bg='#101f2c',panel='#1b3140',well='#122734',grid='#365568',ink='#edf4e9',dim='#aec7d0';
const mint='#8ce6c3',sky='#9bcdf1',amber='#ffd098',rose='#ffae94';
const width=1120,height=674,x=62,w=642,graphTop=219,graphHeight=196;
const fmt=(n,d=3)=>n.toFixed(d), ms=value=>value<.001?value.toExponential(2).toUpperCase():fmt(value);
function canvas(title,subtitle,color){
  const commands=[];
  const d={rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    text:(text,x,y,scale=2,color=ink)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    pack:()=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands,edges:'hard'}))};
  d.rect(0,0,width,height,bg);d.rect(34,31,24,4,color);
  d.text('INK STUDIO / SIMULATION PERFORMANCE',73,25,2,color);d.text(title,31,63,5);
  d.text(subtitle,36,124,2,dim);d.rect(34,160,700,474,panel);d.rect(755,160,330,474,panel);
  return d;
}
function axes(d,y,h,label){
  d.text(label,x,y-28,2,dim);d.rect(x,y,w,h,well);
  for(let i=0;i<=5;i++)d.line([[x+w*i/5,y],[x+w*i/5,y+h]],grid);
  for(let i=1;i<4;i++)d.line([[x,y+h*i/4],[x+w,y+h*i/4]],grid);
}
function metric(d,y,label,value,color){
  d.text(label,777,y,1,dim);d.text(value,776,y+20,3,color);
}
function hostCard(t){
  const d=canvas('Whole world steps','60 HZ WORLD / 48 KHZ VENT + NOTE METER',mint);
  const duration=actual.steps.rows, baselineDeadline=duration[0].deadlineMs;
  axes(d,graphTop,graphHeight,'MEASURED STEP TIMES / MILLISECONDS');
  const lo=Math.min(-3,Math.floor(Math.log10(Math.max(1e-6,Math.min(...duration.map(row=>row.elapsedMs)))))),
    hi=Math.ceil(Math.log10(Math.max(baselineDeadline,actual.steps.maxMs))), bottom=graphTop+graphHeight;
  const at=duration=>bottom-graphHeight*(Math.log10(Math.max(10**lo,duration))-lo)/(hi-lo);
  const boundary=at(baselineDeadline);
  const dx=w/duration.length;
  for(let i=0;i<Math.max(1,Math.floor(t*duration.length));i++){
    const v=duration[i], y=at(v.elapsedMs);
    d.rect(x+i*dx+2,y,dx-4,Math.max(2,bottom-y),v.latenessMs?rose:mint);
  }
  d.line([[x,boundary],[x+w,boundary]],amber,2);
  d.text('16.67 MS CADENCE',x+12,Math.max(graphTop+3,boundary-15),1,amber);
  d.text('LOG SCALE / FIRST TO LAST COMMITTED TICK',x,431,1,dim);
  d.text('DEFAULT DEADLINE',x,477,2,dim);
  d.text(actual.steps.deadlines.missed+' MISSES',x,511,3,mint);
  d.text('DELIBERATELY TIGHT DEADLINE',x+285,477,2,dim);
  d.text(tight.steps.deadlines.missed+' MISSES',x+285,511,3,rose);
  d.text('SAME MODEL AND STEP COUNT',x,575,1,dim);
  metric(d,202,'STEP P95',ms(actual.steps.p95Ms)+' MS',mint);
  metric(d,305,'LONGEST STEP',ms(actual.steps.maxMs)+' MS',sky);
  metric(d,408,'NATIVE VENT BLOCK MAX',ms(actual.native.kernels['vent/solver'].observed.peakMs)+' MS',sky);
  metric(d,511,'QUEUED NOTES / HIGH-WATER',String(actual.queues.maxQueuedEvents),amber);
  return d.pack();
}
function ventCard(t){
  const d=canvas('Inside a callback','48 KHZ PREPARED VENT / VARIABLE HOST REQUESTS',sky);
  const requests=ventCase.requests.rows.slice(0,8), blocks=ventCase.blocks.rows;
  axes(d,graphTop,graphHeight,'REQUEST SIZE / SPLIT INTO NATIVE BLOCKS');
  const n=requests.length, base=graphTop+graphHeight, height=graphHeight/200, dx=w/n;
  let visible=Math.max(1,Math.floor(t*n));
  for(const [i,row] of requests.entries()){
    if(i>=visible)break;
    let y=base;
    for(const [j,block] of blocks.filter(block=>block.startSample>=row.startSample&&block.endSample<=row.endSample).entries()){
      const size=height*block.samples;y-=size;
      d.rect(x+i*dx+15,y+1,dx-30,size-2,j%2?mint:sky);
    }
    d.text(String(row.requestedSamples),x+i*dx+24,base+15,1,dim);
  }
  const cap=ventCase.work.effectiveBlockSamples, line=base-cap*height;
  d.line([[x,line],[x+w,line]],amber,2);
  d.text(cap+'-SAMPLE NATIVE CAP',x+10,line-16,1,amber);
  d.text('P95 HOST REQUEST',x,477,2,dim);
  d.text(ms(ventCase.requests.p95Ms)+' MS',x,511,3,sky);
  d.text('P95 INTERNAL BLOCK',x+285,477,2,dim);
  d.text(ms(ventCase.blocks.p95Ms)+' MS',x+285,511,3,mint);
  d.text('HOST REQUESTS CAN SPAN MULTIPLE BLOCKS',x,575,1,dim);
  metric(d,202,'COMPLETED NATIVE BLOCKS',String(ventCase.blocks.completed),sky);
  metric(d,305,'WORST PREPARED WORK',ventCase.work.observedPeakPreparedUnits+' UNITS',mint);
  metric(d,408,'TRACKED ALLOCATION',ventCase.memory.preparedAllocatedBytes+' BYTES',amber);
  metric(d,511,'HOST DEADLINE MISSES',String(ventCase.requests.deadlines.missed),sky);
  return d.pack();
}
function queueCard(t){
  const d=canvas('Unread event queue','THE SAME EVENTS / ONE SLOT PER OUTPUT PORT',amber);
  const boxes=[[drained,225,'DRAIN EVERY REQUEST',mint],[full,419,'LEAVE EVENTS UNREAD',rose]];
  for(const [scenario,y,label,color] of boxes){
    axes(d,y,105,label);
    d.rect(x+22,y+22,82,60,grid);
    d.text('1',x+56,y+45,2,ink);
    d.text('SLOT CAPACITY',x+126,y+24,1,dim);
    const queue=scenario.queues.queues.notes;
    d.text(queue.peak+' COMMITTED / '+queue.attemptedPeak+' ATTEMPTED',x+125,y+53,2,color);
    if(t>.47)d.text(scenario.passed?'CONSUMER KEPT UP':'SECOND NOTE REJECTED',x+375,y+87,1,color);
  }
  metric(d,202,'COMPLETED WITH DRAINING',drained.completedSamples+' SAMPLES',mint);
  metric(d,305,'RETAINED CURSOR ON OVERFLOW',full.completedSamples+' SAMPLES',rose);
  metric(d,408,'QUEUE OVERFLOWS',String(full.queues.overflows),rose);
  metric(d,511,'TYPED VOICE STATE',full.memory.typedStateBytes+' BYTES',sky);
  return d.pack();
}
const views=[hostCard,ventCard,queueCard],fps=10,hold=30,collected=[];
for(const [card,view] of views.entries())for(let frame=0;frame<hold;frame++){
  const image=view(frame/(hold-1)), bytes=PNG.encodeFrame(image);
  if(frame===hold-1)write(['world-steps','playback-blocks','queue-overflow'][card]+'.png',bytes);
  if(frame%2===0)collected.push(image);
  write('frames/frame-'+String(card*hold+frame).padStart(3,'0')+'.png',bytes);
}
write('budget-gallery.png',PNG.encodeAnimation(collected,fps/2));
console.log('Wrote native simulation timing reports, editable benchmark cases and charts to '+out);
