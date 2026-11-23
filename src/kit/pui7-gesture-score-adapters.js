/* Publish one authored score to world ports and the time-aware graph runner. */
(function(K){
  const W=K.world,P=K.procedural,G=W.gestureScores,{check}=W.data;
  const {fields}=W.boundarySignals;

  W.runtime.register('gesture-score',config=>{
    check(fields(config,['score']),'Gesture-score system needs config.score');
    const score=G.prepare(config.score), player=score.open();
    const outputs=Object.fromEntries(Object.entries(score.info.channels).map(([name,{type,quantity}])=>{
      // A world port publishes at its host cadence. The score retains its internal rate.
      const {sampleRate,...physical}=quantity??{};
      return [name,{type,...(quantity&&{quantity:physical})}];
    }));
    function withState(state,read){
      player.restore(state);
      return read();
    }
    return {
      outputs,initial:()=>score.open().snapshot(),validateState:player.restore,
      step(state,{time}){
        return withState(state,()=>{
          const tick=score.tickAt(time);
          if(tick===player.position())return state;
          player.advance(tick);
          return player.snapshot();
        });
      },
      output:state=>withState(state,player.values),
      fields:{score:{type:'record',read:({state})=>W.query.ok(withState(state,player.view))}}
    };
  });

  const optional={type:'record',default:{}};
  const operation={
    time:true, cacheVersion:1,
    description:'Blend overlapping gesture targets and sample executed scalar or vector controls on the graph or take clock.',
    inputs:{
      score:{type:'record',description:'A versioned ink-studio/gesture-score document.'},
      options:{...optional,properties:{tick:{type:'number',unit:'score tick',constraints:{integer:true,min:0}}}},
      checkpoint:{...optional,description:'Start from a saved checkpoint of this score.'}
    },
    outputs:{value:'record',outputs:'record',checkpoint:'record'},
    instantiate(){
      let prepared,player,previous,previousCheckpoint,baseline;
      return ({score,options,checkpoint},{time,take})=>{
        check(fields(options,['tick']),'Unknown gesture score graph option');
        if(score!==previous||checkpoint!==previousCheckpoint){
          const next=G.prepare(score), saved=Object.keys(checkpoint).length?checkpoint:undefined;
          const cursor=next.open(saved);
          prepared=next;player=cursor;baseline=saved;
          previous=score;previousCheckpoint=checkpoint;
        }
        const tick=options.tick===undefined?prepared.tickAt(time,take):options.tick;
        check(Number.isSafeInteger(tick)&&tick>=(baseline?.tick??0),'Gesture graph cannot seek before its starting checkpoint');
        if(tick<player.position())player=prepared.open(baseline);
        player.advance(tick);
        const value=player.view();
        return {value,outputs:Object.fromEntries(Object.entries(value.channels).map(([name,row])=>[name,row.value])),
          checkpoint:player.snapshot()};
      };
    }
  };
  P.graph.operations=Object.freeze({...P.graph.operations,'sim.gesture-score':Object.freeze(operation)});
})(KIT);
