/* Rehearse three recorded routes into the same observatory. */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'), {KIT:K}=require('../..').load();
const repo=path.resolve(__dirname,'../..'), out=path.resolve(process.argv[2] ?? 'signal-observatory');
const A=K.music.production, W=K.world.runtime;
const tempo=96, dt=.025, sampleRate=32000, end=9.1, beats=12;
const roles={reed:'lead',hull:'pad',bass:'bass',rim:'percussion',kick:'percussion'};
const patches={
  reed:{type:'fm',ratio:2,index:.68,env:{attack:.084,decay:.19,sustain:.69,release:.63},
    echo:{delay:.31,feedback:.43,damping:.64,wow:.11,flutter:.10,width:.64,send:.23}},
  hull:{type:'graph',tail:1.1,output:'amp',nodes:{
    root:{type:'oscillator',wave:'sine'},octave:{type:'oscillator',wave:'sine',ratio:2.003},
    chime:{type:'oscillator',wave:'sine',ratio:3.977},edge:{type:'gain',input:'octave',amount:.36},
    fragment:{type:'gain',input:'chime',amount:.20},sum:{type:'mix',inputs:['root','edge','fragment']},
    habitat:{type:'filter',input:'sum',mode:'lowpass',cutoff:990,resonance:.75},
    env:{type:'envelope',env:{attack:.19,decay:.38,sustain:.57,release:1.04}},
    amp:{type:'gain',input:'habitat',amount:{base:0,from:{env:.62}}}
  }},
  bass:{type:'subtractive',saw:.24,pulse:.25,sub:.50,filter:{cutoff:256,keyTrack:.34,envAmount:14},
    env:{attack:.025,decay:.23,sustain:.45,release:.20}},
  rim:{type:'drum',kind:'brush',decay:.145,tune:182,color:.55,click:.47},
  kick:{type:'drum',kind:'kick',decay:.17,tune:47,sweep:78,click:.12}
};
const voices={
  boardwalk:[[.21,.63,64,.57],[.93,2.53,67,.65],[3.72,1.57,69,.51]],
  service:[[.29,.45,67,.51],[.92,1.64,70,.60],[3.13,1.72,67,.62]],
  promenade:[[.52,.75,72,.57],[1.58,.66,76,.53],[2.72,1.91,74,.58]],
  observatory:[[1.04,.55,67,.59],[1.83,.57,70,.67],[2.59,1.05,72,.62]],
  arrival:[[.99,.48,72,.68],[1.60,.56,75,.69],[2.84,1.07,77,.72]],
  familiar:[[1.02,.42,67,.66],[1.63,.49,70,.73],[2.46,1.06,79,.76],[3.64,.63,77,.58]],
  skylight:[[1.10,.71,76,.70],[2.41,1.02,81,.67],[3.70,1.52,79,.63]],
  answer:[[.44,.37,75,.66],[1.14,.72,72,.57],[2.11,.79,79,.72],[3.17,.60,77,.65]]
};
const hulls={
  boardwalk:[[0,3.65,48,.53],[3.8,2.16,55,.42]],
  service:[[.4,3.50,46,.42],[3.94,1.65,53,.35]],
  promenade:[[.48,2.86,53,.44],[3.41,1.78,57,.43]],
  observatory:[[1.16,2.97,48,.49]],arrival:[[1.29,2.73,53,.53]],
  familiar:[[1.11,1.89,48,.57],[3.01,2.56,55,.53]],
  skylight:[[1.48,3.9,57,.58]],answer:[[.32,2.67,51,.43],[3.12,1.41,55,.47]]
};
const roots={boardwalk:36,service:34,promenade:41,observatory:36,arrival:41,familiar:36,skylight:41,answer:39};
function lining(name,part,notes) {
  return [{id:name+'-'+part,beat:0,length:beats,...(roles[part]==='percussion' && {mode:'layer'}),
    voices:[{id:'performer',notes:notes.map(([beat,duration,midi,velocity],i)=>({
      id:'note-'+i,beat,duration,midi,velocity,...(part==='reed' && {play:{vibrato:[5,16,24,12][i%4],
        curves:{pitchCents:[[0,[-46,21,-33][i%3]],[.23,7],[1,-12]],
          amplitude:[[0,.66],[.31,.92],[.73,1],[1,.79]]}}})
    }))}]}];
}
function cue(name) {
  const root=roots[name], transit=['boardwalk','service','promenade'].includes(name);
  const bass=transit ? [[.02,.61,root,.67],[1.58,.44,root+7,.51],[2.35,.83,root,.70],[3.74,.48,root+7,.45]] :
    [[.01,.80,root,.63],[1.49,.39,root+7,.54],[2.03,.46,root+12,.49],[2.82,.78,root,.72]];
  const rim=transit ? [[.94,.16,38,.49],[1.98,.12,38,.33],[3.05,.17,38,.68]] :
    [[.97,.14,38,.54],[1.72,.12,38,.34],[3.04,.17,38,.69],[3.71,.14,38,.37]];
  const hits=[[.013,.13,36,.67],[1.59,.14,36,.49],[2.36,.12,36,.64],[3.55,.13,36,.41]];
  const track=(part,gain,pan,send,notes)=>({patch:part,gain,pan,send,clips:lining(name,part,notes)});
  return {seed:7915,arrangement:{score:{tempoMap:{tempo,swing:.55},key:{root:'C3',mode:'minor'},endFade:.12,
    harmonies:{home:{root:'C3',quality:'minor'}}},motifs:{},
    parts:Object.fromEntries(Object.entries(roles).map(([part,role])=>[part,{role}])),
    sections:[{id:'music',bars:3,harmony:'home'}]},patches,
    tracks:{reed:track('reed',-7.9,-.11,.55,voices[name]),hull:track('hull',-17.1,.21,.68,hulls[name]),
      bass:track('bass',-14.7,.025,0,bass),rim:track('rim',-20.1,.32,0,rim),kick:track('kick',-18,0,0,hits)},
    room:{gain:-1.5,size:1.39,decay:1.49,damping:.42},gain:.5};
}
const sources=Object.fromEntries(Object.keys(voices).map(name=>[name,cue(name)]));
const names=['boardwalk','service','promenade','observatory'];
const route=[
  ['go-service','boardwalk','service','service','half-bar'],
  ['go-promenade','boardwalk','promenade','promenade','half-bar'],
  ['service-door','service','observatory','open','half-bar'],
  ['stairs-door','promenade','observatory','open','half-bar']
];
const score={tempo,entry:'boardwalk',sections:Object.fromEntries(names.map(name=>[name,{resource:name}])),
  parameters:{service:{default:0},promenade:{default:0},open:{default:0}},
  transitions:route.map(([id,from,to,channel,quantize])=>({id,from,to,quantize,
    when:{path:'/parameters/'+channel,op:'gte',value:.5}}))};
