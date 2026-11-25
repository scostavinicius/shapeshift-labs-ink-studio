const test=require('node:test'), assert=require('node:assert/strict');
const studio=require('..'), A=studio.load().KIT.music.production;
const {project,route,event,ids}=require('../examples/motif-branch-memory/fixture.cjs');
const rate=8000, {sources,timeline}=project(A), options={sampleRate:rate};
const replay=(path,spec=timeline,commands=route(path),settings=options)=>A.live.replay(sources,spec,commands,settings);
const mode=preserve=>({...timeline,thematic:{...timeline.thematic,recalls:{overlook:{
  ...timeline.thematic.recalls.overlook,preserve}}}});
const recall=out=>out.report.joins.find(row=>row.to==='overlook').entry.recall;
const relative=(rows,key)=>rows.map(row=>row[key]-rows[0][key]);
const close=(a,b,tol)=>{assert.equal(a.length,b.length);a.forEach((n,i)=>assert(Math.abs(n-b[i])<=tol));};

test('the live destination plays the heard branch rhythm and intervals on a new instrument',async()=>{
  const [wet,dry]=await Promise.all([replay('waterline'),replay('clocktower')]);
  const a=recall(wet), b=recall(dry);
  assert.equal(a.part,'cello');
  assert.equal(a.version.part,'reed');
  assert.equal(b.version.part,'glass');
  assert.deepEqual(a.version.notes.map(row=>row.id),ids);
  assert(a.version.complete&&b.version.complete);
  assert.deepEqual(relative(a.notes,'midi'),[0,3,7,5]);
  assert.deepEqual(relative(b.notes,'midi'),[0,7,5,-2]);
  close(relative(a.notes,'beat'),[0,.45,1.22,1.7],.001);
  close(relative(b.notes,'beat'),[0,.78,1,1.95],.001);
  assert(a.notes.every(row=>row.status==='played')&&b.notes.every(row=>row.status==='played'));
  assert.equal(wet.report.themeVersions.beacon.source,'waterline','recall should not become a new heard version');
  const chunks=await replay('waterline',timeline,{...route('waterline'),blockFrames:137});
  assert.deepEqual(chunks.value.samples,wet.value.samples);
});

test('muted or unadmitted attacks do not count, and a partial later version never borrows missing notes',async()=>{
  const muted=await replay('waterline',timeline,route('waterline'),{...options,layerGains:{reed:0}});
  const starved=await replay('waterline',timeline,route('waterline'),{...options,maxVoices:1,reservedVoices:1,foreground:['bed']});
  for(const output of [muted,starved]){
    assert.equal(recall(output).status,'unheard');
    assert.equal(output.report.themeVersions.beacon,null);
  }
  assert(starved.report.profile.dropped>0);
  const visits=[event('junction','waterline',.42),event('waterline','clocktower',2.12)];
  const visit=transition=>({...route('waterline'),events:[...visits,event('clocktower','overlook',transition)]});
  const short=await replay('waterline',timeline,visit(2.61));
  assert.equal(recall(short).version.source,'waterline');
  assert.equal(short.report.themeVersions.beacon.source,'clocktower');
  const partial=await replay('waterline',timeline,visit(3.01));
  const remembered=recall(partial).version;
  assert.equal(remembered.source,'clocktower');
  assert.equal(remembered.complete,false);
  assert.deepEqual(remembered.notes.map(row=>row.id),ids.slice(0,3));
  assert.deepEqual(relative(recall(partial).notes,'midi'),[0,7,5]);
});

test('authors can keep only rhythm or only signed intervals',async()=>{
  const [rhythm,intervals]=await Promise.all([replay('clocktower',mode('rhythm')),replay('clocktower',mode('intervals'))]);
  assert.deepEqual(relative(recall(rhythm).notes,'midi'),[0,0,0,0]);
  close(relative(recall(rhythm).notes,'beat'),[0,.78,1,1.95],.001);
  assert.deepEqual(relative(recall(intervals).notes,'midi'),[0,7,5,-2]);
  close(relative(recall(intervals).notes,'beat'),[0,.5,1,1.5],1e-6);
});

test('headless renders remember the branch, print recall stems, and reconstruct memory for a trim',()=>{
  const printed=(path,spec=timeline,render={})=>A.renderTimeline(sources,spec,route(path).events.map(row=>row.intent),{},
    {sampleRate:rate,stems:true,...render});
  const a=printed('waterline'), b=printed('clocktower'), again=printed('clocktower',timeline,{start:2.5,end:4.45});
  assert.equal(a.report.themes.recalls[0].version.part,'reed');
  assert.deepEqual(relative(b.report.themes.recalls[0].notes,'midi'),[0,7,5,-2]);
  assert(b.stems.cello.samples.some(sample=>Math.abs(sample)>.04));
  assert.notDeepEqual(a.stems.cello.samples,b.stems.cello.samples);
  assert.deepEqual(again.value.samples,b.value.samples.slice(2.5*rate*2,4.45*rate*2));
  assert.deepEqual(again.report.themes,b.report.themes);
  const carry=printed('clocktower',{...timeline,performers:{tracks:['cello']}});
  assert(carry.stems.cello.samples.some(sample=>Math.abs(sample)>.04));
  assert.equal(carry.report.performers.lanes.cello.notes,4);
});
