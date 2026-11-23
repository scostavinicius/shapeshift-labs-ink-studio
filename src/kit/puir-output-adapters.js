/* Common simulation output operations for graph and module hosts. */
(function(K){
  const W=K.world,P=K.procedural,G=W.outputGeometry,C=W.outputTiming,T=P.takeTime;
  const {check}=W.data,{fields}=W.boundarySignals;
  const options={type:'record',default:{}};

  function rows(source){
    G.validate('pointBuffer',source);
    const {positions,velocities,velocityValid,ids,count}=source;
    return Array.from({length:count},(_,i)=>{
      const start=i*3, end=start+3, moving=velocities&&(velocityValid===undefined||velocityValid[i]);
      return {id:ids?.[i]??i,point:Array.from(positions.slice(start,end)),
        ...(moving&&{velocity:Array.from(velocities.slice(start,end))})};
    });
  }

  const operations={};
  function node(name,description,input,type,run){
    operations['sim.'+name]=Object.freeze({
      cacheVersion:1,description,inputs:{source:input,options},outputs:{value:type},
      run({source,options}){return {value:run(source,options)};}
    });
  }
  node('outputField','Adapt a regular simulation grid or scalar raster to a typed field.','any','gridField',G.grid);
  node('outputTrace','Adapt native wave, modal, sensor or contact channels to a typed sample trace.','any','trace',C.trace);
  node('outputPoints','Adapt solver point records or packed XYZ data to a typed point buffer.','any','pointBuffer',G.points);
  node('outputMesh','Adapt an indexed simulation surface to Ink mesh ports.','any','mesh',G.mesh);
  node('outputRaster','Adapt a simulation image or a selected model probe to a typed raster.','any','raster',G.raster);
  node('outputEvents','Adapt committed or recorded events to a typed event log.','any','eventLog',C.events);
  node('fieldMesh','Build a triangle height surface from a scalar field slice.','gridField','mesh',G.surface);
  node('traceWindow','Crop a typed trace by absolute native sample indices.','trace','trace',C.traceWindow);
  operations['sim.fieldRaster']=Object.freeze({
    cacheVersion:1,description:'Read a typed grid slice with numeric samples and coordinate metadata.',
    inputs:{source:'gridField',options},outputs:{value:'raster',report:'record'},
    run({source,options}){return G.slice(source,options);}
  });
  operations['sim.pointRecords']=Object.freeze({
    cacheVersion:1,description:'Unpack positions and measured velocities from a typed point buffer.',
    inputs:{source:'pointBuffer'},outputs:{value:'array<record>'},
    run({source}){return {value:rows(source)};}
  });
  operations['sim.outputAudio']=Object.freeze({
    cacheVersion:1,description:'Adapt PCM or calibrate selected trace channels into interleaved audio.',
    inputs:{source:'any',options},outputs:{value:'audio',report:'record'},
    run({source,options}){return C.audio(source,options);}
  });
  operations['sim.eventWindow']=Object.freeze({
    cacheVersion:1,description:'Read simulation events in an explicit half-open time range or on the current take frame.',
    time:true,inputs:{source:'eventLog',options},outputs:{value:'eventLog',events:'array<record>'},
    run({source,options},{take}){
      check(fields(options,['from','to'])&&(Object.keys(options).length===0||
        options.from!==undefined&&options.to!==undefined),'Supply both event window endpoints');
      const exact=take&&T.requireFrame(take);
      check(exact||options.from!==undefined,'Event window needs a take frame or explicit endpoints');
      const value=C.eventWindow(source,options.from??W.soundMeasurements.pack(exact.start),
        options.to??W.soundMeasurements.pack(exact.end));
      return {value,events:value.entries.map(row=>row.event)};
    }
  });

  W.outputAdapters=Object.freeze({
    field:G.grid,trace:C.trace,points:G.points,mesh:G.mesh,raster:G.raster,audio:C.audio,events:C.events,
    fieldRaster:G.slice,fieldMesh:G.surface,traceWindow:C.traceWindow,pointRecords:rows,eventWindow:C.eventWindow
  });
  P.graph.operations=Object.freeze({...P.graph.operations,...operations});
})(KIT);
