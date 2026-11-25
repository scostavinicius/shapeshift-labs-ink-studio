/* Complementary, stereo-linked harmonic/percussive masks on the source sample grid. */
(function(P){
  const A=P.mediaGraph, S=P.mediaGraphSupport;
  const {check,fields,finite,integer,id}=P.musicInstruments;
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(n,hi));
  const powerOfTwo=n=>!(n&(n-1));
  const odd=(n,lo,hi)=>clamp(2*Math.round((n-1)/2)+1,lo,hi);
  const pcm=(sampleRate,channels,samples)=>({sampleRate,channels,samples});

  function median(row){
    let low=0, high=row.length-1;
    const middle=high>>1;
    while(low<high){
      const pivot=row[(low+high)>>1];
      let left=low, right=high;
      while(left<=right){
        while(row[left]<pivot)left++;
        while(row[right]>pivot)right--;
        if(left<=right){
          const value=row[left];
          row[left++]=row[right];
          row[right--]=value;
        }
      }
      if(middle<=right)high=right;
      else if(middle>=left)low=left;
      else break;
    }
    return row[middle];
  }

  function split(input,settings={}){
    const source=A.audio(input), {sampleRate,channels,samples}=source, length=samples.length/channels;
    check(fields(settings,['size','hop','timeMedian','frequencyMedian','sharpness','balance']) &&
      integer(sampleRate,8000,96000)&&channels<=2&&length>0,
      'Harmonic/percussive separation needs nonempty mono or stereo PCM at 8–96 kHz');
    const {size=clamp(2**Math.round(Math.log2(sampleRate*.046)),512,4096),hop=size/4,
      timeMedian=odd(.32*sampleRate/hop,5,31),frequencyMedian=13,sharpness=2,balance=1}=settings;
    check(integer(size,128,8192)&&powerOfTwo(size)&&integer(hop,size/8,size/2)&&
      [timeMedian,frequencyMedian].every(n=>integer(n,3,63)&&(n&1))&&
      finite(sharpness,.5,4)&&finite(balance,.25,4),'Invalid harmonic/percussive FFT, median windows or mask settings');
    const half=size/2,bins=half+1,columns=Math.ceil((length+half)/hop),grid=columns*bins;
    check(grid<=6e6&&grid*(timeMedian+frequencyMedian)<=180e6&&columns*channels*size*Math.log2(size)*3<=600e6,
      'Harmonic/percussive separation exceeds its spectral budget. Shorten the recording or lower FFT overlap and median sizes');
    const {weights,transform}=S.fftSetup(source,{size},size,channels);
    const spectra=new Float32Array(grid), real=new Float64Array(size), imag=real.slice();
    function analyze(begin,ch){
      imag.fill(0);
      for(let i=0;i<size;i++)real[i]=(samples[(begin+i)*channels+ch]??0)*weights[i];
      transform(real,imag,0,1,-1);
    }
    for(let column=0;column<columns;column++){
      const begin=column*hop-half, first=column*bins;
      for(let ch=0;ch<channels;ch++){
        analyze(begin,ch);
        for(let k=0;k<bins;k++)spectra[first+k]+=real[k]*real[k]+imag[k]*imag[k];
      }
    }
    const timeWindow=new Float32Array(timeMedian), frequencyWindow=new Float32Array(frequencyMedian);
    const timeRadius=timeMedian>>1, frequencyRadius=frequencyMedian>>1;
    const timeRows=new Int32Array(timeMedian), frequencyBins=new Int32Array(bins*frequencyMedian);
    for(let k=0;k<bins;k++)for(let i=0;i<frequencyMedian;i++)
      frequencyBins[k*frequencyMedian+i]=clamp(k+i-frequencyRadius,0,bins-1);
    const mask=new Float64Array(bins), harmonic=new Float64Array(samples.length), norm=new Float64Array(length);
    for(let column=0;column<columns;column++){
      const begin=column*hop-half, low=Math.max(0,-begin), high=Math.min(size,length-begin), first=column*bins;
      for(let i=0;i<timeMedian;i++)timeRows[i]=clamp(column+i-timeRadius,0,columns-1)*bins;
      for(let k=0;k<bins;k++){
        for(let i=0;i<timeMedian;i++)timeWindow[i]=spectra[timeRows[i]+k];
        for(let i=0;i<frequencyMedian;i++)frequencyWindow[i]=spectra[first+frequencyBins[k*frequencyMedian+i]];
        const tonal=balance*median(timeWindow), transient=median(frequencyWindow);
        mask[k]=tonal>0?1/(1+(transient/tonal)**sharpness):0;
      }
      for(let i=low;i<high;i++)norm[begin+i]+=weights[i]*weights[i];
      for(let ch=0;ch<channels;ch++){
        analyze(begin,ch);
        for(let k=0;k<bins;k++){
          real[k]*=mask[k];imag[k]*=mask[k];
          if(k>0&&k<half){real[size-k]=real[k];imag[size-k]=-imag[k];}
        }
        imag[0]=imag[half]=0;
        transform(real,imag,0,1,1);
        for(let i=low;i<high;i++)harmonic[(begin+i)*channels+ch]+=real[i]*weights[i]/size;
      }
    }
    const percussive=new Float64Array(samples.length);
    let harmonicPeak=0,percussivePeak=0;
    for(let i=0;i<length;i++)for(let ch=0;ch<channels;ch++){
      const at=i*channels+ch, h=harmonic[at]/Math.max(1e-12,norm[i]);
      const p=samples[at]-h;
      harmonic[at]=h;percussive[at]=p;
      harmonicPeak=Math.max(harmonicPeak,Math.abs(h));percussivePeak=Math.max(percussivePeak,Math.abs(p));
    }
    const layerGain=1/Math.max(1,harmonicPeak,percussivePeak);
    if(layerGain<1)for(let i=0;i<harmonic.length;i++){
      harmonic[i]=clamp(harmonic[i]*layerGain,-1,1);percussive[i]=clamp(percussive[i]*layerGain,-1,1);
    }
    return {harmonic:pcm(sampleRate,channels,harmonic),percussive:pcm(sampleRate,channels,percussive),
      report:{sampleRate,channels,frames:length,size,hop,timeMedian,frequencyMedian,sharpness,balance,
        layerGain,harmonicPeak:Math.min(1,harmonicPeak*layerGain),percussivePeak:Math.min(1,percussivePeak*layerGain)}};
  }

  function session(input,options={}){
    check(fields(options,['id','separation','detect','tail'])&&(options.detect===false||options.detect===undefined||
      fields(options.detect,['size','hop','minGap','minStrength','sensitivity','channel'])),'Invalid separated session settings');
    const {id:name='separated-audio',separation={},detect={},tail=0}=options;
    check(id(name)&&finite(tail,0,8),'Invalid separated session ID or tail');
    const {harmonic,percussive,report}=split(input,separation), {frames,sampleRate:rate}=report;
    const found=detect===false?[]:A.detectTransients(percussive,{minGap:.068,minStrength:.022,...detect}).events;
    check(found.length<=510,'Too many detected hits for one session. Increase the gap or turn detection off');
    const restoreGain=Math.min(4,1/report.layerGain), overlap=Math.max(1,Math.round(rate*.004)), lead=Math.round(rate*.012);
    const cuts=found.map(({detected:{sample,strength}},i)=>{
      const handle=i?Math.min(lead,Math.floor((sample-found[i-1].detected.sample)/2)):lead;
      return {sample,strength,boundary:Math.max(0,sample-handle)};
    });
    if(cuts[0]?.boundary!==0)cuts.unshift({sample:0,boundary:0});
    const blend=cuts.map(({sample,boundary},i)=>i?Math.min(overlap,sample-boundary,
      boundary-cuts[i-1].boundary-1,(cuts[i+1]?.boundary??frames)-boundary-1):0);
    const clip=(name,track,from,to,pin,fades)=>({id:name,track,spot:{samples:pin},take:'main',
      takes:{main:{asset:track,sync:{sample:pin},fromSample:from,toSample:to}},
      ...(restoreGain!==1&&{gain:restoreGain}),...(fades&&{fades})});
    const clips=[clip('harmonic','harmonic',0,frames,0)], hits=[];
    for(const [i,row] of cuts.entries()){
      const next=cuts[i+1];
      const fadeIn=blend[i], fadeOut=blend[i+1]??0;
      const end=next?next.boundary+fadeOut+Number(fadeOut>0):frames;
      const key=row.strength===undefined?'percussion-lead':'hit-'+row.sample;
      if(row.strength!==undefined)hits.push({id:key,sample:row.sample,strength:row.strength});
      clips.push(clip(key,'percussive',row.boundary,end,row.sample,
        fadeIn||fadeOut?{inSamples:fadeIn,outSamples:fadeOut,curve:'linear'}:undefined));
    }
    const fps=30, shotFrames=Math.ceil((frames+Math.round(tail*rate))*fps/rate);
    const value={format:'ink-studio/audio-editorial',version:1,id:name,sampleRate:rate,
      picture:{fps,shots:[{id:'recording',frames:shotFrames}]},map:{tempo:120},clips};
    return {value,assets:{harmonic,percussive},report:{...report,hits,restoreGain}};
  }
  A.harmonicPercussive=Object.freeze({split,session});
})(KIT.procedural);
