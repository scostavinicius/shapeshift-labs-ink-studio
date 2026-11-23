/* Native art studies for paired sockets and independently turning glyphs. */
const { rect, line, fill, pixel } = require('./pixel-stamp-studies.js');
const W=272,H=166,LOOP=6.4;

function plate(K, colors) {
  const keys=Object.keys(colors), marks=[], font=K.inspection.font({});
  const slot = name => keys.indexOf(name);
  return {
    box:(ink,...bounds)=>marks.push(rect(slot(ink),...bounds)),
    path:(ink,points,width)=>marks.push(line(slot(ink),points,width)),
    poly:(ink,points)=>marks.push(fill(slot(ink),points)),
    dot:(ink,x,y)=>marks.push(pixel(slot(ink),x,y)),
    text(ink,str,x,y){
      for(const [c,char] of [...str].entries()){
        const glyph=font.get(char);
        for(let v=0;v<8;v++) for(let u=0;u<6;u++)
          if(glyph[v*6+u]) marks.push(pixel(slot(ink),x+c*6+u,y+v));
      }
    },
    image:()=>K.pixelStamps.image({width:W,height:H,palette:Object.values(colors),strokes:marks}).rgba
  };
}

function blit(dest,{w,h,rgba},left,top){
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const p=(y*w+x)*4;
    if(rgba[p+3]) dest.set(rgba.subarray(p,p+4),((top+y)*W+left+x)*4);
  }
}
const modulo=(n,mod)=>((n%mod)+mod)%mod;

function floor(K,seed){
  const width=18,height=14,left=102,top=35;
  const rng=K.grow.dice(seed);
  const map={a:'b',b:'a'};
  const weave=K.pixelTiles.reconnect({
    width,height,period:LOOP,initial:()=>rng()>.49?'a':'b',
    ...K.pixelTiles.pairedArcs(8,{shadow:'#172a34',ink:'#253d47',edge:'#476367',wave:'#215bbf',spark:'#70d3fa'}),
    cues:[
      {time:.46,duration:.58,next:map,wave:{from:[.3,6],speed:7.6}},
      {time:3.62,duration:.56,next:map,wave:{direction:[-1,.4],speed:11.2}}
    ]
  });
  const art=plate(K,{
    night:'#112632', dark:'#1f3541', mortar:'#304550', stone:'#536367', high:'#718381',
    deep:'#2d463e', moss:'#536d50', leaf:'#739057', grit:'#738477', shadow:'#514241',
    brass:'#92734b', gold:'#cba66a', light:'#e5c089', joint:'#987e61',
    clay:'#cfaf80', cream:'#e2c394', pale:'#ecd2a2', paper:'#edd7ad',
    ink:'#354855', live:'#5baee1', fire:'#9cdded'
  });
  const {box,path,poly,dot}=art;
  box('night',0,0,W,H);
  for(let row=0;row<10;row++) for(let col=0;col<13;col++){
    const x=col*23-(row%2)*11, y=row*19-8;
    const stone=(row*7+col*41)%13<2?'deep':'mortar';
    box(stone,x,y,22,18);
    path('stone',[[x+2,y],[x+20,y]]);
    if((row+col)%4===0)path('dark',[[x+3,y+15],[x+11,y+13],[x+17,y+14]]);
  }
  for(const [x,y] of [[13,35],[26,100],[4,131],[255,17],[254,153],[12,155],[73,13]]){
    for(let i=0;i<26;i++){
      const u=x+Math.floor(rng()*26)-8,v=y+Math.floor(rng()*12)-4;
      if(u>=0&&u<W&&v>=0&&v<H) dot(i%5?'moss':'leaf',u,v);
    }
  }
  poly('night',[[82,29],[99,17],[245,17],[261,33],[261,147],[248,161],[95,161],[82,148]]);
  poly('shadow',[[87,26],[98,19],[245,19],[257,31],[257,148],[246,157],[96,157],[86,147]]);
  poly('brass',[[89,28],[99,21],[244,21],[255,33],[255,146],[244,155],[97,155],[88,146]]);
  path('gold',[[90,143],[90,30],[100,22],[243,22],[253,32]]);
  poly('clay',[[93,34],[103,25],[241,25],[251,35],[251,145],[241,151],[101,151],[93,142]]);
  box('joint',left-1,top-1,weave.w+2,weave.h+2);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++){
    const px=left+x*8,py=top+y*8,tone=rng()>.83?'paper':rng()>.22?'pale':'cream';
    box(tone,px,py,8,8);
    dot(rng()>.45?'cream':'clay',px+1+Math.floor(rng()*6),py+1+Math.floor(rng()*6));
  }
  for(const y of [29,149]) for(let x=103;x<242;x+=9){
    poly('brass',[[x,y],[x+2,y-2],[x+4,y],[x+2,y+2]]);
    dot('light',x+1,y-1);
  }
  for(const x of [96,249]) for(let y=41;y<142;y+=10){
    box('gold',x,y,1,5);
    dot('shadow',x,y+5);
  }
  const ring=(x,y,r)=>Array.from({length:24},(_,i)=>[Math.round(x+r*Math.cos(i*Math.PI/12)),Math.round(y+r*Math.sin(i*Math.PI/12))]);
  poly('night',ring(52,88,29));
  poly('shadow',ring(49,84,28));
  poly('gold',ring(49,83,26));
  poly('brass',ring(49,84,24));
  poly('clay',ring(49,82,21));
  poly('ink',ring(49,83,17));
  poly('dark',ring(49,83,14));
  for(let a=0;a<12;a++){
    const t=a*Math.PI/6,x=Math.round(49+20*Math.cos(t)),y=Math.round(83+20*Math.sin(t));
    dot(a%3?'light':'shadow',x,y);
  }
  path('brass',[[73,84],[84,84],[90,87],[99,87]],3);
  path('gold',[[73,83],[84,83],[90,86],[99,86]]);
  art.text('paper','TIDE',16,24);
  art.text('gold','SEAL',16,35);
  path('high',[[16,46],[73,46]]);
  const base=art.image();
  const crest=K.pixelStamps.image({
    width:17,height:17,palette:['#2c4e62','#5582a1','#87c6df','#bae6ea','#4a76aa'],
    rows:[
      '........4........','........2........','.......131.......','.......232.......',
      '......12321......','.....1243421.....','....123...321....','..1232.....2321..',
      '423432..3..234324','..1232.....2321..','....123...321....','.....1243421.....',
      '......12321......','.......232.......','.......131.......','........2........','........4........'
    ]
  });
  const lit=crest.rgba, dark=lit.slice();
  for(let i=0;i<dark.length;i+=4) if(dark[i+3]) dark.set([124,142,133],i);
  return time=>{
    const t=modulo(time,LOOP),rgba=base.slice(), active=(t>.32&&t<2.9)||(t>3.55&&t<5.82);
    blit(rgba,weave.raster(time),left,top);
    blit(rgba,{w:17,h:17,rgba:active?lit:dark},41,75);
    return {w:W,h:H,rgba};
  };
}

