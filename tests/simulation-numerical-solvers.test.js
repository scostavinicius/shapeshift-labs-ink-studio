const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const S=require('..').load().KIT.world.solvers;
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);
const matrixProduct=(matrix,x)=>matrix.map(row=>row.reduce((sum,v,j)=>sum+v*x[j],0));
const checkSolution=(result,expected,tol=1e-9)=>{
  assert.equal(result.status,'converged');
  assert.ok(result.converged);
  expected.forEach((v,i)=>near(result.solution[i],v,tol));
  assert.ok(result.residual.absolute<=result.residual.threshold);
  assert.ok(result.work.used<=result.work.limit);
};
function compressed(a){
  const rowPointers=[0],columns=[],values=[];
  for(const row of a){
    row.forEach((v,i)=>{if(v!==0){columns.push(i);values.push(v);}});
    rowPointers.push(values.length);
  }
  return {rowPointers,columns,values};
}

test('dense solve pivots, leaves the source intact, and measures the original residual',()=>{
  const a=[[0,2,-1],[3,-1,2],[1,1,1]], expect=[1.5,-2,.6], b=matrixProduct(a,expect);
  const saved=JSON.stringify({a,b});
  const result=S.dense(a,b);
  checkSolution(result,expect);
  assert.ok(result.work.pivotSwaps>0);
  assert.equal(JSON.stringify({a,b}),saved);
  const residual=Math.max(...matrixProduct(a,result.solution).map((v,i)=>Math.abs(v-b[i])));
  assert.equal(result.residual.absolute,residual);
  checkSolution(S.dense([[1e-50,0],[1e40,1e40]],[2e-50,5e40]),[2,3]);
  assert.equal(S.dense([[1,2],[2,4]],[3,6]).status,'singular');
  assert.equal(S.dense(a,b,{maxWork:2}).solution,null);
});

test('banded pivoting retains the second superdiagonal after row swaps',()=>{
  const a=[[0,2,0,0],[3,4,5,0],[0,1,0,6],[0,0,4,1]], expected=[1,2,3,4], rhs=matrixProduct(a,expected);
  const matrix={lower:[3,1,4],diagonal:[0,4,0,1],upper:[2,5,6]};
  const result=S.tridiagonal(matrix,rhs);
  checkSolution(result,expected);
  assert.ok(result.work.pivotSwaps>0);
  checkSolution(S.tridiagonal({lower:[],diagonal:[8],upper:[]},[6]),[.75]);
  assert.equal(S.tridiagonal({lower:[0],diagonal:[1,0],upper:[0]},[1,0]).status,'singular');
  assert.throws(()=>S.tridiagonal({...matrix,lower:[1]},rhs),/lower diagonal/);
});

test('sparse GMRES handles nonsymmetric systems and restarts with measured residuals',()=>{
  const skew=[[0,-1],[1,0]];
  checkSolution(S.sparse(compressed(skew),[-2,1]),[1,2]);
  const a=Array.from({length:30},(_,i)=>Array.from({length:30},(_,j)=>j===i?4:j===i+1?-1.2:j===i-2?.9:0));
  const expected=a.map((_,i)=>Math.sin(i)), rhs=matrixProduct(a,expected), csr=compressed(a);
  const result=S.sparse(csr,rhs,{restart:4,history:true});
  checkSolution(result,expected);
  assert.ok(result.work.iterations>4&&result.history.length>2);
  const residual=Math.max(...matrixProduct(a,result.solution).map((v,i)=>Math.abs(v-rhs[i])));
  assert.equal(result.residual.absolute,residual);
  assert.equal(result.history[0].iterations,0);
  checkSolution(S.sparse(csr,rhs,{maxIterations:0,initial:expected}),expected);
});

test('sparse limits return the best measured iterate and validate CSR structure',()=>{
  const a=[[2,-1,0],[-1,2,-1],[0,-1,2]], rhs=[1,2,3], csr=compressed(a);
  const cut=S.sparse(csr,rhs,{maxIterations:1,history:true});
  assert.equal(cut.status,'iteration-limit');
  assert.equal(cut.work.iterations,1);
  assert.ok(cut.residual.absolute<3);
  const work=S.sparse(csr,rhs,{maxWork:100});
  assert.equal(work.status,'work-limit');
  assert.ok(work.work.used<=100&&work.residual.absolute<3);
  assert.equal(S.sparse({rowPointers:[0,0],columns:[],values:[]},[1]).status,'breakdown');
  assert.throws(()=>S.sparse({...csr,columns:[0,0,...csr.columns.slice(2)]},rhs),/unique and sorted/);
  assert.throws(()=>S.sparse({...csr,rowPointers:[0,7,3,7]},rhs),/row pointer/);
});

test('root solve retains the sign-changing interval and counts callback evaluations',()=>{
  let calls=0;
  const fn=x=>{calls++;return x*x*x-11;};
  const result=S.root(fn,[0,4],{history:true});
  assert.equal(result.status,'converged');
  near(result.root,Math.cbrt(11));
  assert.ok(result.bracketValues[0]<=0&&result.bracketValues[1]>=0);
  assert.equal(result.history.length,calls);
  assert.equal(result.work.evaluations,calls);
  assert.equal(S.root(x=>x-1,[1,3]).root,1);
  assert.equal(S.root(x=>x-3,[1,3]).root,3);
  assert.equal(S.root(x=>x*x+1,[-1,1]).status,'unbracketed');
  assert.equal(S.root(()=>Infinity,[0,1]).status,'non-finite');
  const limited=S.root(x=>x*x-2,[0,2],{maxEvaluations:2});
  assert.equal(limited.status,'work-limit');
  assert.equal(limited.work.evaluations,2);
  assert.deepEqual(limited.bracket,[0,2]);
});

test('sim solve emits portable reports and can require convergence',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-solves-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  function run(name,plan,...args){
    fs.writeFileSync(path.join(folder,name),JSON.stringify({format:S.planFormat,version:1,...plan}));
    return spawnSync(process.execPath,[cli,'sim','solve',name,...args],{cwd:folder,encoding:'utf8'});
  }
  const d=run('dense.json',{method:'dense',matrix:[[0,1],[1,0]],rhs:[3,4]});
  assert.equal(d.status,0,d.stderr);
  const dense=JSON.parse(d.stdout);
  assert.equal(dense.format,S.reportFormat);
  assert.deepEqual(dense.solution,[4,3]);
  fs.writeFileSync(path.join(folder,'valve.cjs'),'module.exports = (_kit, config) => x => x*x - config.target;');
  const r=run('root.json',{method:'root',bracket:[0,2],equation:{module:'valve.cjs',config:{target:2}}},
    '--require-convergence','--out','root.report.json');
  assert.equal(r.status,0,r.stderr);
  near(JSON.parse(fs.readFileSync(path.join(folder,'root.report.json'))).root,Math.SQRT2);
  const failed=run('invalid.json',{method:'root',bracket:[0,2],equation:{coefficients:[1,0,1]}},'--require-convergence');
  assert.notEqual(failed.status,0);
  assert.equal(JSON.parse(failed.stdout).status,'unbracketed');
});
