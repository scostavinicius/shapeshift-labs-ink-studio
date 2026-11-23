const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const { KIT: K, makeBuilder } = ink.load();

const skin = [200,140,90,255], berry = [117,51,69,255], clear = [0,0,0,0];
const palette = ['#234b65','#b4d3bf'];
const lid = [35,75,101,255], open = [180,211,191,255];
function fixture() {
  const width = 16, height = 1, color = new Uint8Array(width * 4), normals = new Uint8Array(width * 4);
  const frames = [0,1].flatMap(frame => [0,1].map(direction => {
    const x = (frame*2+direction)*4;
    color.set([...skin,...skin,...skin,...clear], x*4);
    normals.set([127,127,255,255], (x+1)*4);
    return { frame,direction,yaw:direction*Math.PI,duration:.5,
      rect:{ x,y:0,width:4,height:1 }, pivot:{ x:0,y:0 } };
  }));
  const cels = { poses:{ held:0 }, holds:[{frame:'held',frames:2}], transitions:[
    { id:'eyes',frame:'held',direction:0,rect:[0,0,2,1],period:1,palette,frames:[
      { duration:.125,paint:{rows:['.0']} },{ duration:.125,paint:{rows:['.1']} },{ duration:.25,paint:{rows:['.0']} }
    ] },
    { id:'mouth',rect:[2,0,1,1],start:.125,period:1,frames:[
      { duration:.375,images:{color:Uint8Array.from(berry),normal:Uint8Array.of(255,127,127,255)} }
    ] },
    { id:'grown-jaw',direction:0,rect:[0,0,5,1],mode:'replace',start:.5,period:1,
      extensionDepth:-.12,palette,frames:[
        {duration:.25,paint:{rows:['.0110']}},{duration:.125}
      ] }
  ] };
  return { metadata:{ width,height,frames,cels,unitsPerPixel:.23 }, images:{ color,normal:normals } };
}
function sample(atlas, view, time, x) {
  const texel = { color:[], normal:[], emission:[0,0,0] };
  const packet = atlas.transition(view,time);
  if (!atlas.sample(view,x,0,{depth:true,emission:true},texel,undefined,packet)) return { paint:clear };
  return { paint:[...texel.color,texel.alpha].map(n=>Math.round(n*255)), depth:texel.depth,
    normal:texel.hasNormal ? texel.normal : null };
}

test('authored intermediate cels, named pose holds and separate mouth timing share one sprite grid', () => {
  const atlas = K.sprite.atlas(fixture()), front = atlas.select(1,'impostor',[0,0,1]), back = atlas.select(1,'impostor',[0,0,-1]);
  assert.equal(front.frame,0);
  assert.deepEqual(sample(atlas,front,0,1).paint,lid);
  assert.deepEqual(sample(atlas,front,.125,1).paint,open);
  assert(sample(atlas,front,.125,1).normal[2] > .99, 'eye keeps its underlying normal');
  assert.deepEqual(sample(atlas,front,.125,2).paint,berry);
  assert(sample(atlas,front,.125,2).normal[0] > .99, 'mouth can supply its own normal');
  assert.deepEqual(sample(atlas,front,.25,1).paint,lid);
  assert.deepEqual(sample(atlas,front,.25,0).paint,skin);
  assert.deepEqual(sample(atlas,back,.125,1).paint,skin);
  assert.deepEqual(sample(atlas,back,.125,2).paint,berry);
  assert.deepEqual(sample(atlas,front,1.125,1).paint,open);
  assert.deepEqual(sample(atlas,front,.875,2).paint,skin);
});

