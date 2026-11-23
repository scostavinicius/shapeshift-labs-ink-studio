/* Resolve two discretization descriptions and transfer a portable state. */
const fs=require('node:fs'), path=require('node:path');
const discretization=require('./discretization.js');

function run(kit,document,file,dependency=()=>{}) {
  const {stateRemap,discretization:api}=kit.KIT.world;
  if(document?.format!==stateRemap.format||document.version!==1||
    !Object.keys(document).every(key=>['format','version','source','target','channels','options'].includes(key)))
    throw Error('Expected a version 1 state remap plan');
  function domain(value) {
    let location=file;
    if(typeof value==='string'){
      if(!value.trim()||path.isAbsolute(value)||path.win32.isAbsolute(value))
        throw Error('State remap geometry paths must be relative to the plan');
      location=path.resolve(path.dirname(file),value);
      dependency(location);
      value=JSON.parse(fs.readFileSync(location,'utf8'));
    }
    return value?.format===api.compiledFormat?value:discretization.compile(kit,value,location,dependency);
  }
  return stateRemap.transfer(domain(document.source),domain(document.target),document.channels,document.options);
}
module.exports={run};
