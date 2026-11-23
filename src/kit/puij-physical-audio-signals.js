/* Native physical traces keep their units and absolute sample addresses. */
(function (K) {
  const W=K.world, P=K.procedural, {check,own}=W.data, {fields}=W.boundarySignals;
  const format='ink-studio/physical-signal', maxFrames=2000000;
  const units=Object.freeze({pressure:'Pa','radiated-pressure':'Pa',displacement:'m',
    velocity:'m/s',acceleration:'m/s^2','volume-flow':'m^3/s'});
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const list=value=>Array.isArray(value)||value instanceof Float32Array||value instanceof Float64Array;

  function inspect(track){
    check(fields(track,['format','version','kind','quantity','sampleRate','startSample','samples','previous','beforePrevious'])&&
      track.format===format&&track.version===1&&own(units,track.kind)&&
      integer(track.sampleRate,1,192000)&&integer(track.startSample,0,Number.MAX_SAFE_INTEGER)&&
      list(track.samples)&&integer(track.samples.length,1,maxFrames)&&
      Number.isSafeInteger(track.startSample+track.samples.length)&&
      (track.previous===undefined||Number.isFinite(track.previous))&&
      (track.beforePrevious===undefined||(track.previous!==undefined&&Number.isFinite(track.beforePrevious))),
    'Expected a bounded version 1 physical signal');
    const quantity=K.quantities.normalize(track.quantity,'Physical signal quantity');
    check(quantity&&(quantity.sampleRate===undefined||K.quantities.equalRate(quantity.sampleRate,track.sampleRate)),
      'Physical quantity cadence does not match the signal');
    const convert=K.quantities.converter(quantity,{...quantity,unit:units[track.kind]});
    return {track,convert};
  }

  function validate(track){
    const {convert}=inspect(track);
    for(const value of track.samples)convert(value);
    if(track.previous!==undefined)convert(track.previous);
    if(track.beforePrevious!==undefined)convert(track.beforePrevious);
    return track;
  }

  function fromTrace(trace,selection){
    check(fields(selection,['name','channel','metersPerUnit','previous','beforePrevious'])&&W.data.id(selection.name)&&
      (selection.previous===undefined||Number.isFinite(selection.previous))&&
      (selection.beforePrevious===undefined||(selection.previous!==undefined&&Number.isFinite(selection.beforePrevious))),
    'Select a named physical trace channel');
    const {name,channel,metersPerUnit,previous,beforePrevious}=selection;
    const {start,end}=trace??{};
    let kind, quantity, sampleRate, values, scale=1;
    check(trace?.version===1,'Expected a version 1 physical trace');
    switch(trace.format){
      case W.waveNetworks.traceFormat:
        check((channel===undefined||channel==='pressure'||channel==='flow')&&metersPerUnit===undefined,
          'Wave channels are pressure or flow');
        kind=channel==='flow'?'volume-flow':'pressure';
        sampleRate=trace.info?.sampleRate;
        values=own(trace[channel??'pressure'],name)?trace[channel??'pressure'][name]:undefined;
        break;
      case W.resonantModes.traceFormat:
        check(channel===undefined&&Number.isFinite(metersPerUnit)&&metersPerUnit>0,
          'A modal pickup needs metersPerUnit, the displacement calibration');
        kind='displacement';
        sampleRate=trace.info?.sampleRate;
        values=own(trace.pickups,name)?trace.pickups[name]:undefined;
        scale=metersPerUnit;
        break;
      case W.virtualSensors.reportFormat: {
        check(trace.kind==='wave'&&channel===undefined&&metersPerUnit===undefined,
          'Use a sample-rate wave sensor report for physical audio');
        const sensor=own(trace.rig?.sensors,name)?trace.rig.sensors[name]:undefined;
        check(['microphone','pressure-tap','flow-meter'].includes(sensor?.kind),'Select a pressure or flow sensor');
        kind=sensor.kind==='flow-meter'?'volume-flow':'pressure';
        quantity=sensor.quantity;
        check(quantity!==undefined,'Wave sensor report needs quantity metadata');
        sampleRate=trace.sampleRate;
        values=own(trace.readings,name)?trace.readings[name]:undefined;
        break;
      }
      default: throw Error('Use a wave, modal pickup, or wave sensor trace');
    }
    check(list(values)&&integer(values.length,1,maxFrames)&&end===start+values.length,
      'Missing or misaligned physical trace channel '+name);
    return validate({format,version:1,kind,quantity:quantity??{unit:units[kind]},sampleRate,startSample:start,
      samples:scale===1?values:Float64Array.from(values,value=>Number.isFinite(value)?value*scale:NaN),
      ...(previous!==undefined&&{previous:previous*scale}),
      ...(beforePrevious!==undefined&&{beforePrevious:beforePrevious*scale})});
  }

  W.physicalSignals=Object.freeze({format,units,maxFrames,inspect,validate,fromTrace});
  P.graph.operations=Object.freeze({...P.graph.operations,'audio.physicalSignal':Object.freeze({
    cacheVersion:1,description:'Select a calibrated physical signal and absolute sample addresses from a simulation trace.',
    inputs:{trace:'record',selection:'record'},outputs:{value:'record'},
    run({trace,selection}){return {value:fromTrace(trace,selection)};}
  })});
})(KIT);
