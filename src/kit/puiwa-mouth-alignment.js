/* Constrain a supplied pronunciation to acoustic changes in the recorded read. */
(function(K){
  const P=K.procedural,W=K.world;
  const {check}=P.musicInstruments;
  const vowels=/^[aeiouyæɑɒɔəɛɚɝɜɐɪʊʌœøɨʉɯɤɵɞɘɶɔɿʅɩʏ]/u;
  const phoneGroups=[
    ['seal',/^[pbm]/u],['teeth',/^[fvɱ]/u],['tongue',/^[θðtdnɾɹrlɫɬ]/u],
    ['hiss',/^(?:[szʃʒɕʑçxɣh]|[td]͡?[ʃʒ])/u],['round',/^[wuoɔʊɒøœʉɵ]/u],
    ['spread',/^[ijɪeɛyɨʏ]/u],['open',vowels]
  ];
  function describe(symbol){
    const phone=symbol.normalize('NFD').replace(/[^\p{L}͜͡]/gu,'');
    const diphthong=/^[aeouɑɔə][ɪʊiu]/u.test(phone);
    const shape=/^[td][͜͡]?[ʃʒ]/u.test(phone) ? 'hiss' :
      phoneGroups.find(([,pattern])=>pattern.test(phone))?.[0] ?? 'narrow';
    const acoustic=vowels.test(phone) ? 'vowel' : /^[pbtdkɡgʔ]/u.test(phone) && shape!=='hiss' ? 'stop' :
      shape==='hiss' || shape==='teeth' || /^[θð]/u.test(phone) ? 'fricative' : 'sonorant';
    const duration=acoustic==='vowel' ? (diphthong || /[ːˑ]/u.test(symbol) ? 1.85 : 1.38) :
      acoustic==='stop' ? .63 : acoustic==='fricative' ? 1.04 : .86;
    return {shape,acoustic,duration};
  }

  function pronounce(speech){
    const input=W.inputCompilers.compile({format:W.inputCompilers.planFormat,version:1,id:'mouth-read',sources:{read:speech}});
    const units=[];
    let prior=0,pending,seen=false;
    for(const row of input.events){
      if(row.kind==='word'){
        check(row.value.pronunciation!=='unresolved','Add an IPA pronunciation for '+row.value.text);
        continue;
      }
      if(row.kind==='pause'){
        units.push({acoustic:'rest',duration:1.1,pause:true});
        prior=row.end;
        pending=undefined;
        continue;
      }
      if(row.kind!=='phoneme')continue;
      if(seen && row.time-prior>.005){
        units.push({acoustic:'rest',duration:.35,pause:true});
        pending=undefined;
      }
      const {symbol,stress,sourceSpan,word}=row.value, phone=describe(symbol);
      if(stress)pending=stress;
      const emphasis=phone.acoustic==='vowel' ? pending : undefined;
      units.push({...phone,duration:phone.duration*(emphasis==='primary' ? 1.23 : 1),
        symbol,sourceSpan,word,stress:emphasis});
      if(phone.acoustic==='vowel')pending=undefined;
      prior=row.end;
      seen=true;
    }
    const first=units.findIndex(row=>!row.pause), last=units.findLastIndex(row=>!row.pause);
    check(first>=0 && last-first<160,'A mouth utterance needs 1 to 160 phones and pauses');
    return {units:units.slice(first,last+1),warnings:input.warnings};
  }

  const rmsDb=value=>20*Math.log10(Math.max(1e-9,value));
  const clamp=value=>Math.max(0,Math.min(1,value));
  function scan(audio,first,last,channel){
    const {samples,channels,sampleRate:rate}=audio, hop=Math.round(rate*.01), count=Math.ceil((last-first)/hop);
    const stride=Math.max(1,Math.floor(rate/8000)), values=new Float64Array(Math.ceil((last-first)/stride));
    for(let i=0;i<values.length;i++){
      const start=first+i*stride, end=Math.min(last,start+stride);
      for(let at=start;at<end;at++)values[i]+=samples[at*channels+channel]/(end-start);
    }
    const features=Array.from({length:count},(_,k)=>{
      const center=Math.round((k+.5)*hop/stride), reach=Math.round(.01*rate/stride);
      const from=Math.max(0,center-reach), to=Math.min(values.length,center+reach);
      let sum=0,delta=0;
      for(let i=from;i<to;i++){
        sum+=values[i]**2;
        delta+=(values[i]-(values[i-1]??0))**2;
      }
      let voiced=0;
      if(sum>1e-9)for(let lag=Math.round(rate/stride/345);lag<=Math.round(rate/stride/93);lag+=2){
        let cross=0,a=0,b=0;
        for(let i=from+lag;i<to;i++){
          const x=values[i],y=values[i-lag];
          cross+=x*y;a+=x*x;b+=y*y;
        }
        if(a*b>1e-12)voiced=Math.max(voiced,cross/Math.sqrt(a*b));
      }
      return {rms:Math.sqrt(sum/Math.max(1,to-from)),bright:clamp(Math.sqrt(delta/Math.max(1e-9,sum))/.9),voiced};
    });
    const energy=features.map(row=>row.rms).sort((a,b)=>a-b);
    const peak=energy.at(-1), level=energy[Math.floor((count-1)*.8)];
    const floor=Math.max(.0003,Math.min(peak*.11,level*.12));
    const active=features.findIndex(row=>row.rms>=floor), end=features.findLastIndex(row=>row.rms>=floor)+1;
    if(active<0)return null;
    const spoken=features.slice(active,end), norm=Math.max(level,peak*.25);
    for(const frame of spoken)frame.energy=clamp(frame.rms/norm);
    return {spoken,origin:first+active*hop,hop,level:norm};
  }

  function penalty(unit,{energy,bright,voiced}){
    if(unit.pause)return energy*2.4+.24*voiced*energy;
    if(unit.acoustic==='vowel')return .9*(1-energy)+.54*(1-voiced)+.45*bright;
    if(unit.acoustic==='fricative')return .73*(1-bright)+.3*voiced+.45*Math.max(0,.22-energy);
    if(unit.acoustic==='stop')return .53*voiced*energy+.36*Math.max(0,energy-.5);
    return .45*(1-voiced)+.35*(1-energy)+.26*bright;
  }

  function align(units,performance){
    const {spoken}=performance, count=spoken.length;
    const weights=units.reduce((sum,row)=>sum+row.duration,0);
    if(units.filter(row=>!row.pause).length>count)return null;
    let previous=new Float64Array(count+1).fill(Infinity);
    previous[0]=0;
    const edges=[];
    for(const unit of units){
      const expected=count*unit.duration/weights, smallest=unit.pause ? 0 : 1;
      const largest=Math.min(count,Math.ceil(expected*3.65)+7);
      const running=new Float64Array(count+1);
      for(let i=0;i<count;i++)running[i+1]=running[i]+penalty(unit,spoken[i]);
      const current=new Float64Array(count+1).fill(Infinity), edge=new Int32Array(count+1).fill(-1);
      for(let start=0;start<=count;start++){
        if(!Number.isFinite(previous[start]))continue;
        for(let end=start+smallest;end<=Math.min(count,start+largest);end++){
          const length=end-start, deviation=(length-expected)/(expected+2);
          const cost=previous[start]+running[end]-running[start]+1.3*deviation*deviation;
          if(cost<current[end]){current[end]=cost;edge[end]=start;}
        }
      }
      previous=current;
      edges.push(edge);
    }
    if(!Number.isFinite(previous[count]))return null;
    let end=count;
    return units.map((unit,index)=>({unit,index})).reverse().map(({unit,index})=>{
      const start=edges[index][end], length=end-start;
      let power=0;
      for(let i=start;i<end;i++)power+=spoken[i].rms**2;
      const rms=Math.sqrt(power/Math.max(1,length));
      const result={unit,start,end,rmsDbFS:rmsDb(rms),relativeDb:rmsDb(rms)-rmsDb(performance.level),
        stretch:length/(count*unit.duration/weights)};
      end=start;
      return result;
    }).reverse();
  }

  W.mouthAlignment=Object.freeze({pronounce,scan,align});
})(KIT);
