/* Restarted GMRES over validated compressed sparse rows, with true residual checks. */
(function(K){
  const W=K.world, {check}=W.data, {controls,vector,array,integer}=W.directSolvers, finite=Number.isFinite;

  function validate(matrix,n){
    const {rowPointers,columns,values}=matrix??{}, nnz=values?.length;
    check(integer(nnz,0,1000000)&&array(rowPointers)&&rowPointers.length===n+1&&
      array(columns)&&columns.length===nnz&&rowPointers[0]===0&&rowPointers[n]===nnz,
    'Sparse solve needs bounded CSR rowPointers, columns, and values');
    vector(values,nnz,'sparse value');
    for(let i=0;i<n;i++)
      if(!integer(rowPointers[i+1],rowPointers[i],nnz))throw Error('Invalid CSR row pointer at '+(i+1));
    for(let i=0;i<n;i++){
      let previous=-1;
      for(let j=rowPointers[i];j<rowPointers[i+1];j++){
        const column=columns[j];
        check(integer(column,previous+1,n-1),'CSR columns must be unique and sorted within each row');
        previous=column;
      }
    }
    return {rowPointers,columns,values,nnz};
  }

  function euclidean(row){
    let scale=0, ss=1;
    for(const value of row){
      const a=Math.abs(value);
      if(!finite(a))return Infinity;
      if(a===0)continue;
      if(a>scale){ss=1+ss*(scale/a)**2;scale=a;}
      else ss+=(a/scale)**2;
    }
    return scale*Math.sqrt(ss);
  }

  function sparse(matrix,b,options={}){
    const n=b?.length;
    check(integer(n,1,65536),'Sparse solve supports 1–65536 rows');
    vector(b,n,'right-hand side');
    const {rowPointers,columns,values,nnz}=validate(matrix,n), ctl=controls(options,b);
    const {restart=24,maxIterations=Math.min(1000,n*4),initial,history=false}=options;
    check(integer(restart,1,64)&&integer(maxIterations,0,10000)&&typeof history==='boolean','Invalid GMRES controls');
    const x=initial===undefined?new Float64Array(n):Float64Array.from(vector(initial,n,'initial solution'));
    let best=x.slice(), bestResidual=null,bestRow=0,bestSigned=0, iterations=0,matrixProducts=0;
    const trace=history?[]:null;
    function finish(status){
      return {method:'sparse',algorithm:'gmres',size:n,status,converged:status==='converged',solution:best,
        residual:bestResidual===null?null:ctl.residual(bestResidual,bestRow,bestSigned),
        work:{...ctl.evidence(),iterations,matrixProducts,nonzeros:nnz,restart:Math.min(restart,n)},
        ...(trace&&{history:trace})};
    }
    const productCost=nnz+n, residualCost=nnz+2*n, residual=new Float64Array(n);
    function measure(solution){
      let largest=0,row=0;
      for(let i=0;i<n;i++){
        let sum=0;
        for(let j=rowPointers[i];j<rowPointers[i+1];j++)sum+=values[j]*solution[columns[j]];
        residual[i]=b[i]-sum;
        const magnitude=Math.abs(residual[i]);
        if(!finite(magnitude)){largest=magnitude;break;}
        if(magnitude>largest){largest=magnitude;row=i;}
      }
      matrixProducts++;
      if(finite(largest)){
        if(bestResidual===null||largest<bestResidual){
          bestResidual=largest;bestRow=row;bestSigned=residual[row];best.set(solution);
        }
        trace?.push({iterations,absolute:largest});
      }
      return largest;
    }
    if(!ctl.take(residualCost))return finish('work-limit');
    const starting=measure(x);
    if(!finite(starting))return finish('non-finite');
    if(starting<=ctl.threshold)return finish('converged');
    if(maxIterations===0)return finish('iteration-limit');
    if(!ctl.take(productCost))return finish('work-limit');

    const scales=new Float64Array(n), scaled=new Float64Array(nnz);
    let maxScale=0;
    for(let i=0;i<n;i++){
      let scale=0;
      for(let j=rowPointers[i];j<rowPointers[i+1];j++)scale=Math.max(scale,Math.abs(values[j]));
      scales[i]=scale||1;
      maxScale=Math.max(maxScale,scales[i]);
      for(let j=rowPointers[i];j<rowPointers[i+1];j++)scaled[j]=values[j]/scales[i];
    }
    const length=Math.min(n,restart,maxIterations), estimate=ctl.threshold/maxScale;
    const basis=Array.from({length:length+1},()=>new Float64Array(n));
    const h=Array.from({length},()=>new Float64Array(length+1));
    const guess=new Float64Array(n), rhs=new Float64Array(length+1);
    const c=new Float64Array(length),s=new Float64Array(length),y=new Float64Array(length);
    function product(input,out){
      for(let i=0;i<n;i++){
        let sum=0;
        for(let j=rowPointers[i];j<rowPointers[i+1];j++)sum+=scaled[j]*input[columns[j]];
        out[i]=sum;
      }
      matrixProducts++;
    }

    function arnoldi(j){
      const w=basis[j+1], column=h[j];
      product(basis[j],w);
      const imageNorm=euclidean(w);
      column.fill(0);
      // Reorthogonalize for small residuals and nearly dependent directions.
      for(let pass=0;pass<2;pass++)for(let k=0;k<=j;k++){
        const q=basis[k];
        let projection=0;
        for(let i=0;i<n;i++)projection+=q[i]*w[i];
        column[k]+=projection;
        for(let i=0;i<n;i++)w[i]-=projection*q[i];
      }
      const tail=euclidean(w), invariant=tail<=32*Number.EPSILON*imageNorm;
      column[j+1]=invariant?0:tail;
      for(let k=0;k<j;k++){
        const a=column[k], b=column[k+1];
        column[k]=c[k]*a+s[k]*b;
        column[k+1]=-s[k]*a+c[k]*b;
      }
      const a=column[j], b=column[j+1], diagonal=Math.hypot(a,b);
      if(diagonal===0)return {usable:false,invariant:true};
      c[j]=a/diagonal;
      s[j]=b/diagonal;
      column[j]=diagonal;
      column[j+1]=0;
      rhs[j+1]=-s[j]*rhs[j];
      rhs[j]*=c[j];
      if(!invariant)for(let i=0;i<n;i++)w[i]/=tail;
      return {usable:true,invariant};
    }

    const candidateCost=k=>residualCost+(k+3)*n+k*(k+1)/2;
    function candidate(k){
      for(let i=k-1;i>=0;i--){
        let value=rhs[i];
        for(let j=i+1;j<k;j++)value-=h[j][i]*y[j];
        y[i]=value/h[i][i];
      }
      guess.set(x);
      for(let i=0;i<k;i++)for(let j=0;j<n;j++)guess[j]+=basis[i][j]*y[i];
      return guess.every(finite);
    }

    while(iterations<maxIterations){
      const limit=Math.min(length,maxIterations-iterations);
      if(!ctl.take(4*n))return finish('work-limit');
      for(let i=0;i<n;i++)basis[0][i]=residual[i]/scales[i];
      const beta=euclidean(basis[0]);
      if(!finite(beta))return finish('non-finite');
      if(beta===0)return finish('breakdown');
      for(let i=0;i<n;i++)basis[0][i]/=beta;
      rhs.fill(0);
      rhs[0]=beta;
      let k=0,invariant=false,limited=false;
      for(let j=0;j<limit;j++){
        const cost=productCost+n*(4*(j+1)+3)+6*(j+1);
        if(!ctl.fits(cost+candidateCost(j+1))){limited=true;break;}
        ctl.take(cost);
        const step=arnoldi(j);
        iterations++;
        invariant=step.invariant;
        if(!step.usable)break;
        k++;
        if(invariant||Math.abs(rhs[k])<=estimate)break;
      }
      if(k===0)return finish(limited?'work-limit':'breakdown');
      ctl.take(candidateCost(k));
      if(!candidate(k))return finish('non-finite');
      const absolute=measure(guess);
      if(!finite(absolute))return finish('non-finite');
      if(absolute<=ctl.threshold)return finish('converged');
      if(invariant)return finish('breakdown');
      if(limited)return finish('work-limit');
      if(guess.every((value,i)=>value===x[i]))return finish('stagnated');
      x.set(guess);
    }
    return finish('iteration-limit');
  }

  W.sparseSolver=sparse;
})(KIT);
