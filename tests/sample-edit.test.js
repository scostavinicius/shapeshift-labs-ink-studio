const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), kit=ink.load(), A=kit.KIT.procedural.mediaGraph, E=A.sampleEdit;
const sampleRate=8000;
const mono=values=>({sampleRate,channels:1,samples:Float64Array.from(values)});
const asArray=audio=>[...audio.samples];

test('transient proposals use Ink detector positions and markers can be auditioned and edited independently',()=>{
  const frames=8000;
  const pcm=mono(Array.from({length:frames},(_,i)=>[960,3360,5920].reduce((sum,at)=>{
    const t=i-at;
    return sum+(t>=0 && t<125 ? .75*Math.cos(t*1.79)*Math.exp(-t*.019) : 0);
  },0)));
  const detect={minGap:.16,sensitivity:2};
  const proposals=E.create(pcm,{detect});
  assert(proposals.markers.length>=3);
  assert.deepEqual(proposals.markers.map(row=>row.at),A.detectTransients(pcm,detect).events.map(row=>row.detected.sample));
  const [a,b]=proposals.markers;
  const edited=E.edit(proposals,[{op:'move',id:a.id,at:a.at-3},
    {op:'delete',id:b.id},{op:'add',id:'second',at:b.at-2,kind:'attack'},
    {op:'splitHit',id:a.id,body:a.at+12,tail:a.at+72,bodyId:'body',tailId:'tail'}]);
  assert.equal(proposals.markers[0].at,a.at);
  const {value,report}=E.audition(pcm,edited,{marker:a.id,before:16,after:80});
  assert.equal(report.center,16);
  assert.deepEqual(value.samples,pcm.samples.slice(a.at-19,a.at+77));
  const rendered=E.render(pcm,edited,{slice:'body'});
  assert.equal(rendered.report.slices.find(row=>row.id==='tail').kind,'tail');
  assert.deepEqual(rendered.value.samples,pcm.samples.slice(a.at+12,a.at+72));
  assert.deepEqual(E.render(pcm,edited).value.samples,pcm.samples);
  assert.throws(()=>E.edit(proposals,[{op:'move',id:a.id,at:b.at}]),/unique IDs and source frames/);
});

test('source-first clips reverse, slip and trim on frame boundaries with exact stereo join previews',()=>{
  const pcm={sampleRate,channels:2,samples:Float64Array.from({length:24},(_,i)=>
    (i%2 ? -1 : 1)*Math.floor(i/2)/12)};
  const base=E.create(pcm);
  const edit=E.edit(base,[
    {op:'assemble',clips:[{id:'first',from:1,to:7},{id:'second',from:4,to:10}]},
    {op:'reverse',id:'second'},{op:'trim',id:'second',head:1,tail:1},{op:'slip',id:'second',frames:1},
    {op:'crossfade',left:'first',right:'second',frames:2}
  ]);
  const stereo=frames=>frames.flatMap(frame=>[frame/12,-frame/12]);
  const {value,report}=E.render(pcm,edit);
  assert.equal(report.joins[0].at,4);
  assert.deepEqual([...value.samples.slice(0,8)],stereo([1,2,3,4]));
  assert.deepEqual([...value.samples.slice(-4)],stereo([7,6]));
  for (const [i,frame] of [5,6].entries()) {
    const u=(i+1)/3, mixed=(frame*(1-u)+(9-i)*u)/12;
    assert(Math.abs(value.samples[(4+i)*2]-mixed)<1e-12);
    assert.equal(value.samples[(4+i)*2],-value.samples[(4+i)*2+1]);
  }
  const joined=E.audition(pcm,edit,{left:'first',right:'second',before:2,after:2});
  assert.deepEqual([...joined.hardCut.samples],stereo([5,6,9,8]));
  assert.deepEqual(joined.value.samples,value.samples.slice(4,16));
  assert.deepEqual(base.clips,[{id:'original',from:0,to:12,reverse:false}]);
  assert.throws(()=>E.edit(edit,[{op:'trim',id:'second',head:3}]),/Crossfades overlap/);
});

test('equal-power headroom is shared by ranges and the hard-cut comparison',()=>{
  const pcm=mono(new Array(12).fill(1));
  const edit=E.edit(E.create(pcm),[
    {op:'assemble',clips:[{id:'one',from:0,to:8},{id:'two',from:4,to:12}]},
    {op:'crossfade',left:'one',right:'two',frames:3,curve:'equal-power'}
  ]);
  const wide=E.render(pcm,edit), crop=E.render(pcm,edit,{firstSample:0,endSample:3});
  assert.equal(wide.report.gain,crop.report.gain);
  assert(wide.report.gain<1);
  assert.equal(wide.value.samples[6],1);
  const join=E.audition(pcm,edit,{left:'one',right:'two',before:1,after:1});
  assert.equal(join.report.gain,wide.report.gain);
  assert(join.hardCut.samples.every(x=>x===wide.report.gain));
  assert.deepEqual(crop.value.samples,wide.value.samples.slice(0,3));
});

test('CLI reopens edits by catalog source hash, publishes audio, and leaves the original intact',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-slice-')), libraryPath=path.join(root,'library');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const library=ink.openSampleLibrary(libraryPath,{kit});
  const pcm=mono([.125,.25,.375,.5,.625,.75,.875,1]);
  const stored=library.add(A.sampleCatalog.capture(pcm,{sample:{id:'original',label:'Original'},
    source:{kind:'file',name:'clip.wav'}}));
  const at=(name,value)=>{
    const target=path.join(root,name);
    if (value!==undefined) fs.writeFileSync(target,JSON.stringify(value));
    return target;
  };
  const run=(mode,...args)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'music','samples',mode,libraryPath,...args],{encoding:'utf8'}));
  const project=at('original.json',run('slice','original'));
  const changes=at('changes.json',[{op:'assemble',clips:[{id:'a',from:0,to:4},{id:'b',from:4,to:8}]},
    {op:'reverse',id:'b'},{op:'crossfade',left:'a',right:'b',frames:1}]);
  const edited=run('edit',project,changes), edit=at('edit.json',edited);
  assert.equal(edited.source.asset,stored.entry.asset);
  const result=run('render',edit,'--out',at('render'));
  assert.deepEqual(asArray(ink.readWav(result.audio)),[.125,.25,.375,.75,.875,.75,.625]);
  const options=at('join.json',{left:'a',right:'b',before:3,after:2});
  const review=run('audition',edit,options,'--out',at('review'));
  assert.deepEqual(asArray(ink.readWav(review.hardCut)),[.25,.375,.5,1,.875]);
  assert.deepEqual(library.load('original').value.samples,pcm.samples);
});
