/* Resolve chart and mesh assets into the simulation discretization compiler. */
const path=require('node:path');

function compile(kit,plan,file,dependency=()=>{}) {
  const api=kit.KIT.world.discretization, source=plan?.source;
  if(plan?.format!==api.format||!source) return api.compile(plan);
  if(source.kind==='mesh'&&source.file!==undefined){
    const reference=source.file;
    if(typeof reference!=='string'||!reference.trim()||path.isAbsolute(reference)||path.win32.isAbsolute(reference)||
      source.mesh!==undefined||source.pos!==undefined||source.positions!==undefined)
      throw Error('Choose embedded mesh geometry or a relative mesh file');
    const location=path.resolve(path.dirname(path.resolve(file)),reference);
    dependency(location);
    return api.compile({...plan,source:{...source,mesh:require('../index.js').readMesh(location)}});
  }
  if(source.kind==='charts'&&Array.isArray(source.charts)){
    const charts=source.charts.map(row=>{
      const {carrier}=row??{}, {kind}=carrier??{};
      if(!['plane','cylinder'].includes(kind))throw Error('A chart needs a plane or cylinder carrier');
      return {...row,carrier:kit.KIT.procedural.surface[kind]({...carrier,id:row.id})};
    });
    return api.compile({...plan,source:{...source,charts}});
  }
  return api.compile(plan);
}

module.exports={compile};
