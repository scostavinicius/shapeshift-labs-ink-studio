const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {KIT}=require('..').load(), P=KIT.procedural, E=P.mediaGraph.timbreEvolution, K=KIT.music.production;
const WAV=require('../cli/wav'), rate=16000;
const near=(a,b,limit)=>assert(Math.abs(a-b)<=limit,a+' vs '+b);
function recording() {
  let turn=0;
  return {sampleRate:rate,channels:1,samples:Float64Array.from({length:rate},(_,i)=>{
    const t=i/rate, pitch=230*2**(8*t/12);
    turn+=pitch/rate;
    const air=P.musicInstruments.noise(i,49), opening=Math.max(0,1-t*30);
    const tone=.3*Math.sin(turn*Math.PI*2)*Math.min(1,t*42)*Math.min(1,Math.max(0,5*(.90-t)));
    const tail=Math.max(0,1-Math.abs(t-.805)/.17);
    return tone+air*(.48*opening+.25*tail);
  })};
}
function score() {
  const sine={type:'graph',output:'voice',tail:.24,nodes:{
    oscillator:{type:'oscillator',wave:'sine'},voice:{type:'gain',input:'oscillator',amount:.45}}};
  return {seed:104,arrangement:{
    score:{tempoMap:{tempo:120,changes:[{beat:2,tempo:80}]},key:{root:'C4',mode:'major'},endFade:0,
      harmonies:{home:{root:'C3',quality:'unison'}}},
    parts:{metal:{role:'percussion'},reed:{role:'lead'},air:{role:'pad'},bed:{role:'bass',material:'pedal'}},
    motifs:{pedal:{length:4,events:[{beat:.04,duration:.12,midi:36}]}},
    sections:[{id:'cue',bars:2,harmony:'home'}]
  },patches:{sine,metal:{type:'drum',kind:'metal',decay:.49}},tracks:{
    metal:{patch:'metal'},reed:{patch:'sine'},air:{patch:'sine'},bed:{patch:'sine',gain:-18}
  }};
}
const settings=()=>({id:'handoff',tonic:'C4',placements:[{id:'first',section:'cue',beat:.5,length:3}],
  routes:{attack:{part:'metal'},body:{part:'reed'},decay:{part:'air'}}});
const point=(points,phase)=>{
  const index=points.findIndex(row=>row[0]>phase), a=points[Math.max(0,index-1)], b=points[index];
  return index<0 ? points.at(-1)[1] : index===0 ? a[1] : a[1]+(b[1]-a[1])*(phase-a[0])/(b[0]-a[0]);
};
const at=(note,name,time)=>point(note.play.curves[name],(time-note.time)/note.gate);
const pitchAt=(note,time)=>note.midi+(note.play.curves.pitchCents ? at(note,'pitchCents',time)/100 : 0);
const rms=(pcm,from,to)=>{
  const span=pcm.samples.slice(Math.ceil(from*pcm.sampleRate)*pcm.channels,Math.floor(to*pcm.sampleRate)*pcm.channels);
  return Math.sqrt(span.reduce((sum,x)=>sum+x*x,0)/Math.max(1,span.length));
};

test('measurement retains a rising carrier, onset texture and rough decay on the source clock',()=>{
  const input=recording(), analysis={id:'rise',pitch:{lowHz:180,highHz:950}};
  const profile=E.analyze(input,analysis), {gesture,texture}=profile;
  assert.deepEqual(profile,E.analyze(input,analysis));
  const middle=gesture.pitchTrack.filter(row=>row.sample>rate*.17 && row.sample<rate*.54);
  assert(middle.at(-1).midi-middle[0].midi>2);
  assert(texture.some(row=>row.sample<rate*.03 && row.roughness>.18));
  assert(texture.some(row=>row.sample>rate*.75 && row.roughness>.21));
  assert(texture.some(row=>row.sample>rate*.2 && row.sample<rate*.52 && row.roughness<.06));
});

