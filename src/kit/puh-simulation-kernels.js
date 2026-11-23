/* Creator kernels own typed working memory. World state holds portable snapshots. */
(function (K) {
  const W = K.world, R = W.runtime, P = K.procedural;
  const {check, id, own, record, equal} = W.data, {clone, freeze} = P.data;
  const format = 'ink-studio/kernel-state', version = 1;
  const maxBytes = 8 * 1024 * 1024, maxBlockSize = 65536;
  const types = {number:'number', bool:'boolean', vec3:'vec3', record:'record', event:'array'};
  const defaults = {number:0, bool:false, vec3:[0,0,0], record:{}, event:[]};
  const arrays = {Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array};
  const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;
  const kernels = new Map(), operations = new Map(), processors = new WeakMap();
  const storageType = value => ArrayBuffer.isView(value) && Object.prototype.toString.call(value).slice(8,-1);
  const isFloat = type => type === 'Float32Array' || type === 'Float64Array';
  const positiveRevision = value => Number.isSafeInteger(value) && value > 0;
  const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));

  function layout(buffers) {
    check(record(buffers) && Object.keys(buffers).length <= 64, 'Kernel snapshot needs named typed buffers');
    let bytes = 0;
    const result = Object.fromEntries(Object.entries(buffers).map(([name, value]) => {
      const type = storageType(value);
      check(id(name) && own(arrays,type), 'Invalid typed kernel buffer ' + name);
      bytes += value.byteLength;
      return [name,{type,length:value.length}];
    }));
    check(bytes <= maxBytes, 'Kernel snapshot exceeds its typed buffer budget');
    return result;
  }

  function swap(bytes, stride) {
    if (!littleEndian && stride > 1) {
      for (let i=0; i<bytes.length; i+=stride) bytes.subarray(i,i+stride).reverse();
    }
    return bytes;
  }

  function pack(array, type) {
    check(!isFloat(type) || array.every(Number.isFinite), 'Kernel float buffers must be finite');
    const view = new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
    const bytes = littleEndian ? view : swap(view.slice(),array.BYTES_PER_ELEMENT);
    let binary = '';
    for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(binary);
  }

  function unpack(encoded, {type,length}, name) {
    const Type = arrays[type], size = length*Type.BYTES_PER_ELEMENT;
    check(typeof encoded === 'string' && encoded.length === Math.ceil(size/3)*4 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'Invalid encoded kernel buffer ' + name);
    const binary = atob(encoded);
    check(binary.length === size && btoa(binary) === encoded, 'Invalid encoded kernel buffer ' + name);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const value = new Type(swap(bytes,Type.BYTES_PER_ELEMENT).buffer);
    check(!isFloat(type) || value.every(Number.isFinite), 'Kernel float buffers must be finite');
    return value;
  }

  function inspectBuffers(saved) {
    check(saved?.format===format && saved.version===version && record(saved.buffers) &&
      Object.keys(saved.buffers).length<=64,'Invalid kernel state for buffer inspection');
    let bytes=0;
    return Object.fromEntries(Object.entries(saved.buffers).map(([name,row])=>{
      check(id(name) && record(row) && own(arrays,row.type) && Number.isSafeInteger(row.length) && row.length>=0,
        'Invalid kernel buffer layout for '+name);
      bytes+=row.length*arrays[row.type].BYTES_PER_ELEMENT;
      check(bytes<=maxBytes,'Kernel snapshot exceeds its typed buffer budget');
      return [name,unpack(row.base64,row,name)];
    }));
  }

  function ports(source = {}, inbound = false) {
    check(record(source), 'Expected named kernel ports');
    return Object.fromEntries(Object.entries(source).map(([name, raw]) => {
      const spec = typeof raw === 'string' ? {type:raw} : raw;
      check(id(name) && keys(spec,['type','default','quantity','description','timing']) && own(types,spec.type) &&
        (spec.description === undefined || typeof spec.description === 'string') &&
        (spec.timing===undefined || inbound && spec.type==='event' && spec.timing==='split'), 'Invalid kernel port ' + name);
      const valid = P.graphTypes.validator(types[spec.type]);
      const value = spec.default ?? defaults[spec.type];
      check(valid(value), 'Invalid default for kernel port ' + name);
      const quantity = K.quantities.normalize(spec.quantity,'Kernel port '+name);
      check(quantity === undefined || ['number','vec3'].includes(spec.type), 'Physical kernel ports need number or vec3');
      return [name,{...clone(spec),default:clone(value),...(quantity && {quantity})}];
    }));
  }

  function values(schema, source, requireAll) {
    check(record(source) && Object.keys(source).every(key => own(schema,key)), 'Unknown or malformed kernel port value');
    return freeze(Object.fromEntries(Object.entries(schema).map(([name, spec]) => {
      const present = own(source,name), value = present ? source[name] : spec.default;
      check((!requireAll || present) && P.graphTypes.validator(types[spec.type])(value),
        'Invalid or missing kernel port value ' + name);
      return [name,clone(value)];
    })));
  }

  function definition(kind, revision) {
    const spec = kernels.get(kind)?.get(revision);
    check(spec, 'Unregistered simulation kernel ' + kind + ' revision ' + revision);
    return spec;
  }

  function prepare(kind, revision, config = {}, {id:instance = 'solver', seed = 1, dt = 1/60, clock} = {}) {
    const spec = definition(kind,revision);
    check(record(config) && id(instance) && Number.isSafeInteger(seed) && Number.isFinite(dt) && dt > 0 && dt <= 1,
      'Invalid kernel configuration or fixed timestep');
    const settings = freeze({config:clone(config),id:instance,seed,dt});
    const processing=spec.processing ? W.kernelProcessing.create(spec,settings,{arrays,clock,maxStateBytes:maxBytes}) : undefined;
    function runPrepared(count,input) {
      Object.assign(processing.input,input);
      const status=processing.process(count);
      check(status!=='sample-capacity' && status!=='work-capacity','Prepared kernel '+status+' exceeded');
      return processing.output;
    }
    const kernel = processing ? {
      reset(){ processing.reset(); return processing.output; },
      advance(context){ check(context.dt===dt && context.tick===processing.position()+1,'Prepared kernel needs its fixed sample clock');
        return runPrepared(1,context.input); },
      advanceBlock({start,end,input}){
        check(start===processing.position(),'Prepared block needs its fixed sample clock');
        return runPrepared(end-start,input);
      },
      snapshot:()=>({buffers:processing.state})
    } : spec.prepare(settings.config,{id:instance,seed,dt});
    check(record(kernel) && ['advance','reset','snapshot'].every(key => typeof kernel[key] === 'function') &&
      (processing || typeof kernel.restore==='function'),
      'Kernel prepare must return advance, reset, snapshot and restore');
    check(!spec.block || typeof kernel.advanceBlock === 'function', 'Block kernel prepare must return advanceBlock');
    const reactive = Object.values(spec.inputs).some(port=>port.timing==='split');
    check(!reactive || typeof kernel.react==='function','Timed kernel inputs need a react hook');
    let current, shape, dirty=false;

    function state(outputs, steps) {
      const snap = kernel.snapshot();
      check(keys(snap,['buffers','data']), 'Kernel snapshot needs buffers and optional JSON data');
      const actual = layout(snap.buffers);
      check(shape === undefined || equal(shape,actual), 'Kernel snapshot changed its typed buffer layout');
      shape ??= freeze(actual);
      const buffers = Object.fromEntries(Object.entries(shape).map(([name,{type,length}]) =>
        [name,{type,length,base64:pack(snap.buffers[name],type)}]));
      return freeze({format,version,kind,revision,settings,steps,outputs,buffers,
        ...(snap.data !== undefined && {data:clone(snap.data)})});
    }

    function decode(saved) {
      check(saved?.format === format && saved.version === version && saved.kind === kind &&
        saved.revision === revision && equal(saved.settings,settings) &&
        Number.isSafeInteger(saved.steps) && saved.steps >= 0 && record(saved.buffers) &&
        equal(Object.keys(saved.buffers).sort(),Object.keys(shape).sort()), 'Snapshot does not match this prepared kernel');
      const outputs = values(spec.outputs,saved.outputs,true);
      const buffers = Object.fromEntries(Object.entries(shape).map(([name, expected]) => {
        const row = saved.buffers[name];
        check(keys(row,['type','length','base64']) && row.type === expected.type && row.length === expected.length,
          'Invalid kernel buffer layout for ' + name);
        return [name,unpack(row.base64,expected,name)];
      }));
      return {outputs, payload:{buffers,...(saved.data !== undefined && {data:clone(saved.data)})}};
    }

    function snapshot() {
      if (processing && current && (dirty || current.steps!==processing.position())) {
        current=state(values(spec.outputs,processing.output,true),processing.position());
        dirty=false;
      }
      return current;
    }
    function install(saved,{outputs,payload}) {
      if (processing) processing.install(payload.buffers,outputs,saved.steps);
      else kernel.restore(payload);
    }
    function transact(action) {
      const before = snapshot();
      try { return action(); }
      catch (error) {
        if (before) {
          try { install(before,decode(before)); }
          catch (cause) { throw Error('Kernel rollback failed after: ' + error.message,{cause}); }
        }
        throw error;
      }
    }

    function reset() {
      return transact(() => current = state(values(spec.outputs,kernel.reset(),true),0));
    }
    function advance(context = {}) {
      const steps = snapshot().steps+1, {tick = steps, time = tick*dt, dt:step = dt} = context;
      check(Number.isSafeInteger(steps) && Number.isSafeInteger(tick) && tick > 0 &&
        Number.isFinite(time) && time >= 0 && Number.isFinite(step) && step > 0, 'Invalid kernel advance time');
      const input = values(spec.inputs,context.input ?? {},false);
      const random = context.random ?? (key => P.data.hash(instance+'/'+tick+'/'+String(key),seed)/4294967296);
      return transact(() => {
        const outputs = values(spec.outputs,kernel.advance({...context,tick,time,dt:step,input,random}),true);
        current = state(outputs,steps);
        return outputs;
      });
    }
    function react(context) {
      check(Number.isFinite(context?.time) && context.time>=0,'Invalid kernel reaction time');
      const input = values(spec.inputs,context.input??{},false);
      return transact(() => {
        const outputs = values(spec.outputs,kernel.react({...context,dt:0,input}),true);
        current = state(outputs,current.steps);
        return outputs;
      });
    }
    const eventPorts = Object.keys(spec.outputs).filter(port=>spec.outputs[port].type==='event');
    function advanceBlock({start = snapshot().steps, end, input:source = {}} = {}) {
      check(start === snapshot().steps && Number.isSafeInteger(end) && end >= start && end-start <= maxBlockSize,
        'Kernel block needs a contiguous integer range of at most '+maxBlockSize+' samples');
      if (end === start) return eventPorts.length ? freeze({...current.outputs,
        ...Object.fromEntries(eventPorts.map(port=>[port,[]]))}) : current.outputs;
      const input = values(spec.inputs,source,false);
      const randomAt = (sample,key) => P.data.hash(instance+'/'+(sample+1)+'/'+String(key),seed)/4294967296;
      return transact(() => {
        function eventAt(sample,fraction,event) {
          check(Number.isSafeInteger(sample) && sample>=start && sample<end,'Event sample is outside the block');
          return W.timedEvents.within(sample*dt,(sample+1)*dt,fraction,event,{sample,fraction});
        }
        const outputs = values(spec.outputs,kernel.advanceBlock({start,end,dt,input,randomAt,eventAt}),true);
        const endpoint = {...outputs};
        for (const port of eventPorts) {
          check(outputs[port].length<=W.rates.maxEvents,'Kernel block event budget exceeded');
          let previousSample=start, previousFraction=0;
          endpoint[port]=[];
          for (const event of outputs[port]) {
            const {sample,fraction} = event?.timing??{};
            check(Number.isSafeInteger(sample) && sample>=start && sample<end &&
              (sample>previousSample || sample===previousSample && fraction>=previousFraction) &&
              W.timedEvents.timeOf(event)===W.timedEvents.withinTime(sample*dt,(sample+1)*dt,fraction),
            'Block events need ordered enclosing samples and fractions');
            previousSample=sample;
            previousFraction=fraction;
            if (sample===end-1) endpoint[port].push(event);
          }
        }
        current = state(freeze(endpoint),end);
        return outputs;
      });
    }
    function restore(saved) {
      if (saved === snapshot()) return current;
      const decoded = decode(saved);
      return transact(() => {
        install(saved,decoded);
        const after = state(decoded.outputs,saved.steps);
        check(equal(after.buffers,saved.buffers) && equal(after.data,saved.data), 'Kernel restore did not reproduce its snapshot');
        return current = after;
      });
    }
    reset();
    const processor=processing && Object.freeze({process:count=>processing.process(count),input:processing.input,
      output:processing.output,buffers:processing.buffers,capacity:processing.capacity,report:processing.report,
      snapshot,reset,restore});
    if (processor) processors.set(processor,{processing,markDirty:()=>{dirty=true;}});
    return Object.freeze({advance,reset,snapshot,restore,...(spec.block && {advanceBlock}),...(reactive && {react}),
      ...(processor && {processor})});
  }

  function prepareStateTransfer(source,target,mapping) {
    const from=processors.get(source), to=processors.get(target);
    check(from && to && from!==to && Array.isArray(mapping) && mapping.length>0 && mapping.length<=64,
      'State remapping needs two prepared kernels and 1–64 spans');
    const spans=mapping.map(row=>{
      check(keys(row,['from','to','source','target','count']) && id(row.from) && id(row.to),
        'Invalid state remap span');
      const src=from.processing.state[row.from], dst=to.processing.state[row.to];
      const {source:a=0,target:b=0,count}=row;
      check(src && dst && src.constructor===dst.constructor && [a,b,count].every(Number.isSafeInteger) &&
        a>=0 && b>=0 && count>0 && count<=src.length-a && count<=dst.length-b,
      'State remap type or range mismatch for '+row.from+' → '+row.to);
      return {source:src.subarray(a,a+count),dst,start:b,end:b+count};
    });
    for (let i=0;i<spans.length;i++) for (let j=0;j<i;j++) {
      const a=spans[i], b=spans[j];
      check(a.dst!==b.dst || a.start>=b.end || b.start>=a.end,'State remap target ranges overlap');
    }
    return Object.freeze({copy() {
      for (let i=0;i<spans.length;i++) {
        const {source,dst,start}=spans[i];
        dst.set(source,start);
      }
      to.markDirty();
    }, elements:spans.reduce((sum,span)=>sum+span.source.length,0)});
  }

  function processPair(source,target,count) {
    const first=processors.get(source)?.processing, second=processors.get(target)?.processing;
    check(first && second && first!==second && Number.isSafeInteger(count) && count>0,
      'Paired processing needs two prepared kernels and a positive block size');
    const firstStatus=first.process(count,true);
    if (firstStatus!=='ok' && firstStatus!=='deadline') return firstStatus;
    let secondStatus;
    try { secondStatus=second.process(count); }
    catch(error) {
      first.rollbackLast();
      throw error;
    }
    if (secondStatus!=='ok' && secondStatus!=='deadline') {
      first.rollbackLast();
      return secondStatus;
    }
    return firstStatus==='deadline'?'deadline':secondStatus;
  }

  const stateBytes=saved=>Object.values(saved.buffers).reduce((sum,{type,length})=>sum+arrays[type].BYTES_PER_ELEMENT*length,0);

  function worldProvider(spec) {
    return (config,{id,world}) => {
      let session;
      const open = () => session ??= prepare(spec.kind,spec.revision,config,{id,seed:world.seed,dt:world.dt});
      function stepBlock(saved, range) {
        const run = open();
        run.restore(saved);
        const emitted = run.advanceBlock(range);
        const events = Object.fromEntries(Object.entries(spec.outputs).filter(([,port])=>port.type==='event')
          .map(([name])=>[id+'/'+name,emitted[name]]));
        return {state:run.snapshot(),events};
      }
      return {
        inputs:spec.inputs, outputs:spec.outputs, shareCheckpoint:true,
        ...(spec.block && {stepBlock}),
        ...(spec.processing && {processingReport:()=>open().processor.report(),
          processingLimit:()=>open().processor.capacity.effectiveMaxSamples}),
        ...(Object.values(spec.inputs).some(port=>port.timing==='split') && {react(saved,context) {
          const run = open();
          run.restore(saved);
          run.react(context);
          return run.snapshot();
        }}),
        kernel:{kind:spec.kind,revision:spec.revision,description:spec.description,...(spec.block && {block:true}),...(spec.processing && {prepared:true})},
        typedStateBytes:stateBytes,
        ...(spec.estimate && {estimate:() => spec.estimate(config,{id,seed:world.seed,dt:world.dt})}),
        initial:() => open().snapshot(),
        validateState:saved => { open().restore(saved); },
        step(saved,context) {
          if (spec.block && world.simulationModel?.blockSize)
            return stepBlock(saved,{start:context.tick-1,end:context.tick,input:context.input}).state;
          const run = open();
          run.restore(saved);
          run.advance(context);
          return run.snapshot();
        },
        output:saved => saved.outputs
      };
    };
  }

  function graphOperation(spec, name) {
    const {kind,revision,description} = spec, T = P.takeTime;
    const outputPorts = Object.fromEntries(Object.entries(spec.outputs).map(([key, {type,quantity,description}]) =>
      [key,{type:types[type],...(quantity && {quantity}),...(description !== undefined && {description})}]));
    const opts = {type:'record',default:{}};
    const operation = {
      description,cacheVersion:revision,time:true,
      inputs:{config:opts, commands:{type:'array<record>',default:[],
        description:'Model input commands with tick, input, and value.',
        properties:Object.fromEntries(Object.entries(spec.inputs).map(([key,{type,...details}])=>
          [key,{type:types[type],...details}]))},
      clock:{...opts,properties:{tick:{type:'number',unit:'model tick'},dt:{type:'number',unit:'s'},seed:{type:'number'},
        ...(spec.block && {blockSize:{type:'number',unit:'samples',min:1,max:maxBlockSize}})}},
      checkpoint:{...opts,description:'Portable world checkpoint from the same kernel configuration and input schedule.'}},
      outputs:{...outputPorts,checkpoint:'record'},
      instantiate() {
        let run, prior;
        return ({config,commands,clock,checkpoint},{time,take}) => {
          const {tick,dt=1/60,seed=1,blockSize} = clock;
          const allowed = spec.block ? ['tick','dt','seed','blockSize'] : ['tick','dt','seed'];
          check(keys(clock,allowed), 'Invalid kernel graph clock settings');
          const request = [config,commands,dt,seed,blockSize,checkpoint];
          if (!prior || request.some((value,i)=>value!==prior[i])) {
            const alias = table => Object.fromEntries(Object.keys(table).map(key=>[key,'solver/'+key]));
            const model = {format:W.models.format,version:1,id:kind,revision,seed,numerics:{dt,...(blockSize !== undefined && {blockSize})},
              domain:{},parameters:{},initial:{},boundaries:{},operators:{solver:{kind,revision,config}},
              inputs:alias(spec.inputs),outputs:alias(spec.outputs),commands,probes:{}};
            run = W.models.session(model,{...(Object.keys(checkpoint).length && {checkpoint})});
            prior = request;
          }
          const at = tick === undefined ? (take === undefined ? Math.floor(time/dt + 1e-10) :
            T.index(T.roundDown(T.div(T.requireFrame(take).start,T.period(dt))))) : tick;
          run.seek(at);
          const {outputs} = W.models.sample(run);
          return {...outputs,checkpoint:run.checkpoint()};
        };
      }
    };
    if (spec.example) {
      const output = Object.keys(spec.outputs)[0] ?? 'checkpoint';
      operation.example = freeze({kind:'graph',project:{format:'ink-studio/graph-project',version:1,
        nodes:{example:{op:name,inputs:spec.example}},outputs:{value:{node:'example',port:output}}}});
    }
    return Object.freeze(operation);
  }

  function register(kind, spec) {
    const {revision = 1, description = 'Creator simulation kernel.', example, block = spec?.processing!==undefined} = spec ?? {};
    const name = 'kernel.' + kind + '.v' + revision;
    check(id(kind) && name.length <= 100 && positiveRevision(revision) && typeof description === 'string' &&
      keys(spec,['revision','description','inputs','outputs','prepare','example','estimate','block','processing']) && typeof spec.prepare === 'function' &&
      typeof block === 'boolean' && (spec.estimate === undefined || typeof spec.estimate === 'function') &&
      (example === undefined || keys(example,['config','commands','clock'])), 'Invalid simulation kernel registration ' + name);
    const versions = kernels.get(kind) ?? new Map();
    check(!versions.has(revision), 'Duplicate simulation kernel ' + name);
    const inputs = ports(spec.inputs,true), outputs = ports(spec.outputs);
    const processing=spec.processing===undefined ? undefined : W.kernelProcessing.limits(spec.processing,maxBlockSize);
    check(!processing || block && [...Object.values(inputs),...Object.values(outputs)]
      .every(port=>port.type==='number' || port.type==='bool'), 'Prepared kernels need block execution and scalar level ports');
    check(!block || Object.values(inputs).every(port => port.type !== 'event'),
      'Block kernels need level input ports');
    check(!own(outputs,'checkpoint'),'Kernel output checkpoint is reserved for the graph snapshot');
    const def = freeze({kind,revision,description,inputs,outputs,block,processing,prepare:spec.prepare,estimate:spec.estimate,...(example && {example:clone(example)})});
    R.register(kind,worldProvider(def),{revision});
    versions.set(revision,def);
    kernels.set(kind,versions);
    operations.set(name,graphOperation(def,name));
    return name;
  }

  W.kernels = Object.freeze({register,prepare,prepareStateTransfer,processPair,inspectBuffers,stateBytes,format,maxBlockSize,operation:name => operations.get(name),
    graphOperations:() => Object.fromEntries(operations)});
})(KIT);
