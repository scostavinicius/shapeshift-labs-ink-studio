/* The Drowned Belfry. Authored hem cels move independently of a held ghost pose. */
const { line, fill, rect, pixel } = require('./pixel-stamp-studies.js');

const WIDTH = 322, HEIGHT = 214, CW = 58, CH = 66, LOOP = 6;
const ghostPalette = ['#18445d','#246276','#328393','#51a6a7','#98d1c3','#c7e7cd','#f3f4d7','#e2b68a'];
const fringePalette = ['#377687','#539b9f','#7bbeb4','#b0dbc5','#dcf0d1','#edf4d8'];
const rect2 = (x,y,w,h,fill) => ({ type:'rect', rect:[x,y,w,h], fill });
const polygon = (fill,...points) => ({ type:'polygon', points, fill });
const path = (stroke,points,width=1) => ({ type:'path', points, stroke, width });
const oval = (x,y,w,h,fill) => ({ type:'ellipse', rect:[x,y,w,h], fill });
const render = (K,width,height,commands) =>
  K.procedural.drawing2d.render({ width,height,commands,edges:'hard' }).data;

function ghost(cel) {
  const shift = cel === 0 ? 0 : cel === 1 ? 1 : -1;
  return [
    // Narrow hood in profile and shoulder armor.
    fill(0, [[18,22],[17,19],[18,14],[23,10],[29,9],[33,11],[35,15],[34,21],[31,25],[33,27],
      [38,30],[39,36],[37,42],[38,51],[39+shift,60],[37+shift,65],[31,64],[27,66],[23,63],
      [17+shift,65],[13+shift,60],[15,52],[20,42],[17,38],[17,30],[21,26]]),
    fill(1, [[19,30],[23,27],[27,26],[32,28],[36,31],[37,36],[34,43],[35,51],[36+shift,60],[34,63],
      [29,60],[26,65],[23,62],[17+shift,64],[15+shift,61],[18,52],[22,42],[20,37]]),
    fill(2, [[21,32],[24,28],[29,28],[32,32],[32,38],[29,44],[31,49],[33+shift,59],[29,62],[27,58],
      [24,64],[21,61],[17+shift,63],[20,56],[21,51],[24,43],[23,39]]),
    fill(3, [[22,31],[27,28],[30,31],[29,38],[26,42],[27,46],[26,53],[24,57],[22,54],[21,59],
      [19,62],[18,61],[21,54],[21,51],[24,44],[24,40]]),
    line(4, [[22,32],[24,29],[28,29],[30,31]]), line(5, [[23,31],[27,29],[29,30]]),
    fill(2, [[19,21],[18,17],[22,12],[26,10],[30,10],[33,13],[34,16],[32,17],[34,20],[33,22],
      [30,23],[29,26],[25,26],[22,23]]),
    fill(4, [[21,15],[24,12],[29,11],[31,12],[29,14],[27,15],[28,17],[27,20],[25,21],[23,19],[22,21],[20,20]]),
    fill(1, [[28,14],[32,14],[33,17],[34,18],[33,20],[32,20],[32,22],[30,23],[27,22],[27,19]]),
    line(5, [[22,14],[25,12],[29,11],[32,12]]), pixel(6,31,17), pixel(4,30,17), pixel(4,33,20),
    line(4, [[30,23],[28,25],[25,25]]), line(5, [[22,24],[24,26],[27,26]]),
    // A shoulder band separates the neck from the raised forearm.
    fill(2, [[32,28],[36,28],[40,32],[41,35],[44,34],[46,30],[50,29],[51,33],[47,38],[43,40],[39,39],
      [36,38],[34,42],[31,40],[32,35]]),
    line(4, [[34,29],[37,30],[40,33],[42,35],[44,34],[46,31],[49,30]]),
    line(5, [[41,35],[44,34],[47,31]]),
    line(1, [[39,39],[42,40],[47,38],[49,35]]),
    fill(3, [[20,30],[17,31],[15,35],[16,41],[18,44],[21,42],[20,38],[21,35],[24,34],[24,31]]),
    line(5, [[18,32],[16,35],[17,39],[19,40]]),
    // Ice blade with two separate glints and a darker hilt.
    fill(2, [[47,35],[49,32],[51,11],[53,1],[54,5],[53,18],[51,33],[50,37],[48,38]]),
    fill(5, [[50,30],[52,11],[53,2],[54,5],[53,17],[51,31]]),
    line(6, [[53,4],[52,15],[51,24],[50,29]]),
    line(4, [[46,29],[48,31],[52,31],[55,29]]),
    line(6, [[47,29],[49,30],[52,30],[54,29]]),
    pixel(7,50,32), pixel(5,49,33), pixel(4,49,35),
    // Lower fabric joins are drawn into the pose. The brush sites sit on these rows.
    line(4, [[23,42],[24,46],[22,52],[21,56],[19+shift,61]]),
    line(4, [[28,42],[28,49],[28,55],[29,60]]),
    line(3, [[32,43],[33,48],[34,52],[34+shift,60]]),
    line(2, [[34,49],[36,54],[37+shift,60]]),
    line(5, [[24,48],[23,53],[23,55]]),
    line(5, [[19,32],[18,34],[18,36]]), line(6, [[24,29],[27,29]]),
    line(4, [[16+shift,60],[16+shift,62],[17+shift,63]]),
    pixel(5,24,58), pixel(4,28,57), pixel(4,31,63), pixel(3,17+shift,63)
  ];
}

