/* Resolve material packs and physical geometry from a local authored plan. */
const fs=require('node:fs'), path=require('node:path');
const {resolveSource}=require('./path-sections.js');
const {install}=require('./asset-pack.js');

function measure(kit,document,file,{dependency=()=>{},assetPack}={}) {
  const api=kit.KIT.world.massProperties;
  if(document?.format!==api.format||!document.parts||typeof document.parts!=='object'||Array.isArray(document.parts))
    return api.measure(document);
  const parts=Object.fromEntries(Object.entries(document.parts).map(([name,part])=>{
    const source=part?.source;
    if(source?.kind==='mesh'||source?.kind==='sdf')
      return [name,{...part,source:resolveSource(kit,source,file,dependency)}];
    if(source?.kind==='discretization'&&source.file!==undefined){
      const reference=source.file;
      if(typeof reference!=='string'||!reference.trim()||path.isAbsolute(reference)||path.win32.isAbsolute(reference)||
        source.domain!==undefined) throw Error('Choose an embedded or relative compiled discretization');
      const location=path.resolve(path.dirname(path.resolve(file)),reference);
      dependency(location);
      return [name,{...part,source:{...source,domain:JSON.parse(fs.readFileSync(location,'utf8'))}}];
    }
    return [name,part];
  }));
  if(assetPack!==undefined)dependency(assetPack);
  const assetPacks=install(kit.KIT.authoring.assetPacks,document.assetPacks,assetPack)??[];
  return api.measure({...document,parts,assetPacks});
}
module.exports={measure};
