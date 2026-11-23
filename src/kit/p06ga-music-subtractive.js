/* Harmonic-limited oscillators and a resonant low-pass on each note. */
(function (P) {
  const I=P.musicInstruments,{fields,finite,check,clamp,envelope,level,options,phase,hz}=I;
  const tau=2*Math.PI, size=4096, mask=size-1, tables=new Map();
  const referenceHz=hz(60);
  let sineTable;

  function table(harmonics) {
    if (tables.has(harmonics)) return tables.get(harmonics);
    sineTable ??= Float64Array.from({length:size},(_,i)=>Math.sin(tau*i/size));
    const wave=new Float64Array(size), taper=Math.PI/(harmonics+1);
    // Lanczos weights smooth the discontinuity while holding the fundamental constant across bands.
    for (let harmonic=1;harmonic<=harmonics;harmonic++) {
      const amplitude=-2/Math.PI*Math.sin(harmonic*taper)/(harmonic*harmonic*Math.sin(taper));
      for (let i=0,at=0;i<size;i++,at=(at+harmonic)&mask) wave[i]+=amplitude*sineTable[at];
    }
    tables.set(harmonics,wave);
    return wave;
  }

  function reader(wave,turn) {
    const index=(turn-Math.floor(turn))*size, from=Math.floor(index), y=wave[from&mask];
    return y+(wave[(from+1)&mask]-y)*(index-from);
  }

  function sawBand(step) {
    const available=Math.max(1,.45/step);
    const harmonics=Math.min(1024,2**Math.floor(Math.log2(available)));
    const richest=table(harmonics);
    if (harmonics===1 || available>=2048) return turn=>reader(richest,turn);
    const thinner=table(harmonics/2), blend=clamp(available/harmonics-1);
    const smooth=blend*blend*(3-2*blend);
    return turn=>{
      const low=reader(thinner,turn);
      return low+(reader(richest,turn)-low)*smooth;
    };
  }

  function filterState(rate,mode,resonance) {
    let z1=0,z2=0,lastHz,lastQ,damping,g,a,b,c;
    return (input,hertz,q=resonance)=>{
      if (hertz!==lastHz || q!==lastQ) {
        lastHz=hertz;
        lastQ=q;
        damping=1/q;
        g=Math.tan(Math.PI*hertz/rate);
        a=1/(1+g*(g+damping));
        b=g*a;
        c=g*b;
      }
      const residual=input-z2;
      const band=a*z1+b*residual;
      const low=z2+b*z1+c*residual;
      z1=2*band-z1;
      z2=2*low-z2;
      return mode==='bandpass' ? band : mode==='highpass' ? input-damping*band-low : low;
    };
  }

  function settings(raw) {
    const {type,env,pwm={},filter={},...oscillators}=raw;
    const amp=envelope(env);
    const osc=options(oscillators,{saw:[.65,0,1],pulse:[.45,0,1],sub:[.20,0,1],pulseWidth:[.44,.02,.98],
      color:[.5,0,1]});
    const lfo=options(pwm,{depth:[0,0,.46],rate:[.55,.01,30],phase:[0,0,1]});
    check(osc.pulseWidth-lfo.depth>=.02-1e-9 && osc.pulseWidth+lfo.depth<=.98+1e-9,
      'Pulse-width modulation must stay within 2% to 98% duty');
    check(fields(filter,['bypass','cutoff','resonance','keyTrack','envAmount','velocity','env']) &&
      (filter.bypass===undefined || typeof filter.bypass==='boolean') &&
      (filter.env===undefined || fields(filter.env,['attack','decay','sustain','release'])),
      'Invalid subtractive filter or filter envelope');
    const {bypass=false,env:shape,...controls}=filter;
    const tone=options(controls,{cutoff:[1250,20,24000],resonance:[.88,.5,12],keyTrack:[.55,0,2],
      envAmount:[31,-84,84],velocity:[7,0,48]});
    const sweep=envelope({attack:.016,decay:.31,sustain:.24,release:.25,...shape});
    return {osc,lfo,amp,tone,sweep,bypass};
  }

  function compile(raw) {
    const {osc,lfo,amp,tone,sweep,bypass}=settings(raw);
    const norm=.76/Math.max(1,osc.saw+osc.pulse+osc.sub);
    return {prepare(note,rate,gate) {
      const {bend=0,glide=0,vibrato=0,brightness=osc.color}=note.play;
      const frequency=note.frequency*2**(bend/1200);
      const start=glide && note.fromFrequency ? note.fromFrequency : frequency;
      const vibratoHz=frequency*(2**(vibrato/1200)-1);
      const pitchMax=note.expression?.pitchMax ?? 1;
      const maximum=Math.max(frequency,start)+vibratoHz+frequency*Math.max(0,pitchMax-1);
      const widthSpeed=osc.pulse ? tau*lfo.depth*lfo.rate : 0;
      const saw=osc.saw || osc.pulse ? sawBand((maximum+widthSpeed)/rate) : null;
      const filter=bypass ? null : filterState(rate,'lowpass',tone.resonance);
      const ceiling=Math.min(24000,.46*rate);
      const cutoffBase=Math.log2(tone.cutoff)+tone.keyTrack*Math.log2(note.frequency/referenceHz)+
        (tone.velocity*(note.velocity-.65)+24*(brightness-.5))/12;
      const amount=tone.envAmount/12, gain=norm*note.velocity**.82;
      const highGuard=(maximum+widthSpeed)>.42*rate;
      return {duration:gate+amp.release,signal(t) {
        const turn=phase(note,t);
        const current=highGuard ? frequency+(glide ? (start-frequency)*Math.max(0,1-t/glide) : 0)+
          vibratoHz*Math.sin(t*tau*5.2) : 0;
        const edge=lfo.depth ? lfo.depth*Math.sin(tau*(lfo.rate*t+lfo.phase)) : 0;
        const guarded=current+frequency*Math.max(0,pitchMax-1);
        const guard=highGuard ? clamp((.49*rate-guarded-widthSpeed)/(.07*rate)) : 1;
        let sample=0;
        if (saw && guard) {
          const center=saw(turn);
          sample=guard*(osc.saw*center+
            (osc.pulse ? osc.pulse*(saw(turn-osc.pulseWidth-edge)-center) : 0));
        }
        const subGuard=highGuard ? clamp((.49*rate-guarded/2)/(.07*rate)) : 1;
        if (osc.sub && subGuard) sample+=osc.sub*subGuard*Math.sin(Math.PI*turn);
        if (filter) {
          const cutoff=Math.max(20,Math.min(ceiling,2**(cutoffBase+amount*level(sweep,t,gate))));
          sample=filter(sample,cutoff);
        }
        const out=sample*gain*level(amp,t,gate), magnitude=Math.abs(out);
        // Leave the normal range linear and keep very resonant settings bounded.
        return magnitude<=.85 ? out : Math.sign(out)*(.85+.15*(magnitude-.85)/(magnitude-.7));
      }};
    }};
  }

  function articulate(base,override) {
    return {
      ...base,...override,
      ...(override.env && {env:{...base.env,...override.env}}),
      ...(override.pwm && {pwm:{...base.pwm,...override.pwm}}),
      ...(override.filter && {filter:{...base.filter,...override.filter,
        ...(override.filter.env && {env:{...base.filter?.env,...override.filter.env}})}})
    };
  }

  P.musicSubtractive=Object.freeze({compile,articulate,sawBand,filterState});
})(KIT.procedural);
