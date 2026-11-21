const test=require('node:test'),assert=require('node:assert/strict');
const core=require('..'),{KIT:K,makeBuilder}=core.load();
const camera={view:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-10,1],eye:[0,0,10],tangent:.5,aspect:1,ortho:false,depthRange:[0,20],clipNear:1,clipFar:100};
const context={world:{},camera,width:240,height:240,time:1};
const settings=(targets,extra={})=>K.inspection.prepare({targets,...extra});
const target=(extra={})=>({id:'relay',at:[0,0,0],halfSize:[.5,.5,.5],label:'RELAY 01',...extra});
test('one target drives annotations, bounded glyph rings and a source crop without taking over the camera',()=>{
 const s=settings([target({magnify:true})]),p=K.inspection.plan(s,context),t=p.targets[0];
 assert.equal(t.id,'relay');assert.deepEqual(t.anchor,[120,120]);assert(t.rect[2]>24);assert(t.ripple);assert(t.lens);assert.equal(t.text[0],'RELAY 01');
 assert(t.lens.crop[0]>=0&&t.lens.crop[0]+t.lens.crop[2]<=240);assert.deepEqual(camera.eye,[0,0,10]);
});
test('frustum, near-plane, facing, reveal coverage and explicit activation gate every effect together',()=>{
 const cases=[target({id:'behind',at:[0,0,20]}),target({id:'offscreen',at:[100,0,0]}),target({id:'near',at:[0,0,9]}),
 target({id:'back',normal:[0,0,-1]}),target({id:'hidden',coverage:()=>0}),target({id:'inactive',active:()=>false})];
 const p=K.inspection.plan(settings(cases),context);assert.equal(p.targets.length,0);
 assert.deepEqual(p.diagnostics.map(t=>t.reason),['clipped','offscreen','clipped','back-facing','hidden','inactive']);
});
test('all target effects share depth visibility, partial coverage and an explicit x-ray opt-out',()=>{
 const p=K.inspection.plan(settings([target({coverage:.8}),target({id:'xray',occlusion:'none'})]),context);
 assert.equal(K.inspection.visibility(p.targets[0],()=>.1),0);assert.equal(K.inspection.visibility(p.targets[0],()=>1),.8);
 let n=0;assert(Math.abs(K.inspection.visibility(p.targets[0],()=>n++<2?1:.1)-.32)<1e-8);
 assert.equal(K.inspection.visibility(p.targets[1],()=>.1),1);
});
test('deterministic budgets and focus prioritize targets and magnifiers independently',()=>{
 const s=settings([target({id:'a',priority:3,magnify:true}),target({id:'b',magnify:true}),target({id:'c',priority:2,magnify:true})],{maxTargets:2});
 const p=K.inspection.plan(s,{...context,focus:'b'});assert.deepEqual(p.targets.map(t=>t.id),['b','a']);assert(p.targets[0].lens);assert(!p.targets[1].lens);
 assert.equal(p.diagnostics.at(-1).reason,'budget');
});
test('moving callbacks and actual GPU-bone and CPU-rig anchors update without stale screen positions',()=>{
 const B=makeBuilder(1,[0,0xffffff]);B.disc(0,0,0,[0,0,1],.1,.01,B.P[1],3);const world=B.finish();
 const matrix=new Float32Array(24);for(const off of [0,12])for(const k of [0,4,8])matrix[off+k]=1;matrix[21]=2;
 world.anim={bones:matrix,rig:{M:matrix,bid:Uint16Array.of(1),free:Uint8Array.of(0)}};
 const s=settings([target({at:{part:1,point:[0,0,0]}}),target({id:'bone',at:{bone:1,point:[0,0,0]}}),target({id:'fn',at:({time})=>[time,0,0]})]);
 let p=K.inspection.plan(s,{...context,world});assert.deepEqual(p.targets[0].at,[2,0,0]);assert.deepEqual(p.targets[1].at,[2,0,0]);assert.equal(p.targets[2].at[0],1);
 matrix[21]=3;p=K.inspection.plan(s,{...context,world,time:2});assert.equal(p.targets[0].at[0],3);assert.equal(p.targets[2].at[0],2);
});
test('software composition hides the whole inspection, preserves base pixels, and samples a clean source for magnification',()=>{
 const s=settings([target({magnify:{rect:[.7,.05,.25,.25]},ripple:false})]),p=K.inspection.plan(s,context);
 const rgb=new Uint8Array(240*240*3);for(let y=0;y<240;y++)for(let x=0;x<240;x++)rgb.set([x,y,30],(y*240+x)*3);
 const frame={w:240,h:240,rgb},copy=rgb.slice(),hidden=K.inspection.compose(frame,p,s,()=>0);assert.deepEqual(hidden.rgb,rgb);
 const visible=K.inspection.compose(frame,p,s,()=>1);assert.notDeepEqual(visible.rgb,rgb);assert.deepEqual(rgb,copy);
 const lens=p.targets[0].lens,x=190,y=40,sx=Math.floor(lens.crop[0]+(x+.5-lens.rect[0])/lens.rect[2]*lens.crop[2]),sy=Math.floor(lens.crop[1]+(y+.5-lens.rect[1])/lens.rect[3]*lens.crop[3]);
 assert.deepEqual(Array.from(visible.rgb.slice((y*240+x)*3,(y*240+x)*3+3)),[sx,sy,30]);
});
test('software renderer captures its actual camera and depth, keeps requested passes and can disable inspection',()=>{
 const B=makeBuilder(2,[0x0b1520,0x73dfcf]);for(let y=-.5;y<.5;y+=.08)for(let x=-.5;x<.5;x+=.08)B.disc(x,y,0,[0,0,1],.08,.01,B.P[1],3);
 const W=B.finish();W.cam={yaw:0,pitch:0,dist:8,target:[0,0,0]};W.look={pixelSize:1,inspection:{targets:[target({ripple:false})]}};
 const a=core.render(W,{w:160,h:120,px:1,passes:['depth']}),b=core.render(W,{w:160,h:120,px:1,inspection:false});
 assert(a.inspection.targets.length);assert(a.passes.depth);assert(!a.passes.splatId);assert(!b.inspection);assert.notDeepEqual(a.rgb,b.rgb);
 const mixed=core.render(W,{w:160,h:120,px:1,composite:{world:{resolution:2},layers:[]}});assert.equal(mixed.w,160);assert.equal(mixed.inspection.targets.length,1);
});
test('invalid budgets, target identity, glyphs and unresolved anchor shapes fail explicitly',()=>{
 for(const definition of [{targets:[target(),target()]},{targets:[target()],maxTargets:33},{targets:[target({ripple:{cell:0}})]},{targets:[target({style:{color:'red'}})]}])assert.throws(()=>K.inspection.prepare(definition));
 assert.throws(()=>K.inspection.plan(settings([target({at:{wat:1}})]),context),/anchors/);
 assert.throws(()=>K.inspection.font(settings([target()],{glyphs:{日:['too-wide']}})),/glyph/);
 const font=K.inspection.font(settings([target()],{glyphs:{日:['#####','#...#','#####','#...#','#####']}}));assert(font.has('日'));
});
test('custom surface probes override conservative bounds and preserve partial visibility fractions',()=>{
 const s=settings([target({halfSize:[3,3,3],probes:[[0,0,0],[.1,0,0]],depthBias:0})]);
 const p=K.inspection.plan(s,context);assert.equal(p.targets[0].probes.length,2);
 assert.equal(K.inspection.visibility(p.targets[0],()=>.49),0);let count=0;assert.equal(K.inspection.visibility(p.targets[0],()=>count++===0?1:0),.5);
});
test('named selectors follow current sampled splats and report absent objects without inventing an anchor',()=>{
 const B=makeBuilder(1,[0,0xffffff]);for(const x of [-1,1])B.disc(x,0,0,[0,0,1],.05,.01,B.P[1],3);const world=B.finish();
 world.renderMetadata={objectIds:Uint16Array.of(1,1),objects:[null,'terminal']};
 const s=settings([target({at:{selector:{object:'terminal'}}}),target({id:'missing',at:{selector:{object:'absent'}}})]);
 const p=K.inspection.plan(s,{...context,world});assert.deepEqual(p.targets[0].at,[0,0,0]);assert.equal(p.diagnostics[1].reason,'unresolved');
 world.data[0]=-.5;assert.equal(K.inspection.plan(s,{...context,world}).targets[0].at[0],.25);
});
test('transparent exports gain annotation coverage without changing the original alpha buffer',()=>{
 const s=settings([target({ripple:false})]),p=K.inspection.plan(s,context),frame={w:240,h:240,rgb:new Uint8Array(240*240*3),alpha:new Uint8Array(240*240)};
 const out=K.inspection.compose(frame,p,s,()=>1);assert(out.alpha.some(a=>a>0));assert(frame.alpha.every(a=>a===0));
 const hidden=K.inspection.compose(frame,p,s,()=>0);assert(hidden.alpha.every(a=>a===0));
});
test('invalid live activation fails clearly and Unicode labels clip by glyph instead of UTF-16 code unit',()=>{
 assert.throws(()=>K.inspection.plan(settings([target({active:()=>0})]),context),/boolean/);
 const p=K.inspection.plan(settings([target({label:'😀'.repeat(90)})]),context);assert.equal([...p.targets[0].text[0]].length,80);
});
test('auxiliary reflection captures do not replace the main inspection camera',()=>{
 const B=makeBuilder(3,[0x07131d,0x326277,0xffdba0]),S=K.sculpt(core.load().makeSculpt(B));
 const water=K.reflection.material({r:[1],a:.8},'pool',{f0:.8});
 S.box([0,-.1,0],[1.8,.1,1.8],water,{res:.18});S.ball([0,1,0],[.3,.3,.3],{r:[2]},{res:.1});S.bake();
 const W=B.finish();W.cam={target:[0,.5,0],dist:7,yaw:.1,pitch:.5};W.radius=4;W.look={pixelSize:1};W.reflections=[K.reflection.plane({id:'pool',at:[0,0,0]})];
 let view;const inspection={targets:[target({at:[0,1,0],halfSize:[.3,.3,.3],ripple:false,label:({camera})=>{view=Array.from(camera.view);return 'RELAY';}})]};
 const frame=core.render(W,{w:100,h:80,px:1,inspection,renderStats:true});const reflected=view;
 core.render(W,{w:100,h:80,px:1,inspection,reflections:false});assert.deepEqual(reflected,view);assert(frame.renderStats.rasterPasses>1);
});
