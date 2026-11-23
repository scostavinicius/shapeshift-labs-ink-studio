const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const { KIT: K, makeBuilder } = ink.load();

const base = [[45,66,87,255],[62,83,104,255],[85,115,132,255]];
const old = [87,46,54,255], red = [208,103,88,255], streak = [255,175,109,255], clear = [0,0,0,0];
const viewW = 7, h = 3, width = viewW * 3;
const row = (w, x, y) => (y * w + x) * 4;
const pixel = (rgba, w, x, y) => Array.from(rgba.slice(row(w,x,y),row(w,x,y)+4));
function source() {
  const color = new Uint8Array(width * h * 4);
  const anchors = [[2,0],[3,0],[3,1]];
  const frames = anchors.map(([x,y], frame) => {
    const local = frame * viewW;
    color.set(base[frame],row(width,local,0));
    color.set(old,row(width,local+x+2,y));
    return { frame,direction:0,duration:.25,rect:{x:local,y:0,width:viewW,height:h},pivot:{x:0,y:0} };
  });
  const smear = new Uint8Array(4 * 2 * 4);
  smear.set(streak,12);
  const silhouettes = [{ id:'hem',direction:0,rect:[2,0,4,2],period:.75,pin:[0,0],
    anchors:anchors.map((at,frame)=>({frame:frame===1?'lean':frame,at})),
    palette:['#d06758'], extensionDepth:-.2, frames:[
      { duration:.125,paint:{rows:['.0..','....']},maskPaint:{rows:['0000','....']} },
      { duration:.375,hold:0 }, { duration:.125,mode:'patch',offset:[1,0],images:{color:smear} }, {duration:.125}
    ] }];
  return { metadata:{ width,height:h,frames, cels:{poses:{lean:1},silhouettes} }, images:{ color } };
}
function read(atlas, time, x, y) {
  const view = atlas.select(atlas.playback('once')(time),'card');
  const texel = { color:[], normal:[], emission:[0,0,0] };
  const packet = atlas.transition(view,time);
  const found = atlas.sample(view,x,y,{depth:true},texel,undefined,packet);
  return { rgba:found ? [...texel.color,texel.alpha].map(n=>Math.round(n*255)) : clear, depth:texel.depth };
}

test('a held silhouette moves with the named pin while the underlying pose advances', () => {
  const atlas = K.sprite.atlas(source());
  assert.deepEqual(atlas.silhouettes,['hem']);
  assert.deepEqual(read(atlas,0,0,0).rgba,base[0]);
  assert.deepEqual(read(atlas,.25,0,0).rgba,base[1]);
  assert.deepEqual(read(atlas,0,3,0).rgba,red);
  assert.deepEqual(read(atlas,.25,4,0).rgba,red);
  assert.deepEqual(read(atlas,.25,3,0).rgba,clear);
  assert.deepEqual(read(atlas,.25,5,0).rgba,clear);
  assert.deepEqual(read(atlas,.5,5,1).rgba,old);
  assert.deepEqual(read(atlas,.5,7,1),{rgba:streak,depth:-.2});
  assert.deepEqual(read(atlas,.625,7,1).rgba,clear);
  assert.deepEqual(read(atlas,.75,4,1).rgba,red);
});

test('pin-registered onion skins skip a held contour and the composite still shows changing poses', () => {
  const atlas = K.sprite.atlas(source()), options = {atlas,width:16,height:8,fps:8,count:6,mode:'card',origin:[5,3]};
  const whole = K.sprite.celPreview.create(options), pinned = K.sprite.celPreview.create({...options,silhouette:'hem'});
  const view = pinned.inspect(2);
  assert.equal(whole.inspect(2).next.index,4);
  assert.notDeepEqual(whole.inspect(0).rgba,whole.inspect(2).rgba);
  assert.deepEqual(pinned.inspect(0).rgba,view.rgba);
  assert.deepEqual(pixel(view.rgba,16,6,3),red);
  assert.deepEqual(pixel(view.rgba,16,5,3),clear);
  assert.equal(view.previous,null);
  assert.equal(view.next.index,4);
  assert.notDeepEqual(view.onion,view.rgba);
  assert.throws(()=>K.sprite.celPreview.create({...options,silhouette:'other'}),/unknown silhouette/);
});

