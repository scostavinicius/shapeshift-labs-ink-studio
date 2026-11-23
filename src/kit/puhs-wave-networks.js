/* Run deterministic wave blocks with portable pressure, flow and delay memory. */
(function(K){
  const W=K.world, T=W.waveTopology, {check,record,equal,own}=W.data;
  const {integer,array,finite}=T, {freeze}=K.procedural.data;
  const runFormat='ink-studio/wave-run', traceFormat='ink-studio/wave-trace', checkpointFormat='ink-studio/wave-checkpoint';
  function numbers(value,count){
    if(!array(value)||value.length!==count)return false;
    for(let i=0;i<count;i++)if(!finite(value[i]))return false;
    return true;
  }

  function prepare(domain,settings={},{diagnostics}={}){
    const spec=T.compile(domain,settings), {sources,probes,sampleRate,method,maxWork,identity}=spec;
    let review=diagnostics===undefined?null:W.diagnostics.create(diagnostics);
    const engine=method==='distributed'?W.waveDistributed(spec,review):W.waveDelay(spec,review);
    const connections=review&&spec.nodes.map(node=>({kind:'connection',node:node.name}));
    function observer(block){
      return (pressure,outward,through,input,time)=>{
        for(let i=0;i<spec.nodes.length;i++){
          const {outside,source,pressureSource,released}=spec.nodes[i];
          if(pressureSource||released)continue;
          const incoming=source<0?0:input[source], load=outside*pressure[i];
          block.error('wave-flow-balance',outward[i]+load-incoming,Math.max(through[i],Math.abs(load),Math.abs(incoming)),
            connections[i],time);
        }
      };
    }
    const probePressure=new Float64Array(probes.length), probeFlow=new Float64Array(probes.length);
    const buffers={...engine.buffers,probePressure,probeFlow};
    const views=Object.entries(buffers).map(([name,value])=>({name,value,saved:new Float64Array(value.length)}));
    const keys=new Set(sources.map(row=>row.name)), level=new Float64Array(sources.length);
    const workPerSample=engine.workPerSample+spec.driveWork+(review?engine.reviewWork:0);
    const info=freeze({method,sampleRate,soundSpeed:spec.soundSpeed,density:spec.density,domain:identity,
      nodes:spec.named,tubes:spec.tubeCount,sections:spec.segments.length,workPerSample,maxWork,
      ...(spec.conditions&&{boundarySet:spec.conditions.asset}),
      sources:sources.map(({name,kind})=>({name,kind})),probes:probes.map(({name})=>name),...engine.info});
    const planning=review;
    if(review)review=planning.fork();
    review?.merge(planning);
    let sample=0, reviewStart=0;

    function resetReview(){
      if(planning){
        review=planning.fork();
        review.merge(planning);
        reviewStart=sample;
      }
    }

    function process(count,{inputs={},collect=true}={}){
      check(integer(count,0,65536)&&sample+count<=Number.MAX_SAFE_INTEGER&&typeof collect==='boolean',
        'Wave block needs a bounded sample count');
      check(count*workPerSample<=maxWork,'Wave block exceeded the work limit; split it into smaller blocks');
      check(!collect||count*probes.length<=1000000,'Wave block exceeded its collected sample budget');
      check(record(inputs)&&Object.keys(inputs).every(name=>keys.has(name)),'Invalid wave input channels');
      const supplied=sources.map(({name})=>{
        const value=own(inputs,name)?inputs[name]:spec.defaults?.[name]??0;
        check(typeof value==='function'&&!own(inputs,name)||finite(value)||numbers(value,count),
          'Wave input '+name+' needs a finite level or one value per sample');
        return value;
      });
      const pressure=collect?probes.map(()=>new Float64Array(count)):null;
      const flow=collect?probes.map(()=>new Float64Array(count)):null;
      if(count){
        const block=review?.fork(), observe=block&&observer(block);
        for(const {value,saved} of views)saved.set(value);
        try{
          for(let i=0;i<count;i++){
            for(let j=0;j<level.length;j++){
              const drive=supplied[j];
              level[j]=typeof drive==='number'?drive:typeof drive==='function'?drive((sample+i)/sampleRate,1/sampleRate):drive[i];
              check(finite(level[j]),'Wave authored drive exceeded numerical range');
            }
            engine.advance(sample+i,level,probePressure,probeFlow,observe);
            for(let j=0;j<probes.length;j++){
              check(finite(probePressure[j])&&finite(probeFlow[j]),'Wave probe exceeded the finite numeric range');
              if(collect){pressure[j][i]=probePressure[j];flow[j][i]=probeFlow[j];}
            }
          }
          check(views.every(({value})=>value.every(finite)),'Wave state exceeded the finite numeric range');
          if(block)review.merge(block);
        }catch(error){
          for(const {value,saved} of views)value.set(saved);
          throw error;
        }
      }
      const start=sample;
      sample+=count;
      return {start,end:sample,...(collect&&{
        pressure:Object.fromEntries(probes.map(({name},i)=>[name,pressure[i]])),
        flow:Object.fromEntries(probes.map(({name},i)=>[name,flow[i]]))
      })};
    }

    function view(){
      return {sample,time:sample/sampleRate,probes:Object.fromEntries(probes.map(({name},i)=>
        [name,{pressure:probePressure[i],flow:probeFlow[i]}]))};
    }
    function snapshot({typed=false}={}){
      return {format:checkpointFormat,version:1,method,domain:identity,sample,
        buffers:Object.fromEntries(views.map(({name,value})=>[name,typed?value.slice():Array.from(value)]))};
    }
    function restore(row){
      check(row?.format===checkpointFormat&&row.version===1&&row.method===method&&equal(row.domain,identity)&&
        integer(row.sample,0,Number.MAX_SAFE_INTEGER)&&record(row.buffers)&&Object.keys(row.buffers).length===views.length&&
        views.every(({name,value})=>numbers(row.buffers[name],value.length)),'Incompatible wave checkpoint');
      for(const {name,value} of views)value.set(row.buffers[name]);
      sample=row.sample;
      resetReview();
    }
    function reset(){for(const {value} of views)value.fill(0);sample=0;resetReview();}
    return Object.freeze({info,process,view,snapshot,restore,reset,...(review&&{
      diagnostics:()=>review.report({solver:method+'-wave',domain:identity,start:reviewStart,end:sample})
    })});
  }

  W.waveNetworks=Object.freeze({format:T.format,runFormat,traceFormat,checkpointFormat,prepare});
})(KIT);
