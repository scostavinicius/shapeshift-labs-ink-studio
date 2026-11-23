/* Track executable score targets with bounded travel, slew and acceleration. */
(function(K){
  const W=K.world,{check,equal}=W.data,D=W.gestureScoreData;
  const {format,traceFormat,maxTick,integer,compile,workspace,evaluate,pack,clamp,mix}=D;
  const clock=K.procedural.takeTime, finite=Number.isFinite;
  const checkpointFormat='ink-studio/gesture-score-checkpoint', maxWork=8000000;
  const bounded=(track,i,value)=>clamp(value,track.min?.[i]??-Infinity,track.max?.[i]??Infinity);
  const slew=(from,to,step)=>Math.abs(to-from)<=step?to:from+(to>from?step:-step);
  const same=(a,b,n)=>Math.abs(a-b)<=n;

  function prepare(asset){
    const spec=compile(asset), {tracks,limited,size,work,sampleWork,info}=spec;
    const {identity}=info, rate=identity.rate;

    function tickAt(time,take){
      let index;
      if(take!==undefined){
        index=clock.index(clock.roundDown(clock.mul(clock.requireFrame(take).start,[BigInt(rate),1n])));
      }else{
        check(finite(time)&&time>=0,'Gesture time must be nonnegative seconds');
        const at=time*rate, rounded=Math.round(at);
        // Rejoin a floating host clock at an authored integer tick to machine precision.
        index=Math.abs(at-rounded)<=2*Number.EPSILON*Math.max(1,at)?rounded:Math.floor(at);
      }
      check(integer(index,0,maxTick),'Gesture time lies outside the score clock');
      return index;
    }

    function requested(time){
      check(finite(time)&&time>=0&&time<=maxTick/rate,'Gesture time lies outside the score clock');
      const work=workspace();
      return Object.fromEntries(tracks.map(track=>{
        const contributors=[], raw=evaluate(track,time,work,contributors), requested=pack(track,raw);
        for(let i=0;i<track.size;i++)raw[i]=bounded(track,i,raw[i]);
        return [track.name,{requested,target:pack(track,raw),contributors}];
      }));
    }

    function open(saved){
      let tick=0;
      const position=new Float64Array(size), waypoint=new Float64Array(size), velocity=new Float64Array(size);
      const nextPosition=position.slice(), nextWaypoint=waypoint.slice(), nextVelocity=velocity.slice(), scratch=workspace();
      for(const {state,base} of limited){position.set(base,state);waypoint.set(base,state);}

      function advance(end){
        check(integer(end,tick,maxTick),'Gesture player needs a forward score tick');
        check((end-tick)*work<=maxWork,'Gesture advance exceeds its motion work budget; split it into shorter spans');
        if(end===tick)return tick;
        if(work){
          nextPosition.set(position);nextWaypoint.set(waypoint);nextVelocity.set(velocity);
          for(let at=tick+1;at<=end;at++){
            const time=at/rate;
            for(const track of limited){
              const {state,size,step,alpha}=track, raw=evaluate(track,time,scratch);
              for(let i=0;i<size;i++){
                const index=state+i, target=bounded(track,i,raw[i]), previous=nextPosition[index];
                const destination=bounded(track,i,slew(nextWaypoint[index],target,step[i]));
                const actual=bounded(track,i,mix(previous,destination,alpha[i]));
                const speed=(actual-previous)*rate;
                check(finite(destination)&&finite(actual)&&finite(speed),'Gesture motion exceeded numeric range on '+track.name);
                nextWaypoint[index]=destination;nextPosition[index]=actual;nextVelocity[index]=speed;
              }
            }
          }
          position.set(nextPosition);waypoint.set(nextWaypoint);velocity.set(nextVelocity);
        }
        tick=end;
        return tick;
      }

      function values(){
        const time=tick/rate;
        return Object.fromEntries(tracks.map(track=>{
          if(track.state!==undefined)return [track.name,pack(track,position,track.state)];
          const raw=evaluate(track,time,scratch);
          for(let i=0;i<track.size;i++)raw[i]=bounded(track,i,raw[i]);
          return [track.name,pack(track,raw)];
        }));
      }

      function view(){
        const time=tick/rate, channels=requested(time);
        for(const track of tracks){
          const {name,state,alpha}=track, row=channels[name];
          const target=track.size===1?[row.target]:row.target, unconstrained=track.size===1?[row.requested]:row.requested;
          const axes=target.map((value,i)=>{
            const flags=[];
            if(value!==unconstrained[i])flags.push('range');
            if(state!==undefined){
              if(waypoint[state+i]!==value)flags.push('speed');
              if(alpha[i]<1&&position[state+i]!==waypoint[state+i])flags.push('acceleration');
            }
            return flags;
          });
          row.value=state===undefined?row.target:pack(track,position,state);
          if(state!==undefined)row.velocity=pack(track,velocity,state);
          row.limits=track.size===1?axes[0]:axes;
        }
        return {tick,time,channels};
      }

      function snapshot(){
        return {format:checkpointFormat,version:1,score:identity,tick,
          position:Array.from(position),waypoint:Array.from(waypoint),velocity:Array.from(velocity)};
      }

      function restore(saved){
        const isField=row=>Array.isArray(row)&&row.length===size&&Array.from(row).every(finite);
        check(saved?.format===checkpointFormat&&saved.version===1&&equal(saved.score,identity)&&
          integer(saved.tick,0,maxTick)&&[saved.position,saved.waypoint,saved.velocity].every(isField),
          'Incompatible gesture score checkpoint');
        for(const {state,size,base,speed,step,alpha,...track} of limited)for(let i=0;i<size;i++){
          const p=saved.position[state+i], q=saved.waypoint[state+i], v=saved.velocity[state+i];
          const scale=Math.max(Math.abs(p),Math.abs(q),step[i]), delta=v/rate;
          const valid=saved.tick===0?p===base[i]&&q===p&&v===0:
            p===bounded(track,i,p)&&q===bounded(track,i,q)&&Math.abs(v)<=speed[i]+(8*Number.EPSILON*scale)*rate&&
            same((1-alpha[i])*delta,alpha[i]*q-alpha[i]*p,8*Number.EPSILON*scale);
          check(valid,'Invalid gesture motion checkpoint on '+track.name);
        }
        position.set(saved.position);waypoint.set(saved.waypoint);velocity.set(saved.velocity);tick=saved.tick;
      }
      if(saved!==undefined)restore(saved);
      return Object.freeze({advance,values,view,snapshot,restore,position:()=>tick});
    }

    function trace({fromTick,toTick=fromTick,every=1,checkpoint}={}){
      const player=open(checkpoint), from=fromTick??player.position(), to=toTick??from;
      check(integer(from,player.position(),maxTick)&&integer(to,from,maxTick)&&integer(every,1,maxTick),
        'Gesture trace needs ordered ticks and a positive sample stride');
      const count=Math.ceil((to-from)/every)+1;
      check(count<=4096&&count*sampleWork<=200000&&(to-player.position())*work<=maxWork,
        'Gesture trace exceeds its sample, evidence, or motion work budget');
      const frames=[];
      for(let tick=from;;tick=Math.min(to,tick+every)){
        player.advance(tick);
        frames.push(player.view());
        if(tick===to)break;
      }
      return {format:traceFormat,version:1,score:info,frames,checkpoint:player.snapshot()};
    }

    return Object.freeze({info,tickAt,requested,open,trace});
  }

  W.gestureScores=Object.freeze({format,traceFormat,checkpointFormat,prepare});
})(KIT);
