const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const kit = require('..').load();
const PNG = require('../cli/png.js'), WAV = require('../cli/wav.js');
const Review = require('../cli/blind-av-review.js');

const root = path.resolve(__dirname,'..'), read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const questions = require('../examples/blind-av-review/brief.json').questions;
const brief = {format:'ink-studio/blind-av-review',version:1,id:'test-review',title:'Private production name',
  picture:'export.json',window:{from:11,to:14},seats:6,questions};
const modes = ['picture','sound','combined'];
const has = name=>spawnSync(name,['-version'],{stdio:'ignore'}).status===0;
const cli = (...args)=>spawnSync(process.execPath,[path.join(root,'cli/ink-studio.js'),'take',...args],
  {encoding:'utf8',timeout:15000});
function write(file,value) { fs.writeFileSync(file,JSON.stringify(value)); }
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-blind-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function parsePage(html) {
  const line = html.match(/^const model = (.*);$/m);
  return JSON.parse(line[1]);
}
function fixture(dir) {
  const picture = Array.from({length:5},(_,index)=>{
    const file = index+'.png', rgb = new Uint8Array(33*21*3).fill(44+index*15);
    PNG.write(path.join(dir,file),33,21,rgb);
    return {frame:10+index,file};
  });
  const fps = {numerator:24000,denominator:1001}, sampleRate = 48000;
  const clock = kit.KIT.timeDomains.take({fps,sampleRate});
  const startSample = clock.at(10).firstSample, endSample = clock.at(15).firstSample;
  const samples = Float64Array.from({length:endSample-startSample},(_,index)=>.18*Math.sin(index*.09));
  fs.writeFileSync(path.join(dir,'audio.wav'),WAV.encode({sampleRate,channels:1,samples}));
  write(path.join(dir,'export.json'),{format:'ink-studio/audiovisual-export',version:1,
    picture:{format:'ink-studio/graph-clip',fps,from:10,to:15,frames:picture},
    audio:{file:'audio.wav',startSample}});
  write(path.join(dir,'brief.json'),brief);
  return clock;
}

function keyFixture() {
  const session = '4a51c693-a0ec-49d2-ba62-8dd25d52846c';
  const seats = [...modes,...modes].map((mode,index)=>({mode,
    seat:'72651524-2094-4eff-b587-00000000000'+index,
    choices:{action:['gate','swing','unsure','light'],cause:['bell','motor','unsure','chain']}}));
  return {format:brief.format+'-key',version:1,session,id:brief.id,title:brief.title,questions,seats};
}

function ballot(key,index,answers,completions=1) {
  return {format:Review.ballotFormat,version:1,session:key.session,seat:key.seats[index].seat,completions,answers};
}

test('report scores seat-local choices, shows missing cohorts and keeps impact separate', ()=>{
  const key = keyFixture();
  const report = Review.summarize(key,[
    ballot(key,0,{action:2,cause:2,impact:3}),
    ballot(key,2,{action:2,cause:1,impact:4},2),
    ballot(key,3,{action:3,cause:3,impact:null}),
    ballot(key,5,{action:2,cause:1,impact:5})
  ]);
  const [picture,sound,combined] = report.cohorts;
  assert.deepEqual([report.received,report.assigned],[4,6]);
  assert.deepEqual([picture.action.correct,picture.cause.correct,picture.impact.median,picture.impact.unrated],[1,0,3,1]);
  assert.equal(sound.action.fraction,null);
  assert.equal(sound.impact.median,null);
  assert.equal(combined.replayed,1);
  assert.equal(combined.impact.median,4.5);
  assert.deepEqual(report.differences,[{against:'picture',action:.5,cause:1,impact:1.5},
    {against:'sound',action:null,cause:null,impact:null}]);
});

test('rejects duplicate, cross-review, out-of-range and unplayed ballots', ()=>{
  const key = keyFixture(), valid = ballot(key,0,{action:2,cause:1,impact:2});
  assert.throws(()=>Review.summarize(key,[valid,valid]),/more than one ballot/);
  assert.throws(()=>Review.summarize(key,[{...valid,session:key.seats[0].seat}]),/does not belong/);
  assert.throws(()=>Review.summarize(key,[{...valid,seat:key.session}]),/does not belong/);
  assert.throws(()=>Review.summarize(key,[{...valid,completions:0}]),/incomplete/);
  assert.throws(()=>Review.summarize(key,[{...valid,answers:{...valid.answers,cause:8}}]),/out-of-range/);
  assert.throws(()=>Review.summarize(key,[{...valid,answers:{...valid.answers,impact:0}}]),/out-of-range/);
  assert.throws(()=>Review.summarize({...key,seats:key.seats.map(row=>({...row,mode:'combined'}))},[]),/unbalanced/);
});

