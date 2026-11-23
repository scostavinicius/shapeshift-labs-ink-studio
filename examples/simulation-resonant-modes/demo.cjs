const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const kit=require('../..').load(), PNG=require('../../cli/png.js'), WAV=require('../../cli/wav.js');
const {KIT:K}=kit, R=K.world.resonantModes, cli=require('../../cli/modal-resonator.js');
const out=path.resolve(process.argv[2]??'studio/out/resonant-modes');
fs.mkdirSync(out,{recursive:true});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),value);
const json=(name,value)=>write(name,JSON.stringify(value,null,2)+'\n');
const point=(x,y=0,z=0)=>({point:[x,y,z]});
function bake(id,source,excitations,pickups){
  const plan={format:R.planFormat,version:1,id,revision:1,source,excitations,pickups};
  json(id+'.bake.json',plan);
  const asset=cli.bake(kit,plan,path.join(out,id+'.bake.json'));
  json(id+'.modes.json',asset);
  return asset;
}
const string=bake('pinned-string',{kind:'string',length:1,speed:420,count:10,density:.012,decay:5.5,decayPerHz:.003},
  {strike:point(.21)},{center:point(.5),offCenter:point(.31)});
const bound=R.bind(string);
assert.ok(Math.abs(bound.pickups.center.gains[1])<1e-12&&Math.abs(bound.pickups.offCenter.gains[1])>.1);
const size=[1,.64], speed=300, density=.22, decay=8, decayPerHz=.012;
const sites={strike:point(.25,.43)}, receivers={plate:point(.62,.39)};
function rectangle(nx,ny){
  const positions=[],indices=[];
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++)positions.push(i*size[0]/nx,j*size[1]/ny,0);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
    indices.push(a,b,d,a,d,c);
  }
  return {positions,indices};
}
const exact=bake('analytic-rectangle',{kind:'rectangle',size,speed,density,count:5,decay,decayPerHz},sites,receivers);
const coarse=bake('plate-coarse',{kind:'mesh',mesh:rectangle(9,7),speed,density,count:5,decay,decayPerHz},sites,receivers);
const fine=bake('plate-refined',{kind:'mesh',mesh:rectangle(18,12),speed,density,count:10,decay,decayPerHz},sites,receivers);
const evidence=exact.modes.map((row,i)=>({
  order:row.order,analytic:row.hz,coarse:coarse.modes[i].hz,refined:fine.modes[i].hz,
  coarseError:Math.abs(coarse.modes[i].hz/row.hz-1),refinedError:Math.abs(fine.modes[i].hz/row.hz-1)
}));
assert.ok(evidence.every(row=>row.refinedError<row.coarseError));
const authored=bake('authored-bell',{kind:'authored',modes:[
  {id:'body',hz:172,decay:5},{id:'rim',hz:428,decay:9},{id:'blend',hz:691,decay:15},{id:'spark',hz:1115,decay:22}
]},{
  strike:{point:[.12,.08,.15],gains:[.52,1.40,.92,.17]},
  rim:{point:[.24,.08,.03],gains:[.24,.47,1.31,.9]}
},{
  nearby:{point:[.18,.07,.22],gains:[.68,1.21,.37,.91]}
});

const sampleRate=24000, samples=19200;
const strikes=[.04117,.26629,.49314].map((time,i)=>{
  const at=time*sampleRate;
  return {excitation:'strike',sample:Math.floor(at),fraction:at%1,value:[.017,.012,.009][i]};
});
function render(asset){
  const id=asset.id, file=path.join(out,id+'.run.json');
  const plan={format:R.runFormat,version:1,asset:id+'.modes.json',settings:{sampleRate},samples,impulses:strikes};
  return {id,plan,trace:cli.run(kit,plan,file)};
}
const takes=[render(string),render(fine),render(authored)];
const peak=values=>values.reduce((a,b)=>Math.max(a,Math.abs(b)),0);
const channels=[], gains={};
for(const {id,plan,trace} of takes){
  const keys=Object.keys(trace.pickups);
  const commonGain=.78/Math.max(...keys.map(name=>peak(trace.pickups[name])));
  gains[id]=commonGain;
  plan.audio={pickup:keys[0],gain:commonGain};
  json(id+'.run.json',plan);
  json(id+'.trace.json',trace);
  for(const pickup of keys){
    const label=id+'-'+pickup;
    cli.writeWav(path.join(out,label+'.wav'),trace,{pickup,gain:commonGain});
    channels.push({label,samples:Float64Array.from(trace.pickups[pickup],value=>value*commonGain)});
  }
}
const stride=Math.round(.96*sampleRate), reel=new Float64Array(stride*channels.length);
for(const [i,track] of channels.entries())reel.set(track.samples,i*stride);
write('resonator-auditions.wav',WAV.encode({sampleRate,channels:1,samples:reel}));
json('comparison.json',{
  mesh:{rows:evidence,maxCoarseError:Math.max(...evidence.map(row=>row.coarseError)),
    maxRefinedError:Math.max(...evidence.map(row=>row.refinedError)),verification:fine.evidence},
  string:{mode2Hz:string.modes[1].hz,gains:{center:bound.pickups.center.gains[1],offCenter:bound.pickups.offCenter.gains[1]}},
  auditions:{order:channels.map(row=>row.label),sectionSeconds:.96,gains}
});

const bg='#12222e', panel='#1c3140', well='#152935', grid='#395564', paper='#edf2dd', dim='#a7c1cc',
  mint='#8fe6b9', amber='#ffbf83', blue='#8fbcf2', lilac='#c6adf7';
