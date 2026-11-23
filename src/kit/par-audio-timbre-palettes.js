/* Stock sounds for translating a recorded gesture into a playable ensemble. */
(function (P) {
  const A=P.mediaGraph,{check,fields,integer}=P.musicInstruments;
  const names=Object.freeze(['coastal','metal-breath','broken-beat']);
  function load(name,options={}) {
    check(names.includes(name) && fields(options,['sampleRate','seed']) && integer(options.sampleRate ?? 24000,8000,96000) &&
      Number.isSafeInteger(options.seed ?? 0),'Choose coastal, metal-breath or broken-beat timbres');
    const {sampleRate=24000,seed=0}=options;
    const {instrumentPresets:stock}=P.musicProduction;
    const assets={};
    const baked=(id,model,duration,parameters)=>{
      const key='timbre-'+name+'-'+id;
      assets[key]=A.synthesizeGesture({model,duration,sampleRate,parameters,
        seed:P.data.hash(key,seed),room:0}).value;
      return key;
    };
    let patches, room;
    if (name==='coastal') {
      const tap=baked('tap','metal',.35,{body:371,hardness:.27,decay:.17,strike:.29});
      patches={contour:{...stock['glass-reed'],echo:{delay:.312,feedback:.32,damping:.52,width:.68,send:.21}},
        attacks:{type:'sample',zones:[{samples:[tap],gain:-6}]},
        tail:{type:'subtractive',saw:.28,pulse:.29,sub:.12,pulseWidth:.4,pwm:{depth:.13,rate:.48},
          filter:{cutoff:1100,envAmount:12,resonance:1.05},env:{attack:.26,decay:.87,sustain:.54,release:.54}},
        bass:stock['coast-bass'],bed:stock['smoked-tines'],kick:{type:'drum',kind:'kick',tune:46,decay:.26},
        hats:{type:'drum',kind:'hat',tune:510,decay:.064,color:.64}};
      room={gain:-14,size:1.28,decay:1.17,damping:.56};
    } else if (name==='metal-breath') {
      const strike=baked('strike','metal',.71,{body:231,hardness:.75,decay:.57,strike:.67});
      const alternate=baked('alt','metal',.60,{body:325,hardness:.52,decay:.39,strike:.34});
      const breath=baked('air','breath',2.28,{pitchStart:220,pitchEnd:220,voice:.47,throat:940});
      patches={contour:{type:'fm',ratio:1.414,index:2.2,indexDecay:.43,body:.21,width:8,grain:.125,
        env:{attack:.034,decay:.31,sustain:.62,release:.33}},
      attacks:{type:'sample',zones:[{samples:[strike,alternate],levels:[-3,-5]}],performance:{}},
      tail:{type:'sample',env:{attack:.15,decay:.78,sustain:.66,release:.46},zones:[
        {samples:[breath],root:57,oneShot:false,gain:-3}]},
      bass:{type:'fm',ratio:1.5,index:.87,indexDecay:.49,body:.38,drive:1.22,
        env:{attack:.021,decay:.62,sustain:.46,release:.45}},
      bed:{type:'analog',width:13,grain:.14,body:.32,env:{attack:.43,decay:1.09,sustain:.61,release:.8}},
      kick:{type:'drum',kind:'metal',tune:92,decay:.41,color:.47,click:.28},
      hats:{type:'drum',kind:'brush',tune:490,decay:.22,color:.39,click:.27}};
      room={gain:-11,size:1.31,decay:1.06,damping:.76};
    } else {
      const contact=baked('rim','metal',.25,{body:578,hardness:.56,decay:.115,strike:.79});
      const cap=baked('cap','metal',.22,{body:443,hardness:.34,decay:.088,strike:.58});
      patches={contour:{...stock['smoked-tines'],bite:.82,tine:.67,
        env:{attack:.004,decay:.17,sustain:.16,release:.075}},
      attacks:{type:'sample',zones:[{samples:[contact,cap]}],performance:{}},
      tail:{type:'fm',ratio:2.58,index:2.8,indexDecay:.10,body:.11,grain:.05,
        env:{attack:.042,decay:.32,sustain:.28,release:.14}},
      bass:{type:'analog',body:.48,drive:1.66,env:{attack:.006,decay:.13,sustain:.48,release:.08}},
      bed:{type:'keys',tine:.61,bite:.45,dust:.087,wear:.18,
        env:{attack:.007,decay:.49,sustain:.28,release:.105}},
      kick:{type:'drum',kind:'kick',tune:54,decay:.135,sweep:103,click:.37},
      hats:{type:'drum',kind:'hat',tune:840,decay:.046,color:.78,click:.32}};
      room={gain:-31,size:.42,decay:.21,damping:.71};
    }
    return {id:name,patches:P.data.freeze(P.data.clone(patches)),assets,room};
  }
  A.timbrePalettes=Object.freeze({names,load});
})(KIT.procedural);
