/* Audition a bank and bake playable per-key zones for the production sampler. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,{fields,finite,integer,record,id,check}=P.musicInstruments,H=P.musicHarmony;
  const budget=8e6;
  const note=value=>integer(value,0,127) ? value : Math.round(H.midi(value));
  const cleanShape=(report,overrides)=>({
    attackFrames:Math.min(report.protectedFrames,report.frames-1),fundamentalHz:report.root?.hz ?? 180,
    mode:report.root ? 'tones' : 'speech',...overrides
  });

  function audition(assets,settings={}) {
    check(fields(settings,['analysis','offsets','gap','sampleRate','shape']) &&
      Array.isArray(settings.offsets ?? []) && integer((settings.offsets ?? [0]).length,1,17) &&
      (settings.offsets ?? []).every(x=>finite(x,-24,24)) && finite(settings.gap ?? .17,0,1) &&
      integer(settings.sampleRate ?? 32000,8000,96000) && record(settings.shape ?? {}),
    'Invalid instrument audition settings');
    const {offsets=[-7,-3,0,3,7],gap=.17,sampleRate=32000}=settings;
    const {takes}=S.analyzeInstrumentBank(assets,settings.analysis), rows=[], sounds=[];
    const quiet=Math.round(gap*sampleRate);
    let cursor=0;
    for (const [name,report] of Object.entries(takes)) for (const offset of offsets) {
      const {value,report:processing}=A.shapeInstrumentSample(assets[name],{
        ...cleanShape(report,settings.shape),pitchCents:100*offset+(settings.shape?.pitchCents ?? 0)
      });
      const step=value.sampleRate/sampleRate, frames=Math.ceil(processing.targetFrames/step);
      check((cursor+frames)*2<=budget,'Instrument range audition exceeds its PCM budget');
      const reader=S.pcmReader(value,0,processing.targetFrames,step);
      let peak=0;
      for (const x of value.samples) peak=Math.max(peak,Math.abs(x));
      const gain=peak>0 ? Math.min(4,.72/peak) : 1;
      sounds.push({reader,step,frames,start:cursor,gain});
      rows.push({take:name,offset,note:report.root ? report.root.suggestedNote+offset : null,firstSample:cursor,
        endSample:cursor+frames,gain,processing});
      cursor+=frames+quiet;
    }
    const samples=new Float64Array((cursor-quiet)*2), pair=[0,0];
    for (const {reader,step,frames,start,gain} of sounds) for (let i=0;i<frames;i++) {
      reader.read(i*step,pair);
      const edge=Math.min(1,i/Math.max(1,sampleRate*.003),(frames-i-1)/Math.max(1,sampleRate*.008)), j=(start+i)*2;
      samples[j]=pair[0]*gain*edge; samples[j+1]=pair[1]*gain*edge;
    }
    let peak=1;
    for (const x of samples) {
      check(Number.isFinite(x),'Invalid instrument audition PCM');
      peak=Math.max(peak,Math.abs(x));
    }
    if (peak>1) for (let i=0;i<samples.length;i++) samples[i]/=peak;
    return {value:{samples,channels:2,sampleRate},report:{sampleRate,takes,rows,headroom:1/peak}};
  }

  function build(assets,recipe) {
    check(fields(recipe,['analysis','env','zones']) && Array.isArray(recipe.zones) && integer(recipe.zones.length,1,48),
      'Give the instrument at least one labeled key zone');
    const {takes}=S.analyzeInstrumentBank(assets,recipe.analysis), names=new Set(), plan=[], zones=[], details=[];
    let size=0;
    for (const row of recipe.zones) {
      check(fields(row,['id','label','low','high','takes','root','roots','velocity','articulation','gain','shape']) &&
        id(row.id) && !names.has(row.id) && typeof (row.label ?? row.id)==='string' &&
        (row.label ?? row.id).trim().length>0 && (row.label ?? row.id).length<=120 &&
        Array.isArray(row.takes) && integer(row.takes.length,1,16) && new Set(row.takes).size===row.takes.length &&
        row.takes.every(key=>Object.hasOwn(takes,key)) && record(row.shape ?? {}) && record(row.roots ?? {}) &&
        Object.keys(row.roots ?? {}).every(key=>row.takes.includes(key)) &&
        (row.articulation===undefined || id(row.articulation)),
      'Invalid instrument zone, take or articulation');
      names.add(row.id);
      const low=note(row.low), high=note(row.high);
      check(integer(low,0,127) && integer(high,low,127) && zones.length+high-low+1<=96,'Instrument exceeds its keyed zone budget');
      const sourceRoots=Object.fromEntries(row.takes.map(name=>{
        const raw=Object.hasOwn(row.roots ?? {},name) ? row.roots[name] : row.root;
        const estimated=takes[name].root;
        if (raw===null || raw===undefined && estimated===null) return [name,null];
        return [name,raw===undefined ? estimated.midi : finite(raw,0,127) ? raw : H.midi(raw)];
      }));
      const start=zones.length;
      for (let key=low;key<=high;key++) {
        const samples=row.takes.map((name,i)=>{
          const report=takes[name], root=sourceRoots[name], id='zone-'+(details.length+1)+'-key-'+key+'-take-'+(i+1);
          const options=cleanShape(report,row.shape);
          options.pitchCents=(options.pitchCents ?? 0)+(root===null ? 0 : (key-root)*100);
          const duration=options.duration ?? 1;
          check(finite(duration,.5,2) && finite(options.pitchCents,-2400,2400),
            'Choose a valid duration or narrow the zone around its source root');
          size+=Math.max(1,Math.round(report.frames*duration))*report.channels;
          check(size<=budget && plan.length<128,'Baked instrument exceeds its audio budget');
          plan.push({id,name,key,zone:row.id,options});
          return id;
        });
        zones.push({low:key,high:key,root:key,samples,
          ...(row.velocity!==undefined && {velocity:row.velocity}),
          ...(row.articulation!==undefined && {articulation:row.articulation}),
          ...(row.gain!==undefined && {gain:row.gain})});
      }
      details.push({id:row.id,label:row.label ?? row.id,low,high,takes:row.takes,roots:sourceRoots,firstZone:start,
        ...(row.articulation!==undefined && {articulation:row.articulation})});
    }
    const baked={}, files=[];
    for (const {id,name,key,zone,options} of plan) {
      const {value,report}=A.shapeInstrumentSample(assets[name],options);
      baked[id]=value;
      files.push({asset:id,source:name,key,zone,processing:report});
    }
    const value={type:'sample',zones,...(recipe.env!==undefined && {env:recipe.env})};
    P.musicInstruments.compile(value,baked);
    return {value,assets:baked,report:{takes,zones:details,files}};
  }
  A.sampleInstrument=Object.freeze({analyze:S.analyzeInstrumentBank,audition,build});
})(KIT.procedural);
