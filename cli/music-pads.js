const fs=require('node:fs'), path=require('node:path');
const {json}=require('./asset-files.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

module.exports=function padCommand([mode,file,settings],opt,kit) {
  if (!file || !['program','compose','capture','edit'].includes(mode) ||
      (['capture','edit'].includes(mode) && !settings) || (mode==='compose' && settings))
    throw new TypeError('Use music pads program, compose, capture, or edit with a source and applicable settings file');
  const {padPattern,sliceComposition}=kit.KIT.procedural.mediaGraph;
  const source=read(file), rules=settings ? read(settings) : undefined;
  let value;
  if (mode==='compose') {
    if (opt.report!==undefined && (typeof opt.report!=='string' ||
        [file,opt.out].some(name=>typeof name==='string' && path.resolve(name)===path.resolve(opt.report))))
      throw new TypeError('--report needs a separate path');
    const composed=sliceComposition.compose(source);
    if (opt.report) json(opt.report,composed.report);
    value=composed.value;
  } else if (mode==='program') value=padPattern.perform(source,rules).value;
  else if (mode==='capture') {
    const {routes,options}=rules;
    value=padPattern.capture(source,routes,options);
  } else value=padPattern.edit(source,rules);
  if (typeof opt.out==='string') json(opt.out,value);
  else process.stdout.write(JSON.stringify(value,null,2)+'\n');
  return value;
};
