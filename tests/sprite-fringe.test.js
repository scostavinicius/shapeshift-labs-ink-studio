const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const { KIT: K, makeBuilder } = ink.load();

function fixture() {
  const tile = { width: 3, height: 2 };
  const frames = [0, 1, 2].flatMap((frame, i) => [0, 1].map(direction => ({
    frame, direction, yaw: direction * Math.PI, duration: .5, pivot: { x: 1, y: 0 },
    rect: { x: (i * 2 + direction) * tile.width, y: 0, ...tile }
  })));
  const width = 18, height = 2, color = new Uint8Array(width * height * 4);
  for (const { rect: { x } } of frames) color.set([220,50,40,255], x * 4);
  const fringe = {
    clips: { tail: { width: 2, height: 2, pin: [0,0], palette: ['#254478','#f6aa3e'],
      frames: [{ rows: ['0.','01'], duration: .25 }, { rows: ['.1','..'], duration: .25, offset: [1,2] }] } },
    brushes: [{ clip: 'tail', depth: .1, emission: .5 }, { clip: 'tail', phase: .25, depth: -.1 }],
    paint: { rows: ['...','..0'] },
    views: [
      { frame: 'held', direction: 0, paint: { strokes: [{ slot: 1, shape: { type: 'rect', rect: [1,1,1,1] } }] } },
      { frame: 'held', direction: 1, paint: {} }
    ]
  };
  return { metadata: { width,height,frames,unitsPerPixel:.25,cels:{ poses:{held:1},holds:[{frame:'held',frames:2}],fringe } }, images:{color} };
}

test('brush paint follows the selected held view while fringes seek on their own clock', () => {
  const asset = K.sprite.atlas(fixture()), view = asset.select(0, 'impostor', [0,0,1]);
  assert.deepEqual(asset.fringe(view, 0).bounds, [2,1,4,3]);
  assert.deepEqual(asset.fringe(view, 0).at(3,2)[0].color.map(n=>Math.round(n*255)), [246,170,62]);
  assert.equal(asset.fringe(view, 0).at(3,2)[0].depth, .1);
  assert.deepEqual(asset.fringe(view,.25).bounds, [4,3,5,4]);
  assert.equal(asset.fringe(view,.25).at(2,1), undefined);
  assert.deepEqual(asset.fringe(view, .5).bounds, asset.fringe(view, 0).bounds);

  const held = asset.select(2,'impostor',[0,0,1]);
  assert.equal(held.frame, 1);
  assert.deepEqual(asset.fringe(held,1.0).bounds,[3,3,4,4]);
  assert.equal(asset.fringe(held,1.0).at(3,3)[0].depth, -.1);
  assert.deepEqual(asset.fringe(held,1.25).bounds,[1,1,3,3]);
  assert.equal(asset.fringe(asset.select(2,'impostor',[0,0,-1]),1), null);
});

test('fringe paint and independent offsets survive an atlas manifest round trip', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-sprite-fringe-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const file = path.join(directory,'atlas.json'), original = fixture();
  require('../cli/sprite-atlas.js').writeSpriteAtlas(original,{out:file});
  const json = JSON.parse(fs.readFileSync(file,'utf8'));
  fs.writeFileSync(path.join(directory,'edits.json'),JSON.stringify(json.cels));
  json.cels = 'edits.json';
  fs.writeFileSync(file,JSON.stringify(json));
  const result = ink.readSpriteAtlas(file), view = result.select(0,'card');
  assert.deepEqual(result.snapshot().metadata.cels.fringe, original.metadata.cels.fringe);
  assert.deepEqual(result.fringe(view,.25).bounds,[4,3,5,4]);
  assert.equal(ink.readSpriteAtlas(file,{cels:false}).fringe, undefined);
  const wrong = fixture();
  wrong.metadata.cels.fringe.paint.rows[1] = '..3';
  assert.throws(() => K.sprite.atlas(wrong), /brush slot/);
});

const pixel = (frame,x,y) => [...frame.rgb.slice((y*frame.w+x)*3,(y*frame.w+x)*3+3)];
const color = [246,170,62];
function render(t, { occluder = false, nativePixels = true, fringe = true } = {}) {
  const source = fixture();
  if (!fringe) delete source.metadata.cels.fringe;
  const ghost = K.sprite.placeAtlas({ atlas: source, mode:'card', nativePixels, at:[0,0,0], frame:0, lighting:false });
  const sprites = [ghost];
  if (occluder) sprites.push(K.sprite.placeAtlas({
    atlas:{metadata:{width:1,height:1,frames:[{rect:{x:0,y:0,width:1,height:1},pivot:{x:0,y:0}}]},
      images:{color:[12,205,78,255]}},
    at:[0,0,.8], mode:'card', nativePixels:true, pixelOffset:()=>[2,2], lighting:false
  }));
  const world = makeBuilder(5,[0x050910]).finish({
    cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},radius:5,spriteAtlases:sprites
  });
  world.fog.max = 0;
  return ink.render(world,{w:64,h:44,px:1,t,raw:true,transparent:true,passes:['depth','position','emission']});
}

test('the native atlas renders overhanging fringe cels with emission and leaves depth ownership clear', () => {
  const first = render(0), moved = render(.25), blank = render(0,{fringe:false});
  assert.deepEqual(pixel(first,31,22),[220,50,40]);
  assert.deepEqual(pixel(moved,31,22),[220,50,40]);
  assert.deepEqual(pixel(first,34,24),color);
  assert.deepEqual(pixel(moved,35,25),color);
  assert.equal(moved.alpha[24*64+34],0);
  const p = 24*64+34;
  assert.equal(first.passes.depth[p], blank.passes.depth[p]);
  assert(first.passes.emission[p*3] > .45);
  assert.deepEqual(pixel(render(0,{occluder:true}),34,24),[12,205,78]);

  const projected = render(.25,{nativePixels:false});
  assert(projected.rgb.some((n,i)=>i%3===0&&n===246));
});
