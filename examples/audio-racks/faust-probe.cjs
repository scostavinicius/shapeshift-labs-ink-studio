/* Usage: node faust-probe.cjs /path/to/@grame/faustwasm */
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(process.argv[2]);
async function main() {
  const {instantiateFaustModuleFromFile,LibFaust,FaustCompiler,FaustMonoDspGenerator}=
    await import(pathToFileURL(path.join(root,'dist','esm','index.js')).href);
  const module=await instantiateFaustModuleFromFile(path.join(root,'libfaust-wasm','libfaust-wasm.js'));
  const lib=new LibFaust(module), compiler=new FaustCompiler(lib), generator=new FaustMonoDspGenerator();
  const dsp='gain=hslider("trim",0.5,0,2,0.01); process=(*(gain):mem),(*(gain):mem);';
  await generator.compile(compiler,'RackProbe',dsp,'');
  const rate=48000, frames=2048, create=()=>generator.createOfflineProcessor(rate,128);
  const left=new Float32Array(frames),right=new Float32Array(frames);
  left[1]=.4;right[1]=-.32; left[900]=.4; right[900]=-.32;
  const processor=await create(), [param]=processor.getParams();
  processor.setParamValue(param,.25);
  const out=processor.render([left,right],frames,offset=>{
    if (offset===896) processor.setParamValue(param,.75);
  });
  assert.equal(out.length,2);
  assert(Math.abs(out[0][2]-.1)<1e-6 && Math.abs(out[0][901]-.3)<1e-6);
  const recalled=await create();
  recalled.setParamValue(param,.75);
  assert(Math.abs(recalled.render([left,right],frames)[0][2]-.3)<1e-6);
  console.log(JSON.stringify({compiler:lib.version(),channels:out.length,frames,param,
    first:out[0][2],afterBlockChange:out[0][901],measuredDelay:1}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
