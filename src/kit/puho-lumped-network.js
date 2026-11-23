/* Simulate reusable effort/flow elements and publish power and conservation evidence. */
(function(K){
  const W=K.world, {check,record,own,equal}=W.data;
  const T=W.lumpedTopology, finite=Number.isFinite;
  const runFormat='ink-studio/lumped-network-run', traceFormat='ink-studio/lumped-network-trace',
    checkpointFormat='ink-studio/lumped-network-checkpoint';

  function prepare(definition,{diagnostics}={}){
    const {layout,initial,inputs,outputs,numeric,nodes,elements,junctions,solve}=T.compile(definition);
    const energyIn=initial.length-2, energyOut=initial.length-1;
    const reviewOptions=diagnostics===undefined?null:W.diagnostics.create(diagnostics);
    let review=reviewOptions?.fork();
    const connections=review&&nodes.map((node,i)=>node.kind!=='junction'?null:{
      kind:'connection',node:node.name,
      elements:elements.filter(edge=>edge.from===i||edge.to===i).map(edge=>edge.name)
    });
    const through=review&&new Float64Array(nodes.length);
    const defaults=Object.fromEntries(Object.entries(inputs).map(([key,port])=>[key,port.default]));
    const e=new Float64Array(nodes.length), net=new Float64Array(nodes.length),
      junctionLoad=new Float64Array(junctions.length);
    const q=new Float64Array(elements.length), drive=new Float64Array(elements.length);
    const read=(d,input)=>d.input===undefined?d.value:input[d.input]*d.scale+d.offset;
    let applied=defaults, lossPower=0, sourcePower=0, junctionResidual=0;

    function levels(values={}){
      check(record(values)&&Object.entries(values).every(([key,value])=>own(inputs,key)&&finite(value)),
        'Network inputs must name declared finite level ports');
      return {...defaults,...values};
    }
    function energy(state){
      let total=0;
      for(const node of nodes)if(node.kind==='storage')total+=.5*node.capacity*state[node.state]**2;
      for(const edge of elements)if(edge.state!==undefined)
        total+=.5*(edge.inertance??edge.stiffness)*state[edge.state]**2;
      check(finite(total),'Network stored energy exceeded the numeric range');
      return total;
    }
    const initialEnergy=energy(initial);

    function evaluate(state,input){
      net.fill(0);
      junctionLoad.fill(0);
      sourcePower=0;lossPower=0;junctionResidual=0;
      for(const [i,node] of nodes.entries()){
        e[i]=node.kind==='reference'?read(node.drive,input):node.kind==='storage'?state[node.state]:0;
      }
      for(const [i,edge] of elements.entries()){
        const {from,to,conductance:g,kind}=edge;
        const value=edge.drive===undefined?0:read(edge.drive,input);
        drive[i]=value;
        q[i]=g>0?g*(e[from]-e[to]+value):kind==='inertance'?state[edge.state]:
          kind==='spring'?edge.stiffness*state[edge.state]:value;
        const a=nodes[from].junction,b=nodes[to].junction;
        if(a>=0)junctionLoad[a]-=q[i];
        if(b>=0)junctionLoad[b]+=q[i];
      }
      solve(junctionLoad);
      for(const [j,i] of junctions.entries())e[i]=junctionLoad[j];

      for(const [i,edge] of elements.entries()){
        const {from,to,conductance:g,kind}=edge, drop=e[from]-e[to];
        if(g>0){
          const effective=drop+drive[i];
          q[i]=g*effective;
          lossPower+=q[i]*effective;
          sourcePower+=drive[i]*q[i];
        }else if(kind==='inertance'){
          lossPower+=edge.resistance*q[i]**2;
          sourcePower+=drive[i]*q[i];
        }else if(kind==='flow-source')sourcePower-=drop*q[i];
        net[from]+=q[i];
        net[to]-=q[i];
      }
      for(const [i,node] of nodes.entries()){
        if(node.kind==='reference')sourcePower+=e[i]*net[i];
        else if(node.kind==='junction')junctionResidual=Math.max(junctionResidual,Math.abs(net[i]));
      }
      check(e.every(finite)&&q.every(finite)&&net.every(finite)&&drive.every(finite)&&finite(sourcePower)&&finite(lossPower),
        'Network effort, flow, or power exceeded the numeric range');
    }
    function derivative(_time,state,out,input){
      evaluate(state,input);
      for(const [i,node] of nodes.entries())if(node.kind==='storage')out[node.state]=-net[i]/node.capacity;
      for(const [i,edge] of elements.entries())if(edge.state!==undefined){
        const drop=e[edge.from]-e[edge.to];
        out[edge.state]=edge.kind==='inertance'?(drop+drive[i]-edge.resistance*q[i])/edge.inertance:drop;
      }
      out[energyIn]=sourcePower;
      out[energyOut]=lossPower;
    }
    const solver=W.integrators.create({step:1/240,...numeric,initial,derivative});

    function report(time,state,input){
      evaluate(state,input);
      const stored=energy(state), supplied=state[energyIn], dissipated=state[energyOut];
      const balance=stored-initialEnergy-supplied+dissipated;
      check(finite(balance),'Network energy balance exceeded the numeric range');
      const ledger={initialEnergy,energy:stored,supplied,dissipated,balance,sourcePower,lossPower,junctionResidual};
      const nodeRows=Object.fromEntries(nodes.map(({name,kind,capacity},i)=>{
        const stored=capacity===undefined?undefined:capacity*e[i];
        check(stored===undefined||finite(stored),'Network stored quantity exceeded the numeric range');
        return [name,{kind,effort:e[i],flow:net[i],...(stored!==undefined&&{stored})}];
      }));
      const edgeRows=Object.fromEntries(elements.map(({name,kind,from,to,state:index},i)=>{
        const drop=e[from]-e[to];
        check(finite(drop),'Network effort drop exceeded the numeric range');
        return [name,{kind,flow:q[i],drop,...(kind==='spring'&&{displacement:state[index]})}];
      }));
      const ports=Object.fromEntries(Object.entries(outputs).map(([name,{group,index,measure}])=>
        [name,group==='ledger'?ledger[measure]:group==='nodes'?nodeRows[nodes[index].name][measure]:edgeRows[elements[index].name][measure]]));
      return {time,inputs:{...input},nodes:nodeRows,elements:edgeRows,ledger,outputs:ports};
    }
    function inspect({time,ledger}){
      if(!review)return;
      const {initialEnergy,energy,supplied,dissipated,balance}=ledger, expected=initialEnergy+supplied-dissipated;
      const block=review.fork();
      block.error('network-energy-balance',balance,
        Math.max(Math.abs(initialEnergy),Math.abs(energy),Math.abs(supplied),Math.abs(dissipated)),
        {kind:'network',id:layout.id},time,{energy,expected,initialEnergy,supplied,dissipated});
      through.fill(0);
      for(const [i,{from,to}] of elements.entries()){
        const amount=Math.abs(q[i]);
        through[from]=Math.max(through[from],amount);
        through[to]=Math.max(through[to],amount);
      }
      for(const i of junctions)block.error('network-junction-residual',net[i],through[i],connections[i],time,
        {unit:layout.units.flow??null});
      review.merge(block);
    }

    function view(){
      const {time,state}=solver.snapshot();
      return report(time,state,applied);
    }
    function advance(time,input=applied){
      const next=levels(input), before=solver.snapshot();
      try{
        const stepped=solver.advance(time,next);
        const measured=report(stepped.time,stepped.state,next);
        inspect(measured);
        applied=next;
        return {...measured,stats:stepped.stats};
      }catch(error){
        solver.restore(before);
        throw error;
      }
    }
    function snapshot(){
      return {format:checkpointFormat,version:1,layout,inputs:{...applied},integrator:solver.snapshot()};
    }
    function restore(saved){
      check(saved?.format===checkpointFormat&&saved.version===1&&equal(saved.layout,layout),
        'Incompatible lumped network checkpoint');
      const next=levels(saved.inputs), before=solver.snapshot();
      check(equal(next,saved.inputs),'Network checkpoint needs all level inputs');
      try{
        solver.restore(saved.integrator);
        const {time,state}=solver.snapshot();
        check(time>=0,'Network checkpoint time must be nonnegative');
        const measured=report(time,state,next);
        const beforeReview=review;
        review=reviewOptions?.fork();
        try{inspect(measured);}catch(error){review=beforeReview;throw error;}
        applied=next;
      }catch(error){
        solver.restore(before);
        throw error;
      }
    }
    function reset(){
      solver.reset();applied=defaults;
      review=reviewOptions?.fork();
      if(review)inspect(view());
    }
    inspect(view());
    const outputPorts=Object.fromEntries(Object.entries(outputs).map(([key,row])=>[key,row.port]));
    return Object.freeze({layout,inputs:K.procedural.data.freeze(inputs),outputs:K.procedural.data.freeze(outputPorts),
      advance,view,snapshot,restore,reset,...(review&&{
        diagnostics:()=>review.report({solver:'lumped-network',network:layout,configuredStep:numeric.step??1/240})
      })});
  }

  function system(config){
    check(record(config)&&Object.keys(config).every(key=>key==='network'),'Lumped network system needs config.network');
    const run=prepare(config.network);
    const state=output=>({checkpoint:run.snapshot(),outputs:output});
    return {
      inputs:run.inputs,outputs:run.outputs,
      initial(){run.reset();return state(run.view().outputs);},
      validateState(saved){
        run.restore(saved?.checkpoint);
        check(equal(saved.outputs,run.view().outputs),'Lumped network outputs disagree with its checkpoint');
      },
      step(saved,{time,input}){
        run.restore(saved.checkpoint);
        return state(run.advance(time,input).outputs);
      },
      output:saved=>saved.outputs,
      fields:{network:{type:'record',read({state:saved}){
        run.restore(saved.checkpoint);
        return W.query.ok(run.view());
      }}}
    };
  }

  W.runtime.register('lumped-network',system);
  W.lumpedNetworks=Object.freeze({format:T.format,runFormat,traceFormat,checkpointFormat,prepare});
})(KIT);
