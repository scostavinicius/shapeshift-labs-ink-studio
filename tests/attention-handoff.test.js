const assert=require('node:assert/strict'),{test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ink=require('..'),kit=ink.load(),{build}=require('../cli/attention-handoff.js');
const WAV=require('../cli/wav.js'),PNG=require('../cli/png.js');
const rate=48000, fps={numerator:30000,denominator:1001};

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-attention-handoff-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const file=name=>path.join(dir,name);
  function save(name,value){
    fs.writeFileSync(file(name),JSON.stringify(value));
    return file(name);
  }
  const take=kit.KIT.timeDomains.take({fps,sampleRate:rate}), anchor=take.at(20).firstSample;
  const cue={sampleRate:rate,channels:1,samples:Float64Array.from({length:51},(_,i)=>i===4?.75:0)};
  const bed={sampleRate:rate,channels:2,samples:Float64Array.from({length:100000},(_,i)=>i%2?.5:.625)};
  fs.writeFileSync(file('cue.wav'),WAV.encode(cue,{encoding:'pcm24'}));
  fs.writeFileSync(file('bed.wav'),WAV.encode(bed,{encoding:'pcm24'}));
  const session={format:'ink-studio/audio-editorial',version:1,id:'spot',sampleRate:rate,
    picture:{fps,startFrame:20,shots:[{id:'glass',frames:30}]},
    clips:[
      {id:'bed',spot:{samples:0},take:'one',takes:{one:{asset:'bed',sync:{sample:0}}}},
      {id:'spark',spot:{frame:8},offsetSamples:37,track:'answer',
        take:'one',takes:{one:{asset:'cue',sync:{sample:4}}}}
    ]};
  save('editorial.json',{session,assets:{cue:'cue.wav',bed:'bed.wav'}});
  const frames=Array.from({length:14},(_,i)=>{
    const name='frame-'+i+'.png';
    PNG.write(file(name),8,4,new Uint8Array(8*4*3).fill(i*12));
    return name;
  });
  const recipe={format:'ink-studio/attention-handoff',version:1,id:'glass',editorial:'editorial.json',
    picture:{fps,firstFrame:23,frames},window:{from:25,to:35},
    reveal:{frame:29,label:'Lantern appears'},clip:'spark',
    variants:[{id:'lead',offsetMs:-25},{id:'same',offsetMs:0},{id:'answer',offsetMs:42.5}]};
  return {recipe,take,anchor,session,file,save};
}

test('lead, sync and answer variants move only the selected source on a cropped fractional take clock',t=>{
  const {recipe,take,anchor,session,file,save}=fixture(t);
  const {report,picture,audio}=build(save('handoff.json',recipe),kit);
  assert.equal(report.window.firstSample,take.at(25).firstSample);
  assert.equal(report.reveal.sample,take.at(29).firstSample);
  assert.deepEqual(picture.slice(0,1),[fs.readFileSync(file('frame-2.png'))]);
  assert.equal(picture.length,10);
  const positions=[-1200,0,2040].map(delta=>take.at(29).firstSample+delta);
  assert.deepEqual(report.variants.map(row=>row.syncSample),positions);
  const decoded=audio.map(bytes=>WAV.decode(bytes,{metadata:true}));
  const [from,to]=[take.at(25).firstSample,take.at(35).firstSample];
  for(const [index,{samples,bwf}] of decoded.entries()){
    assert.equal(bwf.timeReference,String(from));
    assert.equal(samples.length/2,to-from);
    const expected=positions[index]-from;
    assert.equal(samples.findIndex(value=>value>.8),expected*2);
    for(const other of positions.filter(sample=>sample!==positions[index])){
      assert.equal(samples[(other-from)*2],samples[0]);
    }
    assert.equal(samples[2*(expected+1)],samples[0]);
    const P=kit.KIT.procedural, assets={cue:WAV.read(file('cue.wav')),bed:WAV.read(file('bed.wav'))};
    const revised=P.mediaGraph.audioEditorial.revise(session,assets,[report.variants[index].edit]);
    assert.equal(revised.report.clips.find(row=>row.id==='spark').spot.sample,positions[index]-anchor);
    assert.deepEqual(revised.value.clips[0],session.clips[0]);
  }
  assert.equal(report.headroom,1/1.375);
  assert.equal(decoded[0].samples[0],decoded[1].samples[0]);
  assert.equal(decoded[0].samples[1],decoded[2].samples[1]);
});

test('reject offsets that leave the preview and offsets rounding to the same sample',t=>{
  const {recipe,save}=fixture(t);
  assert.throws(()=>build(save('handoff.json',{...recipe,variants:[{id:'lead',offsetMs:-500},
    {id:'same',offsetMs:0}]}),kit),/include lead sound cue/);
  assert.throws(()=>build(save('handoff.json',{...recipe,variants:[{id:'same',offsetMs:0},
    {id:'answer',offsetMs:.001}]}),kit),/same audio sample/);
});

test('the take CLI publishes shared media, offset reports and native edits from a numbered export',t=>{
  const {recipe,file,save}=fixture(t), {frames,firstFrame}=recipe.picture;
  save('export.json',{format:'ink-studio/audiovisual-export',version:1,
    picture:{format:'ink-studio/graph-clip',fps,from:firstFrame,to:firstFrame+frames.length,
      frames:frames.map((file,i)=>({frame:firstFrame+i,file}))},audio:{file:'bed.wav',startSample:0}});
  const input=save('handoff.json',{...recipe,picture:'export.json'}), cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=out=>spawnSync(process.execPath,[cli,'take','audition-handoff',input,'--out',out],{encoding:'utf8'});
  const result=run(file('out'));
  assert.equal(result.status,0,result.stderr);
  const exported=JSON.parse(result.stdout), report=JSON.parse(fs.readFileSync(exported.report,'utf8'));
  assert.equal(exported.variants,3);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('out/lead.edit.json'),'utf8')),[report.variants[0].edit]);
  assert.match(fs.readFileSync(exported.review,'utf8'),/Download selected nudge/);
  fs.linkSync(file('cue.wav'),file('lead.wav'));
  const collision=run(path.dirname(input));
  assert.equal(collision.status,1);
  assert.match(collision.stderr,/separate from the source/);
});
