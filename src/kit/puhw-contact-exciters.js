/* Deterministic sample-rate contact impulses and sustained excitation forces. */
(function(K){
  const W=K.world,P=W.contactExciterPlans,C=W.contactSamples,{V}=K,{check,record,equal,vector,own}=W.data;
  const {integer}=P, finite=Number.isFinite, zero=[0,0,0];
  const runFormat='ink-studio/contact-excitation-run', traceFormat='ink-studio/contact-excitation-trace',
    checkpointFormat='ink-studio/contact-excitation-checkpoint';
  const signals=['point','slip','impulse','force'];

  function geometry(track,at){
    const keys=track.keys;
    if(!keys.length)return track;
    let a=0,b=keys.length;
    while(b-a>1){
      const mid=(a+b)>>1;
      if(keys[mid].at<=at)a=mid;
      else b=mid;
    }
    if(at<=keys[a].at||b===keys.length)return keys[a];
    const left=keys[a],right=keys[b], u=(at-left.at)/(right.at-left.at);
    return {point:V.lerp(left.point,right.point,u),slip:V.lerp(left.slip,right.slip,u),
      load:left.load+u*(right.load-left.load)};
  }

  function prepare(plan){
    const {tracks,sampleRate,identity}=P.compile(plan), n=tracks.length;
    const travel=new Float64Array(n), bristles=new Float64Array(n*3), active=new Uint8Array(n);
    const last=Object.fromEntries(signals.map(key=>[key,new Float64Array(n*3)]));
    const buffers={travel,bristles,active,...last};
    const info=Object.freeze({sampleRate,identity:Object.freeze(identity),
      tracks:Object.freeze(tracks.map(({name,kind})=>Object.freeze({name,kind})))});
    let cursor=0;

    function reset(){
      cursor=0;
      for(const value of Object.values(buffers))value.fill(0);
      for(const track of tracks)last.point.set(track.point,track.index*3);
    }

    function snapshot({typed=false}={}){
      return {format:checkpointFormat,version:1,identity,sampleRate,cursor,
        buffers:Object.fromEntries(Object.entries(buffers).map(([name,list])=>[name,typed?list.slice():Array.from(list)]))};
    }
    function restore(saved){
      check(saved?.format===checkpointFormat&&saved.version===1&&equal(saved.identity,identity)&&saved.sampleRate===sampleRate&&
        integer(saved.cursor,0,Number.MAX_SAFE_INTEGER)&&record(saved.buffers)&&
        Object.keys(saved.buffers).length===Object.keys(buffers).length&&Object.entries(buffers).every(([name,list])=>{
          const data=saved.buffers[name];
          return (Array.isArray(data)||ArrayBuffer.isView(data))&&data.length===list.length&&Array.from(data).every(finite)&&
            (name!=='active'||Array.from(data).every(value=>value===0||value===1))&&
            (name!=='travel'||Array.from(data).every(value=>value>=0));
        }),'Incompatible contact excitation checkpoint');
      for(const [name,list] of Object.entries(buffers))list.set(saved.buffers[name]);
      cursor=saved.cursor;
    }

    function view(){
      const values=Object.fromEntries(tracks.map(({name,kind,index,normal})=>[name,{kind,active:active[index]===1,
        normal:normal.slice(),...Object.fromEntries(signals.map(key=>[key,Array.from(last[key].subarray(index*3,index*3+3))]))}]));
      return {sample:cursor,time:cursor/sampleRate,tracks:values};
    }

    function process(count,{collect=true,collectEvents=true,controls={}}={}){
      check(integer(count,0,65536)&&cursor+count<=Number.MAX_SAFE_INTEGER&&typeof collect==='boolean'&&
        typeof collectEvents==='boolean'&&(!collect||count*n<=262144),'Contact block exceeds its sample budget');
      check(record(controls)&&Object.keys(controls).every(name=>tracks.some(track=>track.name===name)),
        'Contact controls must name known tracks');
      const levels=tracks.map(track=>{
        if(!own(controls,track.name))return null;
        const value=controls[track.name], {point,slip,load}=value??{};
        check(record(value)&&Object.keys(value).every(key=>['point','slip','load'].includes(key))&&
          (point===undefined||vector(point))&&(slip===undefined||vector(slip))&&
          (load===undefined||track.total===undefined&&finite(load)&&load>=0),'Invalid contact control on '+track.name);
        return {...(point!==undefined&&{point:point.slice()}),
          ...(slip!==undefined&&{slip:C.tangent(slip,track.normal)}),...(load!==undefined&&{load})};
      });
      const pose=(track,at)=>{
        const shape=geometry(track,at), level=levels[track.index];
        return level?{...shape,...level}:shape;
      };
      const events=[], before=snapshot({typed:true});
      const output=collect?tracks.map(()=>({active:new Uint8Array(count),
        ...Object.fromEntries(signals.map(key=>[key,new Float64Array(count*3)]))})):null;

      function emit(track,phase,at,interval,impulse,shape,sample){
        if(!collectEvents)return;
        check(events.length<8192,'Contact block exceeded its event budget; split the block');
        events.push(C.sample({kind:track.kind,track:track.name,phase,point:shape.point,slip:shape.slip,
          normal:track.normal,interval,impulse},{time:at/sampleRate,sample,fraction:Math.max(0,Math.min(1,at-sample))}));
      }

      function drive(track,index){
        const i=track.index, offset=3*i, left=Math.max(track.start,index),right=Math.min(track.stop,index+1);
        const pulse=track.total!==undefined, instantaneous=pulse&&track.start===track.stop&&Math.floor(track.start)===index;
        const present=right>left||instantaneous;
        const shape=pose(track,present?(left+right)/2:index+.5), {point,slip}=shape;
        const {normal,kind}=track, duration=Math.max(0,right-left)/sampleRate;
        let impulse=zero;

        if(present&&pulse){
          const {start,stop,total}=track, span=stop-start;
          let portion=1;
          if(!instantaneous){
            const integral=kind==='impact'?u=>.5*(1-Math.cos(Math.PI*u)):u=>u+Math.sin(Math.PI*u)/Math.PI;
            portion=integral((right-start)/span)-integral((left-start)/span);
          }
          impulse=V.mul(total,portion);
          if(Math.floor(start)===index)emit(track,'onset',start,instantaneous?1/sampleRate:span/sampleRate,total,shape,index);
        }else if(present){
          const speed=V.len(slip), {load}=shape;
          let force;
          if(kind==='bow'){
            const previous=Array.from(bristles.subarray(offset,offset+3));
            let next=V.mad(previous,slip,duration), shear=V.mul(next,track.stiffness);
            const amount=V.len(shear);
            if(amount>track.staticFriction*load){
              const coefficient=W.stickSlip.dynamic(track.kineticFriction,track.staticFriction,speed,track.slipScale);
              shear=V.mul(shear,coefficient*load/amount);
              next=V.mul(shear,1/track.stiffness);
            }
            bristles.set(next,offset);
            force=V.mad(shear,normal,load);
          }else if(kind==='scrape'){
            const step=speed*duration, grain=(travel[i]+.5*step)/track.grain;
            const at=Math.floor(grain), fraction=grain-at;
            const texture=j=>2*K.procedural.data.hash(String(j),track.seed)/4294967296-1;
            const rough=track.roughness*(texture(at)+(texture(at+1)-texture(at))*fraction);
            travel[i]+=step;
            force=speed>0?V.mad(V.mul(normal,load*(1+.55*rough)),slip,track.friction*load*(1+rough)/speed):
              V.mul(normal,load);
          }else{
            const phase=travel[i], step=speed/track.spacing*duration, end=phase+step;
            check(step<=16&&end<=Number.MAX_SAFE_INTEGER,'Chatter tooth rate exceeds its per-sample budget');
            const {duty}=track, area=p=>Math.floor(p)*duty+Math.min(p%1,duty);
            const before=(phase%1)<duty?1:0;
            const portion=end>phase?Math.max(0,Math.min(1,(area(end)-area(phase))/step)):before;
            force=V.mul(normal,load*portion/duty);
            if(collectEvents&&step>0)for(let j=Math.max(1,Math.ceil(phase));j<end;j++){
              const at=left+(right-left)*(j-phase)/step;
              if(at>=track.stop)continue;
              const period=track.spacing/speed;
              emit(track,'tooth',at,period*duty,V.mul(normal,load*period),pose(track,at),index);
            }
            travel[i]=end;
          }
          impulse=V.mul(force,duration);
          if(Math.floor(track.start)===index)emit(track,'onset',track.start,duration,impulse,pose(track,track.start),index);
        }
        const force=V.mul(impulse,sampleRate);
        check(vector(point)&&vector(slip)&&vector(force)&&vector(impulse)&&finite(travel[i]),
          'Contact excitation exceeded its numeric range');
        active[i]=present?1:0;
        for(const [key,value] of [['point',point],['slip',present?slip:zero],['impulse',impulse],['force',force]])
          last[key].set(value,offset);
      }

      try{
        for(let i=0;i<count;i++)for(const track of tracks){
          drive(track,cursor+i);
          if(collect){
            const dst=output[track.index], offset=track.index*3;
            dst.active[i]=active[track.index];
            for(const key of signals)dst[key].set(last[key].subarray(offset,offset+3),i*3);
          }
        }
        check(bristles.every(finite),'Contact excitation exceeded its state range');
      }catch(error){
        restore(before);
        throw error;
      }
      const start=cursor;
      cursor+=count;
      events.sort((a,b)=>a.timing.time-b.timing.time);
      return {start,end:cursor,events,...(collect&&{tracks:Object.fromEntries(tracks.map(({name},i)=>[name,output[i]]))})};
    }

    reset();
    return Object.freeze({info,process,view,snapshot,restore,reset});
  }

  W.contactExciters=Object.freeze({format:P.format,runFormat,traceFormat,checkpointFormat,prepare});
})(KIT);