const palette=['#ffc28c','#e28e72','#ad6969','#684c61','#344656','#47737d','#5e9b9c','#78c4af','#adeeca'];
function drawing(){
  const commands=[];
  return {commands,rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    text:(text,x,y,scale=2,color=paper)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    polygon:(points,fill)=>commands.push({type:'polygon',points,fill})};
}
const pack=(d,width,height)=>PNG.packRGBA(K.procedural.drawing2d.render({width,height,commands:d.commands,edges:'hard'}));
const hz=(value,digits=1)=>value.toFixed(digits);
function stringDiagram(d,x,y,w,h){
  d.rect(x,y,w,h,well);
  const base=y+h*.52, place=t=>x+21+(w-42)*t;
  d.line([[place(0),base],[place(1),base]],grid,2);
  d.line(Array.from({length:151},(_,i)=>[place(i/150),base-39*Math.sin(2*Math.PI*i/150)]),mint,2);
  for(const [pos,label,color,dy] of [[.21,'STRIKE',amber,-54],[.5,'CENTER',blue,28],[.31,'OFF CENTER',lilac,49]]){
    const u=place(pos);
    d.line([[u,base-7],[u,base+7]],color,2);
    d.text(label,u-17,base+dy,1,color);
  }
}
function modePlot(d,index,x,y,w,h,phase=1){
  d.rect(x,y,w,h,well);
  const mode=fine.modes[index], max=peak(mode.shape), {vertices,elements}=fine.geometry;
  for(const poly of elements){
    const shape=poly.reduce((sum,id)=>sum+mode.shape[id]/3,0)/max*phase;
    const color=palette[Math.round(4+4*Math.max(-1,Math.min(1,shape)))];
    d.polygon(poly.map(id=>[x+vertices[id][0]*w,y+(1-vertices[id][1]/size[1])*h]),color);
  }
}

function board(){
  const d=drawing(),width=1256,height=807;
  d.rect(0,0,width,height,bg);d.rect(40,36,28,4,mint);
  d.text('INK STUDIO / PHYSICAL SIMULATION',81,31,2,mint);
  d.text('Move the pickup. Change the tone.',39,65,5,paper);
  d.text('AUTHORED AND ANALYTIC MODES / VERIFIED TRIANGULAR MEMBRANE',43,130,2,dim);
  d.rect(42,170,540,398,panel);d.rect(600,170,614,398,panel);
  d.text('PINNED STRING / MODE 2',61,192,2,mint);
  d.text('ONE OFF-CENTER STRIKE / TWO PICKUP POSITIONS',62,229,1,dim);
  stringDiagram(d,61,255,502,182);
  d.text('420 HZ AT CENTER',62,462,1,blue);
  d.text('NODAL GAIN '+Math.abs(bound.pickups.center.gains[1]).toExponential(1).toUpperCase(),62,489,1,dim);
  d.text('420 HZ OFF CENTER',314,462,1,lilac);
  d.text('GAIN '+hz(bound.pickups.offCenter.gains[1],3),314,489,1,dim);
  d.text('SAME STRIKE AND LISTENING GAIN',62,534,1,mint);

  d.text('TRIANGLE MESH / PINNED EDGES',619,192,2,mint);
  d.text('MASS-NORMALIZED MODE SHAPES',620,229,1,dim);
  for(const i of [0,1,2]){
    const x=620+i*193;
    modePlot(d,i,x,259,178,119);
    d.text('MODE '+(i+1),x,394,1,blue);
    d.text(hz(fine.modes[i].hz)+' HZ',x,420,2,paper);
  }
  d.text('EIGENPAIR RESIDUAL '+fine.evidence.maxRelativeResidual.toExponential(2).toUpperCase(),
    620,495,1,mint);
  d.text(fine.evidence.dofs+' FREE VERTICES / '+fine.geometry.elements.length+' TRIANGLES',620,532,1,dim);
  d.rect(42,588,1172,164,panel);
  d.text('FIRST FIVE FREQUENCIES / ERROR AGAINST THE ANALYTIC MEMBRANE',62,607,2,paper);
  for(const [i,row] of evidence.entries()){
    const x=62+i*224, percent=n=>(100*n).toFixed(2)+'%';
    d.text('MODE '+(i+1)+'  '+hz(row.analytic)+' HZ',x,650,1,blue);
    d.text('COARSE '+percent(row.coarseError),x,679,1,amber);
    d.text('REFINED '+percent(row.refinedError),x,706,1,mint);
  }
  d.text('AUDITIONS   STRING CENTER / STRING OFF CENTER / MESH MEMBRANE / AUTHORED BELL',43,777,1,dim);
  return pack(d,width,height);
}
write('resonant-mode-comparison.png',PNG.encodeFrame(board()));

const frames=Array.from({length:32},(_,i)=>{
  const d=drawing(),width=594,height=324,phase=Math.sin(2*Math.PI*i/32);
  d.rect(0,0,width,height,bg);
  d.text('TWO MODES OF THE SAME MEMBRANE',23,22,2,paper);
  d.text('SIGNED DISPLACEMENT / NORMALIZED PHASE',24,55,1,dim);
  for(const [j,index] of [0,2].entries()){
    const x=24+j*278;
    modePlot(d,index,x,91,252,160,phase);
    d.text('MODE '+(index+1)+'  '+hz(fine.modes[index].hz)+' HZ',x,273,1,j?amber:mint);
  }
  return pack(d,width,height);
});
write('membrane-modes.apng',PNG.encodeAnimation(frames,12));