test('a pose-only anchor follows the matching orientation of a directional track', () => {
  const art = source();
  art.metadata.frames = art.metadata.frames.flatMap(view=>[view,{...view,direction:1,yaw:Math.PI}]);
  const atlas = K.sprite.atlas(art);
  const front = atlas.select(1,'impostor',[0,0,1]), back = atlas.select(1,'impostor',[0,0,-1]);
  assert.deepEqual(atlas.silhouette(front,.25,'hem').pin,[3,0]);
  assert.equal(atlas.silhouette(back,.25,'hem'),null);
  assert.equal(atlas.silhouette(front,.25),null);
});

test('a native card and its composite onion preview agree during an extending smear', () => {
  const atlas = K.sprite.atlas(source()), w = 32, h = 20;
  const preview = K.sprite.celPreview.create({atlas,width:w,height:h,mode:'card',start:.5,count:1});
  const world = makeBuilder(2,[0x10182a]).finish({
    cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},
    spriteAtlases:[K.sprite.placeAtlas({atlas, mode:'card',at:[0,0,0],nativePixels:true,playback:'once',lighting:false})]
  });
  const native = ink.render(world,{w,h,px:1,t:.5,raw:true,transparent:true});
  const rgba = new Uint8Array(w*h*4);
  for (let p=0;p<w*h;p++) if (native.alpha[p]) rgba.set([...native.rgb.subarray(p*3,p*3+3),native.alpha[p]],p*4);
  assert.deepEqual(preview.inspect(0).rgba,rgba);
  assert.deepEqual(pixel(rgba,w,w/2+7,h/2+1),streak);
});

test('silhouette PNG, hold references and moving anchors survive an atlas and portable project round trip', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-silhouette-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file = path.join(root,'actor.json');
  ink.writeSpriteAtlas(source(),{out:file});
  const manifest = JSON.parse(fs.readFileSync(file,'utf8'));
  const png = manifest.cels.silhouettes[0].frames[2].files.color;
  fs.writeFileSync(path.join(root,'contours.json'),JSON.stringify(manifest.cels));
  manifest.cels = 'contours.json';
  fs.writeFileSync(file,JSON.stringify(manifest));
  const atlas = ink.readSpriteAtlas(file);
  assert.deepEqual(read(atlas,.25,4,0).rgba,red);
  assert.deepEqual(read(atlas,.5,7,1).rgba,streak);
  const scene = path.join(root,'scene.json');
  fs.writeFileSync(scene,JSON.stringify({id:'contour-test',name:'Contour test',seed:2,
    solids:[{kind:'box',at:[0,-1,0],half:[1,.05,1],mat:'stone',res:.2}],
    finish:{spriteAtlases:[{atlas:'actor.json',at:[0,0,0],mode:'card',nativePixels:true}]}}));
  const out = path.join(root,'bundle.json'), { project } = ink.packProject(scene,{out,root});
  assert(project.files().includes('contours.json'));
  assert(project.files().includes(png));
  const restored = ink.createSceneEditor(fs.readFileSync(out,'utf8')).build().spriteAtlases[0].atlas;
  assert.deepEqual(read(restored,.5,7,1).rgba,streak);
});

test('invalid hold references, conflicting anchors and unregistered extension are rejected', () => {
  const broken = change=>{
    const art = source();
    change(art.metadata.cels.silhouettes[0]);
    return ()=>K.sprite.atlas(art);
  };
  assert.throws(broken(track=>track.frames[1].hold=1),/earlier painted cel/);
  assert.throws(broken(track=>track.anchors.push({frame:'lean',at:[5,0]})),/distinct views/);
  assert.throws(broken(track=>delete track.extensionDepth),/extensionDepth/);
});
