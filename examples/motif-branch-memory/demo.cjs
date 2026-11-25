const fs=require('node:fs'), path=require('node:path');
const assert=require('node:assert/strict'), {gzipSync}=require('node:zlib');
const ink=require('../..'), A=ink.load().KIT.music.production;
const WAV=require('../../cli/wav.js'), {json,write}=require('../../cli/asset-files.js');
const fixture=require('./fixture.cjs');
const out=process.argv[2];
if(!out)throw Error('Use node examples/motif-branch-memory/demo.cjs <output-directory>');

const project=fixture.project(A), options={sampleRate:32000,masterGain:-1,foreground:['cello','reed','glass']};
const routes={waterline:fixture.route('waterline'),clocktower:fixture.route('clocktower'),early:fixture.route('clocktower',true)};

async function demo(){
  const examples={};
  for(const [name,route] of Object.entries(routes)){
    const take=await A.live.replay(project.sources,project.timeline,route,options);
    const join=take.report.joins.find(row=>row.to==='overlook');
    assert.equal(join.entry.recall.status,name==='early'?'unheard':'scheduled');
    if(name!=='early'){
      assert.equal(join.entry.recall.version.source,name);
      assert(join.entry.recall.notes.every(note=>note.status==='played'));
    }
    assert.equal(take.report.profile.clippedFrames,0);
    const file=path.join(out,name+'.wav');
    write(file,WAV.encode(take.value,{encoding:'pcm24'}));
    json(path.join(out,name+'-route.json'),route);
    examples[name]={join,versions:take.report.themeVersions,frames:take.value.samples.length/2,
      audio:WAV.encode(take.value,{encoding:'pcm16'}).toString('base64')};
  }
  json(path.join(out,'score.json'),{sources:project.sources,timeline:project.timeline,live:{options}});
  json(path.join(out,'recalls.json'),Object.fromEntries(Object.entries(examples).map(([name,{join,versions}])=>[name,{join,versions}])));
  const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
  const pack=JSON.stringify({...project,options,routes,examples});
  const engine=JSON.stringify(gzipSync(ink.bundle(),{level:9}).toString('base64'));
  const page=read('review.html').replace('/*INK_MOTIF_PROJECT*/',()=>pack)
    .replace('/*INK_MOTIF_ENGINE*/',()=>engine).replace('/*INK_MOTIF_SCRIPT*/',()=>read('review.js'));
  write(path.join(out,'index.html'),page);
  for(const [name,{join}] of Object.entries(examples))console.log(name,join.entry.recall.version?.part??'unheard',
    join.entry.recall.notes?.map(note=>note.midi));
}
demo().catch(error=>{console.error(error);process.exitCode=1;});
