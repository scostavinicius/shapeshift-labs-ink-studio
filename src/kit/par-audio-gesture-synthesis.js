/* Deterministic excitation and resonators for original sample-bank material. */
(function (P) {
  const A=P.mediaGraph,{fields,finite,integer,check}=P.musicInstruments;
  const tau=2*Math.PI, clamp=n=>Math.max(0,Math.min(1,n));
  const slew=(current,target,weight)=>current+(target-current)*weight;
  function noise(seed) {
    let state=(seed>>>0) || 0x6a09e667;
    return ()=>{
      state^=state<<13;
      state^=state>>>17;
      state^=state<<5;
      return (state>>>0)/2147483648-1;
    };
  }

  const {resonator}=InkContactPulse;

  const models={
    breath:{
      duration:.64,
      parameters:{pitchStart:[135,45,900],pitchEnd:[198,45,900],voice:[.62,0,1],roughTail:[.8,0,1],throat:[1060,380,2600]},
      create(rate,random,{pitchStart,pitchEnd,voice,roughTail,throat}) {
        const bands=[[throat*.58,.012,.55],[throat,.018,.32],[throat*2.18,.009,.19]].map(([hz,decay,gain])=>
          [resonator(rate,hz,decay),gain*tau*Math.min(hz,rate*.45)/rate]);
        const airWeight=1-Math.exp(-tau*3400/rate), driftWeight=1-Math.exp(-tau*32/rate);
        let phase=0,air=0,drift=0;
        return (i,u)=>{
          const cloud=random();
          air=slew(air,cloud,airWeight);
          drift=slew(drift,random(),driftWeight);
          const fray=roughTail*clamp((u-.61)/.31);
          const hz=pitchStart*(pitchEnd/pitchStart)**Math.min(1,u/.72)*(1+.045*drift);
          phase=(phase+hz/rate)%1;
          const vowel=Math.sin(tau*phase)+.35*Math.sin(tau*phase*2)-.16*Math.sin(tau*phase*3);
          const turbulence=.60*air+.40*cloud;
          const focused=voice*(1-fray);
          const excite=vowel*focused*.66+turbulence*(1-focused*.68);
          const color=bands.reduce((sum,[ring,gain])=>sum+gain*ring(excite),0);
          const envelope=clamp(i/(rate*.048))**1.5*clamp((1-u)*11)**1.15*(.83+.12*Math.sin(Math.PI*u));
          return envelope*(.25*excite+.22*color+.3*fray*turbulence);
        };
      }
    },
    scrape:{
      duration:.8,
      parameters:{speed:[.56,.05,1],pressure:[.68,.03,1],body:[420,90,1700],grain:[.65,0,1]},
      create(rate,random,{speed,pressure,body,grain}) {
        const modes=[[1,.034,.8],[2.43,.022,.45],[4.13,.015,.28]].map(([ratio,t60,gain])=>
          [resonator(rate,body*ratio,t60),gain]);
        let slip=0,drag=0,texture=0;
        const friction=1-Math.exp(-tau*(450+5000*grain)/rate);
        return (i,u)=>{
          const r=random(), travel=Math.sin(Math.PI*u), contact=travel**.54*(.72+.28*Math.sin(tau*(1.2*u+2*u*u)));
          texture=slew(texture,r,friction);
          slip+=((22+550*speed)*(.18+.82*travel)*(1+grain*r*.9))/rate;
          let strike=0;
          if (slip>=1) {
            slip-=1;
            strike=(.15+.85*Math.abs(r))*pressure*.22;
          }
          drag=slew(drag,texture,Math.min(1,1200/rate));
          const excite=strike+pressure*(texture-drag)*grain*.14;
          const reflex=modes.reduce((sum,[ring,gain])=>sum+gain*ring(excite*contact),0);
          return contact*(.38*reflex+texture*pressure*.34+strike*.5);
        };
      }
    },
    metal:{
      duration:.9,
      parameters:{body:[267,70,1800],hardness:[.62,0,1],decay:[.65,.08,2.5],strike:[.36,0,1]},
      create(rate,random,{body,hardness,decay,strike}) {
        const modes=[1,1.517,2.126,2.732,3.921,5.36,6.82,9.04].map((ratio,i)=>{
          const hz=body*ratio*(1+.009*random());
          const shape=Math.sin(Math.PI*(i+1)*(.11+.68*strike));
          const gain=shape*(.35+.65*hardness)**i/Math.sqrt(i+1);
          return {hz,ring:resonator(rate,hz,decay/(1+i*.48)),gain:gain*Math.sin(tau*hz/rate)};
        }).filter(mode=>mode.hz<rate*.46);
        const length=Math.round(rate*(.0012+.004*(1-hardness)));
        return (i,u)=>{
          const contact=i<length ? Math.sin(Math.PI*i/length)**2*(.55+.45*random())/length : 0;
          const ring=modes.reduce((sum,mode)=>sum+mode.gain*mode.ring(contact),0);
          return clamp((1-u)*40)*(.82*ring+contact*length*hardness*.26);
        };
      }
    }
  };

  function synthesize(options={}) {
    check(fields(options,['model','sampleRate','seed','duration','parameters','room']) &&
      Object.hasOwn(models,options.model),'Choose the breath, scrape or metal gesture model');
    const {model,sampleRate=24000,seed=0,parameters={},room=0}=options, spec=models[model];
    const duration=options.duration ?? spec.duration;
    check(integer(sampleRate,8000,96000) && Number.isSafeInteger(seed) && finite(duration,.04,5) &&
      finite(room,0,1) && fields(parameters,Object.keys(spec.parameters)),'Invalid gesture synthesis options');
    const state=Object.fromEntries(Object.entries(spec.parameters).map(([name,[fallback,min,max]])=>{
      const value=parameters[name] ?? fallback;
      check(finite(value,min,max),'Invalid gesture parameter '+name);
      return [name,value];
    }));
    const frames=Math.round(duration*sampleRate), samples=new Float64Array(frames);
    const tick=spec.create(sampleRate,noise(P.data.hash(model,seed)),state);
    let peak=0;
    for (let i=0;i<frames;i++) {
      samples[i]=tick(i,i/frames);
      peak=Math.max(peak,Math.abs(samples[i]));
    }
    const gain=Math.min(4,.78/(peak || 1));
    for (let i=0;i<frames;i++) samples[i]*=gain;
    const value={sampleRate,channels:1,samples};
    const perspectives={direct:value};
    if (room) {
      const reflected=new Float64Array(frames*2);
      const taps=[[.009,.17,.08],[.016,-.09,.19],[.031,.125,.08],[.047,.065,-.11],[.069,-.05,.07]];
      const delays=taps.map(([seconds,l,r])=>[Math.round(seconds*sampleRate),l,r]);
      let wall=0;
      const damping=1-Math.exp(-tau*1700/sampleRate), history=new Float64Array(frames);
      for (let i=0;i<frames;i++) {
        wall=slew(wall,samples[i],damping);
        history[i]=wall;
        const dry=samples[i]*(.73-room*.30);
        let l=dry,r=dry;
        for (const [delay,left,right] of delays) if (i>=delay) {
          l+=history[i-delay]*room*left;
          r+=history[i-delay]*room*right;
        }
        const fade=clamp((frames-i)/(sampleRate*.012));
        reflected[i*2]=l*fade;
        reflected[i*2+1]=r*fade;
      }
      perspectives.room={sampleRate,channels:2,samples:reflected};
    }
    return {value,perspectives,report:{version:1,model,sampleRate,seed,duration,parameters:state,room,frames}};
  }

  A.synthesizeGesture=synthesize;
})(KIT.procedural);
