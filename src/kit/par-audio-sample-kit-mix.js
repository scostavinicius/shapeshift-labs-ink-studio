/* Ordered pad inserts and shared, post-fader return chains. */
(function (P) {
  const {fields,finite,check,db}=P.musicInstruments;
  const schemas={
    gain:{db:[0,-60,18]},
    lowpass:{hz:[3200,20,24000]},
    highpass:{hz:[80,20,24000]},
    drive:{amount:[2,.1,12],mix:[1,0,1]},
    delay:{seconds:[.18,.01,1],feedback:[.3,0,.8],mix:[.35,0,1]}
  };

  function inserts(raw=[]) {
    check(Array.isArray(raw) && raw.length<=8,'Use up to eight kit inserts per channel');
    return Array.from(raw,effect=>{
      const type=effect?.type, schema=Object.hasOwn(schemas,type) && schemas[type];
      check(schema && fields(effect,['type',...Object.keys(schema)]),'Unknown kit insert or parameter');
      const values=Object.entries(schema).map(([key,[fallback,lo,hi]])=>{
        const value=effect[key] ?? fallback;
        check(finite(value,lo,hi),'Invalid '+type+' insert '+key);
        return [key,value];
      });
      return {type,...Object.fromEntries(values)};
    });
  }
  function tail(chain) {
    let time=0;
    for (const spec of chain) {
      if (spec.type==='delay' && spec.mix)
        time+=spec.seconds*(spec.feedback ? 1+Math.ceil(Math.log(.001)/Math.log(spec.feedback)) : 1);
      if (spec.type==='lowpass' || spec.type==='highpass') time+=Math.log(1000)/(2*Math.PI*spec.hz);
    }
    return time;
  }
  function delay(data,rate,spec) {
    if (!spec.mix) return;
    const line=new Float64Array(2*Math.max(1,Math.round(spec.seconds*rate)));
    let at=0;
    for (let i=0;i<data.length;i++) {
      const dry=data[i], wet=line[at];
      line[at]=dry+wet*spec.feedback;
      data[i]=dry*(1-spec.mix)+wet*spec.mix;
      if (++at===line.length) at=0;
    }
  }
  const poleAt=(hz,rate)=>1-Math.exp(-2*Math.PI*Math.min(hz,.49*rate)/rate);
  function filter(data,rate,spec) {
    const pole=poleAt(spec.hz,rate), state=[0,0];
    const high=spec.type==='highpass';
    for (let i=0;i<data.length;i++) {
      const ch=i%2, dry=data[i];
      state[ch]+=(dry-state[ch])*pole;
      data[i]=high ? dry-state[ch] : state[ch];
    }
  }
  function process(data,rate,chain) {
    for (const spec of chain) {
      if (spec.type==='delay') delay(data,rate,spec);
      else if (spec.type==='lowpass' || spec.type==='highpass') filter(data,rate,spec);
      else if (spec.type==='gain') {
        const gain=db(spec.db);
        for (let i=0;i<data.length;i++) data[i]*=gain;
      } else {
        const norm=1/Math.tanh(spec.amount);
        for (let i=0;i<data.length;i++)
          data[i]=data[i]*(1-spec.mix)+Math.tanh(data[i]*spec.amount)*norm*spec.mix;
      }
    }
  }
  const gains=({gain,pan})=>[gain*Math.sqrt(1-pan),gain*Math.sqrt(1+pan)];
  function route(data,mix,returns,channel) {
    const [left,right]=gains(channel);
    for (let i=0;i<data.length;i+=2) {
      data[i]*=left;
      data[i+1]*=right;
      mix[i]+=data[i];
      mix[i+1]+=data[i+1];
    }
    for (const [name,level] of channel.sends) {
      const wet=returns[name];
      for (let i=0;i<data.length;i++) wet[i]+=data[i]*level;
    }
  }
  P.mediaGraphSupport.sampleKitMix={inserts,tail,process,route,gains,poleAt};
})(KIT.procedural);
