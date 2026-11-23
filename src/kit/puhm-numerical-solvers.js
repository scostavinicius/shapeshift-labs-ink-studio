/* Bracket-preserving scalar root finding and the public solver collection. */
(function(K){
  const W=K.world, {check}=W.data, {integer,tolerance,unitTolerance,vector}=W.directSolvers, finite=Number.isFinite;
  const planFormat='ink-studio/solve-plan', reportFormat='ink-studio/solve-report';
  const sameSign=(a,b)=>(a<0)===(b<0);

  function root(fn,bracket,options={}){
    vector(bracket,2,'root bracket');
    let [left,right]=bracket;
    const {xTolerance=1e-10,relativeXTolerance=4*Number.EPSILON,fTolerance=0,maxEvaluations=128,history=false}=options;
    check(typeof fn==='function'&&left<right&&finite(right-left)&&tolerance(xTolerance)&&
      unitTolerance(relativeXTolerance)&&tolerance(fTolerance)&&integer(maxEvaluations,2,4096)&&typeof history==='boolean',
    'Invalid root bracket, tolerances, or evaluation limit');
    let evaluations=0,best=null;
    const trace=history?[]:null;
    function evaluate(x){
      evaluations++;
      const value=fn(x);
      if(!finite(value))return null;
      if(best===null||Math.abs(value)<Math.abs(best.value))best={x,value};
      trace?.push({x,value});
      return value;
    }
    let a=evaluate(left), b=null;
    function finish(status,reason){
      return {method:'root',status,converged:status==='converged',reason,root:best?.x??null,
        value:best?.value??null,residual:best===null?null:Math.abs(best.value),bracket:[left,right],bracketValues:[a,b],
        work:{used:evaluations,limit:maxEvaluations,evaluations},...(trace&&{history:trace})};
    }
    if(a===null)return finish('non-finite','function');
    if(a===0){right=left;b=0;return finish('converged','function');}
    b=evaluate(right);
    if(b===null)return finish('non-finite','function');
    if(b===0){left=right;a=0;return finish('converged','function');}
    if(sameSign(a,b))return finish('unbracketed','sign');
    for(;;){
      const width=right-left;
      if(Math.abs(best.value)<=fTolerance)return finish('converged','function');
      if(width<=Math.max(xTolerance,relativeXTolerance*Math.max(Math.abs(left),Math.abs(right))))
        return finish('converged','interval');
      if(evaluations>=maxEvaluations)return finish('work-limit','evaluations');
      const weight=Math.abs(a)>Math.abs(b)?1/(1+Math.abs(b/a)):Math.abs(a/b)/(1+Math.abs(a/b));
      const x=left+width*(weight>.125&&weight<.875?weight:.5);
      if(x===left||x===right)return finish('resolution','interval');
      const value=evaluate(x);
      if(value===null)return finish('non-finite','function');
      if(value===0){left=x;right=x;a=0;b=0;return finish('converged','function');}
      if(sameSign(a,value)){left=x;a=value;}
      else{right=x;b=value;}
      // The reported point stays in the retained bracket.
      best=Math.abs(a)<=Math.abs(b)?{x:left,value:a}:{x:right,value:b};
    }
  }

  W.solvers=Object.freeze({planFormat,reportFormat,dense:W.directSolvers.dense,
    tridiagonal:W.directSolvers.tridiagonal,sparse:W.sparseSolver,root});
})(KIT);