test('one trajectory crosses real-time, equal-power overlaps and creates ordinary editable tracks',()=>{
  const source=score(), base=K.compile(source), input=E.analyze(recording(),{pitch:{lowHz:180,highHz:950}});
  const config=settings(), active=input.gesture.active;
  config.handoffs={bodySample:active.fromSample+3400,decaySample:active.fromSample+10800,overlap:[.14,.18]};
  for (const route of Object.values(config.routes)) route.carry={pitch:1,envelope:0,roughness:0};
  const plan=E.plan(JSON.parse(JSON.stringify(input)),source,config), compiled=K.compile(plan.value);
  const {events,clock}=compiled;
  const [placement]=plan.report.placements;
  assert.deepEqual(events.bed,base.events.bed);
  assert.equal(events.metal[0].clip,placement.stages[0].clip);
  assert.equal(plan.value.tracks.metal.clips[0].mode,'layer');
  const tracks=['metal','reed','air'];
  const start=clock.timeAt({beat:placement.beat}), end=clock.timeAt({beat:placement.endBeat});
  for (const [{beat,endBeat},i] of placement.handoffs.map((row,i)=>[row,i])) {
    const a=events[tracks[i]][0], b=events[tracks[i+1]][0], first=clock.timeAt({beat}), last=clock.timeAt({beat:endBeat});
    near(last-first,(end-start)*config.handoffs.overlap[i],2e-6);
    near(a.time+a.gate,last,1e-7);
    near(b.time,first,1e-7);
    const seam=(first+last)*.5;
    near(pitchAt(a,seam),pitchAt(b,seam),2e-5);
    near(at(a,'amplitude',seam)**2+at(b,'amplitude',seam)**2,1,.0001);
    assert(at(a,'amplitude',last)<1e-6 && at(b,'amplitude',first)<1e-6);
  }
  const print=K.render(plan.value,{}, {sampleRate:rate,stems:true});
  for (const track of tracks) {
    const {time,gate}=events[track][0];
    assert(rms(print.stems[track],time,time+gate)>.001);
  }
  const a=events.metal[0], b=events.reed[0];
  assert(rms(print.stems.metal,a.time+a.gate+.01,Math.min(a.time+a.gate+.10,b.time+b.gate))<1e-7);
});

test('qualities can be routed or held independently, including a hard switch and a repeated placement',()=>{
  const input=E.analyze(recording(),{pitch:{lowHz:180,highHz:950}}), source=score(), config=settings();
  config.placements.push({id:'answer',section:'cue',beat:4,length:3,transpose:5});
  config.handoffs={overlap:[0,.13]};
  config.routes.decay={part:'air',carry:{pitch:0,roughness:1,envelope:1},pitchAnchor:'entry',roughnessTarget:'breath'};
  config.routes.body.carry={roughness:0,envelope:0};
  const plan=E.plan(input,source,config), {events}=K.inspect(plan.value);
  assert(events.air.every(note=>{
    const curves=note.play.curves;
    assert(curves.breath.some(([,val])=>val>.15));
    assert(curves.amplitude.at(-1)[1]<.45);
    assert.equal(curves.roughness,undefined);
    assert(!curves.pitchCents || curves.pitchCents.every(row=>row[1]===curves.pitchCents[0][1]));
    return true;
  }));
  assert.equal(events.air[1].midi-events.air[0].midi,5);
  const first=events.metal[0], next=events.reed[0];
  near(first.time+first.gate,next.time,1e-8);
  assert.equal(first.play.curves.amplitude.at(-1)[1],0);
  assert.equal(next.play.curves.amplitude[0][1],1);
  assert.equal(next.play.curves.roughness,undefined);
  const dry=structuredClone(config), rough=structuredClone(config);
  dry.routes.decay.carry.roughness=0;
  rough.routes.decay.roughnessTarget='roughness';
  const print=request=>K.render(E.plan(input,source,request).value,{}, {sampleRate:rate,stems:true}).stems.air.samples;
  const firstDry=print(dry), firstRough=print(rough);
  assert(firstRough.some((sample,i)=>Math.abs(sample-firstDry[i])>.003));
  assert.throws(()=>E.plan(input,source,{...config,handoffs:{overlap:[.5,.5]} }),/inside the gesture/);
});

test('evolve CLI saves replayable audio and an ordinary production with source addresses',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-evolve-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=(...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),...args],{cwd:dir,encoding:'utf8'});
  const save=(name,data)=>fs.writeFileSync(path.join(dir,name),data);
  save('gesture.wav',WAV.encode(recording(),{encoding:'float32'}));
  save('recipe.json',JSON.stringify({source:'gesture.wav',production:score(),options:{sampleRate:rate,end:2.9,stems:true},
    analysis:{pitch:{lowHz:180,highHz:950}},settings:settings()}));
  const result=JSON.parse(cli('music','timbre','evolve','recipe.json','--out','fitted'));
  assert(WAV.read(result.audio).samples.some(sample=>Math.abs(sample)>.03));
  assert(Object.hasOwn(result.stems,'metal') && WAV.read(result.stems.metal).channels===2);
  const data=JSON.parse(fs.readFileSync(result.plan,'utf8'));
  assert.equal(data.source.wav,'gesture.wav');
  assert.equal(data.report.placements[0].stages.length,3);
  cli('music','production','render',result.project,'--out','replayed');
  assert.deepEqual(fs.readFileSync(result.audio),fs.readFileSync(path.join(dir,'replayed','mix.wav')));
});
