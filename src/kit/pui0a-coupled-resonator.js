/* Two modal bodies joined by a reciprocal spring and damper on the audio clock. */
(function (K) {
  const W=K.world,R=W.resonantModes,A=W.modalAssets,{check,record,id,own,equal}=W.data;
  const {freeze,hash}=K.procedural.data,{integer}=A;
  const runFormat='ink-studio/coupled-resonant-mode-run',traceFormat='ink-studio/coupled-resonant-mode-trace',
    checkpointFormat='ink-studio/coupled-resonant-mode-checkpoint';
  const fields=(raw,keys)=>record(raw)&&Object.keys(raw).every(key=>keys.includes(key));
  const finite=Number.isFinite,range=(n,lo,hi)=>finite(n)&&n>=lo&&n<=hi;
  const list=value=>Array.isArray(value)||value instanceof Float32Array||value instanceof Float64Array;
  function values(raw,count,test=finite){
    if(!list(raw)||raw.length!==count)return false;
    for(let i=0;i<count;i++)if(!test(raw[i]))return false;
    return true;
  }
  function drive(value,count,test=finite){
    return test(value)||values(value,count,test);
  }
  const unit=value=>range(value,0,1), at=(value,index)=>typeof value==='number'?value:value[index];
  function dot(left,right){
    let sum=0;
    for(let i=0;i<left.length;i++)sum+=left[i]*right[i];
    return sum;
  }
  function prepare(spec,settings={}){
    check(fields(spec,['bodies','contact'])&&record(spec.bodies)&&Object.keys(spec.bodies).length===2&&
      fields(spec.contact,['stiffness','damping','slewMs','initial'])&&fields(settings,['sampleRate','maxWork']),
    'Coupled resonance needs two named modal bodies and a contact');
    const {sampleRate=48000,maxWork=80000000}=settings;
    const {stiffness,damping=0,slewMs=3,initial=0}=spec.contact;
    check(integer(sampleRate,1000,192000)&&integer(maxWork,1,200000000)&&
      range(stiffness,0,1e12)&&range(damping,0,1e8)&&range(slewMs,0,1000)&&unit(initial),
    'Invalid coupled resonance sample rate or contact coefficients');
    let n=0;
    const bodies=Object.entries(spec.bodies).map(([name,raw])=>{
      check(id(name)&&fields(raw,['asset','site'])&&id(raw.site),'Name a modal asset and its contact site for each body');
      const bound=A.bind(raw.asset);
      check(own(bound.excitations,raw.site)&&bound.excitations[raw.site].gains.some(gain=>gain!==0),
        'Contact needs a known, participating excitation site on '+name);
      const body={name,asset:raw.asset.id,revision:raw.asset.revision,site:raw.site,...bound,first:n};
      n+=bound.modes.length;
      return body;
    });
    const byName=Object.fromEntries(bodies.map(body=>[body.name,body]));
    const modes=bodies.flatMap(body=>body.modes);
    const u=Float64Array.from(bodies.flatMap(({excitations,site},i)=>excitations[site].gains.map(gain=>i?-gain:gain)));
    const spring=Float64Array.from(modes,({hz,decay})=>(2*Math.PI*hz)**2+decay**2);
    const drag=Float64Array.from(modes,({decay})=>2*decay);
    const maxHz=Math.sqrt(Math.max(...spring)+stiffness*dot(u,u))/(2*Math.PI);
    check(finite(maxHz)&&maxHz<.49*sampleRate&&finite(dot(u,u)*damping),
      'Coupled modal bandwidth exceeds the sample-rate limit');
    const substeps=Math.max(1,Math.ceil(maxHz/(.08*sampleRate)));
    const dt=1/sampleRate, halfStep=dt/(2*substeps),slew=slewMs?1000/(sampleRate*slewMs):1;
    const diagonal=half=>Float64Array.from(spring,(k,i)=>1/(1+half*drag[i]+half**2*k));
    const inverse=diagonal(halfStep), direction=u.map((gain,i)=>gain*inverse[i]), norm=dot(u,direction);
    const q=new Float64Array(n),v=q.slice(),rhs=q.slice(),force=q.slice();
    const contact=freeze({stiffness,damping,slewMs,initial});
    const summary=Object.fromEntries(bodies.map(({first,name,...body})=>[name,body]));
    const identity=hash(JSON.stringify([summary,contact,sampleRate]));
    const drives=bodies.flatMap(body=>Object.entries(body.excitations).map(([name,{gains}])=>({body,name,gains})));
    const reads=bodies.flatMap(body=>Object.entries(body.pickups).map(([name,{gains}])=>({body,name,gains})));
    const workPerSample=n*(14*substeps+drives.length+2*reads.length);
    const impulseWork=14*n*substeps;
    const info=freeze({identity,sampleRate,maxWork,maxHz,substeps,workPerSample,impulseWork,bodies:summary,contact});
    let sample=0,level=initial,target=initial;

    function snapshot({typed=false}={}){
      return {format:checkpointFormat,version:1,identity,sampleRate,sample,level,target,
        buffers:{position:typed?q.slice():Array.from(q),velocity:typed?v.slice():Array.from(v)}};
    }
    function restore(saved){
      check(saved?.format===checkpointFormat&&saved.version===1&&equal(saved.identity,identity)&&saved.sampleRate===sampleRate&&
        integer(saved.sample,0,Number.MAX_SAFE_INTEGER)&&unit(saved.level)&&unit(saved.target)&&
        values(saved.buffers?.position,n)&&values(saved.buffers?.velocity,n),'Incompatible coupled resonator checkpoint');
      q.set(saved.buffers.position);
      v.set(saved.buffers.velocity);
      ({sample,level,target}=saved);
    }
    function reset(){q.fill(0);v.fill(0);sample=0;level=target=initial;}
    function read(buffer,{body:{first},gains}){
      let value=0;
      for(let i=0;i<gains.length;i++)value+=buffer[first+i]*gains[i];
      check(finite(value),'Coupled pickup exceeded numerical range');
      return value;
    }
    function tracks(make){
      return Object.fromEntries(bodies.map(({name,pickups})=>[name,
        Object.fromEntries(Object.keys(pickups).map(pickup=>[pickup,make(name,pickup)]))]));
    }
    function view(){
      const energy=Object.fromEntries(bodies.map(({name,first,modes})=>{
        let sum=0;
        for(let i=first;i<first+modes.length;i++)sum+=.5*(v[i]**2+spring[i]*q[i]**2);
        return [name,sum];
      }));
      const separation=dot(u,q),relativeVelocity=dot(u,v),elastic=.5*level*stiffness*separation**2;
      const contactForce=level?-level*(stiffness*separation+damping*relativeVelocity):0;
      const total=elastic+Object.values(energy).reduce((a,b)=>a+b,0);
      check(finite(total)&&finite(contactForce),'Coupled energy or force exceeded numerical range');
      const pickups=tracks(()=>0),velocities=tracks(()=>0);
      for(const row of reads){
        pickups[row.body.name][row.name]=read(q,row);
        velocities[row.body.name][row.name]=read(v,row);
      }
      return {sample,time:sample/sampleRate,pickups,velocities,
        contact:{level,target,force:contactForce},energy:{bodies:energy,contact:elastic,total}};
    }
    function advance(span){
      if(!span)return;
      const count=Math.max(1,Math.ceil(span*substeps-1e-10)),half=span*dt/(2*count);
      const inv=span===1?inverse:diagonal(half), w=span===1?direction:u.map((gain,i)=>gain*inv[i]);
      const hnorm=span===1?norm:dot(u,w),k=level*stiffness,beta=half*(level*damping+half*k);
      for(let step=0;step<count;step++){
        // Eliminate midpoint position and solve the remaining diagonal plus rank-one system.
        const contactForce=k*dot(u,q);
        for(let i=0;i<n;i++)rhs[i]=(v[i]+half*(force[i]-spring[i]*q[i]-u[i]*contactForce))*inv[i];
        const correction=beta*dot(u,rhs)/(1+beta*hnorm);
        for(let i=0;i<n;i++){
          const midpoint=rhs[i]-w[i]*correction;
          q[i]+=2*half*midpoint;
          v[i]=2*midpoint-v[i];
          check(finite(q[i])&&finite(v[i]),'Coupled resonance exceeded numerical range');
        }
      }
    }
    function process(count,options={}){
      check(fields(options,['contact','forces','impulses','collect']),'Invalid coupled block controls');
      const {contact:levels=target,forces={},impulses=[],collect=true}=options;
      check(integer(count,0,65536)&&Number.isSafeInteger(sample+count)&&typeof collect==='boolean'&&
        (!collect||count*(2*reads.length+1)<=1000000)&&drive(levels,count,unit)&&record(forces)&&
        Object.entries(forces).every(([name,rows])=>own(byName,name)&&record(rows)&&
          Object.entries(rows).every(([site,value])=>own(byName[name].excitations,site)&&drive(value,count)))&&
        Array.isArray(impulses)&&impulses.length<=8192,'Invalid coupled block, contact level or excitations');
      check(workPerSample*count+impulseWork*impulses.length<=maxWork,'Coupled block exceeds its work limit');
      const events=new Map();
      for(const row of impulses){
        const {body,excitation,sample:when,fraction=0,value}=row??{};
        check(fields(row,['body','excitation','sample','fraction','value'])&&own(byName,body)&&
          own(byName[body].excitations,excitation)&&integer(when,sample,sample+count-1)&&range(fraction,0,1)&&fraction<1&&finite(value),
        'Invalid or out-of-block coupled impulse');
        const list=events.get(when)??[];
        list.push({first:byName[body].first,gains:byName[body].excitations[excitation].gains,fraction,value});
        events.set(when,list);
      }
      for(const row of events.values())row.sort((a,b)=>a.fraction-b.fraction);
      const inputs=drives.flatMap(({body:{name:body,first},name,gains})=>
        own(forces,body)&&own(forces[body],name)?[{first,gains,value:forces[body][name]}]:[]);
      const pickups=collect&&tracks(()=>new Float64Array(count)), velocities=collect&&tracks(()=>new Float64Array(count));
      const amount=collect&&new Float64Array(count),before=snapshot({typed:true});
      try{
        for(let i=0;i<count;i++){
          target=at(levels,i);
          level=Math.abs(target-level)<=slew?target:level+Math.sign(target-level)*slew;
          if(collect){
            amount[i]=level;
            for(const row of reads){
              pickups[row.body.name][row.name][i]=read(q,row);
              velocities[row.body.name][row.name][i]=read(v,row);
            }
          }
          force.fill(0);
          for(const {first,gains,value} of inputs){
            const amplitude=at(value,i);
            for(let j=0;j<gains.length;j++)force[first+j]+=amplitude*gains[j];
          }
          let cursor=0;
          for(const {first,gains,fraction,value} of events.get(sample+i)??[]){
            advance(fraction-cursor);
            for(let j=0;j<gains.length;j++)v[first+j]+=gains[j]*value;
            cursor=fraction;
          }
          advance(1-cursor);
        }
        view();
      }catch(error){restore(before);throw error;}
      const start=sample;
      sample+=count;
      return {start,end:sample,...(collect&&{pickups,velocities,contact:amount})};
    }
    return Object.freeze({info,process,view,snapshot,restore,reset});
  }
  W.resonantModes=Object.freeze({...R,prepareCoupled:prepare,coupledRunFormat:runFormat,
    coupledTraceFormat:traceFormat,coupledCheckpointFormat:checkpointFormat});
})(KIT);
