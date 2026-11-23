/* Load relative, revision-pinned boundary sets for solver plans. */
const fs=require('node:fs'),path=require('node:path');

function resolve(conditions,file,dependency=()=>{}){
  if(typeof conditions?.asset!=='string')return conditions;
  const reference=conditions.asset;
  if(!reference.length||path.isAbsolute(reference)||path.win32.isAbsolute(reference)||
    !Number.isSafeInteger(conditions.revision)||conditions.revision<1)
    throw Error('Boundary asset paths must be relative with a pinned revision');
  const location=path.resolve(path.dirname(path.resolve(file)),reference);
  dependency(location);
  const asset=JSON.parse(fs.readFileSync(location,'utf8'));
  if(asset?.revision!==conditions.revision)throw Error('Boundary asset revision does not match '+reference);
  return {...conditions,asset};
}

module.exports={resolve};