function fringe() {
  const flowing = (width,height,pin,poses) => ({ width,height,pin,palette:fringePalette,
    frames:poses.map(({ duration, strands, sparks = [], offset }) => ({ duration,
      ...(offset && {offset}),
      strokes:[...strands.map(([slot,weight,...points]) => line(slot,points,weight)),
        ...sparks.map(([slot,x,y]) => pixel(slot,x,y))]
    })) });
  const ruffle = flowing(15,23,[7,0],[
    { duration:.24, strands:[[1,3,[7,0],[7,4],[5,9],[4,13],[3,19]],[3,1,[7,0],[7,4],[6,7],[5,10]],
      [2,1,[6,5],[6,10],[5,14],[6,17]],[0,1,[4,11],[3,14],[2,17]]], sparks:[[1,3,21]] },
    { duration:.18, strands:[[1,2,[7,0],[6,4],[5,8],[3,12],[1,16]],[3,1,[7,0],[7,3],[6,5],[5,9]],
      [2,1,[5,8],[4,12],[4,15],[2,19]],[0,1,[3,10],[2,13],[0,15]]] },
    { duration:.18, strands:[[1,3,[7,0],[7,4],[4,8],[3,12],[1,14]],[3,1,[7,0],[7,3],[5,6],[4,8]],
      [2,1,[5,8],[5,12],[4,14],[3,18]],[1,1,[4,11],[3,15],[1,17]]], sparks:[[0,1,20]] },
    { duration:.24, strands:[[1,2,[7,0],[8,4],[6,8],[4,13],[4,17]],[3,1,[7,0],[8,3],[7,6],[6,8]],
      [2,1,[6,8],[6,13],[5,16],[5,20]],[0,1,[5,13],[3,15],[3,18]]] },
    { duration:.36, strands:[[1,3,[7,0],[8,5],[8,10],[6,14],[6,19]],[3,1,[7,0],[8,4],[8,8],[7,11]],
      [2,1,[8,9],[9,13],[8,17],[8,21]],[0,1,[6,12],[5,17],[4,19]]] }
  ]);
  const cord = flowing(13,28,[5,0],[
    {duration:.18,strands:[[2,3,[5,0],[5,4],[7,9],[7,14],[6,18],[7,23]],[4,1,[5,0],[6,5],[7,9],[7,12]],
      [1,1,[5,9],[5,14],[4,18],[5,23]],[0,1,[6,18],[6,24],[5,26]]]},
    {duration:.26,strands:[[2,3,[5,0],[6,4],[8,9],[9,13],[8,18],[10,22]],[4,1,[5,0],[6,3],[8,7],[9,11]],
      [1,1,[7,11],[7,15],[6,19],[7,23]],[1,1,[9,14],[10,17],[11,21]]],sparks:[[0,10,25]]},
    {duration:.22,strands:[[2,3,[5,0],[5,5],[7,9],[8,14],[10,17],[11,21]],[4,1,[5,0],[5,5],[7,8],[8,13]],
      [1,1,[7,8],[6,13],[7,17],[7,23]],[0,1,[10,17],[10,21],[9,24]]]},
    {duration:.30,strands:[[2,3,[5,0],[4,5],[5,10],[7,14],[8,19],[8,24]],[4,1,[5,0],[4,5],[5,9],[6,12]],
      [1,1,[5,9],[4,14],[5,18],[5,21]],[0,1,[7,18],[6,23],[5,26]]]},
    {duration:.24,strands:[[2,3,[5,0],[4,5],[4,10],[5,15],[4,21],[5,23]],[4,1,[5,0],[4,4],[4,9],[5,13]],
      [1,1,[5,12],[6,17],[5,20],[6,24]],[0,1,[4,16],[3,20],[3,24]]]}
  ]);
  const drift = flowing(12,18,[5,0],[
    {duration:.30,strands:[[1,2,[5,0],[6,4],[7,8],[8,12],[8,15]],[3,1,[5,0],[6,4],[7,6]],
      [0,1,[7,8],[9,10],[10,12]]]},
    {duration:.30,strands:[[1,2,[5,0],[6,4],[8,8],[9,11],[10,14]],[3,1,[5,0],[6,3],[8,7]],
      [0,1,[7,8],[7,12],[8,16]]]},
    {duration:.30,offset:[3,7],strands:[[2,2,[6,1],[7,4],[8,8]],[1,1,[8,7],[9,9],[9,11]]],sparks:[[1,4,5]]},
    {duration:.30,offset:[6,13],strands:[[1,1,[6,2],[7,4],[7,7]]],sparks:[[2,8,5],[0,6,8]]},
    {duration:.30,offset:[9,17],strands:[],sparks:[[1,6,5],[0,7,7]]}
  ]);
  const brushes = [
    {clip:'ruffle',phase:.11,depth:.03,opacity:.79},{clip:'ruffle',phase:.42,depth:.06,opacity:.66},
    {clip:'ruffle',phase:.71,depth:.04,opacity:.82},{clip:'cord',phase:.16,depth:.02,opacity:.88},
    {clip:'cord',phase:.56,depth:.09,opacity:.66},{clip:'cord',phase:.83,depth:.01,opacity:.78},
    {clip:'drift',phase:.25,depth:.03,opacity:.65},{clip:'drift',phase:.82,depth:.04,opacity:.58},
    {clip:'drift',phase:1.35,depth:.07,opacity:.57}
  ];
  const placement = shift => ({strokes:[
    pixel(0,16+shift,59), pixel(1,19+shift,62), pixel(2,21,62), pixel(3,24,64), pixel(4,28,64),
    pixel(5,31,63), pixel(6,34+shift,62), pixel(7,36+shift,59), pixel(8,37+shift,57)
  ]});
  return { clips:{ruffle,cord,drift},brushes,paint:placement(0),
    views:[{frame:'held',paint:placement(1)},{frame:3,paint:placement(-1)}] };
}

