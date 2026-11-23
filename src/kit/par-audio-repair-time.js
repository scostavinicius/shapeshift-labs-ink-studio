/* Local waveform repair and stationary mains-hum subtraction. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,finite,integer,check,db}=P.musicInstruments;
  function sampleRange(row,frames) {
    return fields(row,['fromSample','toSample']) && integer(row.fromSample,0,frames-1) &&
      integer(row.toSample,row.fromSample+1,frames);
  }
  function declick(samples,channels,rate,raw) {
    const frames=samples.length/channels;
    check(fields(raw,['auto','ranges','thresholdDb','sensitivity']) &&
      (raw.auto===undefined || typeof raw.auto==='boolean') && Array.isArray(raw.ranges ?? []) &&
      (raw.ranges ?? []).length<=2048 && finite(raw.thresholdDb ?? -33,-96,0) && finite(raw.sensitivity ?? 8,2,40),
    'Invalid de-click threshold, sensitivity or ranges');
    const spans=Array.from(raw.ranges ?? [],row=>{
      check(sampleRange(row,frames) && row.fromSample>0 && row.toSample<frames &&
        row.toSample-row.fromSample<=Math.ceil(rate*.020),'De-click ranges need clean neighboring samples and up to 20 ms');
      return {...row};
    });
    if (raw.auto ?? (raw.ranges===undefined)) {
      const radius=Math.max(12,Math.round(rate*.0015)), floor=db(raw.thresholdDb ?? -33), sensitivity=raw.sensitivity ?? 8;
      const sum=new Float64Array(frames+1), detected=new Uint8Array(frames);
      for (let ch=0;ch<channels;ch++) {
        const at=i=>samples[i*channels+ch];
        for (let i=1;i<frames-1;i++) sum[i+1]=sum[i]+(at(i)-.5*(at(i-1)+at(i+1)))**2;
        for (let i=2;i<frames-2;i++) {
          const low=Math.max(1,i-radius), high=Math.min(frames-1,i+radius+1);
          const left=Math.max(low,i-3), right=Math.min(high,i+4);
          const noise=Math.sqrt(Math.max(0,sum[left]-sum[low]+sum[high]-sum[right])/Math.max(1,left-low+high-right));
          const a=at(i-1), b=at(i+1), sample=at(i), error=Math.abs(sample-.5*(a+b));
          if (error>Math.max(floor,noise*sensitivity) && Math.abs(a-b)<.65*error) detected[i]=1;
        }
      }
      let count=0;
      for (let i=1;i<frames-1;i++) if (detected[i]) {
        const start=i;
        while (detected[i+1]) i++;
        check(++count+spans.length<=4096,'Too many de-click candidates. Raise the threshold or use explicit ranges');
        spans.push({fromSample:start,toSample:i+1});
      }
    }
    const merged=[];
    for (const row of spans.sort((a,b)=>a.fromSample-b.fromSample)) {
      const tail=merged.at(-1);
      if (tail && tail.toSample>=row.fromSample) tail.toSample=Math.max(row.toSample,tail.toSample);
      else merged.push({...row});
    }
    for (const {fromSample,toSample} of merged) for (let ch=0;ch<channels;ch++) {
      const a=samples[(fromSample-1)*channels+ch], b=samples[toSample*channels+ch];
      for (let i=fromSample;i<toSample;i++) samples[i*channels+ch]=a+(b-a)*(i-fromSample+1)/(toSample-fromSample+1);
    }
    return {regions:merged,repairedFrames:merged.reduce((n,r)=>n+r.toSample-r.fromSample,0)};
  }

  function fit(samples,channels,rate,frequency,from,to) {
    const phase=2*Math.PI*frequency/rate;
    let ss=0, cc=0, cs=0;
    const sv=new Float64Array(channels),cv=new Float64Array(channels);
    for (let i=from;i<to;i++) {
      const s=Math.sin(phase*i),c=Math.cos(phase*i);
      const w=.5-.5*Math.cos(2*Math.PI*(i-from+.5)/(to-from)), sw=s*w,cw=c*w;
      ss+=s*sw;cc+=c*cw;cs+=s*cw;
      for (let ch=0;ch<channels;ch++) {
        const x=samples[i*channels+ch];
        sv[ch]+=sw*x;cv[ch]+=cw*x;
      }
    }
    const det=ss*cc-cs*cs;
    return Array.from(sv,(value,ch)=>({sin:(cc*value-cs*cv[ch])/det,cos:(ss*cv[ch]-cs*value)/det}));
  }

  function dehum(samples,channels,rate,raw) {
    const frames=samples.length/channels;
    check(fields(raw,['frequency','harmonics','reference','amount']) &&
      (raw.frequency===undefined || raw.frequency==='auto' || finite(raw.frequency,40,70)) &&
      integer(raw.harmonics ?? 3,1,12) && finite(raw.amount ?? 1,0,1) &&
      (raw.reference===undefined || sampleRange(raw.reference,frames)),'Invalid hum frequency, harmonic count or reference');
    const reference=raw.reference ?? {fromSample:0,toSample:frames};
    const {fromSample:from,toSample:to}=reference, harmonics=raw.harmonics ?? 3, amount=raw.amount ?? 1;
    const candidates=(raw.frequency ?? 'auto')==='auto' ? [50,60] : [raw.frequency];
    check(to-from>=Math.ceil(rate*.075) && frames*harmonics*channels<=1e8,
      'Hum fitting needs at least 75 ms of reference and a bounded harmonic workload');
    let strongest;
    const powers=[];
    for (const fundamental of candidates) {
      const rows=Array.from({length:harmonics},(_,i)=>{
        const hz=fundamental*(i+1), coeff=fit(samples,channels,rate,hz,from,to);
        return {hz,coeff,amplitude:coeff.map(({sin,cos})=>Math.hypot(sin,cos))};
      });
      const power=rows.reduce((all,{amplitude},i)=>all+amplitude.reduce((sum,x)=>sum+x*x,0)/(i+1),0);
      powers.push({frequency:fundamental,power});
      if (!strongest || power>strongest.power) strongest={fundamental,power,rows};
    }
    const {fundamental,rows}=strongest;
    for (const {hz,coeff} of rows) {
      const phase=2*Math.PI*hz/rate;
      for (let i=0;i<frames;i++) {
        const s=Math.sin(phase*i)*amount,c=Math.cos(phase*i)*amount;
        for (let ch=0;ch<channels;ch++) samples[i*channels+ch]-=coeff[ch].sin*s+coeff[ch].cos*c;
      }
    }
    return {frequency:fundamental,reference:{...reference},amount,candidates:powers,
      harmonics:rows.map(({hz,amplitude})=>({hz,amplitude}))};
  }
  Object.assign(S,{repairRange:sampleRange,repairClicks:declick,repairHum:dehum});
})(KIT.procedural);
