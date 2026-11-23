const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const WAV=require('../cli/wav'),ink=require('..'),kit=ink.load(),A=kit.KIT.procedural.mediaGraph;
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const rate=8000;
const audio=(samples,channels=1,sampleRate=rate)=>({samples,channels,sampleRate});
const start={samples:0};
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-delivery-')),at=name=>path.join(dir,name);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const json=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value));
  const wav=(name,data)=>fs.writeFileSync(at(name),WAV.encode(data,{encoding:'pcm24'}));
  const deliver=(name,output,...args)=>spawnSync(process.execPath,[cli,'music','deliver',at(name),'--out',at(output),...args],
    {encoding:'utf8'});
  return {at,json,wav,deliver};
}

test('BWF preserves the RIFF audio and a 64-bit first-sample time reference',()=>{
  const pcm=audio([.5,0,-.5]);
  const title='Alignment';
  const file=WAV.encode(pcm,{encoding:'pcm24',bwf:{description:title,originator:'Ink',originatorReference:'ink-ref',
    date:'2026-11-22',time:'09:31:10',timeReference:'4294967342'}});
  assert.equal(file.readUInt32LE(4),file.length-8);
  assert.deepEqual([...WAV.decode(file).samples],pcm.samples);
  const value=WAV.decode(file,{metadata:true});
  assert.deepEqual(value.bwf,{description:title,originator:'Ink',originatorReference:'ink-ref',
    date:'2026-11-22',time:'09:31:10',timeReference:'4294967342',version:1});
  assert.throws(()=>WAV.encode(pcm,{bwf:{timeReference:'18446744073709551616'}}),/64 bits/);
});

test('delivery PCM stems null at the compensated master input, including nonlinear and shared routes',t=>{
  const {at,json,wav,deliver}=setup(t);
  const dialogue=audio(Float64Array.from({length:4000},(_,i)=>i<2900 ? .25*Math.sin(i*.3) : 0));
  const score=audio(Float64Array.from({length:8400},(_,i)=>.17*Math.cos(i*2.21)));
  const hit=audio([.5,.2,-.12,.06,.02]);
  const mixer={id:'thaw',sampleRate:rate,end:{samples:9600},output:'master',tail:'cut',
    strips:{master:{inserts:['clip']},dialogue:{clips:[{id:'line',source:'voice',at:{samples:690}}],sends:{room:{level:.5}}},
      music:{clips:[{id:'floor',source:'score'}],inserts:[{processor:'duck',sidechain:{strip:'dialogue',tap:'pre'}}],
        sends:{master:{tap:'pre',level:.21}}},
      door:{clips:[{id:'inside',source:'hit',at:{samples:3180}},{id:'following',source:'hit',at:{samples:4800}}],
        sends:{room:{level:.8}}},
      room:{inserts:['echo']}},
    processors:{clip:{type:'drive',amount:2.9},echo:{type:'delay',seconds:.12,feedback:.17},
      duck:{type:'compressor',thresholdDb:-25,lookahead:.01}}};
  wav('voice.wav',dialogue);wav('score.wav',score);wav('hit.wav',hit);
  json('recipe.json',{mixer,assets:{voice:'voice.wav',score:'score.wav',hit:'hit.wav'},delivery:{
    id:'thaw',from:{frame:1},fps:{numerator:24000,denominator:1001},bwf:{timeReference:480000},
    roles:{door:'effects'},cues:[{id:'enter',label:'Door, opens',at:{frame:1},role:'effects'}],
    loops:[{id:'room',from:{samples:1000},to:{samples:3800}}]}});
  const exec=deliver('recipe.json','output');
  assert.equal(exec.status,0,exec.stderr);
  const actual=read(at('output/delivery.json'));
  const open=file=>WAV.read(at('output/'+file),{metadata:true});
  assert.equal(actual.firstSample,333);
  assert.equal(actual.timeReference,'480333');
  assert.equal(actual.frames,9267);
  assert.deepEqual(Object.keys(actual.stems),['dialogue','music','foley','effects','ambience','returns']);
  const pre=open(actual.premaster), master=open(actual.master), stem=Object.values(actual.stems).map(open);
  assert.equal(master.bwf.timeReference,pre.bwf.timeReference);
  assert.notDeepEqual(master.samples,pre.samples);
  for (let i=0;i<pre.samples.length;i++) assert.equal(stem.reduce((sum,row)=>sum+row.samples[i],0),pre.samples[i]);
  assert(stem.at(-1).samples.some(x=>x!==0));
  const regular=A.mixer.render(mixer,{voice:WAV.read(at('voice.wav')),score:WAV.read(at('score.wav')),hit:WAV.read(at('hit.wav'))});
  const standard=WAV.decode(WAV.encode({...regular.value,samples:regular.value.samples.slice(666)},{encoding:'pcm24'}));
  assert.deepEqual(master.samples,standard.samples);
  const me=open(actual.musicAndEffects.master);
  const muted={...mixer,strips:{...mixer.strips,dialogue:{...mixer.strips.dialogue,clips:[]}}};
  const compare=A.mixer.render(muted,{voice:WAV.read(at('voice.wav')),score:WAV.read(at('score.wav')),hit:WAV.read(at('hit.wav'))});
  assert.deepEqual(me.samples,WAV.decode(WAV.encode({...compare.value,samples:compare.value.samples.slice(666)},{encoding:'pcm24'})).samples);
  const loop=actual.loops[0], head=open(loop.body), tail=open(loop.tail), both=open(loop.withTail);
  assert.equal(head.bwf.timeReference,'481000');
  assert.equal(tail.bwf.timeReference,'483800');
  assert(tail.samples.some(x=>x!==0));
  assert.deepEqual(both.samples.subarray(0,head.samples.length),head.samples);
  assert.deepEqual(both.samples.subarray(head.samples.length),tail.samples);
  const cut=A.mixer.render({...mixer,end:{samples:3800},tail:'keep'},{voice:WAV.read(at('voice.wav')),
    score:WAV.read(at('score.wav')),hit:WAV.read(at('hit.wav'))}).value;
  assert.deepEqual(both.samples,WAV.decode(WAV.encode({...cut,samples:cut.samples.slice(2000)},{encoding:'pcm24'})).samples);
  const cues=read(at('output/'+actual.cueSheet.json)).cues;
  assert.equal(cues.find(row=>row.id==='enter').pictureFrame,1);
  assert.match(fs.readFileSync(at('output/'+actual.cueSheet.csv),'utf8'),/"Door, opens"/);
  const otio=read(at('output/'+actual.interchange));
  assert.equal(otio.global_start_time.value,480333);
  assert.equal(otio.tracks.children[0].children[0].media_reference.target_url,'stems/dialogue.wav');
  assert.equal(otio.tracks.markers.find(mark=>mark.name==='Door, opens').marked_range.start_time.value,0);
});

