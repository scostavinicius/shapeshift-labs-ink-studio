/* Run: node examples/music-production/captured-strike.cjs library-directory output-directory */
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const {json,write} = require('../../cli/asset-files.js');
const WAV = require('../../cli/wav.js');

const [libraryDirectory,output] = process.argv.slice(2);
if (!libraryDirectory || !output) throw new TypeError('Pass a sample library and an output directory');
const kit = ink.load(), {KIT:K} = kit;
const library = ink.openSampleLibrary(libraryDirectory,{kit});
const {items} = library.search({material:'metal',articulation:'struck',pitch:'A4',cents:25,
  sourceKind:'bus',license:'CC0-1.0',limit:1});
if (!items.length) throw new Error('Save the Sample Capture demo’s test instrument to the library first');
const {file,entry,value:recording} = library.load(items[0].id);
const peak = K.music.production.meters(recording).peak;
if (peak < .06) throw new RangeError('The captured take needs a clear strike');
const first = recording.samples.findIndex(sample=>Math.abs(sample)>peak*.09);
const onset = Math.max(0,Math.floor(first/recording.channels)-4)/recording.sampleRate;
const source = {strike:recording};
const riff = (length,notes,offset=0) => ({length,events:notes.map(([beat,duration,midi,velocity])=>
  ({beat,duration,midi,velocity,play:{offset:onset+offset}}))});
const tuned = {type:'sample',zones:[{samples:['strike'],root:69,oneShot:false}],
  env:{attack:.005,decay:.3,sustain:.78,release:.14}};
const production = {seed:10,gain:12,arrangement:{
  score:{key:{root:'A3',mode:'minor'},tempoMap:{tempo:112,swing:.54},endFade:.35,harmonies:{
    home:{root:'A3',quality:'minor',notes:[45,60,64]},shift:{root:'F3',quality:'major',notes:[41,60,65]}
  }},
  motifs:{
    ticks:riff(4,[[0,.065,36,.9],[.75,.041,36,.42],[1.5,.058,36,.68],[2.75,.065,36,.8],[3.5,.035,36,.45]]),
    melody:riff(8,[[.25,.63,69,.72],[1.25,.43,72,.57],[2,.8,76,.75],[3.25,.48,74,.48],
      [4.25,.58,69,.8],[5.5,.48,67,.65],[6.25,1.2,64,.78]]),
    floor:riff(4,[[0,1.12,45,.82],[1.75,.58,45,.56],[2.75,.83,52,.58]],.027),
    turn:riff(4,[[0,1.05,41,.78],[1.75,.62,48,.63],[3,.76,43,.59]],.024)
  },
  parts:{pulse:{role:'percussion',material:'ticks'},high:{role:'lead'},low:{role:'bass',material:'floor'}},
  sections:[{id:'beat',bars:1,harmony:'home'},{id:'answer',bars:1,harmony:'shift',parts:{low:'turn'}},
    {id:'pitched',bars:2,harmony:'home',parts:{high:'melody',low:'floor'}}]
},patches:{
  tick:{...tuned,zones:[{samples:['strike'],oneShot:false}],env:{attack:.002,decay:.03,sustain:.55,release:.022}},
  tone:{...tuned,echo:{delay:.4018,feedback:.36,damping:.7,send:.26,width:.7,wow:.15}},
  bass:{...tuned,env:{attack:.016,decay:.23,sustain:.75,release:.28}}
},tracks:{
  pulse:{patch:'tick',gain:-5.5,pan:.16,highpass:320},
  high:{patch:'tone',gain:-8,pan:-.2,highpass:240,send:.43},
  low:{patch:'bass',gain:-4,lowpass:340,highpass:40,send:.08}
},room:{gain:-13,size:1.25,decay:.67}};
const {value,report} = K.music.production.render(production,source,{sampleRate:32000});
const folder = path.resolve(output);
const sampleReport = {entry,onset,sourcePeak:peak,render:report};
write(path.join(folder,'captured-strike.wav'),WAV.encode(value,{encoding:'pcm24'}));
json(path.join(folder,'captured-strike-report.json'),sampleReport);
json(path.join(folder,'captured-strike-production.json'),{production,assets:{strike:path.relative(folder,file)}});
console.log(JSON.stringify(sampleReport));
