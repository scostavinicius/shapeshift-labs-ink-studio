/* Measurements on the rendered mix and aligned stems, addressed on the score grid. */
(function (P) {
  const A=P.musicProduction, T=P.takeTime, S=P.mediaGraphSupport;
  const sum=values=>values.reduce((total,value)=>total+value,0);
  const round=(value,digits=4)=>Number(value.toFixed(digits));
  const powerDb=value=>value>0 ? round(10*Math.log10(value),3) : null;

  function address(score,rate,fromBeat,toBeat) {
    const samples=beat=>{
      const time=score.clock.timeAt({beat});
      return T.index(T.roundDown(T.mul(T.read(time),[BigInt(rate),1n])));
    };
    const firstSample=samples(fromBeat), endSample=samples(toBeat);
    return {fromBeat,toBeat,firstSample,endSample,start:firstSample/rate,end:endSample/rate};
  }

  function segment(audio,first,end) {
    return {...audio,samples:audio.samples.slice(first*audio.channels,end*audio.channels)};
  }

  function stats(audio) {
    const {samples,channels}=audio, frames=samples.length/channels;
    let left=0,right=0,cross=0,peak=0,clippedFrames=0,peakOffset=0;
    for (let i=0;i<frames;i++) {
      const l=samples[i*channels],r=channels===2 ? samples[i*channels+1] : l;
      left+=l*l;
      right+=r*r;
      cross+=l*r;
      const magnitude=Math.max(Math.abs(l),Math.abs(r));
      clippedFrames+=Number(magnitude>1);
      if (magnitude>peak) {peak=magnitude;peakOffset=i;}
    }
    const stereo=(left+right)*.5, mono=Math.max(0,(left+right+2*cross)*.25);
    const truePeak=S.mixerPeak.peak(samples,channels);
    const loudness=A.loudness(audio);
    return {samplePeakDbFS:powerDb(peak**2),truePeakDbTP:powerDb(truePeak**2),clippedFrames,
      peakOffset:peak>0 ? peakOffset : null,integratedLufs:loudness===null ? null : round(loudness,3),
      rmsDbFS:powerDb(stereo/Math.max(1,frames)),correlation:left && right ?
        round(Math.max(-1,Math.min(1,cross/Math.sqrt(left*right)))) : null,
      monoLossDb:stereo>0 ? powerDb(mono/stereo) : null,monoNull:stereo>0 && mono<=stereo*1e-10};
  }

  function spectra(audio,bounds,centers) {
    const {samples,sampleRate,channels}=audio, {parametricBand}=S;
    return centers.map(hz=>{
      const band=parametricBand('bandpass',sampleRate,()=>hz,()=>.88,()=>0), output=[0,0];
      const values=new Float64Array(bounds.length-1);
      let first=0, energy=0;
      for (let frame=0;frame<bounds.at(-1);frame++) {
        while (first<values.length-1 && frame>=bounds[first+1]) {
          values[first]=energy/Math.max(1,bounds[first+1]-bounds[first]);
          energy=0;
          first++;
        }
        const l=samples[frame*channels], r=channels===2 ? samples[frame*channels+1] : l;
        band(l,r,frame,output);
        energy+=(output[0]**2+output[1]**2)*.5;
      }
      values[first]=energy/Math.max(1,bounds[first+1]-bounds[first]);
      return values;
    });
  }

  function masking(leadPower,otherPower,centers) {
    const powers=leadPower.map(row=>sum(row)), total=sum(powers), peak=Math.max(...powers);
    if (total<1e-7) return null;
    let active=0,covered=0,overlap=0;
    const bands=leadPower.flatMap((row,i)=>{
      if (powers[i]<.045*peak) return [];
      const other=otherPower[i];
      let target=0, rival=0;
      for (let frame=0;frame<row.length;frame++) {
        if (row[frame]<Math.max(1e-7,powers[i]/row.length*.09)) continue;
        const l=row[frame], r=other[frame];
        target+=l;
        rival+=r;
        covered+=r>=l*.25 ? l : 0;
        overlap+=Math.min(l,r);
      }
      active+=target;
      return target>0 ? [{centerHz:centers[i],leadDbFS:powerDb(target/row.length),
        otherDbFS:powerDb(rival/row.length),otherOverLeadDb:powerDb(rival/target)}] : [];
    });
    return active>0 ? {coverage:round(covered/active),overlap:round(overlap/active),bands} : null;
  }

  function repeats(windows) {
    const pairs=[];
    for (const length of [1,2,4]) {
      for (let a=0;a+2*length<=windows.length;a++) {
        const first=windows.slice(a,a+length);
        if (first.some(row=>row.range.toBeat-row.range.fromBeat<.99999)) continue;
        const left=first.flatMap(row=>row.signature);
        for (let b=a+length;b+length<=windows.length;b++) {
          const second=windows.slice(b,b+length);
          if (second.some(row=>row.range.toBeat-row.range.fromBeat<.99999)) continue;
          const right=second.flatMap(row=>row.signature);
          const aPower=sum(left.map(x=>x*x)), bPower=sum(right.map(x=>x*x));
          if (Math.min(aPower,bPower)<.0004 || Math.min(aPower,bPower)<.12*Math.max(aPower,bPower)) continue;
          const similarity=sum(left.map((value,i)=>value*right[i]))/Math.sqrt(aPower*bPower);
          if (similarity>=.91) pairs.push({beats:length,similarity:round(similarity),
            first:{...first[0].range,toBeat:first.at(-1).range.toBeat,endSample:first.at(-1).range.endSample,end:first.at(-1).range.end},
            second:{...second[0].range,toBeat:second.at(-1).range.toBeat,endSample:second.at(-1).range.endSample,end:second.at(-1).range.end}});
        }
      }
    }
    return pairs.sort((a,b)=>b.beats-a.beats || b.similarity-a.similarity)
      .filter((row,i,rows)=>!rows.slice(0,i).some(old=>old.first.fromBeat<=row.first.fromBeat &&
        old.first.toBeat>=row.first.toBeat && old.second.fromBeat<=row.second.fromBeat && old.second.toBeat>=row.second.toBeat))
      .slice(0,6);
  }

  function measure(score,range,focus,lead,layers,sampleRate,rendered) {
    const requestedStart=score.clock.timeAt({beat:range.fromBeat}), requestedEnd=score.clock.timeAt({beat:range.toBeat});
    const {value,stems,report}=rendered ?? A.renderCompiled(score,{start:requestedStart,end:requestedEnd,sampleRate,stems:true});
    const context=rendered ? range : address(score,sampleRate,range.fromBeat,range.toBeat);
    const anchors=new Map([context,focus].flatMap(row=>[[row.fromBeat,row.firstSample],[row.toBeat,row.endSample]]));
    const at=(a,b)=>{
      const raw=address(score,sampleRate,a,b), firstSample=anchors.get(a) ?? raw.firstSample;
      const endSample=anchors.get(b) ?? raw.endSample;
      return {...raw,firstSample,endSample,start:firstSample/sampleRate,end:endSample/sampleRate};
    };
    const whole=stats(value), centers=[95,260,700,1800,Math.min(4600,Math.round(sampleRate*.39))];
    const points=[...new Set([range.fromBeat,focus.fromBeat,focus.toBeat,range.toBeat])].sort((a,b)=>a-b);
    const rows=[];
    for (let i=0;i<points.length-1;i++) for (let beat=points[i];beat<points[i+1]-1e-8;beat+=1) {
      const end=Math.min(beat+1,points[i+1]);
      const range=at(beat,end);
      const relative=range.firstSample-report.firstSample, frames=range.endSample-range.firstSample;
      if (frames<8) continue;
      const bounds=Array.from({length:9},(_,i)=>at(beat,i===8 ? end : beat+(end-beat)*i/8).endSample-range.firstSample);
      const mix=segment(value,relative,relative+frames), mixBands=spectra(mix,bounds,centers);
      const leadAudio=lead && segment(stems[lead],relative,relative+frames);
      const leadPower=leadAudio && spectra(leadAudio,bounds,centers);
      const overlap=leadPower ? layers.flatMap(name=>{
        const candidate=masking(leadPower,spectra(segment(stems[name],relative,relative+frames),bounds,centers),centers);
        return candidate ? [{track:name,...candidate}] : [];
      }).sort((a,b)=>b.overlap-a.overlap) : [];
      const measured=stats(mix);
      rows.push({range,mix:{...measured,peakSample:measured.peakOffset===null ? null : range.firstSample+measured.peakOffset},
        masking:overlap,signature:mixBands.flatMap(band=>Array.from(band,value=>Math.sqrt(value)))});
    }
    return {value,stems,report:{sampleRate,context,focus:rendered ? focus : address(score,sampleRate,focus.fromBeat,focus.toBeat),
      mix:whole,windows:rows.map(({signature,...row})=>row),repeats:repeats(rows)}};
  }

  function snippets(measurement,lead,layer,bass) {
    const {value,stems,report}=measurement, {context,focus,sampleRate}=report;
    const audio={}, ranges={};
    const add=(id,input,range)=>{
      audio[id]=segment(input,range.firstSample-context.firstSample,range.endSample-context.firstSample);
      ranges[id]=range;
    };
    add('focus',value,focus);
    if (context.firstSample<focus.firstSample) add('lead-in',value,{...context,
      toBeat:focus.fromBeat,endSample:focus.firstSample,end:focus.start});
    const hot=report.windows.filter(row=>row.range.fromBeat>=focus.fromBeat && row.range.toBeat<=focus.toBeat)
      .sort((a,b)=>(b.masking.find(row=>row.track===layer)?.overlap ?? 0)-
        (a.masking.find(row=>row.track===layer)?.overlap ?? 0))[0];
    if (hot?.masking.some(row=>row.track===layer && row.overlap>=.25)) add('overlap',value,hot.range);
    if (report.repeats.length) {
      add('repeat-a',value,report.repeats[0].first);
      add('repeat-b',value,report.repeats[0].second);
    }
    for (const [role,track] of Object.entries({lead,layer,bass})) if (track) add(role,stems[track],focus);
    const peak=Math.max(...Object.values(audio).map(strip=>
      S.mixerPeak.peak(strip.samples,strip.channels)));
    const gain=Math.min(1,.89125/Math.max(peak,1e-10));
    if (gain<1) for (const strip of Object.values(audio)) strip.samples=strip.samples.map(x=>x*gain);
    const strip=audio.focus, mono=new Float32Array(strip.samples.length/2);
    for (let i=0;i<mono.length;i++) mono[i]=(strip.samples[2*i]+strip.samples[2*i+1])*.5;
    audio.mono={sampleRate,channels:1,samples:mono};
    ranges.mono=focus;
    return {audio,ranges,gain};
  }

  P.musicCritiqueEvidence=Object.freeze({address,measure,snippets,stats,segment});
})(KIT.procedural);