test('scene delivery spots native cues and reports strict quality failures while preserving the package',t=>{
  const {at,json,wav,deliver}=setup(t);
  wav('actor.wav',audio([.75,.5,.21,.03]));
  wav('metal.wav',audio([.7,.125,0]));
  json('world.json',{format:'ink-studio/world',id:'gel',dt:.1,
    timeline:{duration:1,audio:[{id:'impact',cue:'metal',time:.5}]}});
  json('scene.json',{format:'ink-studio/scene-audio',version:1,sampleRate:rate,post:{},
    assets:{actor:'actor.wav',metal:'metal.wav'},tracks:[{asset:'actor',bus:'dialogue',time:.2}]});
  json('take.json',{format:'ink-studio/take',version:1,world:'world.json',audio:'scene.json',clock:{fps:25,simulationRate:10}});
  json('delivery-setup.json',{take:'take.json',delivery:{id:'thaw',profile:'ebu-r128',bwf:{timeReference:20000}}});
  const exec=deliver('delivery-setup.json','package','--strict');
  assert.equal(exec.status,1,exec.stderr);
  assert(exec.stdout,exec.stderr);
  const manifest=read(at('package/delivery.json')), quality=read(at('package/quality.json'));
  assert.equal(JSON.parse(exec.stdout).passed,false);
  assert.equal(quality.files[manifest.master].rateMatch,false);
  assert.equal(quality.files[manifest.master].truePeak,true);
  assert.equal(quality.files[manifest.master].loudness,false);
  assert.equal(manifest.frames,8000);
  const cues=read(at('package/cue-sheet.json')).cues;
  const metal=cues.find(row=>row.source==='metal');
  assert.equal(metal.role,'effects');
  assert.equal(metal.fromSample,4000);
  const me=WAV.read(at('package/'+manifest.musicAndEffects.master)).samples;
  assert.equal(me[3200],0);
  assert(me[8000]>.68);
});