function spirit(K, enabled) {
  const frames = Array.from({length:4}, (_,frame) => ({ frame, duration:1.5,
    rect:{x:frame*CW,y:0,width:CW,height:CH}, pivot:{x:29,y:32} }));
  const width = CW*4, rgba = new Uint8Array(width*CH*4);
  for (const entry of frames) {
    const i = entry.frame, cel = K.pixelStamps.image({width:CW,height:CH,palette:ghostPalette,strokes:ghost(i)});
    for (let row=0;row<CH;row++) rgba.set(cel.rgba.subarray(row*CW*4,(row+1)*CW*4),(row*width+i*CW)*4);
  }
  return K.sprite.atlas({metadata:{width,height:CH,frames,cels:{
    poses:{held:1},holds:[{frame:'held',frames:2}],...(enabled&&{fringe:fringe()})
  }},images:{color:rgba}});
}

function background(K, seed) {
  const navy = ['#0a1323','#101b2e','#122338','#162d42','#1c374b','#224458','#285365','#30606c','#3c7075'];
  const atmosphere = new Uint8Array(WIDTH*HEIGHT*4), ramp = navy.map(hex =>
    [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).concat(255));
  for (let y=0;y<HEIGHT;y++) for (let x=0;x<WIDTH;x++) {
    const center = Math.hypot((x-212)/115,(y-105)/92);
    const ray = Math.max(0,1-Math.abs(x-204+(y-64)*.45)/76);
    const wash = 2.1 + (1-center)*2.4 + ray*2.7 + .37*Math.sin(x*.09+y*.04);
    const grain = (x+y)%2 ? .17 : -.17;
    atmosphere.set(ramp[Math.max(0,Math.min(8,Math.floor(wash+grain)))],(y*WIDTH+x)*4);
  }
  const cards = [
    oval(232,24,26,26,'#83a29b'), oval(226,20,29,25,'#244c5e'),
    polygon('#142a3b',[0,139],[15,136],[30,136],[50,123],[69,124],[85,115],[106,124],[125,137],
      [151,132],[170,138],[197,128],[209,130],[225,121],[245,126],[269,116],[286,116],[322,126],[322,177],[0,177]),
    polygon('#162a3a',[0,163],[25,153],[58,151],[83,142],[105,147],[121,142],[145,153],[180,149],
      [209,143],[246,148],[256,138],[282,145],[322,134],[322,198],[0,198])
  ];
  for (let i=0;i<125;i++) {
    const x = Math.floor(K.hash(i,seed,31)*WIDTH), y = Math.floor(K.hash(i,seed,85)*171);
    if (i%3 || x>155) cards.push(rect2(x,y,1,1, i%23===0 ? '#72918c' : '#4c758163'));
  }
  const { data } = K.procedural.raster.stack({width:WIDTH,height:HEIGHT,layers:[
    {source:{width:WIDTH,height:HEIGHT,channels:4,data:atmosphere}},
    {source:{width:WIDTH,height:HEIGHT,channels:4,data:render(K,WIDTH,HEIGHT,cards)}}
  ]}).value;
  return data;
}

