/* Versioned, portable artifacts baked from detailed geometry or measured responses. */
(function(K){
  const W=K.world, P=K.procedural, {check,copy,id,record}=W.data;
  const format='ink-studio/reduction-plan', assetFormat='ink-studio/reduced-model';
  const settingsByKind={
    profile:['segments','areaPower'],
    network:['segments','areaPower'],
    response:['fit','validation','fadeSamples'],
    modes:['fit','validation','band','decay','maxModes']
  };

  function bake(plan){
    const {version,kind,source,revision=1,settings={},reference}=plan??{};
    check(plan?.format===format&&version===1&&id(plan.id)&&Object.hasOwn(settingsByKind,kind)&&
      Number.isSafeInteger(revision)&&revision>=1,'Expected a version 1 reduction plan');
    check(record(settings)&&Object.keys(settings).every(key=>settingsByKind[kind].includes(key)),
      'Unknown settings for '+kind+' reduction');
    check(reference===undefined||record(reference),'Reduction source reference must be JSON data');

    let result, origin;
    if(kind==='profile'){
      check(source?.format===P.pathSections.format&&source.version===1&&source.complete===true,
        'Profile reduction needs a complete measured path section report');
      result=W.reducedGeometry.profile(source.sections,settings);
      origin={format:source.format,geometry:source.source};
    }else if(kind==='network'){
      result=W.reducedGeometry.network(source,settings);
      origin={format:source.format,id:source.id,revision:source.revision,...(source.snapshot&&{snapshot:source.snapshot})};
    }else{
      result=W.reducedResponses[kind==='response'?'impulse':'modes'](source,settings);
      origin={sampleRate:result.sampleRate,sampleCount:result.sampleCount,
        ...(source.origin!==undefined&&{capture:source.origin})};
    }
    return P.data.freeze(copy({format:assetFormat,version:1,id:plan.id,revision,kind,
      source:{...origin,...(reference!==undefined&&{reference})},settings,...result}));
  }

  function render(asset,options){
    check(asset?.format===assetFormat&&asset.version===1,'Expected a version 1 reduced-model asset');
    return W.reducedResponses.render(asset,options);
  }

  W.reduction=Object.freeze({format,assetFormat,bake,render,capture:W.reducedResponses.capture});
})(KIT);
