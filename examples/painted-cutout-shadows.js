/* A swung lamp illuminates two paper cutouts through the same light path. */
const { rect, line, fill, pixel } = require('./pixel-stamp-studies.js');
const LOOP = 4.8, W = 48, H = 76;

function tornPaper(K) {
  const strokes = [
    fill(0, [[3,0],[45,0],[46,12],[44,17],[47,23],[46,54],[43,58],[46,61],[44,71],
      [40,73],[37,70],[33,75],[29,71],[26,76],[22,74],[19,70],[14,74],[8,71],[3,73],[2,54],[0,46],[2,37]]),
    fill(1, [[4,1],[43,1],[45,20],[44,55],[42,61],[43,69],[38,71],[36,69],[33,72],
      [30,69],[26,74],[21,71],[18,68],[13,71],[8,69],[5,71],[3,46],[4,33]]),
    fill(2, [[5,1],[15,1],[15,22],[12,34],[13,46],[11,61],[13,69],[8,68],[6,69],[5,55],[4,44]]),
    line(3, [[6,2],[5,11],[6,24],[5,39],[6,50]]),
    line(0, [[39,3],[41,15],[39,20],[42,27],[41,44],[42,54]]),
    line(2, [[39,4],[40,12],[39,18]]),
    line(2, [[8,63],[13,65],[17,64]]),
    line(0, [[18,68],[22,71],[27,70],[29,68]]),
    fill(null, [[26,7],[31,8],[34,11],[34,15],[31,18],[27,19],[22,16],[21,13],[22,10],
      [24,10],[24,14],[27,15],[30,14],[30,11]]),
    fill(null, [[23,33],[19,29],[13,27],[7,27],[9,32],[13,36],[18,38],[14,40],[13,44],
      [17,45],[21,43],[23,41],[24,48],[26,46],[26,41],[29,44],[33,45],[37,42],
      [35,39],[31,37],[38,34],[41,29],[41,26],[32,28],[28,31],[26,34],[25,31],[24,31]]),
    line(null, [[24,33],[22,27],[20,25]]),
    line(null, [[26,33],[28,27],[31,25]]),
    fill(null, [[24,55],[30,61],[24,67],[18,61]]),
    fill(null, [[35,56],[38,59],[35,63],[32,59]]),
    pixel(null, 12, 16), pixel(null, 39, 18), pixel(null, 16, 20), pixel(null, 34, 50)
  ];
  return K.pixelStamps.image({ width: W, height: H, palette: ['#533741','#9b5b52','#b9755c','#dfac7d'], strokes });
}

