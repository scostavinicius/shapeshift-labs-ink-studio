/* Independent sample-domain and FFT checks on the same native trace window. */
(function(K){
  const W=K.world,M=W.traceMeasurements,{check}=W.data,{fields}=W.boundarySignals;
  const {measured,unavailable}=M, finite=Number.isFinite, tau=2*Math.PI;
  const inBand=(hz,[lo,hi])=>hz>=lo&&hz<=hi;
  const crest=(bins,i)=>bins[i]>bins[i-1]&&bins[i]>=bins[i+1];

  function pole(signal,rate,band,metric,rayleighHz,minFit){
    const method='sample-recurrence', fail=(reason,evidence={})=>unavailable('Hz',reason,{method,...evidence});
    // Separate the two regressors at a fraction of the shortest allowed period.
    const stride=Math.max(1,Math.floor(rate/(8*band[1]))), count=signal.length-2*stride;
    if(count<12)return fail('insufficient-recurrence-samples',{stride,count});
    let sumX=0,sumY=0,sumZ=0,xx=0,xy=0,yy=0,xz=0,yz=0,zz=0;
    for(let i=2*stride;i<signal.length;i++){
      const x=signal[i-stride],y=signal[i-2*stride],z=signal[i];
      sumX+=x;sumY+=y;sumZ+=z;
      xx+=x*x;xy+=x*y;yy+=y*y;xz+=x*z;yz+=y*z;zz+=z*z;
    }
    // Include a fitted constant to account for the trace's baseline.
    xx-=sumX*sumX/count;xy-=sumX*sumY/count;yy-=sumY*sumY/count;
    xz-=sumX*sumZ/count;yz-=sumY*sumZ/count;zz-=sumZ*sumZ/count;
    const det=xx*yy-xy*xy;
    if(!(det>1e-12*xx*yy&&zz>0))return fail('singular-recurrence',{stride,count});
    const a=(yy*xz-xy*yz)/det,b=(xx*yz-xy*xz)/det;
    const rSquared=Math.min(1,(a*xz+b*yz)/zz), radius=Math.sqrt(-b), cosine=a/(2*radius);
    const fit={method,stride,count,rSquared,minFit};
    if(!finite(rSquared)||rSquared<minFit)return fail('recurrence-fit-below-minimum',fit);
    if(!(radius>0&&Math.abs(cosine)<1))return fail('no-oscillatory-pole',fit);
    const hz=Math.acos(cosine)*rate/(tau*stride), decayRate=-Math.log(radius)*rate/stride;
    const evidence={...fit,centerHz:hz,decayRate};
    if(!inBand(hz,band))return fail('pole-outside-band',evidence);
    if(hz<3*rayleighHz)return fail('insufficient-observed-cycles',evidence);
    if(metric==='resonance')return measured(hz,'Hz',evidence);
    if(decayRate<=1e-7*rayleighHz)return fail('pole-does-not-decay',evidence);
    const bandwidth=decayRate/Math.PI, quality=hz/bandwidth;
    if(quality<5)return fail('pole-too-broad-for-linewidth-model',{...evidence,quality});
    return measured(bandwidth,'Hz',{...evidence,quality});
  }

  function spectralPeak(bins,bin,binHz){
    const left=bins[bin-1], center=bins[bin], right=bins[bin+1], offset=M.peakOffset(left,center,right);
    // Estimate the interpolated magnitude at the vertex of the log parabola.
    const amplitude=offset?center*Math.exp(.25*offset*Math.log(right/left)):center;
    return {bin,hz:(bin+offset)*binHz,amplitude};
  }

  function resonanceFFT(bins,scan,band,metric){
    const method=metric==='bandwidth'?'fft-half-power':'fft-peak', evidence={method,...scan};
    const fail=(reason,details={})=>unavailable('Hz',reason,{...evidence,...details});
    const {binHz,rayleighHz}=scan;
    let strongest=0, center=null;
    const lo=Math.max(2,Math.ceil(band[0]/binHz-.5)),hi=Math.min(bins.length-2,Math.floor(band[1]/binHz+.5));
    for(let bin=lo;bin<=hi;bin++){
      if(bins[bin]<=strongest||!crest(bins,bin))continue;
      const peak=spectralPeak(bins,bin,binHz);
      if(!inBand(peak.hz,band))continue;
      strongest=bins[bin]; center=peak;
    }
    if(!center)return fail('no-spectral-peak-in-band');
    Object.assign(evidence,{centerHz:center.hz,bin:center.bin});
    if(center.hz<3*rayleighHz)return fail('insufficient-observed-cycles');
    if(metric==='resonance')return measured(center.hz,'Hz',evidence);
    const target=center.amplitude/Math.SQRT2;
    function edge(direction){
      let i=center.bin;
      while(i>0&&i<bins.length-1&&bins[i]>=target)i+=direction;
      if(bins[i]>=target)return null;
      const neighbor=bins[i-direction], span=bins[i]>0?Math.log(neighbor/bins[i]):Infinity;
      if(!(span>0))return null;
      const fraction=finite(span)?Math.log(neighbor/target)/span:1-target/neighbor;
      const hz=(i-direction+direction*fraction)*binHz;
      return inBand(hz,band)?hz:null;
    }
    const lowerHz=edge(-1), upperHz=edge(1), width=lowerHz===null||upperHz===null?null:upperHz-lowerHz;
    const details={lowerHz,upperHz,minimumResolvedHz:2*rayleighHz};
    if(width===null)return fail('half-power-crossing-outside-band',details);
    if(width<details.minimumResolvedHz)return fail('linewidth-below-window-resolution',{...details,observedHz:width});
    return measured(width,'Hz',{...evidence,...details});
  }

  function lagPitch(signal,rate,[low,high],threshold){
    const method='yin', min=Math.max(2,Math.floor(rate/high)), max=Math.ceil(rate/low);
    const settings={method,minLag:min,maxLag:Number.isSafeInteger(max)?max:null,threshold};
    if(!Number.isSafeInteger(max)||signal.length<3*max+1)return unavailable('Hz','insufficient-observed-cycles',settings);
    const width=Math.min(max*4,signal.length-max-1,Math.floor(8000000/(max+1)));
    if(width<2*max)return unavailable('Hz','pitch-lag-work-limit',settings);
    const evidence={...settings,analysisSamples:width+max+1};
    // Analyze the middle of the selected window using a fixed comparison width.
    const first=Math.floor((signal.length-width-max-1)/2);
    const guess=K.procedural.mediaGraph.yinPitchLag(signal,first,width,min,max,threshold,new Float64Array(max+2));
    if(!guess)return unavailable('Hz','no-periodic-lag-in-band',evidence);
    // The YIN normalization selects the cycle. Refine its position with the
    // original difference, whose slope has no contribution from that normalization.
    const lag=Math.max(min,Math.min(max,Math.round(guess.period)));
    let left=0,middle=0,right=0;
    for(let i=first;i<first+width;i++){
      const value=signal[i];
      left+=(value-signal[i+lag-1])**2;
      middle+=(value-signal[i+lag])**2;
      right+=(value-signal[i+lag+1])**2;
    }
    const curvature=left-2*middle+right;
    const period=curvature>0?lag+Math.max(-.5,Math.min(.5,.5*(left-right)/curvature)):guess.period;
    const hz=rate/period;
    if(!inBand(hz,[low,high]))return unavailable('Hz','no-periodic-lag-in-band',evidence);
    return measured(hz,'Hz',{...evidence,period,yinPeriod:guess.period,confidence:guess.confidence,windowOffset:first});
  }

  function gcd(a,b){
    while(b)[a,b]=[b,a%b];
    return a;
  }

  function harmonicPitch(bins,scan,band,count,power){
    const method='fft-harmonic-series', evidence={method,...scan}, {rayleighHz,binHz}=scan;
    const lo=Math.max(2,Math.ceil(Math.max(4*rayleighHz,band[0])/binHz-.5));
    const hi=Math.min(bins.length-2,Math.ceil(8*band[1]/binHz+.5)), peaks=[];
    for(let i=lo;i<=hi;i++)if(crest(bins,i))peaks.push(spectralPeak(bins,i,binHz));
    peaks.sort((a,b)=>b.amplitude-a.amplitude||a.hz-b.hz);
    const salient=peaks.slice(0,16).filter(peak=>peak.amplitude>=.08*peaks[0].amplitude);
    const total=salient.reduce((sum,peak)=>sum+peak.amplitude**2,0);
    evidence.strongestPartialHz=salient[0]?.hz??null;
    let winner=null;
    for(const peak of salient)for(let divisor=1;divisor<=8;divisor++){
      const root=peak.hz/divisor;
      if(!inBand(root,band)||root<4*rayleighHz)continue;
      const matches=[];
      for(const partial of salient){
        const harmonic=Math.round(partial.hz/root), tolerance=Math.min(root*.12,Math.max(rayleighHz,partial.hz*.004));
        if(harmonic<1||harmonic>8||Math.abs(partial.hz-harmonic*root)>tolerance||
          matches.some(entry=>entry.harmonic===harmonic))continue;
        matches.push({...partial,harmonic});
      }
      // Coprime harmonics can recover a missing root without inventing an octave below them.
      if(matches.reduce((base,{harmonic})=>gcd(base,harmonic),0)!==1)continue;
      let energy=0,weighted=0,weight=0;
      for(const {hz,amplitude,harmonic} of matches){
        energy+=amplitude**2;
        weighted+=amplitude**2*harmonic*hz;
        weight+=(amplitude*harmonic)**2;
      }
      const hz=weighted/weight;
      if(!inBand(hz,band))continue;
      if(!winner||energy>winner.energy)winner={hz,energy,matches};
    }
    if(!winner)return unavailable('Hz','no-harmonic-series-in-band',evidence);
    const peakShare=winner.energy/total;
    const coherentShare=Math.min(1,8*winner.energy/((count-1)**2*power));
    Object.assign(evidence,{peakShare,coherentShare,matchedHarmonics:winner.matches.map(({hz,harmonic})=>({hz,harmonic}))});
    if(peakShare<.7||coherentShare<.35)return unavailable('Hz','weak-harmonic-support',evidence);
    return measured(winner.hz,'Hz',evidence);
  }

  function compare(trace,spec){
    check(fields(spec,['kind','source','path','channel','trace','window','metric','band','minRms','minFit','pitchThreshold']),
      'Invalid signal comparison options');
    const range=M.withChannel(trace,spec), {count,sampleRate}=range;
    const {metric,band,minRms=0,minFit=.99,pitchThreshold=.16}=spec;
    check(['resonance','bandwidth','pitch'].includes(metric)&&Array.isArray(band)&&band.length===2&&
      band.every(finite)&&band[0]>0&&band[1]>band[0]&&band[1]<=sampleRate/2&&count<=65536&&
      finite(minRms)&&minRms>=0&&finite(minFit)&&minFit>=0&&minFit<=1&&
      finite(pitchThreshold)&&pitchThreshold>0&&pitchThreshold<1&&
      (metric==='pitch'?spec.minFit===undefined:spec.pitchThreshold===undefined),
    'Signal comparison needs its metric, positive band within Nyquist, valid fit controls and at most 65536 samples');
    const evidence={...range.evidence,metric,band,minRms};
    if(count<16)return unavailable('Hz','signal-window-too-short',evidence);
    const {signal,scale,rms}=M.centered(range);
    evidence.rms=rms;
    if(!finite(rms))return unavailable('Hz','measurement-overflow',evidence);
    if(rms<=minRms)return unavailable('Hz','no-ac-signal',evidence);
    const fftSize=4*2**Math.ceil(Math.log2(count)), binHz=sampleRate/fftSize, rayleighHz=sampleRate/count;
    const window=metric==='bandwidth'?'rect':'hann', scan={fftSize,binHz,rayleighHz,window};
    const bins=M.spectrum(signal,fftSize,window==='hann');
    const time=metric==='pitch'?lagPitch(signal,sampleRate,band,pitchThreshold):pole(signal,sampleRate,band,metric,rayleighHz,minFit);
    const frequency=metric==='pitch'?harmonicPitch(bins,scan,band,count,(rms/scale)**2):resonanceFFT(bins,scan,band,metric);
    Object.assign(evidence,{time,frequency});
    if(time.status!=='ok'||frequency.status!=='ok')return unavailable('Hz','independent-estimate-unavailable',evidence);
    evidence.signedHz=time.value-frequency.value;
    if(metric!=='bandwidth')evidence.signedCents=1200*Math.log2(time.value/frequency.value);
    return measured(Math.abs(evidence.signedHz),'Hz',evidence);
  }

  W.signalComparison=Object.freeze({compare});
})(KIT);
