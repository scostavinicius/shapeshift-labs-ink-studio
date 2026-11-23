/* Causal reconstruction from bounded, regularly spaced source publications. */
(function (K) {
  const W = K.world, {check,record} = W.data, {freeze} = K.procedural.data;
  const historyKey = '$crossings';
  const maxTaps = 1025, maxSourceSlots = 16384, maxTotalSlots = 262144;
  const policies = ['interpolate','decimate','fractional-delay'];
  const isAdvanced = sample => policies.includes(sample);
  const strideOf = ({every,substeps},subdivision) => every*subdivision/substeps;

  function compile(edge,schedule,source,target,combinational,filters) {
    const {sample,delay=0,to,filter} = edge, {subdivision,rates,chunks} = schedule;
    check(!chunks?.managed.has(source) && !chunks?.managed.has(target),
      'Sampling '+sample+' needs fixed schedules on '+to);
    check(Number.isFinite(delay) && delay>=0 && delay<=3600 &&
      (sample==='fractional-delay' ? edge.delay!==undefined : Number.isSafeInteger(delay)), 'Invalid connection delay for '+to);
    const sourceStride = strideOf(rates[source],subdivision), targetStride = strideOf(rates[target],subdivision);
    let offset = delay*subdivision, coefficients, taps, cutoff;
    const immediate = sample==='fractional-delay' && offset<sourceStride;
    if (sample==='fractional-delay') {
      check(offset>0 && (!immediate || combinational && offset>=sourceStride-W.rates.gcd(sourceStride,targetStride)),
        'Fractional delay needs available bracketing samples for '+to+
        ' (use at least one source interval or an aligned combinational source)');
    } else {
      offset += sourceStride;
    }
    if (sample==='decimate') {
      const ratio = targetStride/sourceStride;
      check(ratio>1, 'Decimation needs a slower consumer for '+to);
      check(filter===undefined || record(filter) && Object.keys(filter).every(key=>['taps','cutoff'].includes(key)),
        'Invalid decimation filter for '+to);
      taps = filter?.taps === undefined ? 2*Math.ceil(8*ratio)+1 : filter.taps;
      cutoff = filter?.cutoff === undefined ? 0.8 : filter.cutoff;
      check(Number.isSafeInteger(taps) && taps%2===1 && taps>=Math.max(7,4*ratio) && taps<=maxTaps &&
        Number.isFinite(cutoff) && cutoff>0 && cutoff<1,
      'Decimation filter needs odd taps covering at least four rate ratios (up to '+maxTaps+
        ') and a cutoff between zero and the receiving Nyquist for '+to);
      coefficients = filters.get(ratio,taps,cutoff,to);
    }
    const slots = Math.ceil(offset/sourceStride)+(taps??1);
    check(slots<=maxSourceSlots,'Signal history exceeds '+maxSourceSlots+' samples for '+to);
    const whole = Math.floor(offset), fraction = offset-whole;
    return Object.freeze({sourceStride,targetStride,slots,whole,fraction,coefficients,immediate,
      latencyTicks:(offset+(taps===undefined?0:(taps-1)/2*sourceStride))/subdivision,
      ...(taps!==undefined && {taps,cutoff})});
  }

  function filterBank() {
    const saved = new Map();
    let used = 0;
    return {get(ratio,taps,cutoff,to) {
      const key = ratio+'/'+taps+'/'+cutoff;
      if (saved.has(key)) return saved.get(key);
      check(used+taps<=maxTotalSlots,'Combined decimation coefficients exceed '+maxTotalSlots+' taps');
      const half = (taps-1)/2, hz = cutoff/(2*ratio);
      const weights = Array.from({length:taps},(_,i)=>{
        const x = i-half, taper = 0.5+0.5*Math.cos(Math.PI*x/half);
        return (x===0 ? 2*hz : Math.sin(2*Math.PI*hz*x)/(Math.PI*x))*taper;
      });
      const dc = weights.reduce((total,weight)=>total+weight,0);
      check(Number.isFinite(dc) && dc>0,'Invalid decimation cutoff for '+to);
      const coefficients = Object.freeze(weights.map(weight=>weight/dc));
      saved.set(key,coefficients);
      used+=taps;
      return coefficients;
    }};
  }

  function describe(edge) {
    const {crossing:{sourceStride,targetStride,slots,latencyTicks,taps,cutoff}} = edge;
    return {sourceStride,targetStride,historySlots:slots,latencyTicks,...(taps!==undefined && {taps,cutoff})};
  }

  function bind(incoming,ports,subdivision) {
    const sources = new Map();
    for (const edge of incoming.values()) {
      if (!edge.crossing) continue;
      const {sourceStride,slots} = edge.crossing, type = ports.outputs[edge.from].type;
      const existing = sources.get(edge.from);
      sources.set(edge.from,{sourceStride,type,capacity:Math.max(existing?.capacity??0,slots)});
    }
    if (!sources.size) return null;
    const capacity = Array.from(sources.values()).reduce((total,row)=>total+row.capacity,0);
    check(capacity<=maxTotalSlots,'Combined signal histories exceed '+maxTotalSlots+' samples');

    function seed(outputs,causes) {
      return freeze(Object.fromEntries(Array.from(sources.keys(),port=>[port,{
        initial:outputs[port],values:[],...(causes && {initialCause:causes[port],causes:[]})
      }])));
    }
    function validate(saved,parse,tick,causal) {
      check(record(saved) && Object.keys(saved).length===sources.size,'Malformed rate-crossing history');
      for (const [port,{sourceStride,capacity}] of sources) {
        const row = saved[port], length = Math.min(capacity,Math.floor(tick*subdivision/sourceStride));
        check(record(row) && Array.isArray(row.values) && row.values.length===length &&
          (causal ? Array.isArray(row.causes) && row.causes.length===length &&
            W.causality.savedReference(row.initialCause,0) &&
            row.causes.every(ref=>W.causality.savedReference(ref,tick)) :
            row.causes===undefined && row.initialCause===undefined),
        'Invalid saved rate-crossing history for '+port);
        parse(ports.outputs[port],row.initial,port);
        for (const value of row.values) parse(ports.outputs[port],value,port);
      }
    }

    function begin(saved,at,causal) {
      const rows = new Map(Array.from(sources,([port,{sourceStride,type,capacity}])=>{
        const before = saved[port], last = Math.floor((at-1)*subdivision/sourceStride);
        return [port,{first:last-before.values.length+1,type,capacity,initial:before.initial,values:before.values.slice(),
          ...(causal && {initialCause:before.initialCause,causes:before.causes.slice()})}];
      }));
      function publish(port,value) {
        const row = rows.get(port);
        if (!row) return;
        row.values.push(value);
        if (causal) row.causes.push(causal.publication(port));
      }
      function sample(edge,phase,trace) {
        const row = rows.get(edge.from), {sourceStride,whole,fraction,coefficients} = edge.crossing;
        const elapsed = phase-whole;
        let index = Math.floor(elapsed/sourceStride), weight = (elapsed-index*sourceStride-fraction)/sourceStride;
        if (weight<0) { index--; weight+=1; }
        const parents = trace ? new Set() : undefined;
        function read(i) {
          const offset = i-row.first;
          if (i<=0) {
            parents?.add(row.initialCause);
            return row.initial;
          }
          check(offset>=0 && offset<row.values.length,'Rate-crossing sample is outside the retained history');
          if (parents) parents.add(row.causes[offset]);
          return row.values[offset];
        }
        function filtered(i) {
          if (!coefficients) return read(i);
          let result = W.rates.zero(row.type);
          for (let tap=0;tap<coefficients.length;tap++) {
            const gain = coefficients[tap];
            if (gain) result = W.rates.add(result,W.rates.scale(read(i-tap),gain,row.type),row.type);
          }
          return result;
        }
        const a = filtered(index), value = weight===0 ? a : W.rates.add(
          W.rates.scale(a,1-weight,row.type),W.rates.scale(filtered(index+1),weight,row.type),row.type);
        return {value,...(parents && {parents:[...parents]})};
      }
      function finish() {
        return Object.fromEntries(Array.from(rows,([port,row])=>[port,{
          initial:row.initial,values:row.values.slice(-row.capacity),
          ...(causal && {initialCause:row.initialCause,causes:row.causes.slice(-row.capacity)})
        }]));
      }
      return {publish,sample,finish};
    }

    return {seed,validate,begin,capacity};
  }

  W.signalCrossings = Object.freeze({historyKey,isAdvanced,compile,filterBank,describe,bind});
})(KIT);
