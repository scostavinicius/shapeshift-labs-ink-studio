/* Sample exact damped modes with position-dependent drives and readouts. */
(function(K){
  const W=K.world,A=W.modalAssets,{check,equal,own,record}=W.data,{freeze,hash}=K.procedural.data;
  const {integer}=A, finite=Number.isFinite;
  const runFormat='ink-studio/resonant-mode-run', traceFormat='ink-studio/resonant-mode-trace',
    checkpointFormat='ink-studio/resonant-mode-checkpoint';
  const array=value=>Array.isArray(value)||ArrayBuffer.isView(value)&&typeof value.length==='number';

  function values(value,n){
    if(!array(value)||value.length!==n)return false;
    for(let i=0;i<n;i++)if(!finite(value[i]))return false;
    return true;
  }

  function prepare(asset,options={}){
    const {sampleRate=48000,maxWork=80000000,excitations,pickups}=options;
    check(record(options)&&Object.keys(options).every(key=>['sampleRate','maxWork','excitations','pickups'].includes(key))&&
      integer(sampleRate,1000,192000)&&integer(maxWork,1,200000000),'Invalid modal playback settings');
    const bound=A.bind(asset,{excitations,pickups}), modes=bound.modes, inputs=Object.entries(bound.excitations),
      outputs=Object.entries(bound.pickups), n=modes.length, dt=1/sampleRate;
    const rot=modes.map(({hz,decay})=>{
      check(hz<sampleRate*.5,'Mode frequency must be below Nyquist: '+hz);
      const omega=2*Math.PI*hz, step=omega*dt, radius=Math.exp(-decay*dt);
      const cosine=Math.cos(step), s=radius*Math.sin(step), c=radius*cosine;
      const minusC=-Math.expm1(-decay*dt)+2*radius*Math.sin(step*.5)**2;
      const position=1/(omega**2+decay**2), quadrature=(decay/omega)*position;
      const fx=minusC*position-s*quadrature, fy=s*position+minusC*quadrature;
      check([fx,fy,omega].every(finite),'Modal coefficient exceeded numerical range');
      return {omega,decay,c,s,fx,fy};
    });
    const identity=freeze({id:asset.id,revision:asset.revision,signature:hash(JSON.stringify(bound))});
    const info=freeze({identity,sampleRate,maxWork,modes,excitations:bound.excitations,pickups:bound.pickups});
    const x=new Float64Array(n), y=new Float64Array(n);
    let sample=0;

    function snapshot({typed=false}={}){
      return {format:checkpointFormat,version:1,identity,sampleRate,sample,
        buffers:{position:typed?x.slice():Array.from(x),quadrature:typed?y.slice():Array.from(y)}};
    }

    function restore(saved){
      check(saved?.format===checkpointFormat&&saved.version===1&&equal(saved.identity,identity)&&saved.sampleRate===sampleRate&&
        integer(saved.sample,0,Number.MAX_SAFE_INTEGER)&&values(saved.buffers?.position,n)&&values(saved.buffers?.quadrature,n),
      'Incompatible modal resonator checkpoint');
      x.set(saved.buffers.position);y.set(saved.buffers.quadrature);sample=saved.sample;
    }

    function displacement(gains){
      let sum=0;
      for(let i=0;i<n;i++)sum+=x[i]*gains[i];
      check(finite(sum),'Modal output exceeded numerical range');
      return sum;
    }

    function process(count,{forces={},impulses=[],collect=true}={}){
      check(integer(count,0,65536)&&count+sample<=Number.MAX_SAFE_INTEGER&&
        (!collect||count*outputs.length<=1000000)&&typeof collect==='boolean'&&record(forces)&&
        Object.keys(forces).every(name=>own(bound.excitations,name))&&Array.isArray(impulses)&&impulses.length<=8192,
      'Invalid modal block, sources, or impulse table');
      check(n*(count*(2+inputs.length+outputs.length)+impulses.length)<=maxWork,'Modal block exceeded its work limit');
      const levels=inputs.map(([name])=>{
        const level=own(forces,name)?forces[name]:0;
        check(finite(level)||values(level,count),'Modal force needs a finite level or one value per sample');
        return level;
      });
      const events=new Map();
      for(const event of impulses){
        const {excitation,sample:at,fraction=0,value}=event??{};
        check(own(bound.excitations,excitation)&&integer(at,sample,sample+count-1)&&finite(fraction)&&
          fraction>=0&&fraction<1&&finite(value),'Invalid or out-of-block modal impulse');
        if(!events.has(at))events.set(at,[]);
        events.get(at).push({gains:bound.excitations[excitation].gains,span:(1-fraction)*dt,value});
      }
      const out=collect?outputs.map(()=>new Float64Array(count)):null, before=snapshot({typed:true});
      try{
        for(let i=0;i<count;i++){
          if(collect)for(const [j,[,{gains}]] of outputs.entries())out[j][i]=displacement(gains);
          const arriving=events.get(sample+i);
          for(let j=0;j<n;j++){
            const {omega,decay,c,s,fx,fy}=rot[j];
            let force=0;
            for(const [k,[,{gains}]] of inputs.entries())force+=gains[j]*(typeof levels[k]==='number'?levels[k]:levels[k][i]);
            let position=c*x[j]+s*y[j]+fx*force, quad=c*y[j]-s*x[j]+fy*force;
            if(arriving)for(const event of arriving){
              const scale=event.value*event.gains[j]/omega*Math.exp(-decay*event.span);
              position+=scale*Math.sin(omega*event.span);
              quad+=scale*Math.cos(omega*event.span);
            }
            check(finite(position)&&finite(quad),'Modal state exceeded numerical range');
            x[j]=position;y[j]=quad;
          }
        }
        for(const [,{gains}] of outputs)displacement(gains);
      }catch(error){restore(before);throw error;}
      const start=sample;
      sample+=count;
      return {start,end:sample,...(collect&&{pickups:Object.fromEntries(outputs.map(([name],i)=>[name,out[i]]))})};
    }

    function view(){
      return {sample,time:sample/sampleRate,pickups:Object.fromEntries(outputs.map(([name,{gains}])=>[name,displacement(gains)]))};
    }
    function reset(){x.fill(0);y.fill(0);sample=0;}
    return Object.freeze({info,process,view,snapshot,restore,reset});
  }
  W.resonantModes=Object.freeze({planFormat:A.planFormat,assetFormat:A.assetFormat,runFormat,traceFormat,checkpointFormat,
    bake:A.bake,shape:A.shape,bind:A.bind,prepare});
})(KIT);
