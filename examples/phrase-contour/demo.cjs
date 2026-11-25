const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const P=require('../..').load().KIT.procedural, {make}=require('./fixture.cjs');
const WAV=require('../../cli/wav.js'),{json,write}=require('../../cli/asset-files.js');

const dir=process.argv[2];
if (!dir) throw Error('Use node examples/phrase-contour/demo.cjs <output-directory>');
const {captured,borrow,editor,clock,donorTake}=make(P);
const input=editor.edit(captured,[{op:'comp',lane:'call',take:donorTake,from:{beat:0},to:{beat:4}}]);
const output=editor.edit(input,[borrow]);
const audition={lane:'answer',phrase:borrow.phrase,takes:['borrowed']};
const reviewed=editor.auditionPhrase(output,audition), {performances,takes}=editor.inspect(output).lanes.answer;
const donor=editor.render(input,{from:{beat:0},to:{beat:4}}).value;
const suite=editor.render(output).value;
const analysis=performances.borrowed[0], first=clock.timeAt({beat:4});
const notes=takes.reference.map(({address,midi,beat,time,gate,velocity,play},i)=>{
  const fitted=takes.borrowed[i];
  assert.equal(fitted.midi,midi);
  assert.equal(fitted.play.articulation,play.articulation);
  assert(Math.abs(time+gate-fitted.time-fitted.gate)<2e-8);
  return {name:address[3],midi,beat:beat-4,written:time-first,borrowed:fitted.time-first,keyUp:time+gate-first,
    writtenAccent:velocity,borrowedAccent:fitted.velocity,articulation:play.articulation};
});
const moves=notes.filter(note=>Math.abs(note.written-note.borrowed)>.0001);
assert(moves.length>2);
const wav=(value,encoding='pcm24')=>WAV.encode(value,{encoding});
const audio={donor,reference:reviewed.audio.reference,borrowed:reviewed.audio.borrowed};
for (const [id,value] of Object.entries(audio)) write(path.join(dir,id+'.wav'),wav(value));
write(path.join(dir,'paper-wind.wav'),wav(suite));
json(path.join(dir,'captured.json'),{session:input,assets:{}});
json(path.join(dir,'borrowed.json'),{session:output,assets:{}});
json(path.join(dir,'borrow.json'),[borrow]);
json(path.join(dir,'listen.json'),audition);
json(path.join(dir,'report.json'),{donorTake,notes,phrase:analysis,audition:reviewed.report});
const config={notes,breath:analysis.drivers.breath.map(({beat,value})=>[clock.timeAt({beat})-first,value]),
  duration:reviewed.audio.borrowed.samples.length/2/reviewed.report.sampleRate,
  audio:Object.fromEntries(Object.entries(audio).map(([id,value])=>[id,wav(value,'pcm16').toString('base64')]))};
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
write(path.join(dir,'index.html'),read('review.html').replace('/*INK_CONTOUR_DATA*/',()=>JSON.stringify(config))
  .replace('/*INK_CONTOUR_SCRIPT*/',()=>read('review.js')));
console.log(JSON.stringify({donorNotes:5,destinationNotes:notes.length,knots:analysis.drivers.breath.length,moved:moves.length,
  maxShiftMs:1000*Math.max(...moves.map(note=>Math.abs(note.borrowed-note.written)))}));
