const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto'),ink=require('..'),kit=ink.load(),A=kit.KIT.procedural.mediaGraph;
const {resamplingJam:J}=A, rate=8000;
const tone={sampleRate:rate,channels:1,samples:Float64Array.from({length:1600},(_,i)=>
  .30*Math.sin(2*Math.PI*400*i/rate)*Math.min(1,i/56,(1600-i)/48))};
const rack={
  format:'ink-studio/audio-rack',version:1,id:'color',revision:1,title:'Color',
  inputs:{main:'in'},output:'in',strips:{in:{inserts:['shaper']}},
  processors:{shaper:{type:'saturation',driveDb:2,toneHz:2600,wet:1}},
  macros:{heat:{label:'Heat',default:.24,targets:[{path:['processors','shaper','driveDb'],range:[-12,18]}]},
    shade:{label:'Shade',default:.6,targets:[{path:['processors','shaper','toneHz'],range:[580,6200]}]}}
};
function jam() {
  return {format:'ink-studio/resampling-jam',version:1,id:'pulse',
    kit:{id:'pulse',pads:{call:{articulations:{default:[{id:'take',takes:[{asset:'tone'}]}]}}}},
    performance:{events:[
      {id:'head',pad:'call',time:{beat:0},velocity:.83},
      {id:'answer',pad:'call',time:{beat:1,offset:.01},velocity:.7}
    ],options:{sampleRate:rate,map:{tempo:120},duration:1.25}},racks:{color:rack},
    branches:[{id:'hot',rack:'color',speed:1,macros:{heat:{unit:'seconds',points:[{at:0,value:.2},{at:1,value:.8}]}}}]};
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('a three-control sweep stays pinned to the editable phrase and inherits unmodified rack automation',()=>{
  const input=jam(), before=structuredClone(input);
  const request={branches:[{id:'start',from:'hot',speed:.9}],sweep:{from:'start',prefix:'study',axes:[
    {control:'speed',values:[.5,1]},{control:'macros.heat',values:[.1,.86]},{control:'macros.shade',values:[.25,.75]}
  ]}};
  const {value,added}=J.branch(input,request);
  assert.deepEqual(input,before);
  assert.deepEqual(value.performance,input.performance);
  assert.equal(added.length,9);
  assert.deepEqual(added[0].state.macros.heat,input.branches[0].macros.heat);
  assert.equal(added[1].speed,.5);
  assert.equal(added[1].state.macros.shade,.25);
  assert.equal(added.at(-1).id,'study-08');
  assert.deepEqual(J.branch(input,request),{value,added});
  assert.throws(()=>J.branch(input,{branches:[{id:'hot',speed:.6}]}),/unique ID/);
  assert.throws(()=>J.branch(input,{sweep:{from:'source',prefix:'bad',axes:[{control:'macros.heat',values:[0,.5]}]}}),/unavailable/);
  assert.throws(()=>J.branch(input,{sweep:{from:'hot',prefix:'bad',axes:[
    {control:'speed',values:[1,1.5]},{control:'speed',values:[1,1.5]}
  ]}}),/repeated/);
  const assets={tone}, range={firstSample:3200,endSample:8800};
  const plain=J.render(value,assets,{branch:'source'}), slow=J.render(value,assets,{branch:'study-01'});
  assert.equal(plain.report.frames,10000);
  assert.deepEqual(plain.report.events,slow.report.events);
  assert.deepEqual(plain.report.events.map(row=>row.at),[0,4080]);
  assert.deepEqual(plain.value,plain.dry);
  assert.notDeepEqual(slow.value,slow.dry);
  assert.notDeepEqual(plain.dry,slow.dry);
  const slice=J.render(value,assets,{branch:'study-01',range});
  assert.deepEqual(slice.value.samples,slow.value.samples.subarray(range.firstSample*2,range.endSample*2));
  const takes=J.audition(value,assets,{branches:['source','study-01','study-08'],range,levels:{gapSeconds:.1}});
  assert.deepEqual(takes.report.events,plain.report.events);
  assert.deepEqual(takes.report.clips.map(row=>row.startSample),[0,6400,12800]);
  assert(takes.report.clips.every(row=>Math.abs(row.rms-10**(-23/20))<1e-10));
  assert.notEqual(takes.report.clips[0].gain,takes.report.clips[1].gain);
  assert.equal(takes.value.samples.length,18400*2);
});

test('the CLI keeps an exact portable take, recalls its source after the original is gone and edits the recovered performance',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-resampling-jam-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const at=name=>path.join(folder,name), lib=at('library'), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'music',...args],{cwd:folder,encoding:'utf8'}));
  const recipe=(name,data)=>{
    const file=at(name);
    fs.writeFileSync(file,JSON.stringify(data));
    return file;
  };
  fs.writeFileSync(at('tone.wav'),ink.encodeWav(tone,{encoding:'float64'}));
  const base=recipe('base.json',{...jam(),assets:{tone:'tone.wav'}});
  const forks=recipe('forks.json',{branches:[{id:'slip',from:'hot',speed:.74,macros:{shade:.36}}]});
  const {project}=run('jam','branch',base,forks,'--out',at('takes/forks.json'));
  assert.equal(JSON.parse(fs.readFileSync(project)).assets.tone,path.join('..','tone.wav'));
  assert.equal(run('jam','inspect',project).at(-1).from,'hot');
  const render=recipe('window.json',{branch:'slip',range:{firstSample:3200,endSample:8800}});
  const live=run('jam','render',lib,project,render,'--out',at('pre'));
  const selection=recipe('keep.json',{...JSON.parse(fs.readFileSync(render)),takes:['dry','wet'],
    sample:{id:'relay-print',label:'Relay print',material:'metal'},note:'Keeps the moving saturation and the first answer',
    markers:[{id:'answer',kind:'attack',at:4080}]});
  const {manifest,retained,entries}=run('jam','keep',lib,project,selection,'--out',at('print'));
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(manifest),'wet.wav')),fs.readFileSync(live.audio));
  const library=ink.openSampleLibrary(lib,{kit}), {entry,value}=library.load(entries.wet);
  assert.equal(entry.frames,5600);
  assert.equal(entry.source.firstSample,3200);
  assert.equal(entry.print.markers[0].at,880);
  assert.equal(entry.print.inputs.state.state.macros.shade,.36);
  assert.equal(entry.print.projectHash,hash(fs.readFileSync(retained)));
  assert.deepEqual(value,ink.readWav(live.audio));
  const printKit=recipe('new-kit.json',{kit:{id:'new',pads:{echo:{articulations:{default:[{
    id:'wet',takes:[{asset:'print'}]
  }]}}}},assets:{print:{print:'print/print.json',take:'wet',slice:'answer'}}});
  const performance=recipe('new-performance.json',{events:[{id:'one',pad:'echo',time:0}],options:{sampleRate:rate}});
  const played=run('samples','kit',lib,printKit,performance,'--out',at('reused'));
  assert(ink.readWav(played.audio).samples.some(x=>Math.abs(x)>.01));
  fs.rmSync(at('print'),{recursive:true});
  fs.unlinkSync(at('tone.wav'));
  fs.unlinkSync(project);
  fs.unlinkSync(base);
  const recalled=run('jam','recover',lib,entries.wet,'--out',at('recalled'));
  const recovered=run('jam','render',at('fresh-library'),recalled.project,render,'--out',at('rerender'));
  assert.deepEqual(fs.readFileSync(recovered.audio),fs.readFileSync(live.audio));
  const doc=JSON.parse(fs.readFileSync(recalled.project));
  assert.deepEqual(doc.performance,jam().performance);
  doc.performance=A.padPattern.edit(doc.performance,[{op:'set',id:'answer',changes:{velocity:.2}}]);
  fs.writeFileSync(recalled.project,JSON.stringify(doc));
  const changed=run('jam','render',lib,recalled.project,render,'--out',at('changed'));
  assert.notDeepEqual(fs.readFileSync(changed.audio),fs.readFileSync(live.audio));
  const packed=path.resolve(path.dirname(recalled.project),doc.assets.tone.wav);
  fs.writeFileSync(packed,ink.encodeWav({...tone,samples:tone.samples.map(x=>x*.66)},{encoding:'float64'}));
  assert.throws(()=>execFileSync(process.execPath,[cli,'music','jam','render',lib,recalled.project,render,'--out',at('invalid')],
    {stdio:'pipe'}),/WAV hash does not match/);
});
