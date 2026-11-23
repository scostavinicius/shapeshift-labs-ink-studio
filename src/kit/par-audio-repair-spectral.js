/* Local STFT attenuation or magnitude interpolation from surrounding clean audio. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,finite,integer,check,db}=P.musicInstruments;
  const ramp=x=>.5-.5*Math.cos(Math.PI*Math.max(0,Math.min(1,x)));
  function repairSpectrum(samples,channels,rate,raw) {
    check(Array.isArray(raw) && raw.length<=64,'Spectral repair needs a list of at most 64 patches');
    const frames=samples.length/channels;
    let work=0;
    return Array.from(raw,row=>{
      const {fromSample:from,toSample:to,lowHz,highHz,size=1024,mode='attenuate',amountDb=24}=row ?? {};
      check(fields(row,['fromSample','toSample','lowHz','highHz','size','mode','amountDb','fadeSamples','featherHz']) &&
        S.repairRange({fromSample:from,toSample:to},frames) && finite(lowHz,0,rate/2) && finite(highHz,0,rate/2) &&
        highHz>lowHz && integer(size,128,8192) && !(size&(size-1)) &&
        ['attenuate','interpolate'].includes(mode) && finite(amountDb,0,96),
      'Invalid spectral repair window, band, FFT size or reduction');
      const length=to-from, binHz=rate/size, half=size/2, hop=size/4;
      const {fadeSamples=Math.min(Math.floor(length/2),Math.round(rate*.008)),
        featherHz=Math.min(binHz*2,(highHz-lowHz)/4)}=row;
      check(integer(fadeSamples,0,Math.floor(length/2)) && finite(featherHz,0,(highHz-lowHz)/2),
        'Spectral feather must fit inside the time and frequency bounds');
      check(mode!=='interpolate' || from>=size && to+size<=frames,
        'Interpolated spectral repair needs a full clean reference window on each side');
      const first=Math.ceil(lowHz/binHz), last=Math.floor(highHz/binHz);
      const band=Float64Array.from({length:last-first+1},(_,i)=>{
        const hz=(first+i)*binHz;
        return featherHz ? ramp(Math.min(hz-lowHz,highHz-hz)/featherHz) : 1;
      });
      check(band.some(weight=>weight>0),'Spectral selection contains no active bins. Increase FFT size or widen the band');
      work+=(Math.ceil((length+size)/hop)+2)*size*Math.log2(size)*2*channels;
      check(work<=2.4e8,'Spectral repair exceeds its FFT workload');
      const {weights,transform}=S.fftSetup({sampleRate:rate},{size},size,channels);
      const re=new Float64Array(size), im=new Float64Array(size), correction=new Float64Array(length);
      const norm=new Float64Array(length), reduction=db(-amountDb);
      function window(center,ch) {
        im.fill(0);
        for (let i=0;i<size;i++) re[i]=(samples[(center-half+i)*channels+ch] ?? 0)*weights[i];
        transform(re,im,0,1,-1);
      }
      function magnitudes(center,ch) {
        window(center,ch);
        return band.map((_,i)=>Math.hypot(re[first+i],im[first+i]));
      }
      for (let ch=0;ch<channels;ch++) {
        const left=mode==='interpolate' ? magnitudes(from-half,ch) : null;
        const right=left && magnitudes(to+half,ch);
        correction.fill(0);
        norm.fill(0);
        for (let center=from-half+hop;center<to+half;center+=hop) {
          window(center,ch);
          const u=Math.max(0,Math.min(1,(center-from+half)/(length+size)));
          for (let k=0;k<=half;k++) {
            const weight=band[k-first] ?? 0;
            let gain=reduction;
            if (left && weight) {
              const i=k-first, context=left[i]+(right[i]-left[i])*u;
              gain=Math.max(reduction,Math.min(1,context/Math.max(1e-20,Math.hypot(re[k],im[k]))));
            }
            const delta=(gain-1)*weight;
            re[k]*=delta; im[k]*=delta;
            if (k>0 && k<half) {re[size-k]=re[k];im[size-k]=-im[k];}
          }
          im[0]=0;im[half]=0;
          transform(re,im,0,1,1);
          const begin=center-half-from;
          for (let i=Math.max(0,-begin);i<Math.min(size,length-begin);i++) {
            correction[begin+i]+=re[i]*weights[i]/size;
            norm[begin+i]+=weights[i]**2;
          }
        }
        for (let i=0;i<length;i++) {
          const gain=fadeSamples ? ramp(Math.min(i,length-1-i)/fadeSamples) : 1;
          samples[(from+i)*channels+ch]+=gain*correction[i]/Math.max(1e-12,norm[i]);
        }
      }
      return {fromSample:from,toSample:to,lowHz,highHz,size,fadeSamples,featherHz,mode,amountDb};
    });
  }
  S.repairSpectrum=repairSpectrum;
})(KIT.procedural);