test('CLI creates balanced private assignments and clean single-excerpt pages from a native take', t=>{
  if (!has('ffmpeg')||!has('ffprobe')) return t.skip('FFmpeg tools are unavailable');
  const dir = temporary(t), clock = fixture(dir);
  const owner = path.join(dir,'brief.json'), pack = path.join(dir,'pack');
  const first = cli('blind-review',owner,'--out',pack);
  assert.equal(first.status,0,first.stderr);
  const listing = JSON.parse(first.stdout), key = read(path.join(pack,'review-key.json'));
  assert.equal(key.window.firstSample,clock.at(11).firstSample);
  assert.equal(key.window.endSample,clock.at(14).firstSample);
  assert.deepEqual(key.window.fps,{numerator:24000,denominator:1001});
  assert.equal(listing.reviewers.length,6);
  for (const start of [0,3]) assert.deepEqual(key.seats.slice(start,start+3).map(row=>row.mode).sort(),[...modes].sort());
  const media = {};
  for (const row of key.seats) {
    const html = fs.readFileSync(path.join(pack,row.file),'utf8'), model = parsePage(html);
    assert.equal(model.session,key.session);
    assert.equal(model.seat,row.seat);
    assert.equal(model.kind,row.mode==='sound'?'audio':'video');
    assert(!html.includes(brief.title));
    assert.equal(model.questions.action.correct,undefined);
    assert.deepEqual(Object.keys(model.questions.action.options[0]),['code','label']);
    assert(model.questions.action.options.every(({code,label})=>
      questions.action.options.find(option=>option.id===row.choices.action[code-1]).label===label));
    const filename = path.join(dir,row.mode+'.mp4');
    fs.writeFileSync(filename,Buffer.from(model.excerpt,'base64'));
    const probe = spawnSync('ffprobe',['-v','error','-show_streams','-show_packets','-show_data_hash','sha256',
      '-of','json',filename],{encoding:'utf8'});
    assert.equal(probe.status,0,probe.stderr);
    media[row.mode] = JSON.parse(probe.stdout);
  }
  assert.deepEqual(modes.map(mode=>media[mode].streams.map(stream=>stream.codec_type)),
    [['video'],['audio'],['video','audio']]);
  const packets = (mode,index)=>media[mode].packets.filter(packet=>packet.stream_index===index)
    .map(packet=>[packet.pts_time,packet.duration_time,packet.data_hash]);
  assert.deepEqual(packets('picture',0),packets('combined',0));
  assert.deepEqual(packets('sound',0),packets('combined',1));
  assert.equal(media.picture.streams[0].nb_frames,'3');
  assert.equal(media.sound.streams[0].duration_ts,key.window.endSample-key.window.firstSample);
  assert.notEqual(cli('blind-review',owner,'--out',pack).status,0);

  const ballots = path.join(dir,'ballots'), out = path.join(dir,'report');
  fs.mkdirSync(ballots);
  const {choices} = key.seats[0];
  write(path.join(ballots,'response.json'),ballot(key,0,{action:choices.action.indexOf('swing')+1,
    cause:choices.cause.indexOf('bell')+1,impact:5}));
  const scored = cli('blind-review-score',path.join(pack,'review-key.json'),ballots,'--out',out);
  assert.equal(scored.status,0,scored.stderr);
  const report = read(path.join(out,'report.json'));
  assert.equal(report.received,1);
  assert.equal(report.cohorts.find(cohort=>cohort.mode===key.seats[0].mode).cause.correct,1);
  assert(fs.readFileSync(path.join(out,'index.html'),'utf8').includes('Response distributions'));
});

test('failed packaging does not publish a partial review', t=>{
  const dir = temporary(t);
  fixture(dir);
  const owner = path.join(dir,'brief.json'), out = path.join(dir,'invalid');
  write(owner,{...brief,window:{from:8,to:14}});
  assert.throws(()=>Review.build(owner,out,kit,'ffmpeg'),/excerpt/);
  assert.equal(fs.existsSync(out),false);
  assert.equal(fs.readdirSync(dir).some(name=>name.startsWith('.ink-blind-av-')),false);
});
