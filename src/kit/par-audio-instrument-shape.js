/* Independent pitch, length and spectral envelope with a pinned source attack. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,{check,fields,finite,integer}=P.musicInstruments;
  function shape(source,settings={}) {
    const pcm=S.instrumentAudio(source), {sampleRate,channels,samples}=pcm, frames=samples.length/channels;
    check(fields(settings,['pitchCents','duration','formantCents','attackFrames','joinFrames','mode','fundamentalHz']),
      'Unknown instrument shaping setting');
    const {pitchCents=0,duration=1,formantCents=0,attackFrames=0,
      fundamentalHz=180,mode='tones'}=settings;
    check(finite(pitchCents,-2400,2400) && finite(duration,.5,2) &&
      finite(formantCents,-1200,1200) && finite(fundamentalHz,25,3000) &&
      integer(attackFrames,0,frames) && ['tones','speech'].includes(mode),
    'Invalid instrument pitch, duration, formant, attack or quality mode');
    const target=Math.max(1,Math.round(frames*duration)), neutral=target===frames && pitchCents===0 && formantCents===0;
    const tailFrames=frames-attackFrames,outFrames=target-attackFrames;
    const {joinFrames=Math.max(0,Math.min(tailFrames,outFrames,Math.round(.013*sampleRate)))}=settings;
    check(integer(joinFrames,0,Math.min(tailFrames,Math.max(0,outFrames))) &&
      (neutral || tailFrames>0 && outFrames>0),'Attack and join must fit inside both source and target');
    const report={sampleRate,sourceFrames:frames,targetFrames:target,pitchCents,duration,formantCents,attackFrames,
      joinFrames,mode,bodyGain:1};
    if (neutral) return {value:{sampleRate,channels,samples:Float64Array.from(samples)},report};
    const pitch=2**(pitchCents/1200), intermediate=Math.max(1,Math.round(outFrames*pitch));
    // A pure formant edit stays on the source clock, independently of transposition.
    const before={sampleRate,channels,samples:Float64Array.from(samples.slice(attackFrames*channels))};
    const stretch=intermediate!==tailFrames ? A.warpAudio(before,{mode,targetFrames:intermediate}).value : before;
    const shifted=intermediate!==outFrames ? A.warpAudio(stretch,{mode:'repitch',targetFrames:outFrames}).value : stretch;
    const envelope=2**((formantCents-pitchCents)/1200);
    const body=envelope===1 ? shifted.samples : S.instrumentFormants(shifted,envelope,fundamentalHz*pitch);
    const out=new Float64Array(target*channels);
    let peak=1;
    for (const x of body) {
      check(Number.isFinite(x),'Instrument shaping produced nonfinite audio');
      peak=Math.max(peak,Math.abs(x));
    }
    report.bodyGain=1/peak;
    for (let i=0;i<attackFrames*channels;i++) out[i]=samples[i];
    for (let i=0;i<outFrames;i++) {
      const blend=i<joinFrames ? .5-.5*Math.cos(Math.PI*i/joinFrames) : 1;
      for (let ch=0;ch<channels;ch++) {
        const j=i*channels+ch, old=blend===1 ? 0 : before.samples[j];
        out[attackFrames*channels+j]=old*(1-blend)+body[j]*report.bodyGain*blend;
      }
    }
    return {value:{sampleRate,channels,samples:out},report};
  }
  A.shapeInstrumentSample=shape;
})(KIT.procedural);
