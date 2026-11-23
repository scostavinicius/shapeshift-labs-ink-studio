/* Rain Between Rooms. A painted shrine, a rainy garden, and a moon court. */
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const ink = require('..');

function study({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) {
  const width = 256, height = 160, duration = 6;
  const D = K.procedural.drawing2d;
  const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
  const poly = (points, fill) => ({ type: 'polygon', points, fill });
  const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
  const art = (width, height, commands) => D.render({ width, height, commands, edges: 'hard' });
  const oval = (x, y, rx, ry, fill) => poly(Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * 2 * Math.PI;
    return [Math.round(x + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry)];
  }), fill);
  function texel({ width, data }, u, v) {
    const i = (v * width + u) * 4;
    return data[i + 3] ? (data[i] << 16) | (data[i + 1] << 8) | data[i + 2] : undefined;
  }
  function panel(atlas, image, x, y, z, w, h) {
    atlas.face([x, y, z], [w, 0, 0], [0, h, 0], image.width, image.height, (u, v) => texel(image, u, v));
  }

  const tear = [
    [20,19],[27,15],[35,16],[38,24],[45,20],[56,19],[64,23],[67,18],[78,17],[83,23],
    [93,17],[103,11],[108,15],[106,23],[113,27],[110,33],[115,39],[108,46],[112,54],
    [107,58],[112,63],[104,73],[106,80],[98,84],[96,92],[88,90],[81,94],[71,91],[67,96],
    [60,91],[54,96],[51,89],[40,91],[36,86],[32,88],[26,83],[23,73],[17,74],[15,64],
    [18,57],[11,50],[16,40],[13,36],[19,29]
  ];
  const paperWidth = 124, paperHeight = 106;
  const torn = art(paperWidth, paperHeight, [
    poly(tear, '#ffffff'), rect(25, 35, 1, 12, '#000000'), rect(108, 26, 1, 9, '#000000'),
    rect(67, 90, 2, 7, '#000000'), rect(46, 85, 1, 14, '#000000'),
    rect(98, 26, 4, 1, '#000000'), rect(37, 18, 1, 18, '#000000'),
    rect(10, 29, 2, 3, '#ffffff'), rect(105, 7, 2, 3, '#ffffff'),
    rect(116, 50, 2, 3, '#ffffff'), rect(32, 94, 2, 2, '#ffffff')
  ]);
  const hole = Uint8Array.from({ length: paperWidth * paperHeight }, (_, i) =>
    torn.data[i * 4] > 0 ? 255 : 0);
  const outerMask = { width: paperWidth, height: paperHeight, channels: 1, data: hole };
  const screen = [
    rect(0, 0, paperWidth, paperHeight, '#776358'),
    rect(2, 3, 120, 100, '#a58968'), rect(5, 5, 113, 96, '#ad9475'),
    rect(5, 6, 111, 1, '#c4a47b'), rect(6, 98, 111, 2, '#997a61')
  ];
  for (let i = 0; i < 240; i++) {
    const x = 5 + Math.floor(K.hash(i, 22, 11) * 113), y = 6 + Math.floor(K.hash(i, 28, 6) * 94);
    screen.push(rect(x, y, 1 + +(i % 6 === 0), 1, i % 2 ? '#baa081' : '#9d8268'));
  }
  screen.push(poly([[5,63],[8,55],[10,58],[8,85],[9,94],[5,98]], '#6e6858'));
  for (const [x, dx, h] of [[10,-3,15],[12,6,24],[17,-1,14],[99,3,23],[110,-4,34],[113,3,16]]) {
    screen.push(line([[x,100],[x+dx,100-h]], '#6b6558'), rect(x + dx - 1, 97 - h, 2, 4, '#71665a'));
  }
  for (const y of [18, 42, 69, 94]) screen.push(rect(2, y, 120, 1, '#826a59'));
  for (const x of [7, 34, 63, 88, 115]) screen.push(rect(x, 1, 1, 104, '#7c6757'));
  const cloth = art(paperWidth, paperHeight, screen);
  for (let y = 0; y < paperHeight; y++) for (let x = 0; x < paperWidth; x++) {
    const i = y * paperWidth + x;
    if (hole[i]) cloth.data.set([38, 32, 44, 255], 4 * i);
    else if (x + 1 < paperWidth && hole[i + 1] || y > 0 && hole[i - paperWidth])
      cloth.data.set([219, 182, 131, 255], 4 * i);
    else if (x > 0 && hole[i - 1] || y + 1 < paperHeight && hole[i + paperWidth])
      cloth.data.set([114, 84, 66, 255], 4 * i);
  }

  const shrine = SpriteSurface.make(512);
  const wall = [
    rect(0,0,250,154,'#281e2b'), rect(0,15,250,110,'#322533'),
    rect(1,27,249,88,'#3a2934'), rect(0,128,250,26,'#372c37'),
    poly([[0,154],[250,154],[250,125],[22,125]],'#312736'),
    poly([[0,154],[250,154],[250,149],[0,137]],'#241f2f'),
    rect(0,17,250,2,'#613b3d'), rect(0,19,250,3,'#512f37'),
    rect(0,23,250,7,'#261e2b'), rect(0,98,250,2,'#472d36'),
    rect(0,109,250,2,'#462c34'), rect(0,118,250,2,'#2a2232')
  ];
  for (const x of [4, 24, 44, 208, 227, 246]) {
    wall.push(rect(x, 28, 3, 96, '#261e2b'), rect(x + 3, 29, 1, 88, '#67413f'));
    for (let y = 39; y < 121; y += 19) {
      wall.push(rect(x + 5, y, 12, 1, '#543841'), rect(x + 8, y + 5, 8, 1, '#472f3b'));
    }
  }
  for (let i = 0; i < 95; i++) {
    const x = Math.floor(K.hash(i,38,15) * 248), y = 131 + Math.floor(K.hash(i,11,5) * 22);
    wall.push(rect(x, y, i % 12 === 0 ? 4 : 1, 1, i % 2 ? '#523745' : '#44303e'));
  }
  for (const x of [9, 225]) {
    wall.push(poly([[x,121],[x+11,91],[x+25,91],[x+31,121]],'#382d39'));
    wall.push(rect(x+6,116,25,3,'#89614e'), rect(x+8,119,20,6,'#5a3b42'),
      rect(x+11,112,12,4,'#6d4b44'), rect(x+16,104,3,8,'#d0724d'));
    wall.push(rect(x+15,102,5,5,'#e79155'), rect(x+17,100,2,6,'#ffe29a'));
  }
  panel(shrine, art(250,154,wall), -3.5, .02, -.21, 7, 4.31);
  const rootOrigin = [0, 2.03, 0], rootHalf = [1.85, 1.59];
  panel(shrine, cloth, -rootHalf[0], rootOrigin[1] - rootHalf[1], -.035, 2 * rootHalf[0], 2 * rootHalf[1]);
  const wood = art(160, 134, [
    rect(0, 11, 160, 10, '#332431'), rect(2, 12, 156, 2, '#6b423e'),
    poly([[2,10],[19,7],[33,7],[49,4],[111,4],[127,7],[144,7],[158,10],[156,12],[4,12]],'#51303a'),
    rect(15, 21, 130, 2, '#ad704e'),
    rect(12, 15, 8, 115, '#533239'), rect(14, 20, 1, 105, '#ac6b50'),
    rect(19, 23, 2, 102, '#2c2433'), rect(140, 15, 8, 115, '#4c3039'),
    rect(141, 22, 2, 107, '#966048'), rect(137, 22, 3, 103, '#2d2432'),
    rect(7, 121, 146, 7, '#332631'), rect(9, 121, 142, 2, '#b5835d'),
    rect(12, 128, 136, 4, '#6b4b45'), rect(18, 130, 123, 2, '#3c2c37'),
    ...Array.from({ length: 15 }, (_, i) => rect(18 + i * 9, 14, 4, 1, '#896047')),
    ...[16, 145].flatMap(x => [rect(x, 22, 2, 2, '#d6a06e'), rect(x, 118, 2, 2, '#b47c58')]),
    rect(78, 5, 5, 2, '#c18b5b'), poly([[80,6],[84,9],[80,12],[76,9]], '#bd875b'),
    poly([[80,8],[82,9],[80,11],[78,9]], '#ffd492')
  ]);
  panel(shrine, wood, -2.50, .38, .035, 5, 3.73);

  const lamp = art(28, 43, [
    line([[13,0],[13,15],[12,17]], '#61434a'), rect(14,0,1,16,'#c28466'),
    poly([[13,14],[19,18],[19,20],[8,20],[8,18]], '#ce9360'),
    rect(9,19,10,2,'#532f39'), poly([[8,21],[18,21],[21,24],[21,34],[18,37],[8,37],[5,34],[5,24]],'#be603f'),
    rect(7,24,12,10,'#d98347'), rect(9,22,8,14,'#ffc16a'),
    poly([[12,33],[10,31],[12,27],[12,24],[16,28],[16,31],[15,33]],'#fff2bd'),
    rect(12,29,3,3,'#fff8df'), rect(8,23,1,13,'#91503d'),
    rect(18,23,1,12,'#82443b'), rect(6,33,14,2,'#a76143'),
    rect(4,35,18,2,'#59343b'), rect(6,36,14,2,'#c68b55'),
    rect(12,38,3,2,'#815041'), rect(13,40,1,3,'#f2ad63'),
    rect(4,27,1,4,'#e69f5d'), rect(3,27,1,1,'#96604d'),
    rect(22,28,1,3,'#e69f5d')
  ]);
  const lanternFace = 3 * 6;
  panel(shrine, lamp, -.37, 1.38, .73, .74, 1.13);
  const sourceAtlas = shrine.finish(), lampVertices = sourceAtlas.vertices.slice(lanternFace * 5);
  const camera = { target: [0, 2.1, 0], dist: 7.5, fov: .52, yaw: 0, pitch: 0 };
  const source = makeBuilder(19, [0x241c2a]).finish({ cam: camera, radius: 24, spriteSurfaces: sourceAtlas });

  const gardenArt = [
    rect(0,0,220,162,'#22344a'), rect(0,32,220,99,'#294657'),
    poly([[0,80],[23,67],[46,70],[79,58],[98,59],[113,52],[140,58],[166,55],[194,61],[220,58],[220,162],[0,162]], '#38596b'),
    poly([[0,104],[25,96],[45,98],[68,88],[89,95],[109,94],[134,87],[166,97],[200,82],[220,84],[220,162],[0,162]], '#345265'),
    poly([[0,109],[22,106],[52,111],[74,103],[104,112],[129,102],[155,105],[177,111],[205,101],[220,106],[220,162],[0,162]], '#416475'),
    rect(0,113,220,43,'#446673'), rect(0,130,220,32,'#345761'),
    rect(13,126,92,1,'#63918d'), rect(121,120,71,1,'#648889'), rect(148,136,48,1,'#537d7b')
  ];
  function willow(x, y, lean, shade) {
    const dark = shade ? '#253d4c' : '#182e3d', leaf = shade ? '#355263' : '#284353';
    gardenArt.push(poly([[x-5,y+25],[x-3,y-4],[x+lean,y-41],[x+lean+3,y-49],[x+lean+6,y-45],[x+7,y-5],[x+7,y+26]], dark));
    gardenArt.push(line([[x,y+23],[x+2,y],[x+lean+4,y-32]],shade?'#475c62':'#3d5255',2));
    for (let i = 0; i < 28; i++) {
      const u = x + lean + Math.floor(K.hash(i,x,9) * 60) - 28;
      const v = y - 50 + Math.floor(K.hash(i,x,13) * 42);
      gardenArt.push(oval(u,v,7+(i%5),3+(i%4),i % 3 ? dark : leaf));
      if (i % 3 === 0) gardenArt.push(line([[u,v],[u-1,v+7],[u+1,v+12]],leaf));
    }
  }
  willow(43, 100, 10, true);
  willow(176, 97, -13, true);
  willow(199, 85, 5, false);
  for (let i = 0; i < 125; i++) {
    const x = 2 + Math.floor(K.hash(i,5,23) * 216), y = 116 + Math.floor(K.hash(i,9,7) * 43);
    gardenArt.push(rect(x,y,2 + i % 8,1,i % 5 === 0 ? '#7d9e96' : i % 3 === 0 ? '#527b80' : '#3c626d'));
  }
  const gardenAtlas = SpriteSurface.make(512);
  panel(gardenAtlas, art(220,162,gardenArt), -7.3, -.8, -10.3, 14.6, 10.75);
  const basin = [rect(0,0,204,176,'#2e5661')];
  for (let i = 0; i < 380; i++) {
    const x = Math.floor(K.hash(i, 6, 71) * 197), y = Math.floor(K.hash(i, 17, 4) * 176);
    const colors = ['#325962', '#416971', '#537a7d', '#627e83'];
    basin.push(rect(x,y,2+i%8,1,colors[i%7 === 0 ? 3 : i%3]));
  }
  const water = art(204,176,basin);
  gardenAtlas.face([-4.4,-.02,-.02],[8.8,0,0],[0,0,-9.8],water.width,water.height,
    (u,v) => texel(water,u,v));

  const innerOrigin = [.4, 2.02, -3.65], innerHalf = [1.04, 1.17];
  const innerPaint = art(56,64, [poly([
    [6,56],[6,25],[8,18],[12,15],[13,10],[20,8],[21,5],[35,5],[35,8],[42,10],
    [43,14],[48,18],[50,25],[50,56],[47,58],[35,58],[31,56],[15,58],[9,57]
  ],'#ffffff'), rect(7,47,2,8,'#000000'), rect(47,18,2,7,'#000000')]);
  const innerMask = { width: 56, height: 64, channels: 1,
    data: Uint8Array.from({ length: 56 * 64 }, (_, i) => innerPaint.data[i * 4]) };
  const gate = art(70,79, [
    poly([[3,68],[3,33],[5,24],[8,21],[10,16],[16,13],[18,7],[23,6],[25,3],[46,3],
      [50,7],[54,8],[56,14],[62,18],[66,25],[67,69],[63,75],[7,75]],'#233040'),
    poly([[7,69],[7,33],[9,25],[14,22],[16,16],[23,14],[24,10],[29,8],[42,8],[44,11],
      [50,14],[56,18],[57,23],[62,28],[63,69],[60,72],[10,72]],'#537173'),
    poly([[11,67],[11,31],[13,24],[18,21],[20,15],[27,14],[28,11],[42,11],[42,13],
      [49,15],[51,20],[56,23],[58,31],[59,65],[54,70],[17,70]],'#162836'),
    rect(2,61,6,5,'#748579'), rect(62,59,6,5,'#778778'),
    rect(22,5,23,1,'#9caa90'), rect(6,69,59,2,'#93a28c'),
    rect(10,72,53,2,'#4e6769'), rect(33,5,5,3,'#dfbd78')
  ]);
  panel(gardenAtlas, gate, innerOrigin[0] - 1.29, .73, -3.69, 2.58, 2.66);

  const rainSheets = [
    { z:-.85, w:5.8, h:4.8, count:53, marks:[[88,132,146,255],[137,177,178,255],[176,208,201,255]] },
    { z:-2.48, w:6.4, h:5.4, count:79, marks:[[57,100,122,255],[82,123,142,255],[114,153,154,255]] }
  ].map(({ z, w, h, count, marks }, sheet) => {
    const width = 164, height = 125, region = gardenAtlas.reserve(width,height);
    gardenAtlas.faceRegion([-w/2,0,z],[w,0,0],[0,h,0],region);
    const drops = Array.from({ length:count }, (_,i) => ({
      x:Math.floor(K.hash(i,sheet,53)*width), phase:K.hash(i,sheet,15), cycles:4+i%4,
      length:2+i%3, color:marks[i%7 === 0 ? 2 : i%2]
    }));
    return {region, width, height, drops, rgba:new Uint8Array(width*height*4)};
  });
  const B = makeBuilder(81, [0x263c51,0x223944,0x37545c,0x4c7374,0x70877d,0x9aab8b,
    0x29454c,0x466963,0x5f8b75,0xa3a980]);
  const S = K.sculpt(makeSculpt(B));
  S.sun = K.V.norm([-1,1.4,.6]);
  S.amb = .42;
  const stone = { r: [1,2,3,4,5] };
  for (const [i, [x, z]] of [[-.35,-.66],[.1,-1.25],[.47,-1.84],[.12,-2.44],[.52,-3.02],[.55,-3.53]].entries()) {
    const half = .47 - i*.023;
    S.rock([x,.01,z],[half,.16,.30],stone,{ res:.075 });
  }
  for (const [x, z, r] of [[-1.32,-1.0,.63],[1.68,-1.28,.46],[-1.54,-2.3,.46],[1.43,-3.2,.32],[-.93,-4,.40],[1.8,-4.45,.48]]) {
    S.rock([x,.09,z],[r,.28,r*.69],stone,{res:.077});
    for (let i=0; i<5; i++) {
      const d = (K.hash(i,x,z) - .5)*r;
      const h = .26 + K.hash(i,z,x)*.55;
      const sway = (K.hash(i,z,4)-.45)*.32;
      S.tube([[x+d,.18,z],[x+d+sway,.18+h,z-.08]],.019,.01,{r:[6,7,8,9]},{res:.046});
    }
  }
  S.bake();
  const gardenSurfaces = gardenAtlas.finish();
  const garden = B.finish({ radius:24, spriteSurfaces:gardenSurfaces });

  function rain(time) {
    for (const {region,width,height,drops,rgba} of rainSheets) {
      rgba.fill(0);
      for (const {x,phase,cycles,length,color} of drops) {
        const y = Math.floor(((phase+time/duration*cycles)%1)*height);
        for (let n=0;n<length;n++) {
          const row=y+n;
          if (row>=height) break;
          const col=(x+Math.floor(row/6))%width;
          rgba.set(color,(row*width+col)*4);
        }
      }
      SpriteSurface.update(gardenSurfaces,region,{w:width,h:height,rgba});
    }
  }

  const farAtlas = SpriteSurface.make(256);
  const court = [
    rect(0,0,120,130,'#46425b'), rect(0,32,120,73,'#65506a'),
    rect(0,61,120,46,'#876379'), rect(0,91,120,39,'#4a4b64'),
    oval(65,57,41,36,'#926c75'), oval(65,55,32,29,'#aa7d78'),
    oval(65,53,25,24,'#c29782'), oval(65,52,21,21,'#dbac86'),
    oval(65,52,17,17,'#ffd7a0'),
    poly([[0,83],[17,81],[29,75],[44,79],[59,75],[75,81],[97,73],[119,76],[120,107],[0,108]],'#666078'),
    poly([[0,93],[18,91],[33,87],[49,91],[68,90],[78,95],[101,87],[120,92],[120,130],[0,130]],'#4b536b'),
    rect(37,99,44,1,'#a1838b'), rect(51,102,26,1,'#c1918b'), rect(46,106,43,1,'#8b7286'),
    rect(58,111,17,1,'#a47c82'), rect(51,115,33,1,'#7b647a'),
    line([[13,0],[17,40],[31,57],[38,68]],'#3b3c54',4),
    line([[106,6],[102,40],[94,56],[86,67]],'#36394e',3)
  ];
  for (const [x,y] of [[22,39],[36,53],[83,75],[98,63],[39,66],[91,41],[54,20],[77,15]]) {
    court.push(rect(x,y,1,1,'#ffdfad'));
  }
  panel(farAtlas,art(120,130,court),-2.5,-.5,-2.4,5,5.42);
  const far = makeBuilder(92,[0x544660]).finish({radius:24,spriteSurfaces:farAtlas.finish()});

  const doors = K.world.portals;
  const away = { origin:[0,2.03,0], normal:[0,0,-1] };
  const outer = { from:{ origin:rootOrigin }, to:away, halfWidth:rootHalf[0], halfHeight:rootHalf[1] };
  const inner = { from:{ origin:innerOrigin }, to:{ origin:[0,2.02,0], normal:[0,0,-1] },
    halfWidth:innerHalf[0], halfHeight:innerHalf[1] };
  const outerPainted = doors.doorway({ ...outer, mask:outerMask }), outerRect = doors.doorway(outer);
  const innerPainted = doors.doorway({ ...inner, mask:innerMask }), innerRect = doors.doorway(inner);

  function frame(renderer, time, { painted = true, nested = true } = {}) {
    const angle = time / duration * Math.PI * 2;
    const swing = Math.sin(angle) * 1.58, lift = .25 * Math.abs(Math.sin(angle));
    const dst = sourceAtlas.vertices;
    for (let k = 0; k < lampVertices.length; k += 5) {
      dst[lanternFace * 5 + k] = lampVertices[k] + swing;
      dst[lanternFace * 5 + k + 1] = lampVertices[k + 1] + lift;
    }
    SpriteSurface.markGeometryDirty(sourceAtlas,{first:lanternFace,count:6});
    rain(time);
    const child = { source:garden, opening:painted ? innerPainted : innerRect, destination:far };
    renderer.render(source,{width,height,time,raw:true,
      camera:{...camera,yaw:.045*Math.sin(angle-.5)},
      portal:{source,opening:painted ? outerPainted : outerRect,destination:garden,
        destinationFrame:{portal:nested ? child : undefined}}
    });
  }
  return { width,height,duration,frame,outerMask,innerMask };
}

if (require.main === module) {
  const [rendererFile, directory = 'studio/painted-portals'] = process.argv.slice(2);
  if (!rendererFile) throw new Error('Supply a bundled ES module exporting createRenderer');
  const encode = source => gzipSync(source,{level:9}).toString('base64');
  const toolkit = encode(ink.bundle() + '\nreturn { KIT, PixelLook, SpriteSurface, makeBuilder, makeSculpt };');
  const renderer = encode(fs.readFileSync(rendererFile));
  const template = fs.readFileSync(path.join(__dirname,'painted-portals.html.template'),'utf8');
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'rain-between-rooms.html'),template.replace('/* STUDIO */', () => `
    const toolkit = Function(await unpack('${toolkit}'))();
    const moduleUrl = URL.createObjectURL(new Blob([await unpack('${renderer}')], { type:'text/javascript' }));
    let createRenderer;
    try { ({createRenderer} = await import(moduleUrl)); } finally { URL.revokeObjectURL(moduleUrl); }
    const demo = (${study.toString()})(toolkit);
  `));
}
module.exports = study;