test('a face redraw can remove the old silhouette and add depth-bearing pixels beyond the tile', () => {
  const source = fixture(), atlas = K.sprite.atlas(source), view = atlas.select(0,'card');
  assert.equal(atlas.hasDepth,true);
  assert.deepEqual(sample(atlas,view,.5,0).paint,clear);
  assert.deepEqual(sample(atlas,view,.5,4),{ paint:lid,depth:-.12,normal:null });
  assert.deepEqual(sample(atlas,view,.75,0).paint,skin);
  const placement = K.sprite.placeAtlas({ atlas,mode:'card',nativePixels:true,at:[0,0,0],lighting:false });
  const world = makeBuilder(1,[0x10182a]).finish({
    cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},radius:5,spriteAtlases:[placement]
  });
  let image = ink.render(world,{ w:40,h:24,t:.5,raw:true,px:1,transparent:true,passes:['position'] });
  const base = 12*40+20;
  assert.equal(image.alpha[base],0);
  assert.equal(image.alpha[base+4],255);
  assert(Math.abs(image.passes.position[(base+4)*3+2]-.12) < .02);
  assert.deepEqual([...image.rgb.slice((base+4)*3,(base+5)*3)],lid.slice(0,3));
  image = ink.render(world,{ w:40,h:24,t:.76,raw:true,px:1,transparent:true });
  assert.equal(image.alpha[base],255);
  assert.equal(image.alpha[base+4],0);
  delete source.metadata.cels.transitions[2].extensionDepth;
  assert.throws(()=>K.sprite.atlas(source),/beyond the displayed silhouette/);
});

test('PNG transition cels survive a sidecar round trip and a portable project bundle', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-face-transition-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const file = path.join(root,'actor.json');
  const source = fixture();
  const mixed = source.metadata.cels.transitions[0].frames[1];
  mixed.paint.rows = ['11'];
  mixed.images = { mask:Uint8Array.of(0,0,0,127, 0,0,0,128), emission:Uint8Array.of(0,0,0,0, 42,8,19,255) };
  ink.writeSpriteAtlas(source,{out:file});
  const saved = JSON.parse(fs.readFileSync(file,'utf8'));
  const png = saved.cels.transitions[1].frames[0].files.color;
  const { mask, emission } = saved.cels.transitions[0].frames[1].files;
  fs.writeFileSync(path.join(root,'expressions.json'),JSON.stringify(saved.cels));
  saved.cels = 'expressions.json';
  fs.writeFileSync(file,JSON.stringify(saved));
  const loaded = ink.readSpriteAtlas(file);
  assert.deepEqual(sample(loaded,loaded.select(0,'card'),.2,2).paint,berry);
  assert.deepEqual(sample(loaded,loaded.select(0,'card'),.2,0).paint,skin);
  assert.deepEqual(sample(loaded,loaded.select(0,'card'),.2,1).paint,open);
  const scene = path.join(root,'scene.json');
  fs.writeFileSync(scene,JSON.stringify({id:'expression-test',name:'Expression test',seed:1,
    solids:[{ id:'stand',kind:'box',at:[0,-1,0],half:[1,.05,1],mat:'stone',res:.2 }],
    finish:{spriteAtlases:[{atlas:'actor.json',at:[0,0,0],mode:'card',nativePixels:true}]}
  }));
  const out = path.join(root,'bundle.json');
  const { project } = ink.packProject(scene,{out,root});
  assert(project.files().includes(png));
  assert(project.files().includes(mask));
  assert(project.files().includes(emission));
  assert(project.files().includes('expressions.json'));
  const world = ink.createSceneEditor(fs.readFileSync(out,'utf8')).build();
  const restored = world.spriteAtlases[0].atlas;
  assert.deepEqual(sample(restored,restored.select(0,'card'),.2,2).paint,berry);
  const restoredView = restored.select(0,'card'), texel = { color:[], normal:[], emission:[0,0,0] };
  restored.sample(restoredView,1,0,{emission:true},texel,undefined,restored.transition(restoredView,.2));
  assert.deepEqual(texel.emission.map(value=>Math.round(value*255)),[42,8,19]);
  assert.equal(ink.readSpriteAtlas(file,{cels:false}).transition,undefined);
});

