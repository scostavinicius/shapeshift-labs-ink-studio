/* Build the portable instrument and a sample-locked microphone audition. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib'),WAV=require('../../cli/wav.js'),{json,write}=require('../../cli/asset-files.js');
const P=require('../..').load().KIT.procedural,sessionTool=P.mediaGraph.instrumentSession;
const {capture}=require('./fixture.cjs');
const dir=process.argv[2];
if (!dir) throw Error('Use node examples/multisample-session/demo.cjs <output-directory>');
const {session,assets:raw,tracks,slate}=capture(),sampleRate=session.sampleRate,names=Object.keys(tracks);
const rawFiles=Object.fromEntries(names.map(name=>[name,'raw/'+name+'.wav']));
const assets=Object.fromEntries(names.map(name=>{
  const data=WAV.encode(raw[name],{encoding:'float32'});
  write(path.join(dir,rawFiles[name]),data);
  return [name,WAV.decode(data)];
}));
const alignment={retainDelaySamples:{middle:tracks.middle.arrival,room:tracks.room.arrival}};
const settings={perspectives:names,alignment};
const built=sessionTool.build(session,assets,settings);
const before=sessionTool.build(session,assets,{perspectives:names});
const slateResult=sessionTool.align(session,assets,{syncSamples:[slate]});
for (const name of names.slice(1)) {
  assert.equal(built.session.perspectives[name].offsetSamples,tracks[name].offset);
  assert.deepEqual(built.session.perspectives[name],slateResult.value.perspectives[name]);
}
json(path.join(dir,'raw-session.json'),{session,assets:rawFiles});
json(path.join(dir,'calibration-by-slates.json'),{syncSamples:[slate]});
json(path.join(dir,'blend-settings.json'),settings);
json(path.join(dir,'aligned-session.json'),{session:built.session,assets:rawFiles});
json(path.join(dir,'report.json'),built.report);
const files=Object.fromEntries(Object.entries(built.assets).map(([name,pcm])=>{
  const file='instrument/samples/'+name+'.wav';
  write(path.join(dir,file),WAV.encode(pcm,{encoding:'float32'}));
  return [name,file];
}));
json(path.join(dir,'instrument/instrument.json'),{instrument:built.value,assets:Object.fromEntries(
  Object.entries(files).map(([id,file])=>[id,file.slice('instrument/'.length)]))});

const phrase=[
  [.18,60,.36],[1,67,.74],[1.66,65,.87],[2.56,72,.41],[3.10,67,.83],[3.78,65,.66],
  [4.56,60,.86],[5.08,64,.34],[5.68,72,.82],[6.52,74,.79],[7.18,72,.50]
];
function score(patch,position) {
  return {seed:1005,arrangement:{score:{tempoMap:{tempo:132},endFade:0,key:{root:'C4'},
    harmonies:{base:{root:'C4',quality:'unison'}}},parts:{lead:{role:'lead'}},motifs:{},
    sections:[{id:'phrase',bars:3,harmony:'base'}]},patches:{glass:patch},tracks:{lead:{patch:'glass',gain:-6,
      clips:[{id:'notes',beat:0,length:8,voices:[{id:'play',notes:phrase.map(([beat,midi,velocity],i)=>({
        id:'hit-'+(i+1),beat,duration:.42,midi,velocity,
        play:{room:position ?? i/(phrase.length-1),articulation:'glass'}
      }))}]}]}}};
}
const options={sampleRate};
const render=(bank,position)=>P.musicProduction.render(score(bank.value.patch,position),bank.assets,options).value;
const production=score(built.value.patch);
json(path.join(dir,'production.json'),{production,assets:files,options});
const sweep=render(built);
write(path.join(dir,'perspective-sweep.wav'),WAV.encode(sweep,{encoding:'pcm24'}));
function pack({samples}) {
  const pcm=Int16Array.from(samples,sample=>Math.round(Math.max(-1,Math.min(1,sample))*32767));
  return gzipSync(Buffer.from(pcm.buffer)).toString('base64');
}
function trace(project) {
  const anchor=session.takes[0].fromSample+Math.round(sampleRate*.06), points=400;
  return names.map(name=>{
    const {samples,channels}=assets[name],{offsetSamples=0,polarity=1}=project.perspectives[name];
    return Array.from({length:points},(_,i)=>{
      const at=anchor+Math.round((-.015+i/(points-1)*.067)*sampleRate);
      return Math.round(10000*samples[(at+offsetSamples)*channels]*polarity)/10000;
    });
  });
}
const data={sampleRate,names,duration:sweep.samples.length/2/sampleRate,
  settings:names.map(name=>{
    const row=built.report.alignment.perspectives[name];
    return {offset:row.offsetSamples,polarity:row.polarity,arrival:tracks[name].arrival};
  }),
  modes:Object.fromEntries([['raw',before,session],['aligned',built,built.session]].map(([id,bank,manifest])=>[id,{
    trace:trace(manifest),audio:[0,.5,1].map(pos=>pack(render(bank,pos)))
  }]))};
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const html=read('review.html').replace('/*INK_MIC_DATA*/',()=>JSON.stringify(data))
  .replace('/*INK_MIC_SCRIPT*/',()=>read('review.js'));
write(path.join(dir,'index.html'),html);
console.log(JSON.stringify({sampleRate,offsets:data.settings,voices:Object.keys(built.value.patch.instruments).length,
  bakedAssets:built.report.assetCount,duration:data.duration}));
