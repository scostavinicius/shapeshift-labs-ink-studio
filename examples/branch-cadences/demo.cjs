const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib'),WAV=require('../../cli/wav.js'),{json,write}=require('../../cli/asset-files.js');
const ink=require('../..'),live=ink.load().KIT.music.production.live;
const {sources,timeline,options,labels,tempo,samples,excursion}=require('./fixture.cjs');

const out=process.argv[2];
if (!out) throw Error('Use node examples/branch-cadences/demo.cjs <output-directory>');
const pcm=(take,encoding='pcm24')=>WAV.encode(take.value,{encoding});
async function run() {
  json(path.join(out,'score.json'),{sources,timeline,live:{options}});
  json(path.join(out,'route.json'),excursion);
  const trip=await live.replay(sources,timeline,excursion,options);
  const joins=trip.report.joins.filter(join=>join.from==='ferry');
  assert.deepEqual(joins.map(join=>join.carry.cadence.id),['pickup','full','turn']);
  assert(joins.every(join=>join.carry.cadence.status==='started'));
  assert.equal(trip.report.profile.clippedFrames,0);
  write(path.join(out,'night-ferry.wav'),pcm(trip));
  json(path.join(out,'listen.json'),trip.report);
  const examples={};
  for (const [name,{label,route}] of Object.entries(samples)) {
    const take=await live.replay(sources,timeline,route,options), [join]=take.report.joins;
    assert.equal(join.carry.cadence.id,name==='late' ? null : name);
    write(path.join(out,'takes',name+'.wav'),pcm(take));
    json(path.join(out,'routes',name+'.json'),route);
    examples[name]={label,join,pcm:pcm(take,'pcm16').toString('base64')};
  }
  const config={sources,timeline,options,labels,tempo,examples};
  const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
  const html=read('review.html').replace('/*INK_CADENCE_DATA*/',()=>JSON.stringify(config))
    .replace('/*INK_CADENCE_ENGINE*/',()=>JSON.stringify(gzipSync(ink.bundle(),{level:9}).toString('base64')))
    .replace('/*INK_CADENCE_SCRIPT*/',()=>read('review.js'));
  write(path.join(out,'index.html'),html);
  console.log(JSON.stringify(joins.map(join=>({to:join.to,time:join.time,cadence:join.carry.cadence.id,
    phase:join.carry.cadence.phase,dwellFrames:join.carry.cadence.dwellFrames}))));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