test('registered iris stencils clip emission and upper overlays cover both the eye and its glow', () => {
  const colors = ['#340c23','#d1434b','#ff4e31'];
  const rect = [0,0,5,1], bake = Uint8Array.from([...skin,...skin,...skin,...skin,...clear]);
  const baseEmission = Uint8Array.from([...lid,...clear,...clear,...clear,...clear]);
  const atlas = K.sprite.atlas({
    metadata:{width:5,height:1,frames:[{rect:{x:0,y:0,width:5,height:1},pivot:{x:0,y:0}}],cels:{
      transitions:[
        {id:'spell',rect,palette:colors,inheritEmission:false,start:.25,frames:[{
          duration:.75,paint:{rows:['11111']},maskPaint:{rows:['000..']},emissionPaint:{rows:['22222']}
        }]},
        {id:'bangs',rect,palette:colors,inheritEmission:false,frames:[{
          duration:1,paint:{rows:['0....']}
        }]},
        {id:'blink',rect,palette:colors,inheritEmission:false,start:.5,frames:[
          {duration:.25,paint:{rows:['.0...']}},{duration:.25,paint:{rows:['.00..']}}
        ]}
      ]
    }},
    images:{color:bake,emission:baseEmission}
  });
  const stamp = K.sprite.placeAtlas({ atlas,mode:'card',nativePixels:true,at:[0,0,0],lighting:false });
  const world = makeBuilder(1,[0x171827]).finish({
    cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},radius:5,spriteAtlases:[stamp]
  });
  const w = 24,h = 16, left = 12, top = 8, base = top*w+left;
  const preview = K.sprite.celPreview.create({ atlas,width:w,height:h,fps:4,count:4,mode:'card' });
  for (const [i, expected] of [[0,[0,0,0,0,0]],[1,[0,255,255,0,0]],[2,[0,0,255,0,0]],[3,[0,0,0,0,0]]]) {
    const { rgba,time } = preview.inspect(i);
    const frame = ink.render(world,{ w,h,t:time,raw:true,px:1,transparent:true,passes:['emission'] });
    assert.deepEqual(expected.map((_,x)=>Math.round(frame.passes.emission[(base+x)*3]*255)),expected);
    for (let p=base;p<base+5;p++) {
      assert.equal(frame.alpha[p],rgba[p*4+3]);
      if (frame.alpha[p]) assert.deepEqual([...frame.rgb.subarray(p*3,p*3+3)],[...rgba.subarray(p*4,p*4+3)]);
    }
    assert.deepEqual([...rgba.subarray((base+3)*4,(base+4)*4)],skin);
    assert.equal(rgba[(base+4)*4+3],0);
  }
  const withoutHalo = t => ink.render(world,{ w,h,t,px:1 }).rgb;
  const withHalo = t => ink.render(world,{ w,h,t,px:1,artEffects:{glow:{radius:2}} }).rgb;
  assert.notDeepEqual(withHalo(.25),withoutHalo(.25));
  assert.deepEqual(withHalo(.75),withoutHalo(.75));
});

test('a replacement stencil preserves old pixels outside the mask and erases transparent pixels inside it', () => {
  const source = fixture();
  source.metadata.cels.transitions = [{
    id:'selective-replace',mode:'replace',rect:[0,0,4,1],palette,frames:[{
      duration:1,paint:{rows:['..00']},maskPaint:{rows:['.00.']}
    }]
  }];
  const atlas=K.sprite.atlas(source), view=atlas.select(0,'card');
  assert.deepEqual([0,1,2,3].map(x=>sample(atlas,view,0,x).paint),[skin,clear,lid,clear]);
  const cel = source.metadata.cels.transitions[0].frames[0];
  cel.images = { mask: new Uint8Array(16) };
  assert.throws(()=>K.sprite.atlas(source),/one source per auxiliary channel/);
});
