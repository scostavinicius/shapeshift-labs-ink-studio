/* Measure acoustic arrivals, dominant frequencies, and decay on native sample windows. */
(function(K){
  const W=K.world,{check,own}=W.data,{fields}=W.boundarySignals;
  const finite=Number.isFinite;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
  const unavailable=(unit,reason,evidence)=>({status:'unavailable',value:null,unit,reason,evidence});
  const measured=(value,unit,evidence)=>finite(value)?{status:'ok',value,unit,evidence}:
    unavailable(unit,'measurement-overflow',evidence);
  const common=['kind','source','path','channel','trace','window'];

  function window(trace,options={}){
    check(fields(options,['from','to']),'Invalid native sample window');
    const {startSample,frames,sampleRate}=trace;
    const {from=startSample,to=startSample+frames}=options;
    check(integer(from,startSample,startSample+frames)&&integer(to,from,startSample+frames)&&to-from<=262144,
      'Measurement window must lie inside the trace and contain at most 262144 samples');
    return {from,to,sampleRate,start:from-startSample,end:to-startSample,count:to-from};
  }

  function withChannel(trace,spec){
    const {channel=Object.keys(trace.channels).length===1?Object.keys(trace.channels)[0]:undefined}=spec;
    check(own(trace.channels,channel),'Select a known trace channel');
    const {samples,unit}=trace.channels[channel], range=window(trace,spec.window);
    return {...range,samples,unit,evidence:{channel,inputUnit:unit,sampleRate:range.sampleRate,
      firstSample:range.from,endSample:range.to}};
  }

  function arrival(trace,spec){
    check(fields(spec,[...common,'threshold','baseline','direction','holdSamples','referenceSample'])&&
      finite(spec.threshold)&&spec.threshold>0,'Arrival needs a positive threshold');
    const {threshold,baseline=0,direction='absolute',holdSamples=1,referenceSample=0}=spec;
    check(finite(baseline)&&['absolute','rising','falling'].includes(direction)&&integer(holdSamples,1,262144)&&
      integer(referenceSample,0,Number.MAX_SAFE_INTEGER),'Invalid arrival baseline, direction or sample reference');
    const range=withChannel(trace,spec), {samples,start,end,from,sampleRate}=range;
    const evidence={...range.evidence,threshold,baseline,direction,holdSamples,referenceSample};
    const project=direction==='absolute'?Math.abs:direction==='falling'?value=>-value:value=>value;
    let streak=0;
    for(let i=start;i<end;i++){
      const signal=samples[i]-baseline;
      if(!finite(signal))return unavailable('s','measurement-overflow',evidence);
      if(project(signal)<threshold){streak=0;continue;}
      if(++streak===holdSamples){
        const crossing=i-holdSamples+1, sample=from+crossing-start;
        return measured((sample-referenceSample)/sampleRate,'s',{
          ...evidence,sample,amplitude:samples[crossing],confirmedAtSample:from+i-start});
      }
    }
    return unavailable('s','threshold-not-reached',evidence);
  }

  function centered({samples,start,end,count}){
    let scale=0;
    for(let i=start;i<end;i++)scale=Math.max(scale,Math.abs(samples[i]));
    const signal=new Float64Array(count);
    if(!scale)return {signal,scale,rms:0};
    let mean=0;
    for(let i=start;i<end;i++)mean+=samples[i]/scale;
    mean/=count;
    let power=0;
    for(let i=0;i<count;i++){
      const value=samples[start+i]/scale-mean;
      power+=value*value;
      signal[i]=value;
    }
    return {signal,scale,rms:scale*Math.sqrt(power/count)};
  }

  function spectrum(signal,fftSize,taper){
    const real=new Float64Array(fftSize), imag=new Float64Array(fftSize);
    for(let i=0;i<signal.length;i++)real[i]=signal[i]*(taper?(.5-.5*Math.cos(i*2*Math.PI/(signal.length-1))):1);
    InkFFT.axis(fftSize)(real,imag,0,1,-1);
    return Float64Array.from({length:fftSize/2+1},(_,i)=>Math.hypot(real[i],imag[i]));
  }

  function peakOffset(left,center,right){
    const a=Math.log(left),b=Math.log(center),c=Math.log(right);
    const curve=a-2*b+c, vertex=.5*(a-c)/curve;
    return finite(vertex)&&curve<0?Math.max(-.5,Math.min(.5,vertex)):0;
  }

  function frequency(trace,spec){
    check(fields(spec,[...common,'band','minRms']),'Invalid frequency measurement options');
    const range=withChannel(trace,spec), {count,sampleRate}=range;
    const {band=[0,sampleRate/2],minRms=0}=spec;
    check(Array.isArray(band)&&band.length===2&&band.every(finite)&&band[0]>=0&&band[1]>band[0]&&
      band[1]<=sampleRate/2&&finite(minRms)&&minRms>=0&&count<=65536,
    'Frequency needs an increasing band within Nyquist and at most 65536 samples');
    const evidence={...range.evidence,band,minRms};
    if(count<16)return unavailable('Hz','frequency-window-too-short',evidence);
    const {signal,scale,rms}=centered(range);
    if(!scale)return unavailable('Hz','no-ac-signal',evidence);
    const fftSize=2**Math.ceil(Math.log2(count)), binHz=sampleRate/fftSize;
    if(!finite(rms))return unavailable('Hz','measurement-overflow',evidence);
    Object.assign(evidence,{fftSize,binHz,rms});
    if(rms<=minRms)return unavailable('Hz','no-ac-signal',evidence);
    const lo=Math.max(1,Math.ceil(band[0]/binHz)), hi=Math.floor(band[1]/binHz);
    if(lo>hi)return unavailable('Hz','no-fft-bin-in-band',evidence);
    const bins=spectrum(signal,fftSize,true);
    let strongest=lo, peak=bins[lo];
    for(let i=lo+1;i<=hi;i++){
      const value=bins[i];
      if(value>peak){strongest=i;peak=value;}
    }
    if(peak===0)return unavailable('Hz','no-spectral-peak',evidence);
    const offset=strongest>lo&&strongest<hi?peakOffset(bins[strongest-1],peak,bins[strongest+1]):0;
    return measured((strongest+offset)*binHz,'Hz',{...evidence,bin:strongest,binOffset:offset});
  }

  function decay(trace,spec){
    check(fields(spec,[...common,'blockSamples','minRms','baseline','output','minFit'])&&
      integer(spec.blockSamples,2,65536),'Decay needs an RMS block size');
    const range=withChannel(trace,spec), {samples,start,end,from,sampleRate}=range;
    const {blockSamples,minRms=0,baseline=0,output='rate',minFit=0}=spec;
    check(finite(minRms)&&minRms>=0&&finite(baseline)&&finite(minFit)&&minFit>=0&&minFit<=1&&['rate','t60'].includes(output),
      'Invalid decay floor, baseline or output');
    const unit=output==='rate'?'1/s':'s', evidence={...range.evidence,blockSamples,minRms,baseline,output,minFit};
    // Center the least-squares sums as blocks arrive, keeping the fit bounded.
    let count=0,meanT=0,meanY=0,tt=0,yy=0,ty=0,first,last;
    for(let i=start;i+blockSamples<=end;i+=blockSamples){
      let scale=0;
      for(let j=i;j<i+blockSamples;j++)scale=Math.max(scale,Math.abs(samples[j]-baseline));
      if(!finite(scale))return unavailable(unit,'measurement-overflow',evidence);
      if(!scale)continue;
      let squares=0;
      for(let j=i;j<i+blockSamples;j++)squares+=((samples[j]-baseline)/scale)**2;
      const rms=scale*Math.sqrt(squares/blockSamples);
      if(rms<=minRms)continue;
      const sample=from+i-start, t=(i-start+(blockSamples-1)/2)/sampleRate, y=Math.log(rms);
      first??={firstSample:sample,rms};
      last={firstSample:sample,rms};
      const deltaT=t-meanT, deltaY=y-meanY;
      meanT+=deltaT/++count;
      meanY+=deltaY/count;
      tt+=deltaT*(t-meanT);
      yy+=deltaY*(y-meanY);
      ty+=deltaT*(y-meanY);
    }
    evidence.blocks=count;
    if(count<3||tt<=0||yy<=0)return unavailable(unit,'insufficient-decay-evidence',evidence);
    const rate=-ty/tt, rSquared=Math.min(1,ty*ty/(tt*yy));
    Object.assign(evidence,{first,last,rate,rSquared});
    if(!(rate>0))return unavailable(unit,'envelope-does-not-decay',evidence);
    if(rSquared<minFit)return unavailable(unit,'decay-fit-below-minimum',evidence);
    return measured(output==='rate'?rate:Math.log(1000)/rate,unit,evidence);
  }

  W.traceMeasurements=Object.freeze({arrival,frequency,decay,window,withChannel,measured,unavailable,
    centered,spectrum,peakOffset});
})(KIT);
