/* Resolve raw-unit geometry for a portable section measurement plan. */
const fs=require('node:fs'), path=require('node:path');
const format='ink-studio/path-section-plan';

function resolveSource(kit,raw,file,dependency=()=>{}) {
  const {kind,file:reference,sculpt,...source}=raw;
  const K=kit.KIT, origin=path.dirname(path.resolve(file));
  if (reference!==undefined && (typeof reference!=='string'||!reference||path.isAbsolute(reference)||path.win32.isAbsolute(reference)))
    throw Error('Section geometry file must be relative to its plan');
  const location=reference===undefined?undefined:path.resolve(origin,reference);
  if (location) dependency(location);
  if (kind==='mesh') {
    if (location && source.mesh!==undefined) throw Error('Choose embedded mesh data or a mesh file');
    if (location) source.mesh=require('../index.js').readMesh(location);
  } else if (kind==='sdf') {
    if ((location===undefined)===(sculpt===undefined)) throw Error('Choose a JSON sculpt or a field module for SDF sections');
    if (!location) source.field=K.diorama.brushField(sculpt);
    else {
      const ext=path.extname(location).toLowerCase();
      if (ext==='.json') source.field=K.diorama.brushField(JSON.parse(fs.readFileSync(location,'utf8')));
      else if (ext==='.cjs'||ext==='.js') {
        const createField=require(location);
        if (typeof createField!=='function') throw Error('A section field module must export a function of the Ink kit');
        source.field=createField(kit);
      } else throw Error('Use a .json sculpt or a .js/.cjs field module for SDF sections');
    }
  } else if (location!==undefined||sculpt!==undefined) throw Error('Contour sections use embedded profiles or paired banks');
  return {...source,kind};
}

function measure(kit,document,file,dependency) {
  if (document?.format!==format || document.version!==1 || !document.source)
    throw Error('Expected a version 1 path section plan');
  const {format:_,version,source,...options}=document;
  return kit.KIT.procedural.pathSections.measure({...options,source:resolveSource(kit,source,file,dependency)});
}
module.exports={measure,resolveSource,format};
