/* Sample-aligned dry/wet prints with portable take metadata and markers. */
(function (P) {
  const A=P.mediaGraph, {fields,record,id,integer,check}=P.musicInstruments;
  const variants=['dry','wet'];
  const keys=['target','chain','inputs','assets'];
  const hash=value=>typeof value==='string' && /^[0-9a-f]{64}$/.test(value);
  function editDocument(entry,markers) {
    const {id,sampleRate,channels,frames,asset}=entry;
    return A.sampleEdit.validate({format:'ink-studio/sample-edit',version:1,
      source:{id,sampleRate,channels,frames,...(asset!==undefined && {asset})},
      markers,clips:[{id:'original',from:0,to:frames}],joins:[]});
  }
  function metadata(raw,entry) {
    check(fields(raw,['version','take','seed','time','projectHash','markers',...keys]) &&
      raw.version===1 && variants.includes(raw.take) && Number.isSafeInteger(raw.seed) &&
      Number.isFinite(raw.time) && (raw.projectHash===undefined || hash(raw.projectHash)) &&
      (raw.chain===undefined || Array.isArray(raw.chain) && raw.chain.length<=2000) &&
      ['target','inputs','assets'].every(key=>raw[key]===undefined || record(raw[key])),
    'Invalid audio print provenance');
    const print=P.data.clone(raw);
    check(JSON.stringify(print).length<=2e6,'Audio print provenance exceeds its JSON budget');
    return P.data.freeze({...print,markers:editDocument(entry,print.markers).markers});
  }

  function prepare(sources,settings,defaults={seed:0,time:0}) {
    check(fields(sources,variants) && Object.keys(sources).length &&
      fields(settings,['sample','range','markers','seed','time','source','projectHash','traces']) &&
      record(settings.sample) && id(settings.sample.id) && typeof settings.sample.label==='string' &&
      settings.sample.label.trim().length,'Expected audio print takes and sample metadata');
    const {sample,range={},markers=[],source,traces={},projectHash,
      seed=defaults.seed,time=defaults.time}=settings;
    check(fields(range,['firstSample','endSample']) && fields(traces,variants) &&
      Object.entries(traces).every(([take,trace])=>Object.hasOwn(sources,take) && fields(trace,keys)) &&
      fields(source ?? {},['reference']),'Invalid audio print range or graph references');
    const takes=variants.filter(name=>Object.hasOwn(sources,name)).map(name=>[name,A.audio(sources[name])]);
    const {sampleRate,channels,samples}=takes[0][1], frames=samples.length/channels;
    const {firstSample=0,endSample=frames}=range;
    check(takes.every(([,value])=>value.sampleRate===sampleRate) &&
      (range.endSample!==undefined || takes.every(([,value])=>value.samples.length/value.channels===frames)),
    'Paired prints need the same sample rate and an explicit end when tap lengths differ');
    check(integer(firstSample,0,frames-1) &&
      takes.every(([,value])=>integer(endSample,firstSample+1,value.samples.length/value.channels)),
    'Audio print range is outside a selected tap');
    check((endSample-firstSample)*takes.reduce((sum,[,value])=>sum+value.channels,0)<=32e6,
      'Audio print exceeds its PCM budget');
    check(Array.isArray(markers) && markers.length<=4096,'Invalid audio print markers');
    const local=Array.from(markers,row=>{
      check(record(row) && integer(row.at,firstSample,endSample-1),'Audio print marker is outside its source window');
      return {...row,at:row.at-firstSample};
    });
    const entries={}, audio={};
    for (const [name,value] of takes) {
      const trace=traces[name] ?? {}, {target}=trace;
      const tap=target?.output ?? target?.node ?? name;
      const entrySample=takes.length===1 ? sample : {...sample,id:sample.id+'-'+name,label:sample.label+' ('+name+')'};
      const capture=A.sampleCatalog.capture(value,{sample:entrySample,
        source:{kind:'graph',name:tap,...source},firstSample,endSample});
      entries[name]=A.sampleCatalog.entry({...capture.entry,print:{
        version:1,take:name,seed,time,...(projectHash!==undefined && {projectHash}),...trace,markers:local
      }});
      audio[name]=capture.value;
    }
    return {audio,entries,report:{sampleRate,firstSample,endSample,seed,time,takes:takes.map(([name])=>name)}};
  }

  A.audioPrint=Object.freeze({prepare,metadata,edit:entry=>editDocument(entry,entry.print.markers)});
})(KIT.procedural);