const timeline={entry:'boardwalk',end,
  segments:Object.fromEntries(names.map(name=>[name,{source:name,end:{beat:4},loop:name==='observatory'}])),
  transitions:route.map(([,from,to])=>({from,to,tail:.12,fadeIn:to==='observatory' ? .085 : .035})),
  performers:{tracks:['reed','hull'],endFade:.14},
  phrasing:{listen:{service:['reed'],observatory:['reed']},routes:{observatory:[
    {id:'familiar-call',source:'familiar',when:{via:['boardwalk','service'],rule:'service-door',heard:[{phrase:'service'}]}},
    {id:'skylight-call',source:'skylight',when:{via:['promenade']}},
    {id:'first-call',source:'arrival',when:{heard:[{phrase:'first-call',max:0}]}},
    {id:'answered-call',source:'answer',when:{heard:[{phrase:'first-call',min:1}]}}
  ]}}};
const paths=[
  {id:'waited',label:'Stayed for the tunnel phrase',approach:'service',open:2.91,expected:'familiar-call'},
  {id:'hurried',label:'Left the tunnel early',approach:'service',open:1.66,expected:'first-call'},
  {id:'stairs',label:'Came in by the promenade',approach:'promenade',open:2.91,expected:'skylight-call'}
];
const savedir=path.join(out,'project');
fs.mkdirSync(savedir,{recursive:true});
function save(file,data) {
  fs.writeFileSync(path.join(savedir,file),JSON.stringify(data,null,2)+'\n');
}
const command=(at,channel)=>({tick:Math.round(at/dt),action:'world/input',
  args:{port:'score/parameter.'+channel,value:1}});
function run(spec,id,intents) {
  const file=id+'.json';
  save(file,{sources,timeline:spec,intents,options:{sampleRate}});
  const argv=[path.join(repo,'cli/ink-studio.js'),'music','production','timeline',file,'--out',id];
  execFileSync(process.execPath,argv,{cwd:savedir,encoding:'utf8'});
  return JSON.parse(fs.readFileSync(path.join(savedir,id,'report.json')));
}
const evidence=paths.map(record=>{
  const {id,label,approach,open,expected}=record;
  const world={id:'signal-observatory-'+id,dt,systems:{score:{kind:'adaptive-music',config:score}},
    commands:[command(.67,approach),command(open,'open')]};
  const worldRun=W.create(world);
  worldRun.advance(Math.round(end/dt));
  const recording=worldRun.recording(), trace=A.rehearsal.capture(recording,{id,label,end});
  save(id+'-world.json',world);
  save(id+'.run.json',recording);
  save(id+'-trace.json',trace);
  const report=run(timeline,id,trace.intents);
  const [entrance]=report.phrasing.decisions;
  assert.equal(entrance.phrase,expected);
  assert(report.performers.joins[1].held.reed.voices>0);
  return {id,label,approach,entrance,report,intents:trace.intents};
});
const {performers,...isolated}=timeline;
const old=run(isolated,'isolated',evidence[0].intents);
assert.equal(old.phrasing.decisions[0].phrase,evidence[0].entrance.phrase);
assert.equal(evidence[1].report.phrasing.decisions[1].phrase,'answered-call');
save('evidence.json',{cases:evidence.map(({report,intents,...route})=>({...route,
  placements:report.placements,markers:report.markers,phrasing:report.phrasing,performers:report.performers})),
  isolated:{placements:old.placements,markers:old.markers}});
console.log(JSON.stringify({project:savedir,cases:evidence.map(row=>[row.id,row.entrance.time,row.entrance.phrase])},null,2));
