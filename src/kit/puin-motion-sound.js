/* Compile measurement tracks into ordinary editable mixer automation. */
(function (K) {
  const W=K.world,P=K.procedural,T=P.takeTime,S=W.soundMeasurements;
  const {check,id,own,record}=W.data,{fields}=W.boundarySignals;
  const format='ink-studio/motion-sound-plan', resultFormat='ink-studio/motion-sound-controls';
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
  const pair=value=>Array.isArray(value)&&value.length===2&&Number.isFinite(value[0])&&Number.isFinite(value[1]);
  const toSample=(at,rate)=>T.index(T.roundDown(T.mul(at,[BigInt(rate),1n])));
  const curveNames=['linear','smoothstep','power'];
  const mixerLimit=2048;

  function mapRange(value,input,output,shape='linear',exponent=2){
    const u=Math.min(1,Math.max(0,(value-input[0])/(input[1]-input[0])));
    const t=shape==='smoothstep'?u*u*(3-2*u):shape==='power'?u**exponent:u;
    return output[0]+(output[1]-output[0])*t;
  }

  function compile(plan,measurements){
    check(fields(plan,['format','version','id','sampleRate','lanes'])&&plan.format===format&&plan.version===1&&id(plan.id)&&
      integer(plan.sampleRate,8000,96000)&&record(plan.lanes)&&integer(Object.keys(plan.lanes).length,1,64)&&
      Object.keys(plan.lanes).every(id)&&record(measurements),'Expected a version 1 motion sound plan and named measurements');
    const rate=plan.sampleRate, cache=new Map();
    let work=0;
    const entries=Object.entries(plan.lanes).map(([name,lane])=>{
      check(fields(lane,['source','input','output','unit','shape','exponent','attack','release','missing','fallback','curve'])&&
        own(measurements,lane.source)&&pair(lane.input)&&lane.input[0]<lane.input[1]&&
        Number.isFinite(lane.input[1]-lane.input[0])&&pair(lane.output)&&Number.isFinite(lane.output[1]-lane.output[0]),
      'Sound lane '+name+' needs a source, increasing input range and numeric output endpoints');
      const {source,input,output,unit,shape='linear',exponent=2,attack=0,release=0,
        missing='fallback',fallback=output[0],curve='linear'}=lane;
      check(id(source)&&(unit===undefined||typeof unit==='string'&&unit.length>0&&unit.length<=64)&&
        curveNames.includes(shape)&&(lane.exponent===undefined||shape==='power')&&finite(exponent,.05,20)&&
        finite(attack,0,60)&&finite(release,0,60)&&Number.isFinite(fallback)&&
        ['fallback','hold'].includes(missing)&&['linear','hold'].includes(curve),'Invalid settings for sound lane '+name);
      if(!cache.has(source))cache.set(source,S.inspect(measurements[source]));
      const rows=cache.get(source);
      work+=rows.length;
      check(work<=250000,'Motion sound plan exceeds its observation budget');
      const evidence=[], points=[{at:0,value:fallback}];
      let state=fallback, previousSample=null;
      const append=(at,value)=>{
        if(points.at(-1).at===at)points[points.length-1]={at,value};
        else points.push({at,value});
      };
      for(const [index,{row,at}] of rows.entries()){
        const sample=toSample(at,rate), raw=row.value;
        check(previousSample===null||sample>previousSample,'Sound lane '+name+' has multiple observations at audio sample '+sample);
        let target;
        if(raw===null)target=missing==='hold'&&!row.cut?state:fallback;
        else target=mapRange(raw,input,output,shape,exponent);
        if(index===0||row.cut){
          if(sample>0)append(sample-1,state);
          state=target;
        }else{
          const tau=target>state?attack:release;
          state=tau===0?target:state+(target-state)*-Math.expm1(-(sample-previousSample)/(rate*tau));
        }
        check(Number.isFinite(state),'Sound lane '+name+' smoothing exceeds the numeric range');
        previousSample=sample;
        append(sample,state);
        evidence.push({sample,at:row.at,raw,target,value:state,...(row.cut&&{cut:true}),
          ...(row.detail!==undefined&&{detail:row.detail})});
      }
      check(points.length<=mixerLimit,'Sound lane '+name+' exceeds 2048 mixer points. Capture at a lower cadence or split the take.');
      return [name,{lane:{unit:'samples',curve,points},report:{source,inputUnit:measurements[source].unit,
        ...(unit!==undefined&&{outputUnit:unit}),input,output,shape,...(shape==='power'&&{exponent}),attack,release,missing,fallback,
        knots:points.length,missingCount:evidence.filter(row=>row.raw===null).length,observations:evidence}}];
    });
    return {format:resultFormat,version:1,id:plan.id,sampleRate:rate,
      lanes:Object.fromEntries(entries.map(([name,{lane}])=>[name,lane])),
      report:Object.fromEntries(entries.map(([name,{report}])=>[name,report]))};
  }

  function before(rows,sample,key){
    let low=0,high=rows.length;
    while(low<high){
      const mid=(low+high)>>>1;
      if(rows[mid][key]<=sample)low=mid+1;
      else high=mid;
    }
    return low-1;
  }

  function sample(result,settings){
    check(result?.format===resultFormat&&result.version===1&&integer(result.sampleRate,8000,96000)&&
      record(result.lanes)&&record(result.report)&&fields(settings,['sample','at'])&&
      (settings.sample!==undefined)!==(settings.at!==undefined),'Inspect a compiled sound control asset at one sample or time');
    const position=settings.sample??toSample(T.read(settings.at),result.sampleRate);
    check(integer(position,0,3600*result.sampleRate),'Sound control sample is outside its time range');
    const entries=Object.entries(result.lanes).map(([name,lane])=>{
      const {points,curve}=lane, report=result.report[name];
      check(points?.length&&Array.isArray(report?.observations),'Invalid compiled sound lane '+name);
      const i=Math.max(0,before(points,position,'at')), a=points[i], b=points[i+1];
      const value=curve==='hold'||!b?a.value:a.value+(b.value-a.value)*(position-a.at)/(b.at-a.at);
      const j=before(report.observations,position,'sample');
      return [name,{value,previous:report.observations[j]??null,next:report.observations[j+1]??null}];
    });
    return {sample:position,sampleRate:result.sampleRate,
      values:Object.fromEntries(entries.map(([name,{value}])=>[name,value])),lanes:Object.fromEntries(entries)};
  }

  W.motionSound=Object.freeze({format,resultFormat,compile,sample,mapRange});
  const options={type:'record',default:{}};
  P.graph.operations=Object.freeze({...P.graph.operations,
    'audio.soundMeasurements':{
      description:'Project timed telemetry to a scalar sound measurement track, with optional wrapped rates.',
      cacheVersion:1,inputs:{rows:'array<record>',options:'record'},outputs:{value:'record'},
      run({rows,options}){return {value:S.rows(rows,options)};}
    },
    'audio.measureRender':{
      description:'Reduce a scoped native art pass to a dated sound measurement with validity and pixel counts.',
      cacheVersion:1,time:true,inputs:{frame:'renderFrame',options:'record',timing:options},outputs:{value:'record',unit:'string'},
      run({frame,options,timing},{time,take}){
        const model=W.renderSoundMeasurements.prepare(options);
        check(fields(timing,['at','cut','interval']),'Invalid render sound measurement timing');
        const exact=take&&T.requireFrame(take);
        const point=model.measure(frame,{at:timing.at??(exact?S.pack(exact.start):time),
          cut:timing.cut??take?.cut??false,interval:timing.interval});
        return {value:point,unit:model.unit};
      }
    },
    'audio.motionControls':{
      description:'Compile measured motion, render or simulation values to editable mixer lanes with evidence.',
      cacheVersion:1,inputs:{plan:'record',measurements:'record'},outputs:{value:'record',lanes:'record',report:'record'},
      run({plan,measurements}){
        const value=compile(plan,measurements);
        return {value,lanes:value.lanes,report:value.report};
      }
    },
    'audio.sampleMotionControls':{
      description:'Inspect sound control values and surrounding source observations at a sample or take frame.',
      cacheVersion:1,time:true,inputs:{source:'record',options},outputs:{value:'record',values:'record'},
      run({source,options},{time,take}){
        const timing=Object.keys(options).length?options:take?{at:S.pack(T.requireFrame(take).start)}:{at:time};
        const value=sample(source,timing);
        return {value,values:value.values};
      }
    }
  });
})(KIT);
