/* Run: node examples/music-production/voice-leading-workshop.cjs output-directory */
const assert=require('node:assert/strict'), path=require('node:path');
const {KIT:K}=require('../..').load(), A=K.music.production;
const WAV=require('../../cli/wav'), {write,json}=require('../../cli/asset-files');
const folder=path.resolve(process.argv[2] ?? 'voice-leading-workshop'), at=file=>path.join(folder,file);
const files=Object.fromEntries(['snare-rim','snare-ghost','hat-closed','hat-closed-alt'].map(name=>
  [name,path.join(__dirname,'samples',name+'.wav')]));
const assets=Object.fromEntries(Object.entries(files).map(([name,file])=>[name,WAV.read(file)]));
const step=(length,notes)=>({length,events:notes.map(([beat,duration,velocity,degree=1])=>({beat,duration,velocity,degree}))});
const line=(length,notes)=>({length,events:notes.map(([beat,duration,velocity,midi,play])=>
  ({beat,duration,velocity,midi,...(play && {play})}))});
const chord=(root,quality,anchor)=>({root,quality,voicing:{inner:anchor}});
const chords={
  deep:chord('D3','minor7','F4'),silver:chord('Bb2','major7','F4'),silt:chord('G2','minor7','Bb4'),
  hinge:chord('A2','dominant7','G4')
};
const tempo=108, sampleRate=32000;
const production={seed:507,arrangement:{
  pins:['part:melody','part:bass'],
  score:{tempoMap:{tempo,swing:.54},key:{root:'D4',mode:'minor'},harmonies:chords,endFade:.17},
  parts:{
    melody:{role:'lead',material:'signal',pitch:'key'},bass:{role:'bass',material:'low'},
    inner:{role:'pad'},kick:{role:'percussion',material:'kick',voice:{instrument:'kick'}},
    rim:{role:'percussion',material:'rim',voice:{instrument:'snare'}},
    hat:{role:'percussion',material:'hat',voice:{instrument:'hat'}}
  },
  motifs:{
    signal:line(20,[
      [.13,.50,.82,77],[1.28,.39,.67,81],[2.57,.64,.84,79,{brightness:.57}],
      [4.53,.57,.80,77],[5.92,.36,.71,74],[7.19,.45,.71,69,{brightness:.48}],
      [8.16,.66,.75,70],[9.63,.43,.8,77],[10.68,.78,.74,74,{vibrato:9}],
      [12.06,.63,.82,76],[13.28,.34,.71,73],[14.44,.49,.71,69],
      [16.18,.51,.82,77],[17.30,.43,.69,76],[18.52,.79,.77,74,{brightness:.42}]
    ]),
    low:step(8,[[0,.87,.86],[1.67,.30,.67,5],[2.62,.60,.81],[4,.93,.83],
      [5.63,.22,.63,5],[6.59,.70,.79],[7.56,.22,.54,7]]),
    kick:step(4,[[0,.13,.91],[1.79,.12,.49],[2.61,.12,.72]]),
    rim:step(4,[[1,.09,.78],[2.7,.06,.29],[3.004,.10,.88]]),
    hat:step(4,[[.5,.08,.56],[.77,.05,.31],[1.52,.08,.54],[2.29,.06,.41],[2.55,.08,.53],[3.5,.1,.62]])
  },
  sections:['deep','silver','silt','hinge','deep'].map((harmony,i)=>({id:'bar-'+i,bars:1,harmony}))
},patches:{
  glass:{type:'keys',tine:.34,bite:.53,color:.68,drive:1.22,wear:.14,dust:.09,
    env:{attack:.003,decay:.24,sustain:.28,release:.21},
    echo:{delay:.286,feedback:.34,width:.6,damping:.55,send:.14}},
  low:{type:'analog',body:.33,color:.31,width:1.6,drive:1.31,
    env:{attack:.008,decay:.25,sustain:.58,release:.095}},
  air:{type:'fm',body:.23,ratio:1.997,index:1.28,indexDecay:.19,grain:.019,width:5,color:.41,drive:1.29,
    env:{attack:.027,decay:.29,sustain:.61,release:.095}},
  kick:{type:'drum',kind:'kick',tune:44,decay:.20,sweep:125,click:.13,color:.42},
  rim:{type:'sample',zones:[{samples:['snare-ghost'],velocity:[0,.42],gain:3},{samples:['snare-rim'],velocity:[.42,1],gain:3.5}]},
  hat:{type:'sample',zones:[{samples:['hat-closed','hat-closed-alt'],gain:7}]}
},tracks:{
  melody:{patch:'glass',gain:-12,pan:.21,highpass:115,send:.28},
  bass:{patch:'low',gain:-13,lowpass:840},
  inner:{patch:'air',gain:-15,pan:-.2,highpass:130,lowpass:4450,send:.43},
  kick:{patch:'kick',gain:-12,lowpass:4300},
  rim:{patch:'rim',gain:-6,highpass:190,send:.25,groove:{offset:.009}},
  hat:{patch:'hat',gain:-11,pan:.34,highpass:960,groove:{timing:[0,.008,-.01,.006],accents:[1,.82,.94,.9]}}
},room:{gain:-4,size:1.32,decay:.57,damping:.50}};
const settings={track:'inner',melody:'melody',bass:'bass',from:0,to:20,voices:[
  {id:'tenor',low:'G3',high:'D4',anchor:'C4',velocity:.63},
  {id:'alto',low:'D4',high:'C5',anchor:'G4',velocity:.67}
],pedals:[{voice:'tenor',from:0,to:6,midi:'C4'}],
preferences:{tension:.14,dissonance:.28,delay:.53,motion:.9}};
const found=A.voiceLead(production,settings,assets);
assert.deepEqual(found.variants.map(take=>take.id),['connected','suspensions','counterline']);
assert(found.variants[1].metrics.delayed.length>0 && found.variants[2].metrics.answerNotes>=5);
json(at('source.json'),{production,assets:files,options:{sampleRate}});
json(at('search-settings.json'),settings);
json(at('search.json'),found);
const before=A.inspect(production,assets).events;
let fixed;
for (const take of found.variants) {
  const revised=A.revise(production,take.revision,assets), inspected=A.inspect(revised,assets);
  const {value,stems}=A.render(revised,assets,{sampleRate,stems:true});
  assert.deepEqual(inspected.events.melody,before.melody);
  assert.deepEqual(inspected.events.bass,before.bass);
  assert(A.meters(value).peak<1);
  if (fixed) {
    assert.deepEqual(fixed.melody,stems.melody.samples);
    assert.deepEqual(fixed.bass,stems.bass.samples);
  } else fixed={melody:stems.melody.samples,bass:stems.bass.samples};
  write(at(take.id+'.wav'),WAV.encode(value,{encoding:'pcm24'}));
  write(at(take.id+'-inner.wav'),WAV.encode(stems.inner,{encoding:'pcm24'}));
  json(at(take.id+'.json'),{production:revised,assets:files,options:{sampleRate}});
  json(at(take.id+'-performance.json'),{events:inspected.events,metrics:take.metrics});
}
json(at('demo.json'),{sampleRate,tempo,chords:['Dm7','Bbmaj7','Gm7','A7','Dm7'],
  takes:found.variants.map(take=>({id:take.id,...take.metrics}))});
console.log(JSON.stringify(found.variants.map(({id,metrics})=>({id,metrics}))));
