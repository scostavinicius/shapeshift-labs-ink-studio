/* Shared-scale plots for the review's exact sample and event windows. */
const PNG=require('./png.js');

const width=944,height=438,x=68,w=836,h=95;
const dark='#101f2c',panel='#182e3c',grid='#365163',text='#ecf3e6',dim='#a8c6cd',
  mint='#8ce4c5',blue='#94cef5',rose='#ffac91';
const sides=['reference','candidate'],colors=[mint,blue],y=[125,248];
const number=(n,d=3)=>Math.abs(n)>=1e5||n!==0&&Math.abs(n)<10**-d?n.toExponential(2):n.toFixed(d);

function canvas(kit,title,subtitle){
  const commands=[];
  const d={rect:(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill}),
    line:(points,stroke,width=1)=>commands.push({type:'path',points,stroke,width}),
    label:(text,x,y,scale=2,color=dim)=>commands.push({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color}),
    png:()=>PNG.encodeFrame(PNG.packRGBA(kit.KIT.procedural.drawing2d.render({width,height,commands,edges:'hard'})))};
  d.rect(0,0,width,height,dark);d.rect(35,27,23,4,mint);
  d.label('INK STUDIO / MATCHED SIMULATION REVIEW',71,22,2,mint);
  d.label(title.slice(0,42),35,48,3,text);d.label(subtitle.slice(0,115),37,81,1);
  return d;
}

function lanes(d,verticalLabels){
  for(const [i,side] of sides.entries()){
    const top=y[i];
    d.label(side.toUpperCase(),x,top-16,1,colors[i]);
    d.rect(x,top,w,h,panel);
    for(let tick=0;tick<=5;tick++)d.line([[x+tick*w/5,top],[x+tick*w/5,top+h]],grid);
    if(verticalLabels){
      d.line([[x,top+h/2],[x+w,top+h/2]],grid);
      d.label(verticalLabels[0],11,top,1);
      d.label('0',37,top+h/2-3,1);
      d.label(verticalLabels[1],11,top+h-7,1);
    }
  }
}

function footer(d,start,end,at){
  for(let i=0;i<=5;i++){
    const left=x+i*w/5;
    d.label(number(start+(end-start)*i/5)+' S',left-(i===5?48:i===0?0:17),359,1);
  }
  if(at!==undefined&&at>=start&&at<end){
    const pos=x+(at-start)/(end-start)*w;
    d.line([[pos,y[0]],[pos,y[1]+h]],rose,2);
    d.label('FIRST DIFFERENCE / '+number(at*1000,4)+' MS',x,390,2,rose);
  }
}

function samples(d,a,b,meta,focus){
  const {sampleRate:rate,unit,first}=meta;
  const start=focus?Math.max(meta.from,first.sample-64):meta.from;
  const end=focus?Math.min(meta.to,first.sample+65):meta.to;
  const count=end-start;
  const ranges=[a,b].map(trace=>{
    const data=Object.values(trace.channels)[0].samples;
    const lo=Math.max(start,trace.startSample),hi=Math.min(end,trace.startSample+trace.frames);
    return {data,lo,hi,origin:trace.startSample};
  });
  let amplitude=0;
  for(const {data,lo,hi,origin} of ranges)
    for(let k=lo;k<hi;k++)amplitude=Math.max(amplitude,Math.abs(data[k-origin]));
  const top=amplitude?number(amplitude,2):'0';
  lanes(d,[top,'-'+top]);
  for(const [i,{data,lo,hi,origin}] of ranges.entries()){
    if(hi<=lo){
      d.label('NO SAMPLES IN WINDOW',x+18,y[i]+h/2-5,1,rose);
      continue;
    }
    const position=k=>x+(k-start)/count*w;
    const base=y[i]+h/2,gain=h*.42;
    const vertical=value=>base-(amplitude?value/amplitude:0)*gain;
    if(count<=w){
      const points=Array.from({length:hi-lo},(_,j)=>[position(lo+j),vertical(data[lo+j-origin])]);
      if(points.length>1)d.line(points,colors[i],2);
      else d.rect(points[0][0],points[0][1],2,2,colors[i]);
      continue;
    }
    for(let column=0;column<w;column++){
      const j=Math.max(lo,start+Math.floor(column*count/w)),end=Math.min(hi,start+Math.floor((column+1)*count/w));
      if(end<=j)continue;
      let min=Infinity,max=-Infinity;
      for(let k=j;k<end;k++){const value=data[k-origin];min=Math.min(min,value);max=Math.max(max,value);}
      d.rect(x+column,vertical(max),1,Math.max(1,vertical(min)-vertical(max)),colors[i]);
    }
  }
  if(count)footer(d,start/rate,end/rate,first?.time);
  if(first)d.label('NATIVE SAMPLE '+first.sample+' / '+rate+' HZ / '+unit,x,414,1);
  return d.png();
}

function events(kit,d,a,b,meta,clock,focus){
  const W=kit.KIT.world,T=kit.KIT.procedural.takeTime,{first}=meta;
  const timeOf=row=>T.seconds(W.outputTiming.eventTime(row));
  const other=first?.reference&&first.candidate?Math.max(timeOf(first.reference),timeOf(first.candidate)):first?.time;
  const lo=focus?Math.max(clock.start.time,first.time-.05):clock.start.time;
  const hi=focus?Math.min(clock.end.time,other+.05):clock.end.time;
  lanes(d);
  for(const [i,log] of [a,b].entries()){
    const pixels=new Set();
    for(const row of log.entries){
      const time=timeOf(row);
      if(time<lo||time>=hi)continue;
      pixels.add(Math.floor((time-lo)/(hi-lo)*w));
    }
    for(const at of pixels)d.line([[x+at,y[i]+17],[x+at,y[i]+h-17]],colors[i],2);
    if(!pixels.size)d.label('NO EVENTS IN WINDOW',x+18,y[i]+h/2-5,1);
  }
  footer(d,lo,hi,first?.time);
  if(first)d.label('EVENT '+first.eventIndex+' / '+first.reason.toUpperCase(),x,414,1);
  if(other>first?.time)d.label('OTHER OCCURRENCE / '+number(other*1000,4)+' MS',530,414,1);
  return d.png();
}

function plot(kit,review,kind,name,focus=false){
  const {report,reference,candidate}=review, meta=report[kind][name];
  const first=meta.first, prefix=focus?'FOCUS / ':'', a=reference[kind][name],b=candidate[kind][name];
  if(kind==='traces'){
    const d=canvas(kit,prefix+name,'NATIVE SAMPLES / '+meta.sampleRate+' HZ / '+meta.unit+' / SHARED AMPLITUDE SCALE');
    return samples(d,a,b,meta,focus);
  }
  const d=canvas(kit,prefix+name,'TIMED EVENTS / '+(first?first.reason.toUpperCase():'ALL RETAINED EVENTS MATCH'));
  return events(kit,d,a,b,meta,report.clock,focus);
}

module.exports={plot};