function ivyPaper(K) {
  const strokes = [
    line(0, [[16,-1],[20,13],[17,25],[25,39],[23,55],[30,73]], 3),
    line(1, [[17,-1],[21,14],[18,24],[26,39],[24,55],[31,73]]),
    line(0, [[39,0],[35,14],[36,24],[31,38],[32,55],[24,64]], 2),
    line(1, [[9,0],[8,13],[12,24],[9,39],[15,60],[14,72]], 2)
  ];
  const leaves = [
    [18,10,-1,9],[21,16,1,9],[16,25,-1,7],[24,31,1,10],[23,41,-1,9],
    [25,52,1,8],[25,60,-1,9],[30,69,1,7],[36,11,1,7],[34,22,-1,6],
    [35,33,1,9],[31,44,1,8],[31,56,1,7],[10,15,-1,6],[11,26,1,6],
    [10,41,-1,7],[13,49,1,6],[14,63,-1,7]
  ];
  for (const [x,y,d,l] of leaves) {
    const leaf = (slot, points) => strokes.push(fill(slot, points.map(([u,v])=>[x+u*d,y+v])));
    leaf(0, [[0,0],[1,-4],[4,-5],[l,-2],[l+2,2],[l-1,3],[l-3,6],[3,6]]);
    leaf(2, [[1,0],[2,-3],[5,-4],[l,-1],[l+1,2],[l-2,2],[l-4,5],[3,5]]);
    leaf(1, [[2,1],[4,0],[l+1,2],[l-2,3],[l-4,5],[4,4]]);
    strokes.push(line(3, [[x,y],[x+5*d,y],[x+(l-1)*d,y+1]]));
  }
  return K.pixelStamps.image({ width: W, height: H, palette: ['#162b31','#28534a','#487768','#83a48a'], strokes });
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'painted-cutout-shadows', name: 'The Papercut Lantern', seed: 36,
  build(seed, { controls: { study = 'paper', cast = true, fog = true } = {} } = {}) {
    if (!['paper','ivy'].includes(study)) throw new RangeError('Choose the paper or ivy shadow study');
    const ivy = study === 'ivy', { V } = K, tone = ivy ? '#79eee0' : '#ffd08e';
    const palette = [
      0x0e1827,0x172436,0x243747,0x314b58,0x486770,0x638188,0x829b9b,
      0x2b293a,0x433544,0x60434a,0x7e5350,0xa26c54,0xca8e62,0xe9b179,0xffd28d,0xffedb6,
      0x183738,0x285554,0x387571,0x59a098,0x83cbc0,0xb7eae0,
      0x442b31,0x714344,0xae6650,0xe89a58,0xf5c671,0xfce18d
    ];
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, sun: V.norm([-.37,.68,.35]), amb: .42, sky: .20, sunK: .35, shLen: 0 });
    const masonry = { r: [1,2,3,4,5] }, ash = { r: [0,1,2,3,4] }, iron = { r: [7,8,9,10] };
    const brass = { r: [8,9,10,11,12,13] }, darkGold = { r: [7,8,9,10,11] };
    const box = (at, half, mat, res = .106, rd = .043) => S.box(at, half, mat, { res, rd });
    const tube = (points, radius, mat) => S.tube(points, radius, radius * .8, mat, { res: Math.max(.038,radius * .75) });
    const A = SpriteSurface.make(512);
    const facing = [-1.88,.47,.10], across = [1.38,0,-.24], up = [0,2.53,0];
    const reserved = A.reserve(W, H);
    A.faceRegion(facing, across, up, reserved, { id: 'painted-screen', castsShadow: cast });
    const wallX = -4.38, wallY = -.03, wallZ = -1.74, wallW = 8.76, wallH = 3.78;
    const stone = [0x344751,0x394e56,0x40565e,0x475e65,0x4e656b,0x516a70];
    A.face([wallX,wallY,wallZ], [wallW,0,0], [0,wallH,0], 272, 118, (x,y) => {
      const row = Math.floor(y / 13), col = Math.floor((x + (row % 2) * 18) / 36);
      const lx = (x + (row % 2) * 18) % 36, ly = y % 13;
      if (lx === 0 || ly === 0 || ly === 12) return 0x263844;
      const key = Math.abs((row*17+col*11)%5);
      const grain = (x*137 + y*179 + x*y*11) % 47;
      if(ly===1 || lx===1) return stone[Math.min(5,key+1)];
      return stone[(grain===0 ? Math.min(5,key+1) : grain===1?Math.max(0,key-1):key)];
    });
    const atlas = A.finish();
    const painted = (ivy ? ivyPaper : tornPaper)(K);
    SpriteSurface.update(atlas, reserved, { w: painted.width, h: painted.height, rgba: painted.rgba });

    box([0,-.18,-.06],[4.55,.15,2.44],ash,.19,.08);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 12; col++) {
      const x = (col - 5.6) * .73 + (row % 2) * .17, z = -1.4 + row * .66;
      box([x,-.012,z],[.35,.041,.312],(row*7+col*5)%8===1?masonry:ash,.16,.04);
    }
    box([0,.10,-1.67],[4.40,.13,.11],masonry,.12);
    box([0,.25,-1.66],[4.37,.042,.09],ash,.098);
    box([0,3.66,-1.68],[4.42,.092,.15],ash,.118);
    box([0,3.77,-1.60],[4.46,.052,.17],masonry,.11);
    for (const x of [-4.1,3.88]) {
      box([x,1.75,-1.49],[.23,1.47,.20],ash,.13,.063);
      box([x,3.32,-1.44],[.36,.10,.23],masonry,.10);
      box([x,.33,-1.40],[.33,.11,.27],masonry,.11);
      box([x,2.31,-1.25],[.134,.14,.045],iron,.067);
      const y=2.32, z=-1.19;
      tube([[x-.11,y-.03,z],[x,y+.12,z],[x+.11,y-.03,z]],.020,darkGold);
    }
    for (const side of [0,1]) {
      const x = facing[0] + side * across[0], y = facing[1], z = facing[2] + side * across[2];
      tube([[x,y-.33,z],[x,y+2.65,z]],.041,darkGold);
      S.lathe([x,.00,z],.21,[.13,.063],brass,{res:.051});
      S.ball([x,y+2.66,z],[.045,.071,.045],brass,{res:.037});
    }
    const end = V.add(facing, across);
    tube([V.add(facing,up),V.add(end,up)],.049,brass);
    for (const f of [.14,.51,.86]) {
      const a = V.add(V.lerp(facing,end,f),up);
      tube([V.mad(a,[0,0,1],.026),V.mad(a,[0,1,0],.087)],.016,brass);
    }
    const hinge = [-2.82,3.71,1.93];
    box([-2.76,3.78,1.26],[.21,.075,.75],iron,.11);
    S.ball(hinge,[.081,.056,.066],brass,{res:.049});
    S.bake();

    const location = t => {
      const a = .32 * Math.sin(t * Math.PI * 2 / LOOP);
      return [hinge[0]+1.47*Math.sin(a),hinge[1]-1.47*Math.cos(a),hinge[2]+.035*Math.cos(t * Math.PI * 2 / LOOP)];
    };
    const lamp = K.frameSplats(B, 90, (draw, _dt, time) => {
      const p=location(time);
      for(let i=0;i<22;i++) {
        const q=V.lerp(hinge,V.mad(p,[0,1,0],.13),i/22);
        draw.point(q,{width:.029,density:1,rgb:[.42,.29,.25],depth:true});
      }
      for (const y of [-.18,.17]) for(let i=0;i<9;i++) {
        const a = i * Math.PI * 2 / 9;
        draw.point([p[0]+.112*Math.cos(a),p[1]+y,p[2]+.108*Math.sin(a)],
          {width:.046,density:1,rgb:[.66,.43,.31],depth:true});
      }
      draw.point(p,{width:.071,density:1,rgb:ivy?[.54,1,.91]:[1,.79,.38],emissive:true,depth:true});
    });
    const aim = t => V.sub([.45,1.51,-1.55],location(t));
    const world = B.finish({
      cam: {target:[-.06,1.74,-.35],dist:10.2,yaw:.23,pitch:.145,ortho:true,sway:0,fov:.54},
      radius:9,dither:0,detail:24,spriteSurfaces:atlas,look:{splatCoverage:'continuous'},
      areaLights: ivy ? [] : [K.lightEmitters.disc({id:'swing-lamp',at:location,normal:aim,visible:false,size:[.12,.13],sampleGrid:1,
        color:tone,radius:9,intensity:16,volumeIntensity:3.6})],
      volumeLighting:{ambient:.13,...(ivy&&{spots:[{
        at:location,direction:aim,color:tone,radius:9,intensity:5,surfaceIntensity:16,innerAngle:27,outerAngle:48
      }]})},
      atmosphere: fog ? [K.atmosphere.box({
        min:[-3.3,.12,-1.66],max:[3.7,3.31,.40],density:ivy?.21:.16,step:.21,color:ivy?'#b6c9c7':'#aebbc5',lit:true
      })] : []
    });
    const stage = K.stage(world);
    stage.add(lamp);
    stage.stateful = false;
    stage.update(0,0);
    return world;
  }
});
