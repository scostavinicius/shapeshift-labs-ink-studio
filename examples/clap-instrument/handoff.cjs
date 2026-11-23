/* Usage: node examples/clap-instrument/handoff.cjs manifest.json output-directory */
const fs=require('node:fs'), path=require('node:path'), {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'), WAV=require('../../cli/wav.js');
const file=path.resolve(process.argv[2]), out=path.resolve(process.argv[3]);
const host=require('../../cli/clap-adapter.js').load(file), sampleRate=32000;
const rate=sampleRate, beats=24;
const {KIT}=require(repo).load(), A=KIT.music.production;
const saved=host.snapshot('glass',{kind:'instrument',sampleRate,parameters:{17:.56}});
const table={
  call:[[.28,.67,66,.61],[1.12,1.04,73,.69],[2.66,.48,70,.57],[3.36,.44,68,.51],
    [4.52,1.34,71,.64],[6.21,.61,75,.68],[7.19,.51,73,.53],[8.34,.57,70,.55],[9.06,1.29,78,.72],
    [10.80,.82,75,.59],[12.64,.58,73,.60],[13.40,1.39,75,.70],[15.36,.48,68,.53],
    [16.28,.71,66,.57],[17.22,.81,73,.75],[18.4,1.05,82,.76],[19.66,.31,78,.51],
    [20.53,.55,75,.58],[21.29,1.28,73,.63],[23.08,.78,66,.54]],
  answer:[[.77,.68,61,.44],[1.66,.67,66,.47],[2.92,.50,63,.49],[4.04,.80,66,.46],
    [5.38,.71,68,.47],[6.52,.58,66,.45],[8.03,1.12,63,.48],[9.75,.66,66,.47],[10.75,.77,70,.48],
    [12.14,.91,66,.50],[13.66,.79,61,.50],[15.34,.57,66,.45],[16.30,1.32,63,.55],[17.91,.72,70,.51],
    [18.92,.83,73,.55],[20.04,.76,70,.47],[21.35,1.15,61,.49],[22.89,.59,63,.43]],
  bass:[[0,1.02,39,.73],[1.6,.47,46,.48],[2.65,.82,39,.61],[4,.92,35,.67],[5.65,.65,42,.57],
    [6.95,.58,35,.62],[8,1.09,42,.74],[9.65,.42,49,.47],[10.62,.98,42,.62],[12,.79,37,.71],
    [13.62,.48,44,.46],[14.71,.68,37,.64],[16,.98,39,.77],[17.67,.64,46,.51],[18.70,.78,39,.66],
    [20,1.04,35,.68],[21.72,.44,42,.53],[22.52,.83,39,.58]]
};
const kick=[0,1.62,2.62,4,6.33,7.17,8,9.62,10.75,12,13.64,14.71,16,17.64,18.67,20,21.72,22.53]
  .map((beat,i)=>[beat+.014,.13,36,[.82,.62,.73,.64][i%4]]);
const brush=[1.08,3.04,5.08,7.08,9.02,11.08,13.1,15.05,17.02,19.13,21,23.09]
  .map((beat,i)=>[beat,.17,38,[.61,.73,.67][i%3]]);
const dust=Array.from({length:46},(_,i)=>[.67+i*.5+(i%3)*.016,.112,60,[.48,.34,.39,.27,.46][i%5]]);
const phrasing=(layer,index)=>({vibrato:layer==='call' && index%3===1 ? 29 : 8,curves:{
  pressure:[[0,.23],[.24,.73-(index%3)*.08],[.57,.89-(index%4)*.078],[1,.44]],
  brightness:[[0,.27],[.58,.72+(index%3)*.08],[1,.38]],
  pitchCents:[[0,layer==='call' ? [-150,44,-76,-193][index%4] : [21,-47,-63][index%3]],
    [.25,layer==='call' ? 16 : -13],[.64,-8],[1,layer==='call' ? -42 : -9]],
  amplitude:[[0,.72],[.29,1],[1,.82]]
}});
const voice=(id,rows,expressive=false)=>({id,notes:rows.map(([beat,duration,midi,velocity],i)=>({
  id:'note-'+i,beat,duration,midi,velocity,...(expressive && {play:phrasing(id,i)})
}))});
const clip=(id,role,...voices)=>[{id,beat:0,length:beats,voices,...(role==='percussion' && {mode:'layer'})}];
const track=(patch,gain,pan,send,clips)=>({patch,gain,pan,send,clips});
const roles={reed:'lead',bass:'bass',kick:'percussion',brush:'percussion',dust:'percussion'};
const production={seed:841,
  arrangement:{
    score:{key:{root:'D#3',mode:'minor'},tempoMap:{tempo:103,swing:.56,changes:[{beat:12,tempo:109,swing:.54}]},
      harmonies:{home:{root:'D#3',quality:'minor'},bridge:{root:'B3',quality:'major'}},endFade:.21},
    motifs:{},parts:Object.fromEntries(Object.entries(roles).map(([name,role])=>[name,{role}])),
    sections:[{id:'shore',bars:2,harmony:'home'},{id:'lights',bars:2,harmony:'bridge'},{id:'home',bars:2,harmony:'home'}]},
  patches:{
    reed:{type:'clap',...saved,parameters:{17:{unit:'beats',curve:'linear',points:[
      {at:0,value:.42},{at:8,value:.65},{at:16,value:.75},{at:23,value:.49}]}}},
    low:{type:'subtractive',saw:.19,pulse:.38,sub:.38,filter:{cutoff:272,keyTrack:.37,envAmount:13},
      env:{attack:.014,decay:.22,sustain:.48,release:.20}},
    kick:{type:'drum',kind:'kick',decay:.20,tune:49,sweep:93,click:.16},
    brush:{type:'drum',kind:'brush',decay:.17,tune:188,color:.68,click:.55},
    dust:{type:'drum',kind:'hat',decay:.059,tune:797,color:.54,click:.37}
  },
  tracks:{
    reed:track('reed',-6.2,-.06,.17,clip('lantern','lead',voice('call',table.call,true),voice('answer',table.answer,true))),
    bass:track('low',-10.7,.01,.015,clip('pilings','bass',voice('bass',table.bass))),
    kick:track('kick',-12.1,0,.015,clip('kick','percussion',voice('kick',kick))),
    brush:track('brush',-17.4,-.18,.17,clip('brush','percussion',voice('brush',brush))),
    dust:track('dust',-22.5,.28,.10,clip('dust','percussion',voice('dust',dust)))
  },
  room:{gain:-7.5,size:1.32,decay:1.38,damping:.53}
};
const clipAlt=structuredClone(production.tracks.reed.clips);
for (const [i,midi] of [[14,68],[15,75],[16,80],[17,77]]) clipAlt[0].voices[0].notes[i].midi=midi;
const session={format:'ink-studio/music-edit-session',version:1,id:'harbor-glass',sampleRate,production,
  takes:{rise:{tracks:{reed:{clips:clipAlt}}}},
  comp:[{lane:'reed',take:'rise',from:{beat:16},to:{beat:20},fadeSamples:512}],
  mixer:{output:'master',strips:{
    reed:{output:'instrument-bus',sends:{return:{tap:'pre',level:.28}}},
    bass:{output:'instrument-bus'},kick:{output:'drum-bus'},brush:{output:'drum-bus'},dust:{output:'drum-bus'},
    'instrument-bus':{fader:.95},'drum-bus':{fader:.92},'score-room':{},return:{inserts:['trail'],fader:.67},master:{}
  },processors:{trail:{type:'tempo-delay',beats:.75,feedback:.24,highHz:2200,wet:1}},
  taps:{rear:{strip:'return'},front:{strip:'instrument-bus'}}},
  automation:{
    lead:{target:{strip:'reed',parameter:'fader'},unit:'beats',points:[
      {id:'open',at:0,value:.83},{id:'bloom',at:8,value:1.04},{id:'last-light',at:16,value:1.14},{id:'leave',at:22,value:.81}]},
    travel:{target:{strip:'reed',parameter:'pan'},unit:'beats',points:[
      {id:'left',at:0,value:-.17},{id:'turn',at:12,value:.13},{id:'center',at:22,value:0}]},
    wake:{target:{strip:'reed',send:'return',parameter:'level'},unit:'beats',points:[
      {id:'glass',at:0,value:.14},{id:'long',at:12,value:.35},{id:'catch',at:16,value:.54},{id:'end',at:23,value:.22}]}
  }};
fs.mkdirSync(out,{recursive:true});
const save=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
save('session.json',{session});
const packed=JSON.parse(execFileSync(process.execPath,[path.join(repo,'cli/ink-studio.js'),'music','session','handoff',
  path.join(out,'session.json'),'--clap-host',file,'--out',path.join(out,'handoff')],{encoding:'utf8'}));
const plain=structuredClone(production);
for (const {notes} of plain.tracks.reed.clips[0].voices) for (const note of notes) delete note.play;
for (const [name,source] of [['flat',plain],['expressed',production]]) {
  const pass=A.render(source,{}, {sampleRate,stems:true,end:60*6/103,tail:.18},host);
  fs.writeFileSync(path.join(out,name+'.wav'),WAV.encode(pass.stems.reed,{encoding:'float32'}));
}
console.log(JSON.stringify(packed));
