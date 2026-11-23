/* Moth Signal. Original pixel art, rendered through the raster sprite-layer budget. */
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const studio = require('..');
const png = require('../cli/png.js');

function createStudy(K) {
  const { drawing2d, raster } = K.procedural;
  const width = 208, height = 118, fps = 20, frames = 60;
  const sheet = {width:548, height:184};
  const panels = {left:10, right:230, chart:450, top:39};
  const paper = '#121a26', border = '#344c5c', ivory = '#f3dfb4';
  const muted = '#8ca9af', kept = '#649f98', dropped = '#f08086', pinned = '#f9ce82';
  const rect = (x,y,w,h,fill) => ({type:'rect',rect:[x,y,w,h],fill});
  const fill = (points,color) => ({type:'polygon',points,fill:color});
  const line = (points,color,w=1) => ({type:'path',points,width:w,color});
  const text = (x,y,label,color,scale=1) => ({type:'text',at:[x,y],text:label,color,scale});
  const draw = (w,h,commands) => drawing2d.render({width:w,height:h,commands,edges:'hard'});

  const landscape = (() => {
    const a = [
      rect(0,0,width,height,'#20233f'), rect(0,14,width,12,'#282b4d'), rect(0,26,width,11,'#303553'),
      rect(0,37,width,17,'#3e405e'), rect(0,54,width,23,'#51506c'), rect(0,77,width,41,'#293c51')
    ];
    for (let dy=-13;dy<=13;dy++) {
      const radius=Math.floor(Math.sqrt(184-dy*dy));
      a.push(rect(154-radius,35+dy,radius*2+1,1,dy<9?'#e6c5ad':'#c5a7ac'));
    }
    for (const [x,y,w,color] of [[10,24,48,'#343852'],[47,31,63,'#3e465a'],[113,38,73,'#55516a'],
      [135,45,64,'#6e637a'],[9,48,63,'#4b4d68'],[84,54,44,'#696075']]) {
      a.push(fill([[x,y+4],[x+5,y+2],[x+w*.32,y+2],[x+w*.46,y],[x+w-7,y],[x+w,y+2],
        [x+w*.71,y+3],[x+w*.63,y+5],[x+4,y+5]],color),rect(x+w+3,y+2,6,1,color));
    }
    for (const [x,y] of [[11,12],[31,17],[45,7],[76,19],[81,13],[101,27],[133,13],[176,23],[185,10],[201,19]]) {
      a.push(rect(x,y,1,1,'#b6a6af'));
    }
    a.push(fill([[0,77],[14,68],[23,70],[34,63],[44,63],[55,73],[66,74],[79,70],[96,75],[104,71],
      [116,72],[133,65],[144,65],[154,70],[168,68],[181,60],[193,67],[208,65],[208,93],[0,93]],'#414c66'),
    fill([[0,78],[17,76],[23,79],[39,75],[50,78],[65,75],[74,79],[90,79],[113,82],[127,77],
      [140,79],[155,73],[164,77],[179,72],[196,74],[208,71],[208,97],[0,97]],'#303f55'),
    rect(0,87,width,31,'#213b4b'),
    fill([[0,92],[35,90],[57,93],[76,91],[104,90],[127,92],[150,89],[186,92],[208,88],[208,98],[0,98]],'#315361'),
    fill([[127,89],[152,88],[167,91],[156,94],[174,95],[186,100],[157,101],[146,105],[169,109],
      [162,112],[123,115],[85,116],[93,110],[115,106],[127,102],[142,99],[115,96]],'#4a6e72'),
    fill([[140,92],[155,91],[146,95],[159,97],[145,99],[132,99],[131,102],[120,104],[129,105],
      [119,109],[102,110],[115,106],[117,102],[132,99],[131,96]],'#71908a'));
    for (const [x,y,w,color] of [[8,95,31,'#49636c'],[22,100,19,'#46616a'],[52,92,11,'#5b6e78'],
      [52,107,24,'#3b5366'],[75,96,23,'#5c727c'],[121,94,13,'#9b9a91'],[130,101,19,'#8aa49a'],
      [95,106,18,'#63827e'],[102,111,29,'#95a594'],[137,113,17,'#5c8180'],[163,106,19,'#6f8988'],
      [177,98,19,'#688381'],[177,94,11,'#688381']]) a.push(rect(x,y,w,1,color));
    a.push(fill([[0,86],[10,84],[15,87],[25,88],[20,94],[26,99],[38,102],[32,107],
      [48,113],[63,114],[61,118],[0,118]],'#141f31'),
    fill([[208,79],[198,80],[193,86],[198,94],[189,98],[184,104],[171,107],[169,112],[154,115],
      [143,118],[208,118]],'#172538'));
    for (const [x,y,w] of [[2,96,12],[13,101,13],[26,108,9],[7,111,22],[35,115,11],
      [178,110,11],[182,115,22],[196,101,10],[197,93,10],[201,85,7]]) {
      a.push(rect(x,y,w,1,'#273c4c'));
    }
    // Two reed silhouettes set the scale of the flight path.
    for (const [x,y,lean] of [[4,104,-3],[9,110,-3],[15,108,3],[18,114,6],[187,109,-5],
      [197,99,3],[202,102,2],[205,96,1]]) {
      a.push(line([[x,y+5],[x,y-3],[x+lean,y-11]],'#233f48'),
        line([[x,y-1],[x+lean*2,y-7]],'#284850'),
        rect(x+lean,y-12,2,3,'#516a68'));
    }
    return draw(width,height,a);
  })();

  // Every wing pose is its own native-pixel drawing. The moth body stays registered.
  const mothCels = [
    ['.1...........1.','.21.........12.','.321...4...123.','..321.454.123..','...234454432...',
      '....2346432....','.....24542.....','....1..4..1....','.......2.......'],
    ['...............','..11.......11..','..232..4..232..','.2343245423432.','..12344544321..',
      '....2346432....','.....24542.....','....1..4..1....','.......2.......'],
    ['...............','...............','.......4.......','...22.454.22...','.1234445444321.',
      '..12334643321..','....2345432....','.....1.4.1.....','.......2.......'],
    ['...............','...............','.......4.......','......454......','...124454421...',
      '..12334643321..','.1234445444321.','..1232.4.2321..','....1..2..1....']
  ];
  const colors = [
    ['#38446a','#54649a','#7b76b2','#b0a1d3','#d7bddf','#f7e0e1'],
    ['#285665','#347982','#56a49a','#8fc4af','#b7dcc1','#e6f2cf'],
    ['#634058','#8a596a','#b77980','#d59990','#ecc7a1','#fae2b0'],
    ['#76524d','#ad714f','#dc9c60','#edbe74','#ffe1a0','#ffefbc']
  ];
  const leader = [
    '...1.............1...','..21.............12..','..321...........123..',
    '..4321....4....1234..','...4321..454..1234...','....4321446441234....',
    '.....23445554432.....','......234565432......','.......2456542.......',
    '.......1345431.......','......12..4..21......','.....1....3....1.....','..........2..........'
  ];
  function cel(rows,palette) {
    const w = rows[0].length, data = new Uint8Array(w*rows.length*4);
    const swatches = palette.map(hex => [...[1,3,5].map(i => Number.parseInt(hex.slice(i,i+2),16)),255]);
    for (const [y,row] of rows.entries()) {
      if (row.length!==w) throw new Error('The moth cels need a fixed native grid');
      for (const [x,slot] of [...row].entries()) if (slot!=='.') data.set(swatches[Number(slot)-1],(y*w+x)*4);
    }
    return {width:w,height:rows.length,data};
  }
  const sheets = colors.slice(0,3).map(palette => mothCels.map(rows => cel(rows,palette)));
  const heroCel = cel(leader,colors[3]);
  const formation = [[13,72,0],[31,68,1],[48,72,2],[62,66,1],[79,72,0],[102,68,3],
    [120,69,2],[136,72,1],[153,67,0],[170,71,2],[187,69,1]];

  function render(frame, { limit = 4, rotate = true, priority = true } = {}) {
    const theta=frame/frames*2*Math.PI;
    const sprites = formation.map(([x,y,palette], index) => {
      const hero=palette===3, beat=[0,1,2,3,2,1][(Math.floor(frame/2)+index)%6];
      const source=hero?heroCel:sheets[palette][beat];
      return {id:hero?'courier':String(index+1),source,
        x:Math.round(x-source.width/2+2.6*Math.sin(theta+index*.60)),
        y:Math.round(y-source.height/2+1.4*Math.cos(theta*2+index*.91)),priority:hero&&priority?10:0};
    });
    const unrestricted = raster.spriteLayer({width,height,sprites});
    const budgeted = raster.spriteLayer({width,height,sprites,frame,budget:{limit,rotate,holdFrames:6,fps}});
    const views = [unrestricted.value,budgeted.value].map(source => raster.blend(landscape,source));
    return {views,report:budgeted.report};
  }

  const {left,right,chart,top} = panels;
  const plate = draw(sheet.width,sheet.height,[
    rect(0,0,sheet.width,sheet.height,paper),
    rect(10,8,2,14,pinned),text(19,8,'MOTH SIGNAL',ivory,2),
    text(left,27,'UNLIMITED',muted),
    text(chart,27,'ROW INSPECTION',muted),
    ...[left,right].map(x=>rect(x-1,top-1,width+2,height+2,border)),
    rect(chart-1,top-1,89,height+2,border),rect(chart,top,87,height,'#192434'),
    rect(chart,top+height+12,4,4,kept),text(chart+8,top+height+10,'KEPT',muted),
    rect(chart+42,top+height+12,4,4,dropped),text(chart+50,top+height+10,'DROP',muted),
    text(left,168,'11 HAND-DRAWN SPRITES',muted)
  ]);

  function comparison(frame, settings, selected) {
    const {views,report} = render(frame,settings);
    const focus = selected ?? report.droppedCounts.indexOf(Math.max(...report.droppedCounts));
    const priorityLabel = settings?.priority === false ? 'EQUAL PRIORITY' : 'GOLD COURIER HAS PRIORITY';
    const commands = [text(right,27,report.limit+' SPRITES PER ROW',pinned), text(right,168,priorityLabel,pinned)];
    for (let y=0; y<height; y+=16) {
      commands.push(rect(chart,top+y,87,1,'#27364a'));
    }
    const chartX = chart+3;
    report.sprites.forEach(({top:y0,bottom:y1,dropped:runs,priority}, i) => {
      const x = chartX+i*6;
      commands.push(rect(x,top+y0,5,y1-y0,priority?pinned:kept));
      for (const [a,b] of runs) commands.push(rect(x,top+a,5,b-a,dropped));
    });
    for (let y=0; y<height; y++) {
      const count = report.droppedCounts[y];
      if (count) commands.push(rect(chart+86-count*1.5,top+y,count*1.5,1,dropped));
    }
    commands.push(rect(right+width+2,top+focus,5,1,pinned),
      rect(chart-4,top+focus,3,1,pinned),rect(chart+87,top+focus,3,1,pinned),
      text(410,9,'ROW '+String(focus).padStart(3,'0'),ivory),
      text(469,9,report.droppedCounts[focus]+' DROPPED',dropped));
    const overlay = draw(sheet.width,sheet.height,commands);
    const {value} = raster.stack({...sheet,layers:[
      {source:plate},{source:views[0],x:left,y:top},{source:views[1],x:right,y:top},{source:overlay}
    ]});
    return {value,report,focus};
  }
  return {width,height,sheet,panels,frames,fps,render,comparison};
}

