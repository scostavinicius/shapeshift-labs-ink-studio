const { test } = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { study } = require('../examples/sprite-cel-preview.cjs');
const { KIT: K, makeBuilder } = ink.load();
const { create, fromFrames, previousColor, nextColor } = K.sprite.celPreview;

const skin = [200,140,90,255], iris = [35,75,101,255], clear = [0,0,0,0];
const strip = (...pixels) => Uint8Array.from(pixels.flat());

test('onion skins skip held drawings, compare registered pixels and preserve the clean export', () => {
  const before = strip(iris,skin,skin,[1,2,3,0]);
  const current = strip(skin,iris,skin,clear);
  const after = strip(skin,skin,iris,clear);
  const preview = fromFrames({ width:4,height:1,frames:[before,before,current,current,after],fps:8,start:2 });
  const result = preview.inspect(2,{ opacity:1 });
  assert.deepEqual(result.rgba,current);
  assert.equal(result.time,2.25);
  assert.equal(result.previous.index,1);
  assert.equal(result.next.index,4);
  assert.deepEqual(result.onion,strip([...previousColor,255],[...nextColor,255],[...nextColor,255],clear));
  assert.equal(preview.inspect(3).previous.index,1);
  assert.equal(preview.inspect(2,{ neighbors:'frames' }).next.index,3);
  assert.equal(preview.inspect(0).previous,null);
  assert.equal(preview.inspect(4).next,null);
  assert.deepEqual(preview.inspect(2,{ previous:false,next:false }).onion,current);
  assert.deepEqual(preview.inspect(2,{ changesOnly:false,next:false,opacity:1 }).onion,
    strip([...previousColor,255],[...previousColor,255],[...previousColor,255],clear));
  result.rgba.fill(0);
  result.previous.rgba.fill(0);
  assert.deepEqual(preview.inspect(2).rgba,current);
  assert.deepEqual(preview.inspect(2).previous.rgba,before);
  const hidden = fromFrames({ width:1,height:1,frames:[strip(clear),strip([2,3,4,0]),strip(iris)] });
  assert.equal(hidden.inspect(0).next.index,2);
});

test('atlas preview matches the native renderer with a fractional pivot and an extending transition cel', () => {
  const atlas = K.sprite.atlas({
    metadata:{width:2,height:2,unitsPerPixel:.23,frames:[{
      frame:0,duration:1,rect:{x:0,y:0,width:2,height:2},pivot:{x:1.5,y:.5}
    }],cels:{transitions:[{
      id:'brow',rect:[0,0,3,2],start:.25,extensionDepth:-.12,palette:['#234b65'],
      frames:[{duration:.25,paint:{rows:['.00','...']}}]
    }]}},
    images:{color:strip(skin,skin,skin,clear)}
  });
  const placement = K.sprite.placeAtlas({ atlas,mode:'card',nativePixels:true,at:[0,0,0],lighting:false });
  const world = makeBuilder(1,[0x10182a]).finish({
    cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},radius:5,spriteAtlases:[placement]
  });
  const w = 40, h = 24;
  const preview = create({ atlas,width:w,height:h,fps:4,count:3,mode:'card' });
  const rendered = [0,1,2].map(index => {
    const { rgba,time } = preview.inspect(index);
    const { rgb,alpha } = ink.render(world,{ w,h,t:time,raw:true,px:1,transparent:true });
    const expected = new Uint8Array(w*h*4);
    for (let i=0;i<w*h;i++) if (alpha[i]) expected.set([...rgb.subarray(i*3,i*3+3),alpha[i]],i*4);
    assert.deepEqual(rgba,expected);
    return rgba;
  });
  assert.notDeepEqual(rendered[1],rendered[0]);
  assert.deepEqual(rendered[2],rendered[0]);
});

test('courier demo holds the head pose while an authored iris moves exactly one pixel', () => {
  const demo = study(K), preview = create(demo);
  const { previous,rgba,next } = preview.inspect(demo.frame);
  assert.equal(previous.index,7);
  assert.equal(next.index,10);
  assert.deepEqual(previous.rgba,next.rgba);
  const marks = data => {
    const locations = [];
    for (let x=42;x<51;x++) {
      const address = 40*demo.width+x, i=address*4;
      if (data[i]===246 && data[i+1]===223 && data[i+2]===171 && data[i+3]===255) locations.push(address);
    }
    return locations;
  };
  assert.equal(marks(rgba).length,1);
  assert.deepEqual(marks(rgba),marks(previous.rgba).map(address=>address+1));
});