function stonework(K, seed) {
  const outline = '#101928', dark='#1a2737', mid='#22384a', light='#334b58', lit='#3d5c65';
  const stone = [
    polygon(outline,[0,0],[193,0],[179,5],[163,12],[150,26],[140,49],[136,84],[134,132],[145,146],
      [157,154],[153,171],[0,181]),
    polygon(dark,[80,0],[175,0],[153,12],[141,24],[132,40],[128,63],[126,123],[121,141],[128,154],[116,161],
      [74,164],[66,149],[76,129],[74,57]),
    polygon(mid,[79,0],[164,0],[148,11],[136,26],[129,39],[123,55],[123,105],[118,134],[120,150],
      [98,155],[80,147],[84,131],[84,44]),
    polygon('#111c2b',[43,9],[70,10],[81,30],[85,65],[84,117],[79,137],[68,153],[48,157],[40,144],
      [48,118],[47,51],[36,31]),
    path(lit,[[167,2],[154,10],[145,18],[136,34],[128,50],[125,71],[127,86],[126,101]]),
    path(light,[[123,99],[121,123],[117,132],[119,143],[117,153]]),
    path(light,[[85,42],[87,59],[87,108],[84,132]]),
    path('#293e4e',[[122,54],[112,47],[111,35],[123,24],[126,12],[143,7],[150,1]],2),
    path('#203440',[[111,152],[103,148],[106,137],[104,121],[105,107],[101,96],[99,80],[101,66]],2),
    polygon(outline,[279,0],[322,0],[322,172],[292,173],[288,160],[290,146],[286,129],[290,111],[286,90],[290,66],
      [287,43],[286,25],[274,9]),
    polygon(dark,[300,0],[311,0],[315,37],[312,54],[314,81],[312,112],[317,143],[313,158],[296,155],
      [298,128],[295,98],[300,71],[295,53]),
    path(light,[[279,3],[287,16],[290,43],[291,63],[288,88],[292,114],[290,131],[293,150]])
  ];
  for (let row=0;row<11;row++) {
    const y = 13 + row*12;
    for (const x of [57+3*(row%2),88+2*(row%3),113-4*(row%2),301+3*(row%2)]) {
      const w = 6 + Math.floor(K.hash(x,row,seed)*10);
      stone.push(path('#101e2d',[[x,y],[x+w,y],[x+w,y+4],[x+w+5,y+4]]),
        path(row%3===1 ? light : '#29404c',[[x+1,y+1],[x+w-2,y+1]]));
    }
  }
  const grasses = ['#233f43','#2a5354','#376664','#48816e','#5d9380'];
  for (const [root,y,facing] of [[76,0,1],[117,8,1],[153,4,-1],[274,7,1],[302,0,-1]]) {
    const vine = [[root,y],[root+facing*5,y+13],[root+facing*4,y+25],[root+facing*10,y+38],[root+facing*9,y+51]];
    stone.push(path('#28504e',vine));
    for (let i=0;i<12;i++) {
      const px = root+Math.floor((i*.7+K.hash(i,root,seed)*5)*facing), py = y+i*4;
      const d = i%2 ? -1 : 1, n = 2+Math.floor(K.hash(root,i,seed)*4);
      stone.push(polygon(grasses[i%5],[px,py],[px+d*n,py-3],[px+d*(n+1),py],[px+d*2,py+2]));
    }
  }
  return render(K,WIDTH,HEIGHT,stone);
}

