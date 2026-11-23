/* Locate native solver samples and geometric gauge endpoints. */
(function(K){
  const W=K.world,{V}=K,{check,id,record,vector,selector,read,copy}=W.data;
  const {fields,finite,positive}=W.boundarySignals;
  const fieldName=n=>typeof n==='string'&&n.length>0&&n.length<=193;
  const missing=status=>({status:status??'missing',raw:null});
  const value=(raw,detail,status='ok')=>finite(raw)?{status,raw,detail}:missing();
  const inputs=(name,kind)=>kind==='event-counter'?'events.'+name:'in.'+name;
  const fromProbe=(query,{field,at,args,path})=>{
    if(!query)return missing();
    const result=query.probe(field,at,args);
    if(result.status!=='ok')return missing(result.status);
    const picked=path===undefined?result.value:read(result.value,path);
    return {status:'ok',picked};
  };

  function target(raw,label){
    if(vector(raw))return raw.slice();
    check(fields(raw,['point','entity','socket'])&&(vector(raw.point)&&raw.entity===undefined&&raw.socket===undefined||
      id(raw.entity)&&raw.point===undefined&&(raw.socket===undefined||id(raw.socket))), 'Invalid '+label+' selector');
    return copy(raw);
  }
  function field(raw,allowed){
    check(fields(raw,['kind','field','at','args','path',...allowed])&&fieldName(raw.field)&&
      (raw.args===undefined||record(raw.args)), 'Invalid sensor field source');
    return {field:raw.field,...(raw.at!==undefined&&{at:target(raw.at,'field target')}),
      ...(raw.args!==undefined&&{args:copy(raw.args)}),...(raw.path!==undefined&&{path:selector(raw.path).slice()})};
  }
  function endpoint(raw){
    if(!record(raw)||raw.field===undefined){
      const at=target(raw,'gauge endpoint');
      const point=Array.isArray(at)?at:at.point;
      return {fields:[],read:point?()=>point:query=>query?.target(at)?.point};
    }
    const descriptor=field(raw,['node']), {node}=raw;
    check(raw.kind===undefined&&(node===undefined||Number.isSafeInteger(node)&&node>=0&&node<=65535),
      'Invalid sensor geometry node');
    return {fields:[descriptor.field],read(query){
      const {picked,status}=fromProbe(query,descriptor);
      if(status!=='ok')return undefined;
      if(node===undefined)return vector(picked)?picked:undefined;
      const at=node*3, point=(Array.isArray(picked)||ArrayBuffer.isView(picked))&&picked.length>=at+3?
        Array.from(picked.slice(at,at+3)):null;
      return vector(point)?point:undefined;
    }};
  }

  function prepare(name,kind,source){
    const type=source?.kind, counter=kind==='event-counter';
    if(type==='input'){
      check(fields(source,['kind','port'])&&(source.port===undefined||id(source.port)),'Invalid sensor input source');
      const port=source.port??inputs(name,kind);
      return {type,port,fields:[],read:ctx=>counter?ctx.inputs?.[port]:value(ctx.inputs?.[port])};
    }
    if(type==='world-events'){
      check(counter&&fields(source,['kind']),'World event streams need an event counter');
      return {type,fields:[],read:ctx=>ctx.events};
    }
    if(type==='wave'){
      check(['microphone','pressure-tap','flow-meter'].includes(kind)&&fields(source,['kind','probe'])&&id(source.probe),
        'Wave sensors need a pressure or flow probe');
      const measure=kind==='flow-meter'?'flow':'pressure', probe=source.probe;
      return {type,measure,probe,fields:[],read:ctx=>value(ctx.wave?.[measure]?.[probe])};
    }
    check(!counter,'Event counter needs an input or world event stream');
    if(type==='field'){
      const descriptor=field(source,[]);
      return {type,fields:[descriptor.field],read(ctx){
        const row=fromProbe(ctx.query,descriptor);
        return row.status==='ok'?value(row.picked):row;
      }};
    }
    if(type==='geometry'){
      check(['displacement-probe','strain-gauge'].includes(kind)&&fields(source,['kind','from','to','axis','metersPerUnit','when'])&&
        positive(source.metersPerUnit??1)&&(source.axis===undefined||
          kind==='displacement-probe'&&vector(source.axis)&&positive(V.len(source.axis))),
      'Invalid geometry sensor source');
      const from=endpoint(source.from), to=endpoint(source.to), scale=source.metersPerUnit??1;
      const axis=source.axis===undefined?null:V.norm(source.axis);
      const condition=source.when===undefined?null:field(source.when,['equals']);
      if(condition)check(typeof source.when.equals==='boolean','Geometry sensor availability needs a boolean field value');
      const required=[...from.fields,...to.fields,...(condition?[condition.field]:[])];
      return {type,fields:required,read(ctx){
        if(condition){
          const seen=fromProbe(ctx.query,condition);
          if(seen.status!=='ok')return missing(seen.status);
          if(seen.picked!==source.when.equals)return missing('unavailable');
        }
        const a=from.read(ctx.query), b=to.read(ctx.query);
        if(!vector(a)||!vector(b))return missing();
        const difference=V.sub(b,a), distance=scale*(axis?V.dot(difference,axis):V.len(difference));
        return value(distance,{from:a.slice(),to:b.slice(),length:distance,...(axis&&{axis:axis.slice()})});
      }};
    }
    if(type==='acoustic'){
      check(kind==='microphone'&&fields(source,['kind','field','listener','emitter','band','sourceLevelDb','fromRoom','toRoom'])&&
        fieldName(source.field)&&['low','mid','high'].includes(source.band??'mid')&&
        (source.sourceLevelDb===undefined||finite(source.sourceLevelDb)&&source.sourceLevelDb>=-200&&source.sourceLevelDb<=250)&&
        [source.fromRoom,source.toRoom].every(n=>n===undefined||id(n)), 'Invalid acoustic microphone source');
      const at=target(source.listener,'microphone listener'), from=target(source.emitter,'microphone emitter');
      const {band='mid',sourceLevelDb,fromRoom,toRoom}=source;
      const args={from,band,...(sourceLevelDb!==undefined&&{sourceLevelDb}),...(fromRoom&&{fromRoom}),...(toRoom&&{toRoom})};
      const descriptor={field:source.field,at,args};
      return {type,fields:[source.field],read(ctx){
        const {picked,status}=fromProbe(ctx.query,descriptor);
        if(status!=='ok')return missing(status);
        if(!record(picked)||!finite(picked.gain))return missing();
        return value(picked.gain,{band,levelDb:picked.levelDb??null,delaySeconds:picked.delaySeconds??null,
          distanceMeters:picked.distanceMeters??null,apparentSource:picked.apparentSource??null},picked.status??'ok');
      }};
    }
    throw Error('Unknown sensor source on '+name);
  }

  W.sensorSources=Object.freeze({prepare,missing,value});
})(KIT);
