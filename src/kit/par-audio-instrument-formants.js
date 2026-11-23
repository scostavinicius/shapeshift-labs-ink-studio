/* Shift a smoothed log spectral envelope without moving the harmonic carriers. */
(function (P) {
  const S=P.mediaGraphSupport, {check}=P.musicInstruments;
  function formants(source,scale,fundamental) {
    const {samples,channels,sampleRate}=source, frames=samples.length/channels;
    const size=Math.max(256,Math.min(4096,2**Math.round(Math.log2(sampleRate*.046))));
    const half=size/2,hop=size/4;
    check((Math.ceil(frames/hop)+4)*size*Math.log2(size)*channels*4<=5e8,
      'Formant shaping exceeds its FFT budget');
    const {weights,transform}=S.fftSetup(source,{size},size,channels);
    const cutoff=Math.min(half/8,Math.max(3,Math.round(sampleRate*.68/Math.max(125,fundamental))));
    const data=new Float64Array(samples.length), norm=new Float64Array(frames);
    const spectra=Array.from({length:channels},()=>[new Float64Array(size),new Float64Array(size)]);
    const envelope=new Float64Array(size), scratch=new Float64Array(size);
    for (let at=-half+hop;at<frames+half;at+=hop) {
      const start=at-half, lo=Math.max(0,-start),hi=Math.min(size,frames-start);
      for (let i=lo;i<hi;i++) norm[start+i]+=weights[i]**2;
      for (let ch=0;ch<channels;ch++) {
        const [re,im]=spectra[ch];
        im.fill(0);
        for (let i=0;i<size;i++) re[i]=(samples[(start+i)*channels+ch] ?? 0)*weights[i];
        transform(re,im,0,1,-1);
      }
      let peak=0;
      for (let k=0;k<=half;k++) {
        let energy=0;
        for (const [re,im] of spectra) energy+=re[k]**2+im[k]**2;
        envelope[k]=Math.sqrt(energy/channels);
        peak=Math.max(peak,envelope[k]);
      }
      scratch.fill(0);
      for (let k=0;k<=half;k++) {
        envelope[k]=Math.log(Math.max(1e-9,peak*.0008,envelope[k]));
        if (k>0 && k<half) envelope[size-k]=envelope[k];
      }
      transform(envelope,scratch,0,1,1);
      for (let i=0;i<size;i++) {
        const q=Math.min(i,size-i);
        const weight=q<cutoff ? .5+.5*Math.cos(Math.PI*q/cutoff) : 0;
        envelope[i]*=weight/size;
        scratch[i]*=weight/size;
      }
      transform(envelope,scratch,0,1,-1);
      for (let k=0;k<=half;k++) {
        const position=Math.min(half,k/scale), left=Math.floor(position);
        const logLevel=envelope[left]+(position-left)*((envelope[left+1] ?? envelope[left])-envelope[left]);
        const gain=Math.exp(Math.max(-2.05,Math.min(2.05,logLevel-envelope[k])));
        for (const [re,im] of spectra) {
          re[k]*=gain;im[k]*=gain;
          if (k>0 && k<half) {re[size-k]=re[k];im[size-k]=-im[k];}
        }
      }
      for (let ch=0;ch<channels;ch++) {
        const [re,im]=spectra[ch];
        transform(re,im,0,1,1);
        for (let i=lo;i<hi;i++) data[(start+i)*channels+ch]+=re[i]*weights[i]/size;
      }
    }
    for (let i=0;i<data.length;i++) data[i]/=Math.max(1e-12,norm[Math.floor(i/channels)]);
    return data;
  }
  S.instrumentFormants=formants;
})(KIT.procedural);