function mount(K, makeStudy) {
  const study = makeStudy(K), $ = id => document.getElementById(id);
  const canvas = $('view'), scrub = $('frame'), limit = $('limit'), play = $('play');
  canvas.width = study.sheet.width;
  canvas.height = study.sheet.height;
  scrub.max = study.frames-1;
  const ctx = canvas.getContext('2d');
  const art = new ImageData(canvas.width,canvas.height);
  let row = 69, frame = 12, playing = false, start, request;
  function draw() {
    const {value,report} = study.comparison(frame,{limit:+limit.value,rotate:$('rotate').checked,
      priority:$('priority').checked},row);
    art.data.set(value.data);
    ctx.putImageData(art,0,0);
    scrub.value = frame;
    $('limit-value').value = limit.value;
    const lost = report.sprites.filter(s => s.dropped.some(([lo,hi]) => row>=lo && row<hi)).map(s => s.id);
    $('status').textContent = 'Row '+row+' · '+report.used[row]+' kept · '+report.droppedCounts[row]+' dropped' +
      (lost.length ? ' · '+lost.join(', ') : '');
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(request);
    play.textContent = 'Play';
  }
  function tick(now) {
    start ??= now - frame * 1000 / study.fps;
    const step = Math.floor((now-start)*study.fps/1000 + 1e-9) % study.frames;
    if (step!==frame) { frame=step; draw(); }
    if (playing) request=requestAnimationFrame(tick);
  }
  play.addEventListener('click',()=>{
    if (playing) return pause();
    playing=true;
    start=undefined;
    play.textContent='Pause';
    request=requestAnimationFrame(tick);
  });
  scrub.addEventListener('input',()=>{pause(); frame=+scrub.value; draw();});
  for (const id of ['limit','rotate','priority']) $(id).addEventListener('input',draw);
  canvas.addEventListener('pointerdown',event=>{
    const bounds=canvas.getBoundingClientRect(), y=Math.floor((event.clientY-bounds.top)*canvas.height/bounds.height)-study.panels.top;
    if (y>=0 && y<study.height) {row=y;draw();}
  });
  canvas.addEventListener('keydown',event=>{
    const step=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;
    if (!step) return;
    event.preventDefault();
    row=Math.min(study.height-1,Math.max(0,row+step));
    draw();
  });
  draw();
}

