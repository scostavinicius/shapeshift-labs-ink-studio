/* Bounded, row-scaled direct solves for dense and tridiagonal systems. */
(function(K){
  const W=K.world, {check}=W.data, finite=Number.isFinite;
  const integer=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
  const array=v=>Array.isArray(v)||ArrayBuffer.isView(v)&&typeof v.length==='number';
  const tolerance=n=>finite(n)&&n>=0;
  const unitTolerance=n=>tolerance(n)&&n<=1;

  function vector(v,n,label){
    check(array(v)&&v.length===n,label+' needs '+n+' entries');
    for(let i=0;i<n;i++)if(!finite(v[i]))throw Error('Non-finite '+label+' entry '+i);
    return v;
  }
  function norm(v){
    let max=0;
    for(const value of v)max=Math.max(max,Math.abs(value));
    return max;
  }
  function controls(options,b){
    const {absoluteTolerance=0,relativeTolerance=1e-10,maxWork=40000000}=options;
    check(tolerance(absoluteTolerance)&&unitTolerance(relativeTolerance)&&integer(maxWork,1,250000000),
      'Invalid solve tolerances or work limit');
    const scale=norm(b), threshold=Math.max(absoluteTolerance,relativeTolerance*scale);
    let used=0;
    return {
      threshold,
      fits(count){return used+count<=maxWork;},
      take(count){
        if(used+count>maxWork)return false;
        used+=count;
        return true;
      },
      evidence(){
        return {used,limit:maxWork};
      },
      residual(absolute,row,signed){
        const ratio=scale>0?absolute/scale:null;
        return {absolute,relative:finite(ratio)?ratio:null,threshold,row,signed};
      }
    };
  }

  function direct(method,b,options,run,multiply,entries){
    const ctl=controls(options,b);
    const {pivotTolerance=1e-14}=options;
    check(unitTolerance(pivotTolerance),'Invalid pivot tolerance');
    const result=run(ctl,pivotTolerance);
    const {steps,pivotSwaps}=result;
    let {solution,status}=result, residual=null;
    if(solution){
      if(!ctl.take(entries+b.length))status='work-limit';
      else{
        let absolute=0,row=0,signed=0;
        for(let i=0;i<b.length;i++){
          const difference=b[i]-multiply(solution,i), magnitude=Math.abs(difference);
          if(!finite(magnitude)||magnitude>absolute){absolute=magnitude;row=i;signed=difference;}
          if(!finite(absolute))break;
        }
        if(finite(absolute)){
          residual=ctl.residual(absolute,row,signed);
          status=absolute<=ctl.threshold?'converged':'residual';
        }else status='non-finite';
      }
    }
    return {method,size:b.length,status,converged:status==='converged',solution,residual,
      work:{...ctl.evidence(),steps,pivotSwaps}};
  }

  function dense(matrix,b,options={}){
    const n=b?.length;
    check(integer(n,1,512)&&Array.isArray(matrix)&&matrix.length===n,'Dense solve requires a square matrix of up to 512 rows');
    vector(b,n,'right-hand side');
    for(const row of matrix)vector(row,n,'dense row');
    function multiply(x,i){
      let sum=0;
      for(let j=0;j<n;j++)sum+=matrix[i][j]*x[j];
      return sum;
    }
    return direct('dense',b,options,(ctl,pivotTolerance)=>{
      let steps=0,pivotSwaps=0;
      const finish=(status,solution=null)=>({status,solution,steps,pivotSwaps});
      if(!ctl.take(n*(n+1)))return finish('work-limit');
      const rhs=new Float64Array(n), a=matrix.map((row,i)=>{
        const scale=norm(row)||1;
        rhs[i]=b[i]/scale;
        return Float64Array.from(row,value=>value/scale);
      });
      if(!rhs.every(finite))return finish('non-finite');
      for(let k=0;k<n;k++){
        const width=n-k;
        if(!ctl.take(width*width))return finish('work-limit');
        let p=k;
        for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[p][k]))p=i;
        if(Math.abs(a[p][k])<=pivotTolerance)return finish('singular');
        if(p!==k){
          [a[k],a[p]]=[a[p],a[k]];
          [rhs[k],rhs[p]]=[rhs[p],rhs[k]];
          pivotSwaps++;
        }
        for(let i=k+1;i<n;i++){
          const ratio=a[i][k]/a[k][k];
          for(let j=k+1;j<n;j++)a[i][j]-=ratio*a[k][j];
          rhs[i]-=ratio*rhs[k];
        }
        steps++;
      }
      if(!ctl.take(n*(n+1)/2))return finish('work-limit');
      const x=new Float64Array(n);
      for(let i=n-1;i>=0;i--){
        let next=rhs[i];
        for(let j=i+1;j<n;j++)next-=a[i][j]*x[j];
        x[i]=next/a[i][i];
      }
      return x.every(finite)?finish('residual',x):finish('non-finite');
    },multiply,n*n);
  }

  function tridiagonal(matrix,b,options={}){
    const n=b?.length;
    check(integer(n,1,65536),'Tridiagonal solve supports 1–65536 rows');
    vector(b,n,'right-hand side');
    const lower=vector(matrix?.lower,n-1,'lower diagonal'), diagonal=vector(matrix?.diagonal,n,'main diagonal'),
      upper=vector(matrix?.upper,n-1,'upper diagonal');
    function multiply(x,i){
      return diagonal[i]*x[i]+(i>0?lower[i-1]*x[i-1]:0)+(i<n-1?upper[i]*x[i+1]:0);
    }
    return direct('tridiagonal',b,options,(ctl,pivotTolerance)=>{
      let steps=0,pivotSwaps=0;
      const finish=(status,solution=null)=>({status,solution,steps,pivotSwaps});
      if(!ctl.take(4*n))return finish('work-limit');
      const l=new Float64Array(n-1),d=new Float64Array(n),u=new Float64Array(n-1),
        second=new Float64Array(Math.max(0,n-2)),rhs=new Float64Array(n);
      for(let i=0;i<n;i++){
        const scale=Math.max(Math.abs(diagonal[i]),Math.abs(lower[i-1]??0),Math.abs(upper[i]??0))||1;
        d[i]=diagonal[i]/scale;
        rhs[i]=b[i]/scale;
        if(i>0)l[i-1]=lower[i-1]/scale;
        if(i<n-1)u[i]=upper[i]/scale;
      }
      if(!rhs.every(finite))return finish('non-finite');
      for(let i=0;i<n-1;i++){
        if(!ctl.take(8))return finish('work-limit');
        if(Math.max(Math.abs(d[i]),Math.abs(l[i]))<=pivotTolerance)return finish('singular');
        if(Math.abs(d[i])>=Math.abs(l[i])){
          const ratio=l[i]/d[i];
          d[i+1]-=ratio*u[i];
          rhs[i+1]-=ratio*rhs[i];
        }else{
          const ratio=d[i]/l[i], next=d[i+1], nextRhs=rhs[i+1];
          d[i]=l[i];
          d[i+1]=u[i]-ratio*next;
          u[i]=next;
          rhs[i+1]=rhs[i]-ratio*nextRhs;
          rhs[i]=nextRhs;
          if(i<n-2){
            second[i]=u[i+1];
            u[i+1]=-ratio*second[i];
          }
          pivotSwaps++;
        }
        steps++;
      }
      if(!ctl.take(3*n))return finish('work-limit');
      if(Math.abs(d[n-1])<=pivotTolerance)return finish('singular');
      steps++;
      const x=new Float64Array(n);
      for(let i=n-1;i>=0;i--)
        x[i]=(rhs[i]-(i<n-1?u[i]*x[i+1]:0)-(i<n-2?second[i]*x[i+2]:0))/d[i];
      return x.every(finite)?finish('residual',x):finish('non-finite');
    },multiply,3*n-2);
  }

  W.directSolvers=Object.freeze({dense,tridiagonal,vector,norm,controls,integer,array,tolerance,unitTolerance});
})(KIT);
