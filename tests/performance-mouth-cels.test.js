const assert=require('node:assert/strict'), {test}=require('node:test');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('..'), kit=ink.load(), {mouthCels:M}=kit.KIT.world;
const PNG=require('../cli/png.js'), WAV=require('../cli/wav.js');

const rate=8000, poses=['rest','seal','teeth','open','spread','open-accent'];
function plan(){
  return {format:M.planFormat,version:1,id:'radio',fps:24,
    rig:{grid:[8,6],origin:[3,2],size:[3,2],rest:'rest',poses,accents:{open:'open-accent'}},
    utterances:[{id:'line',speech:{kind:'ipa',text:'ˈpɑf'}}]};
}
function read(delay=0){
  const samples=new Float64Array(rate), first=640+delay, vowel=first+400, end=vowel+1880;
  let seed=7;
  const noise=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2147483648-1);
  for(let i=first;i<first+64;i++)samples[i]=.11*noise();
  for(let i=vowel;i<end;i++)samples[i]=.38*Math.sin(2*Math.PI*187*(i-vowel)/rate);
  for(let i=end;i<end+580;i++)samples[i]=.16*noise();
  return {samples,sampleRate:rate,channels:1};
}
function raster(width,height,color){
  return {width,height,channels:4,data:Array.from({length:width*height},()=>color).flat()};
}
test('recorded timing moves the holds while the phonetic labels and accent remain editable',()=>{
  const sheet=M.build(plan(),read()), later=M.build(plan(),read(1600));
  assert.deepEqual(sheet.phones.map(row=>row.symbol),['p','ɑ','f']);
  assert.deepEqual(sheet.phones.map(row=>row.pose),['seal','open-accent','teeth']);
  assert.equal(sheet.phones[1].stress,'primary');
  assert.equal(sheet.phones[1].emphasis,true);
  assert(sheet.phones[1].rmsDbFS>sheet.phones[2].rmsDbFS);
  assert.equal(later.phones[0].fromSample-sheet.phones[0].fromSample,1600);
  assert.equal(later.phones[2].toSample-sheet.phones[2].toSample,1600);
  assert(later.holds.find(row=>row.pose==='open-accent').from>sheet.holds.find(row=>row.pose==='open-accent').from);
  assert(sheet.holds.some(row=>row.pose==='seal'));
  assert(sheet.holds.some(row=>row.pose==='teeth'));
  assert.equal(sheet.holds[0].pose,'rest');
  assert.equal(sheet.holds.at(-1).pose,'rest');
  assert(sheet.holds.every(row=>Number.isInteger(row.from) && Number.isInteger(row.to)));
  const silent=M.build(plan(),{samples:new Float64Array(rate),sampleRate:rate,channels:1});
  assert.equal(silent.holds.length,1);
  assert.equal(silent.holds[0].pose,'rest');
  assert.deepEqual(silent.warnings,[{code:'no-voice',utterance:'line'}]);
});

test('edited and approved frames play at exact take time and affect only the anchored patch',()=>{
  const source=M.build({...plan(),fps:{numerator:24000,denominator:1001}},read());
  assert.throws(()=>M.open(source,{approvedOnly:true}),/needs animator approval/);
  const sheet=JSON.parse(JSON.stringify(source));
  for(const row of sheet.holds)row.approval='approved';
  const row=sheet.holds.find(row=>row.pose==='open-accent');
  row.pose='spread';
  const Mout=M.open(sheet,{approvedOnly:true});
  assert.equal(Mout.frame(row.from).pose,'spread');
  assert.notEqual(Mout.frame(row.from-1).pose,'spread');
  assert.equal(Mout.frame(-1).pose,'rest');
  const face=raster(8,6,[22,45,64,255]), cel=raster(3,2,[245,80,54,255]);
  const graph=ink.createGraphProject({format:'ink-studio/graph-project',version:1,nodes:{
    mouth:{op:'raster.mouthCels',inputs:{sheet,face,cels:{spread:cel,rest:cel},approvedOnly:true}}
  },outputs:{value:{node:'mouth'},hold:{node:'mouth',port:'hold'}}},{kit});
  const take=kit.KIT.timeDomains.take({fps:sheet.fps}).at(row.from);
  const {outputs}=graph.run({take});
  assert.equal(outputs.hold.pose,'spread');
  assert.equal(outputs.hold.approval,'approved');
  const {width,height,data}=outputs.value;
  assert.deepEqual([width,height],[8,6]);
  assert.deepEqual(Array.from(data.subarray((2*width+3)*4,(2*width+3)*4+4)),[245,80,54,255]);
  assert.deepEqual(Array.from(data.subarray(0,4)),[22,45,64,255]);
  assert.throws(()=>Mout.draw(face,raster(2,2,[1,2,3,255])),/native pixel dimensions/);
  graph.clear();
});

test('take mouth-cels exports a portable review alongside the editable sheet',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-mouth-cels-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const file=name=>path.join(dir,name), recipe=plan(), art={face:'face.png',
    cels:Object.fromEntries(poses.map(key=>[key,key+'.png']))};
  const image=(name,{width,height,data})=>fs.writeFileSync(file(name),PNG.encode(width,height,Uint8Array.from(data),4));
  image('face.png',raster(8,6,[61,88,90,255]));
  for(const name of Object.values(art.cels))image(name,raster(3,2,[220,70,45,255]));
  fs.writeFileSync(file('line.wav'),WAV.encode(read()));
  fs.writeFileSync(file('work.json'),JSON.stringify({...recipe,audio:'line.wav',art}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=JSON.parse(execFileSync(process.execPath,[cli,'take','mouth-cels',file('work.json'),'--out',file('out')],{encoding:'utf8'}));
  const sheet=JSON.parse(fs.readFileSync(run.sheet,'utf8'));
  assert.ok(M.open(sheet));
  const html=fs.readFileSync(run.review,'utf8');
  assert.match(html,/Download edited holds/);
  assert.match(html,/data:image\/png;base64/);
  assert.match(html,/open-accent/);
  assert.match(html,/UklGR/);
});
