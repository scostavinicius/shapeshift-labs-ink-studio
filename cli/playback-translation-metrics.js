/* Apply measured transfer power to the isolated cue's windowed spectrum. */
const {axis}=require('../src/fft.js');

const powerDb=value=>value>1e-24 ? 10*Math.log10(value) : null;
const ratioDb=(value,base)=>base>1e-24?powerDb(value/base):null;
const share=(value,total)=>total>1e-24?value/total:null;

function analysis(rate,impulseFrames) {
  const frames=Math.round(rate*.17);
  const size=2**Math.ceil(Math.log2(Math.max(frames,impulseFrames)));
  const transform=axis(size), bins=size/2+1, binHz=rate/size;
  const pair=()=>({real:new Float64Array(size),imag:new Float64Array(size)});
  const fft=({real,imag})=>transform(real,imag,0,1,-1);
  const magnitude=({real,imag},i)=>real[i]*real[i]+imag[i]*imag[i];

  function response(pcm,referenceHz) {
    const {samples,channels}=pcm;
    const power=Array.from({length:2},(_,ch)=>{
      const work=pair();
      for (let i=0;i<samples.length/channels;i++) work.real[i]=samples[i*channels+(channels===1?0:ch)];
      fft(work);
      return Float64Array.from({length:bins},(_,i)=>magnitude(work,i));
    });
    const first=Math.ceil(referenceHz[0]/binHz), stop=Math.ceil(referenceHz[1]/binHz);
    let sum=0;
    for (let i=first;i<stop;i++) sum+=power[0][i]+power[1][i];
    const mean=sum/(2*(stop-first));
    if (!(mean>1e-12)) throw new RangeError('Measured response has no usable energy in the reference band');
    const factor=1/mean, gain=Math.sqrt(factor);
    for (const row of power) for (let i=0;i<row.length;i++) row[i]*=factor;
    return {power,gain,calibrationGainDb:powerDb(factor)};
  }

  function spectrum(pcm,from,to) {
    const {samples,channels}=pcm, span=to-from, length=Math.min(frames,span);
    const blocks=1+Math.ceil((span-length)/Math.max(1,length/2));
    const work=[pair(),pair()], stereo=[new Float64Array(bins),new Float64Array(bins)], mono=new Float64Array(bins);
    const weight=Float64Array.from({length},(_,i)=>.5-.5*Math.cos(2*Math.PI*(i+.5)/length));
    for (let block=0;block<blocks;block++) {
      const first=blocks===1?from:from+Math.round(block*(span-length)/(blocks-1));
      for (const [ch,row] of work.entries()) {
        row.real.fill(0);row.imag.fill(0);
        for (let i=0;i<length;i++) row.real[i]=samples[(first+i)*channels+(channels===1?0:ch)]*weight[i];
        fft(row);
      }
      for (let i=0;i<bins;i++) {
        const factor=i===0||i===bins-1?1:2;
        stereo[0][i]+=factor*magnitude(work[0],i);
        stereo[1][i]+=factor*magnitude(work[1],i);
        const real=(work[0].real[i]+work[1].real[i])*.5, imag=(work[0].imag[i]+work[1].imag[i])*.5;
        mono[i]+=factor*(real*real+imag*imag);
      }
    }
    let square=0;
    for (let i=from*channels;i<to*channels;i++) square+=samples[i]**2;
    return {stereo,mono,rmsDbFS:powerDb(square/(span*channels))};
  }

  function bands(probe,bassHz,profile) {
    let total=0,bass=0;
    for (let i=Math.ceil(20/binHz);i<bins;i++) {
      const l=profile?.input==='mono'?probe.mono[i]:probe.stereo[0][i];
      const r=profile?.input==='mono'?probe.mono[i]:probe.stereo[1][i];
      const value=profile?.power? (l*profile.power[0][i]+r*profile.power[1][i])*.5 : (l+r)*.5;
      total+=value;
      if (i*binHz>=bassHz[0]&&i*binHz<bassHz[1]) bass+=value;
    }
    return {total,bass,bassShare:share(bass,total)};
  }

  function measure(probe,profile,settings,basis) {
    const {bassHz,minBassShare,minBassLossDb,minCueLossDb,minCueRmsDbFS}=settings;
    const original=bands(probe,bassHz), routed=bands(probe,bassHz,{input:profile.input});
    const heard=bands(probe,bassHz,profile);
    const bassResponseDb=ratioDb(heard.bass,routed.bass), responseDb=ratioDb(heard.total,routed.total);
    const routingBassDb=ratioDb(routed.bass,original.bass), routingDb=ratioDb(routed.total,original.total);
    const audible=probe.rmsDbFS!==null&&probe.rmsDbFS>=minCueRmsDbFS&&original.total>1e-24;
    const routedAudible=audible&&routingDb!==null&&probe.rmsDbFS+routingDb>=minCueRmsDbFS;
    const bassRisk=routedAudible&&original.bassShare>=minBassShare&&routed.bassShare>=minBassShare&&
      (bassResponseDb??-Infinity)<=-minBassLossDb&&(responseDb??-Infinity)<=-minCueLossDb;
    return {target:profile.id,status:!audible?'quiet-source':!routedAudible?'lost-in-routing':bassRisk?
      (basis==='isolated-stem'?'bass-risk':'needs-isolation'):'no-bass-flag',
      bassResponseDb,responseDb,routingBassDb,routingDb,sourceBassShare:original.bassShare,
      routedBassShare:routed.bassShare,translatedBassShare:heard.bassShare,
      bassAbsent:original.bass>1e-24&&heard.bass<=1e-24};
  }
  return {size,frames,response,spectrum,measure};
}

module.exports={analysis,powerDb};
