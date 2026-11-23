/* Phase-vocoder stretching with spectral peak locking and a shared stereo reference. */
(function (P) {
  const A=P.mediaGraph, {fftSetup}=P.mediaGraphSupport, tau=2*Math.PI;
  const wrap=phase=>phase-tau*Math.round(phase/tau);

  function reference({samples,channels}) {
    const frames=samples.length/channels, stride=Math.max(1,Math.floor(frames/2048));
    const power=new Float64Array(channels);
    for (let frame=0;frame<frames;frame+=stride)
      for (let c=0;c<channels;c++) power[c]+=samples[frame*channels+c]**2;
    return power.indexOf(Math.max(...power));
  }
  function lockPhases(mag,angles,phase,result) {
    const peaks=[];
    let max=0;
    for (const value of mag) max=Math.max(value,max);
    for (let k=1;k<mag.length-1;k++)
      if (mag[k]>=max*.0003 && mag[k]>0 && mag[k]>mag[k-1] && mag[k]>=mag[k+1]) peaks.push(k);
    let i=0;
    for (let k=0;k<mag.length;k++) {
      while (i+1<peaks.length && k>(peaks[i]+peaks[i+1])/2) i++;
      const peak=k===0 || k===mag.length-1 ? k : peaks[i] ?? k;
      result[k]=phase[peak]+angles[k]-angles[peak];
    }
  }
  function warpTones(audio,out,pieces) {
    const {sampleRate,samples,channels}=audio, frames=samples.length/channels, target=out.length/channels;
    const size=Math.max(256,Math.min(4096,2**Math.round(Math.log2(sampleRate*.065))));
    const {n,weights,transform}=fftSetup(audio,{size},size,channels), half=n/2, hop=n/4, bins=half+1;
    if (Math.ceil((target+half)/hop)*channels*n*Math.log2(n)*2>5e8)
      throw new RangeError('Tonal warp exceeds its transform budget');
    const buffers=Array.from({length:channels},()=>({
      real:new Float64Array(n),imag:new Float64Array(n),mag:new Float64Array(bins),angles:new Float64Array(bins)
    }));
    const norm=new Float64Array(target), phase=new Float64Array(bins), previous=new Float64Array(bins);
    const locked=new Float64Array(bins), binAngle=tau/n, ref=buffers[reference(audio)];
    const sample=(frame,channel)=>frame<0 || frame>=frames ? 0 : samples[frame*channels+channel];
    let cursor=0, last=0;
    for (let at=0;at<target+half;at+=hop) {
      while (cursor+1<pieces.length && at>=pieces[cursor].end) cursor++;
      const {from,start,rate}=pieces[cursor], center=from+(at-start)*rate;
      const source=Math.floor(center)-half, fraction=center-Math.floor(center), displacement=center-last;
      for (const [channel,row] of buffers.entries()) {
        const {real,imag,mag,angles}=row;
        imag.fill(0);
        for (let i=0;i<n;i++) real[i]=weights[i]*(sample(source+i,channel)*(1-fraction)+
          sample(source+i+1,channel)*fraction);
        transform(real,imag,0,1,-1);
        for (let k=0;k<bins;k++) {
          angles[k]=Math.atan2(imag[k],real[k]);
          mag[k]=Math.hypot(real[k],imag[k]);
        }
      }
      for (let k=0;k<bins;k++) {
        const omega=k*binAngle, angle=ref.angles[k];
        phase[k]=at===0 ? angle :
          wrap(phase[k]+(omega+wrap(angle-previous[k]-omega*displacement)/displacement)*hop);
        previous[k]=angle;
      }
      lockPhases(ref.mag,ref.angles,phase,locked);
      const begin=at-half, low=Math.max(0,-begin), high=Math.min(n,target-begin);
      for (let i=low;i<high;i++) norm[begin+i]+=weights[i]**2;
      for (const [channel,{real,imag,mag,angles}] of buffers.entries()) {
        for (let k=0;k<bins;k++) {
          const angle=locked[k]+angles[k]-ref.angles[k];
          real[k]=mag[k]*Math.cos(angle);
          imag[k]=k===0 || k===half ? 0 : mag[k]*Math.sin(angle);
          if (k>0 && k<half) { real[n-k]=real[k]; imag[n-k]=-imag[k]; }
        }
        transform(real,imag,0,1,1);
        for (let i=low;i<high;i++) out[(begin+i)*channels+channel]+=real[i]*weights[i]/n;
      }
      last=center;
    }
    for (let frame=0;frame<target;frame++) for (let c=0;c<channels;c++) {
      const index=frame*channels+c;
      out[index]=norm[frame]>1e-8 ? out[index]/norm[frame] : 0;
    }
  }
  A.warpTones=warpTones;
})(KIT.procedural);
