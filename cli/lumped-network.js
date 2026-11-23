/* Resolve a versioned network and sample its exact source-change boundaries. */
const fs=require('node:fs'), path=require('node:path');

function run(kit,plan,file,dependency=()=>{},diagnostics){
  const W=kit.KIT.world, N=W.lumpedNetworks, {check,record}=W.data;
  const {samples,commands=[],inputs,checkpoint}=plan??{};
  check(plan?.format===N.runFormat&&plan.version===1&&typeof plan.network!=='undefined'&&
    Array.isArray(samples)&&samples.length>=1&&samples.length<=4096&&
    Array.isArray(commands)&&commands.length<=4096,'Expected a version 1 lumped network run');
  function read(value){
    if(typeof value!=='string')return value;
    check(value.length&&!path.isAbsolute(value)&&!path.win32.isAbsolute(value),'Network assets must be relative to their run');
    const location=path.resolve(path.dirname(path.resolve(file)),value);
    dependency(location);
    return JSON.parse(fs.readFileSync(location,'utf8'));
  }
  const network=N.prepare(read(plan.network),{diagnostics});
  if(checkpoint!==undefined)network.restore(read(checkpoint));
  const start=network.view();
  check(Array.from(samples).every((time,i)=>Number.isFinite(time)&&(i?time>samples[i-1]:time>=start.time)),
    'Network samples need increasing times at or after the start');
  check(Array.from(commands).every((row,i)=>record(row)&&record(row.inputs)&&Number.isFinite(row.time)&&
    (i?row.time>commands[i-1].time:row.time>=start.time)&&row.time<=samples.at(-1)),
    'Network commands need increasing times inside the run');
  let active=inputs===undefined?start.inputs:inputs, index=0;
  network.advance(start.time,active);
  const initial=network.view();
  const results=samples.map(time=>{
    while(index<commands.length&&commands[index].time<=time){
      const command=commands[index++];
      network.advance(command.time,active);
      active={...active,...command.inputs};
    }
    return network.advance(time,active);
  });
  return {format:N.traceFormat,version:1,layout:network.layout,initial,results,checkpoint:network.snapshot(),...(network.diagnostics&&{diagnostics:network.diagnostics()})};
}

module.exports={run};