if (require.main===module) {
  const out = process.argv[2] ?? 'out/moth-signal';
  fs.mkdirSync(out,{recursive:true});
  const study = createStudy(studio.load().KIT);
  const snapshots = [];
  const cels = Array.from({length:study.frames},(_,frame)=>{
    const {value,report} = study.comparison(frame);
    snapshots.push({...report,used:Array.from(report.used),droppedCounts:Array.from(report.droppedCounts)});
    return png.packRGBA(value);
  });
  fs.writeFileSync(path.join(out,'moth-signal.png'),png.encodeAnimation(cels,study.fps));
  fs.writeFileSync(path.join(out,'moth-signal-still.png'),png.encodeFrame(cels[12]));
  fs.writeFileSync(path.join(out,'moth-signal-rows.json'),JSON.stringify({fps:study.fps,frames:snapshots}));
  const source = studio.bundle()+'\nreturn KIT;';
  const asset = gzipSync(source,{level:9}).toString('base64');
  const template = fs.readFileSync(path.join(__dirname,'sprite-scanline-budget.html.template'),'utf8');
  fs.writeFileSync(path.join(out,'moth-signal.html'),template.replace('/* DEMO */',()=>`
    const bytes=Uint8Array.from(atob('${asset}'), char=>char.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const KIT=new Function(await new Response(stream).text())();
    (${mount.toString()})(KIT, ${createStudy.toString()});
  `));
}