function foreground(K, seed) {
  const deck = [
    polygon('#111b29',[0,156],[21,158],[48,154],[79,157],[98,154],[112,157],[139,154],[148,161],[171,165],
      [183,173],[210,171],[235,163],[262,165],[290,154],[322,152],[322,214],[0,214]),
    polygon('#1d2f3c',[0,161],[48,157],[61,163],[85,160],[98,156],[112,159],[133,157],[146,165],[163,167],[179,174],
      [166,185],[137,187],[114,192],[93,188],[62,196],[5,196],[0,189]),
    polygon('#223542',[218,175],[237,167],[260,169],[280,158],[302,156],[322,154],[322,181],[286,185],[263,179],
      [247,186],[224,185]),
    path('#456369',[[0,162],[21,162],[47,157],[62,162],[82,162],[96,157],[112,159],[132,157],[146,164],[161,167]]),
    path('#40565b',[[219,175],[240,167],[260,168],[280,159],[305,157],[322,155]]),
    path('#29434c',[[0,203],[42,207],[71,202],[95,202],[105,197],[133,199],[175,193],[199,194],[216,189],[249,196],
      [288,187],[321,190]])
  ];
  const rock = ['#1b2838','#2b3e4a','#355058','#416067'];
  for (let i=0;i<97;i++) {
    const x = Math.floor(K.hash(i,seed,19)*WIDTH), y = 157+Math.floor(K.hash(i,seed,98)*50);
    if (x>146 && x<215 && y<176 || x<133 && y<161) continue;
    const w=2+i%9, h=1+i%3;
    deck.push(polygon(rock[i%4],[x,y],[x+2,y-h],[x+w,y-h],[x+w+2,y],[x+w,y+1],[x+1,y+1]));
  }
  deck.push(
    oval(48,151,59,23,'#be734c20'),oval(57,155,43,14,'#d3865427'),oval(64,157,31,10,'#ef9c5d23'),
    polygon('#6f4348',[66,151],[72,151],[80,159],[84,161],[77,161],[70,157],[63,157]),
    path('#be644c',[[60,147],[67,150],[72,154],[75,156],[82,162]],3),
    path('#eb8a53',[[66,150],[71,154],[77,158],[82,162]],2),
    path('#ffe4a3',[[68,150],[74,155],[79,159],[82,161]]),
    path('#a27660',[[64,154],[67,150],[69,147]],1),
    rect2(60,146,2,1,'#9d795d'),rect2(75,151,1,1,'#ffbe73'),rect2(68,142,1,1,'#ed9961')
  );
  return render(K,WIDTH,HEIGHT,deck);
}

function card(K, pixels) {
  return K.sprite.atlas({metadata:{width:WIDTH,height:HEIGHT,
    frames:[{rect:{x:0,y:0,width:WIDTH,height:HEIGHT}}]},images:{color:pixels}});
}

module.exports = ({ KIT: K, makeBuilder }) => ({
  id:'tidekeeper-fringe', name:'The Drowned Belfry', seed:61,
  build(seed, { controls: { fringe: enabled = true } = {} } = {}) {
    if (typeof enabled !== 'boolean') throw new TypeError('fringe control must be a boolean');
    const board = (pixels,z) => K.sprite.placeAtlas({ atlas:card(K,pixels),mode:'card',nativePixels:true,at:[0,0,z],lighting:false });
    const ghost = K.sprite.placeAtlas({ atlas:spirit(K,enabled),mode:'card',nativePixels:true,playback:'loop',
      objectId:'tidekeeper',at:[0,0,.65],lighting:false,
      pixelOffset:t => [29+Math.round(2*Math.sin(t*Math.PI/3)), -22+Math.round(2*Math.cos(2*t*Math.PI/3))] });
    const mist = {
      resolution:[WIDTH,HEIGHT],
      source({time}) {
        const a=time*Math.PI/3, { sin }=Math, commands=[];
        for (let i=0;i<14;i++) {
          const x=13+i*24, y=178+Math.round(9*sin(a+i*.44)+7*sin(i*1.7));
          commands.push(oval(x-38,y,74+i%3*16,9+i%5,'#476d8424'));
          if (i%3===0) commands.push(oval(x-28,y+17,91,9,'#56849518'));
        }
        return {w:WIDTH,h:HEIGHT,rgba:render(K,WIDTH,HEIGHT,commands)};
      }
    };
    return makeBuilder(seed,[0x0a1422]).finish({
      cam:{target:[0,0,0],dist:8.4,yaw:0,pitch:0,ortho:true,sway:0},radius:8,
      spriteAtlases:[board(background(K,seed),-5),board(stonework(K,seed),-1.1),ghost,board(foreground(K,seed),1.05)],
      look:{pixelSize:1,composite:{layers:[mist]}}
    });
  }
});
