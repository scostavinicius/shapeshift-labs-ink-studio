const test=require('node:test'),assert=require('node:assert/strict'),core=require('..');
function inspectionBrowserProbe(createRenderer) {
 const {KIT:K}=window,kit={KIT,PixelLook,RenderStages},B=makeBuilder(4,[0x091423,0x38627d,0xffbf75]);
 for(let y=-.7;y<=.7;y+=.08)for(let x=-.7;x<=.7;x+=.08)B.disc(x,y,0,[0,0,1],.08,.01,B.P[1],3);
 const W=B.finish();W.cam={yaw:0,pitch:0,dist:8,target:[0,0,0]};W.radius=5;W.look={pixelSize:1};W.fog={c:0,start:1,max:0};
 const canvas=document.querySelector('canvas'),renderer=createRenderer(canvas,{toolkit:kit}),gl=canvas.getContext('webgl2');
 const definition={targets:[{id:'relay',at:[0,0,0],halfSize:[.7,.7,.05],probes:[[0,0,.05]],label:'RELAY',ripple:{chars:'01234',radius:35},magnify:{rect:[.73,.04,.23,.25],zoom:2}}]};
 const frame={width:240,height:180,damp:false,dither:0,edges:false,time:.3,stepAnimation:false};
 const draw=(inspection,extra={})=>{renderer.render(W,{...frame,inspection,...extra});const pixels=new Uint8Array(240*180*4);gl.readPixels(0,0,240,180,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError())throw Error('WebGL error');return pixels;};
 const diff=(a,b)=>a.reduce((n,v,i)=>n+Number(v!==b[i]),0);
 for(const ortho of [false,true]) {
  const camera={...W.cam,ortho};
  let base=draw(false,{camera}),visible=draw(definition,{camera});if(diff(base,visible)<50)throw Error('Visible target did not draw');
  const wall=SpriteSurface.make(16);wall.face([-1.5,-1.5,2],[3,0,0],[0,3,0],16,16,(x,y)=>(x+y)%2?0x38627d:0x31536b);W.spriteSurfaces=wall.finish();
  for(const composite of [false,{world:{resolution:2},layers:[]}]){
   base=draw(false,{camera,composite});const hidden=draw(definition,{camera,composite});if(diff(base,hidden)!==0)throw Error('Occluded target leaked HUD or lens pixels: '+diff(base,hidden));
  }
  delete W.spriteSurfaces;
 }
 const off={targets:[{...definition.targets[0],at:[99,0,0]}]};if(diff(draw(false),draw(off)))throw Error('Offscreen target leaked effects');
 const zero={targets:[{...definition.targets[0],coverage:()=>0}]};if(diff(draw(false),draw(zero)))throw Error('Reveal-hidden target leaked effects');
 const noLens={targets:[{...definition.targets[0],magnify:false}]};if(diff(draw(definition),draw(noLens))<50)throw Error('Magnifier did not switch independently');
 // The maximal target budget must compile within WebGL 2's minimum fragment-uniform budget.
 draw({targets:Array.from({length:32},(_,i)=>({...definition.targets[0],id:'target'+i,at:[(i%8-3.5)*.15,(Math.floor(i/8)-1.5)*.15,0],magnify:false})),maxTargets:32});
 renderer.dispose();return 'PASS';
}
test('native inspection shares occlusion across HUD, glyphs and lens over textured surfaces and mixed resolutions', {skip:!process.env.INK_TEST_CHROME},()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-inspection-'));
 try{
  fs.writeFileSync(path.join(temp,'bundle.js'),core.bundle());
  fs.writeFileSync(path.join(temp,'index.html'),`<!doctype html><canvas></canvas><pre id="result">PENDING</pre><script src="bundle.js"></script><script type="module">
import {createRenderer} from ${JSON.stringify(pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href)};
try{(${inspectionBrowserProbe.toString()})(createRenderer);document.querySelector('#result').textContent='PASS';}catch(e){document.querySelector('#result').textContent=e.stack;}</script>`);
  const html=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking','--allow-file-access-from-files',
   '--enable-unsafe-swiftshader','--use-angle=swiftshader','--user-data-dir='+path.join(temp,'profile'),'--dump-dom',pathToFileURL(path.join(temp,'index.html')).href],
   {timeout:90000,encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','ignore']});
  assert.equal(html.match(/<pre id="result">([^<]*)<\/pre>/)?.[1],'PASS');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
module.exports=inspectionBrowserProbe;
