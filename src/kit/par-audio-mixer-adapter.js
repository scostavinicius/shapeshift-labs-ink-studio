/* A mixer session references an adapter by name. The caller supplies its implementation. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,record,id,finite,integer,check}=P.musicInstruments;
  const paramId=key=>id(key) || /^(0|[1-9][0-9]{0,9})$/.test(key);
  function device(raw,rate,time,host,kind) {
    check(fields(raw,['type','adapter','plugin','state','identity','parameters',...(kind ? [] : ['wet'])]) &&
      id(raw.adapter) && id(raw.plugin) && (raw.state===undefined ||
        typeof raw.state==='string' && raw.state.length<=6e6) &&
      (raw.identity===undefined || typeof raw.identity==='string' && raw.identity.length<=256),
    'External audio device needs an adapter, a plugin alias and optional serialized state');
    const adapter=host?.adapters && Object.hasOwn(host.adapters,raw.adapter) && host.adapters[raw.adapter];
    check(adapter && typeof adapter.describe==='function' && typeof adapter.render==='function',
      'No registered audio adapter '+raw.adapter);
    const values=raw.parameters ?? {};
    check(record(values) && Object.keys(values).length<=64 && Object.keys(values).every(paramId),'Invalid external parameter table');
    const lanes=Object.entries(values).map(([key,value])=>[key,time.lane(value,0,-1e9,1e9,'external parameter '+key)]);
    const initial=Object.fromEntries(lanes.map(([key,lane])=>[key,lane.reader()(0)]));
    const request={plugin:raw.plugin,sampleRate:rate,state:raw.state,initial,...(kind && {kind})};
    const info=adapter.describe(request);
    check(fields(info,['latency','tail','sidechain','parameters','identity',...(kind ? ['notes'] : [])]) &&
      integer(info.latency,0,rate*2) && integer(info.tail,0,rate*60) &&
      typeof info.sidechain==='boolean' && (!kind || ['clap','midi'].includes(info.notes)) && record(info.parameters) &&
      typeof info.identity==='string' && info.identity.length>0 && info.identity.length<=256,
    'Adapter must declare bounded latency, tail, parameters and identity');
    check(raw.identity===undefined || raw.identity===info.identity,'External processor identity differs from the recalled version');
    const parameters=Object.fromEntries(lanes.map(([key,lane])=>{
      const parameter=Object.hasOwn(info.parameters,key) && info.parameters[key];
      check(fields(parameter,['min','max','automatable','stepped']) && finite(lane.min,parameter.min,parameter.max) &&
        finite(lane.max,parameter.min,parameter.max) &&
        (lane.points.length===1 || parameter.automatable===true) &&
        (!parameter.stepped || lane.curve==='hold' && lane.points.every(point=>Number.isInteger(point.value))),
      'Unsupported external parameter or automation '+key);
      return [key,{points:lane.points,curve:lane.curve}];
    }));
    return {...info,render({input,key,frames,notes,transport}) {
      const result=adapter.render({...request,identity:info.identity,input,key,frames,parameters,...(kind && {notes,transport}),
        latency:info.latency,tail:info.tail});
      check(result instanceof Float64Array && result.length===frames*2 && result.every(Number.isFinite),
        'External adapter returned a malformed or misaligned stereo buffer');
      return result;
    }};
  }
  function external(raw,rate,time,wet,host) {
    const processor=device(raw,rate,time,host);
    return {type:'external',latency:processor.latency,tail:wet.max===0 ? 0 : processor.tail,
      sidechain:processor.sidechain,wet,cost:28,block(input,output,key) {
        if (wet.max===0) return;
        output.set(processor.render({input,key,frames:output.length/2}));
        return {adapter:raw.adapter,plugin:raw.plugin,identity:processor.identity};
      }};
  }
  S.externalAudioDevice=device;
  S.externalMixerInsert=external;
})(KIT.procedural);
