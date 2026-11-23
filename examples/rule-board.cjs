/* Emberlock, an editable copper inlay with two glyph-controlled lamps. */
const fs=require('node:fs');
const path=require('node:path');
const {gzipSync}=require('node:zlib');
const ink=require('..');

function study(K) {
  const width=7,height=5,size=16, frameWidth=144,frameHeight=106, left=16,top=13;
  const sides='NESW', palette=['#392c30','#93533d','#d5995c','#32282e','#764a43','#b98569',
    '#352c3c','#6c5e78','#bc9aa4','#f4d493'];
  const live=['#1a514e','#5fc4ac','#e9ffd2','#1a514e','#5fc4ac','#e9ffd2',
    '#24545c','#55a3a1','#c3ecd1','#fffbdc'].map(color=>[
    parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5),16)
  ]);
  const turn=(x,y,n)=>{
    if(n===1) return [size-1-y,x];
    if(n===2) return [size-1-x,size-1-y];
    if(n===3) return [y,size-1-x];
    return [x,y];
  };
  const at=(x,y)=>y*size+x;

  function frame(paths, glyph) {
    const slots=Array(size*size).fill(null), groups=slots.slice();
    function pixel(x,y,slot,group) {
      slots[at(x,y)]=slot; groups[at(x,y)]=group;
    }
    function arm(side,stop,base,group) {
      for(let y=0;y<stop;y++){
        const [lx,ly]=turn(7,y,sides.indexOf(side)),[rx,ry]=turn(8,y,sides.indexOf(side));
        pixel(lx,ly,base+(y%5===3?2:1),group);
        pixel(rx,ry,base,group);
      }
    }
    if (paths.length===2) {
      // The two arcs have separately authored contours and alternate at the center of the stone.
      const arc=[[7,8],[7,8],[7,8],[6,8],[5,7],[4,6],[3,5],[0,4],[0,3]];
      for(const [index,group] of paths.entries()) for(const [y,[lo,hi]] of arc.entries()){
        for(let x=lo;x<=hi;x++){
          const [tx,ty]=turn(x,y,index*2);
          pixel(tx,ty,index*3+(x===hi?0:y%4===2?2:1),group);
        }
      }
    } else {
      const [group]=paths;
      for (const side of group) arm(side,glyph?4:9,0,group.length>2 ? side : group);
    }

    if(glyph) {
      const body=[[6,9],[4,11],[3,12],[3,12],[3,12],[3,12],[3,12],[3,12],[4,11],[6,9]];
      for(const [i,[lo,hi]] of body.entries()){
        const y=i+3;
        for(let x=lo;x<=hi;x++){
          const border=x===lo||x===hi||i===0||i===body.length-1;
          pixel(x,y,border?(i<5?2:0):6,'glyph');
        }
      }
      for(const [y,row] of glyph.entries()) for(const [x,char] of [...row].entries())
        if(char!=='.') pixel(x+4,y+5,Number(char),'glyph');
      pixel(5,10,7,'glyph');
      pixel(10,5,8,'glyph');
    }
    return {cel:{width:size,height:size,palette,slots},groups};
  }
  const art={
    ember:frame(['E'],['...9....','..899...','..8998..','.88988..','.88887..','..777...']),
    moon:frame(['W'],['..999...','.998....','.98.....','.98.....','.998....','..9999..']),
    iris:frame(['S'],['........','..8888..','.89..98.','89988998','.89..98.','..8888..']),
    bell:frame(['N'],['...99...','..8998..','..8888..','..8888..','.999999.','...88...']),
    split:frame(['NW','ES']), straight:frame(['NS']), fork:frame(['NEW'])
  };
  const parts={
    ember:{outputs:'E',cel:art.ember.cel}, moon:{outputs:'W',cel:art.moon.cel},
    iris:{inputs:'S',cel:art.iris.cel}, bell:{inputs:'N',cel:art.bell.cel},
    split:{paths:['NW','ES'],cel:art.split.cel},
    straight:{paths:['NS'],cel:art.straight.cel}, fork:{paths:['NEW'],cel:art.fork.cel}
  };
  const glyph=(part,state)=>({part,id:part,...(state!==undefined&&{state})});
  const line={part:'straight',turn:1};
  const initial=K.ruleBoard.compile({width,height,size,parts,cells:[
    null,null,null,glyph('iris'),null,null,null,
    null,'straight',null,'straight',null,null,null,
    glyph('ember',1),'fork',line,'split',line,line,glyph('moon',0),
    null,null,null,'straight',null,null,null,
    null,null,null,glyph('bell'),null,null,null
  ]});

  const a=K.procedural.drawing2d;
  const commands=[];
  function rect(x,y,w,h,fill){commands.push({type:'rect',rect:[x,y,w,h],fill});}
  function poly(points,fill){commands.push({type:'polygon',points,fill});}
  function shell(x,y,r,b,s,color){
    poly([[x+s,y],[r-s,y],[r,y+s],[r,b-s],[r-s,b],[x+s,b],[x,b-s],[x,y+s]],color);
  }
  rect(0,0,frameWidth,frameHeight,'#111f28');
  shell(6,7,138,103,8,'#0a151e');
  shell(7,5,137,100,8,'#243a43');
  shell(8,5,136,98,8,'#718484');
  shell(9,6,135,97,7,'#314950');
  shell(11,8,133,95,6,'#1d313a');
  shell(13,10,131,95,4,'#0c2027');
  rect(left-1,top-1,width*size+2,height*size+2,'#0b212a');
  const stones=['#253c42','#283f45','#294348','#223940','#263f45'];
  for(let y=0;y<height;y++) for(let x=0;x<width;x++){
    const l=left+x*size,t=top+y*size;
    rect(l,t,size,size,stones[(x*37+y*23)%stones.length]);
    rect(l+1,t,size-2,1,'#496368'); rect(l,t+1,1,size-2,'#425d61');
    rect(l+1,t+size-1,size-1,1,'#152c34'); rect(l+size-1,t+1,1,size-2,'#1c3038');
    for(let i=0;i<9;i++){
      const px=l+2+Math.floor(K.hash(x,y,i+3)*12),py=t+2+Math.floor(K.hash(x,y,i+57)*12);
      rect(px,py,1,1,i%3===1?'#1e333a':'#334d51');
    }
    if((x+y)%2===0){
      rect(l+5,t+3,5,1,'#324a4f'); rect(l+3,t+5,1,5,'#31494e');
      rect(l+9,t+12,3,1,'#21373d');
    }
  }
  for(const [x,y] of [[12,12],[132,12],[12,92],[132,92]]){
    rect(x-1,y-1,3,3,'#182a32'); rect(x-1,y-1,2,2,'#c39768');
    rect(x,y,1,1,'#e2bb7e');
  }
  for(let i=0;i<6;i++){
    rect(40+i*12,4,3,1,i%2?'#d29866':'#8b9e94');
    rect(40+i*12,97,3,1,i%2?'#936253':'#58737a');
  }
  const ground=a.render({width:frameWidth,height:frameHeight,commands,edges:'hard'}).data;
  const alternate=[1,0], rotor=[3,2];
  const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];

  function render(board, graph, {selected, target, energy=0}={}) {
    const rgba=ground.slice(), trace=board.raster();
    const nodes=new Map(board.graph.nodes.map(node=>[node.id,node.data.at]));
    const socketSets=new Map();
    const index=([x,y])=>y*width+x;
    for(const edge of board.graph.edges) if(graph.get(edge.from)){
      for(const {at,side} of edge.data.path){
        const i=index(at);
        if(!socketSets.has(i)) socketSets.set(i,new Set());
        socketSets.get(i).add(side);
      }
    }
    const out=(x,y)=>4*(y*frameWidth+x);
    function point(x,y,color){rgba.set(color,out(x,y));}
    for(const [at,color] of [[target,[132,169,143,255]],[selected,[252,191,116,255]]]){
      if(!at) continue;
      const x=left+at[0]*size,y=top+at[1]*size;
      for(let i=1;i<=4;i++){
        point(x+i,y+1,color); point(x+15-i,y+1,color);
        point(x+i,y+14,color); point(x+15-i,y+14,color);
        point(x+1,y+i,color); point(x+14,y+i,color);
        point(x+1,y+15-i,color); point(x+14,y+15-i,color);
      }
    }
    board.cells.forEach((cell,i)=>{
      if(!cell) return;
      const cx=i%width,cy=Math.floor(i/width), active=socketSets.get(i), {cel,groups}=art[cell.part];
      for(let y=0;y<size;y++) for(let x=0;x<size;x++){
        const slot=cel.slots[at(x,y)];
        if(slot===null)continue;
        const [u,v]=turn(x,y,cell.turn), tx=cx*size+u,ty=cy*size+v;
        const source=4*(ty*trace.w+tx), to=out(left+tx,top+ty), group=groups[at(x,y)];
        const lit=group==='glyph'? graph.get(cell.id) : active && [...group].some(side=>
          active.has(sides[(sides.indexOf(side)+cell.turn)%4]));
        if(lit) rgba.set(live[slot],to);
        else rgba.set(trace.rgba.subarray(source,source+3),to);
        rgba[to+3]=255;
      }
    });
    for(const id of ['iris','bell']){
      if(!graph.get(id))continue;
      const [x,y]=nodes.get(id), u=left+x*size+11,v=top+y*size+4;
      if(energy%3===0)point(u,v,[253,243,174,255]);
      if(energy%3===1)point(u+2,v-2,[187,241,191,255]);
    }
    return {w:frameWidth,h:frameHeight,rgba};
  }

  function settle(board) {
    const graph=board.create();
    graph.step(2);
    return graph;
  }
  return {initial,rotor,alternate,settle,render,same,frameWidth,frameHeight,left,top,size,width,height};
}

if(require.main===module){
  const out=path.resolve(process.argv[2]??'studio/rule-board');
  fs.mkdirSync(out,{recursive:true});
  const packed=gzipSync(ink.bundle()+'\nreturn KIT;',{level:9}).toString('base64');
  const template=fs.readFileSync(path.join(__dirname,'rule-board.html.template'),'utf8');
  const html=template.replace('/* STUDIO */',()=>`
    const bytes=Uint8Array.from(atob('${packed}'),c=>c.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const K=Function(await new Response(stream).text())();
    const demo=(${study.toString()})(K);`);
  fs.writeFileSync(path.join(out,'emberlock.html'),html);
}
module.exports=study;