const arrow=[
  '......','...1..','...21.','111221','111221','...21.','...1..','......'
];
const arrowMid=[
  ['........','........','..1.....','.121....','..22111.','...2221.','.....21.','........'],
  ['........','........','..11....','..221...','...221..','.....221','....1221','.....11.']
];

function glyphs(K){
  const gx=19,gy=10,left=96,top=49, ink=K.glyphGrid.paint({
    tiles:[null,{glyph:'→',color:'#7dada6'},{glyph:'↗',color:'#8ec7b8'},
      {glyph:'∟',color:'#ca9b6d'},{glyph:'·',color:'#326168'},
      {glyph:'♦',color:'#5d8792'},{glyph:'◊',color:'#e0ba82'}],
    glyphs:{'→':arrow.map(r=>r.replaceAll(/[12]/g,'#')),'↗':['......','..####','....##','...#.#','..#..#','.#....','......'],
      '∟':['......','.#....','.#....','.#....','.####.','.####.','......'],
      '◊':['......','..##..','.#..#.','#....#','.#..#.','..##..','......']}
  });
  const sourceCells=Uint8Array.from({length:gx*gy},(_,i)=>{
    const x=i%gx,y=Math.floor(i/gx);
    if(x===0||x===gx-1||y===0||y===gy-1)return (x+y)%4===0?5:4;
    if(y>=3&&y<=6&&x>=3&&x<=15)return y===3||y===6?1:(x+y)%4===0?3:2;
    return x%6===0?6:(x*3+y*7)%7<3?5:4;
  });
  const raw=ink.raster({width:gx,height:gy,states:7,cells:sourceCells}), source=raw.rgba;
  const arrowRGB=[[44,79,88],[100,205,181],[162,245,201]];
  for(let i=0;i<sourceCells.length;i++) if(sourceCells[i]===1){
    const x=i%gx,y=Math.floor(i/gx);
    for(let v=0;v<8;v++) for(let u=0;u<6;u++){
      const mark=arrow[v][u];
      if(mark!=='.') source.set([...arrowRGB[+mark],255],((y*8+v)*raw.w+x*6+u)*4);
    }
  }
  const posePalette=['#2c4f58','#64cdb5','#a2f5c9'];
  const middle=arrowMid.map(rows=>{
    const art=K.pixelStamps.image({width:8,height:8,rows,palette:posePalette});
    return {w:8,h:8,rgba:art.rgba};
  });
  const squares=K.pixelGrid.turn({
    width:gx,height:gy,cell:[6,8],period:LOOP,
    cues:[
      {rect:[3,3,13,4],time:.52,duration:.59,turns:1,wave:{direction:[1,.4],speed:8.8}},
      {rect:[3,3,13,4],time:3.12,duration:.68,turns:3,wave:{direction:[-1,.55],speed:9.6}},
      {cells:[[6,2],[12,2],[6,7],[12,7]],time:2.31,duration:1.3,turns:-4}
    ],
    between({x,y,progress,direction}){
      if(sourceCells[y*gx+x]!==1||direction<0||progress<.18||progress>=.83) return null;
      return middle[+(progress>.51)];
    }
  });
  const art=plate(K,{
    back:'#101d29', deep:'#0a151f', rubber:'#18292f', shell:'#35424d', edge:'#64747b',
    rail:'#86795d', brass:'#b19165', warm:'#dbba81', copper:'#a06a52', bolt:'#4c4647',
    screen:'#112632', lane:'#1a3740', grid:'#244953', shade:'#2e525a', ink:'#88a19e',
    mint:'#80d3b7', hot:'#e4b27a', paper:'#e4d2a2'
  });
  const {box,path,poly,dot}=art;
  box('back',0,0,W,H);
  path('shell',[[9,20],[257,20]],1);
  art.text('paper','GLYPH RELAY',17,7);
  art.text('ink','TURN BANK',196,7);
  poly('deep',[[14,36],[27,26],[246,26],[261,40],[261,141],[249,155],[23,155],[10,142]]);
  poly('rubber',[[16,36],[30,29],[245,29],[258,42],[258,138],[246,152],[26,152],[13,139]]);
  poly('shell',[[18,40],[31,32],[245,32],[255,43],[255,136],[244,148],[27,148],[16,137]]);
  path('edge',[[18,135],[18,42],[33,33],[243,33]]);
  path('deep',[[245,37],[251,44],[251,137],[242,145],[24,145]]);
  box('deep',left-3,top-3,158,86);
  box('rail',left-1,top-1,154,82);
  box('screen',left,top,152,80);
  for(let y=0;y<gy;y++) for(let x=0;x<gx;x++){
    const dx=left+x*8,dy=top+y*8;
    if(x>=3&&x<=15&&y>=3&&y<=6&&((x+y)%2===0)) box('lane',dx,dy,8,8);
    dot('grid',dx,dy);
  }
  path('shade',[[left+24,top+23],[left+129,top+23]]);
  path('shade',[[left+24,top+56],[left+129,top+56]]);
  box('deep',25,48,58,83);
  box('rail',27,49,53,78);
  box('deep',29,51,49,74);
  box('lane',32,54,43,47);
  path('grid',[[35,77],[71,77]]);
  path('grid',[[53,57],[53,97]]);
  poly('shade',[[53,58],[69,77],[53,96],[36,77]]);
  poly('screen',[[53,60],[67,77],[53,94],[38,77]]);
  for(const [x,y] of [[33,58],[72,58],[33,96],[72,96]]) dot('ink',x,y);
  art.text('ink','PHASE',38,106);
  for(let x=29;x<75;x+=4) box('bolt',x,118,2,3);
  for(const [x,y] of [[24,41],[246,40],[25,138],[245,138]]){
    poly('bolt',[[x-3,y],[x,y-3],[x+3,y],[x,y+3]]);
    path('edge',[[x-1,y-1],[x+1,y+1]]);
  }
  for(let x=111;x<234;x+=10) box('copper',x,136,4,2);
  const base=art.image(), tones=[[43,92,93,255],[128,211,183,255],[229,175,120,255]];
  const plot=(rgba,x,y,ink)=>rgba.set(ink,(y*W+x)*4);
  return time=>{
    const t=modulo(time,LOOP), rgba=base.slice();
    blit(rgba,squares.raster(raw,time),left,top);
    const a=t/LOOP*Math.PI*4, tx=53+Math.cos(a)*12,ty=77+Math.sin(a)*12;
    for(let i=0;i<=16;i++) plot(rgba,Math.round(53+(tx-53)*i/16),Math.round(77+(ty-77)*i/16),tones[i>10?1:0]);
    for(let i=0;i<10;i++) for(let x=0;x<2;x++)
      plot(rgba,31+i*4+x,119,tones[i< Math.floor(t/LOOP*10)?2:0]);
    return {w:W,h:H,rgba};
  };
}

module.exports=({KIT:K,makeBuilder})=>({
  id:'reconnecting-grids',name:'Tide Seal and Glyph Relay',seed:59,period:LOOP,
  build(seed,{controls:{study='floor'}={}}={}){
    if(!['floor','glyphs'].includes(study)) throw new RangeError('Choose the floor or glyphs study');
    const image=study==='floor'?floor(K,seed):glyphs(K);
    return makeBuilder(seed,[0x112632]).finish({dither:0,look:{
      composite:{world:{resolution:[8,8]},layers:[{source:({time})=>image(time),resolution:[W,H],filter:'nearest'}]}
    }});
  }
});
