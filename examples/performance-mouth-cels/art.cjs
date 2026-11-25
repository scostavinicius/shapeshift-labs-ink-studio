/* Moon Relay portrait and a hand-authored bank of native-grid mouth cels. */
const ink=[
  0x12252d,0x192f36,0x233c43,0x30545a,0x477777,0x6c9990,0xa4b4a0,
  0x262e39,0x363543,0x523c43,0x784c4d,0xa46756,0xbd8063,0xd7936d,0xe9af84,0xf7c598,
  0x683e48,0x8f4d54,0xc16c69,0xe6a085,0xffdec3,0xf1c477,0xc68c54,0x64768c,0x8ba0ad,0xd2e8df
];
function draw(width,height){
  const data=new Uint8Array(width*height*4);
  function dot(x,y,color){
    if(x<0||y<0||x>=width||y>=height)return;
    const rgb=ink[color];
    data.set([rgb>>16,(rgb>>8)&255,rgb&255,255],(y*width+x)*4);
  }
  function rect(x,y,w,h,c){
    for(let v=y;v<y+h;v++)for(let u=x;u<x+w;u++)dot(u,v,c);
  }
  function ellipse(x,y,w,h,c){
    for(let v=Math.floor(y-h);v<=y+h;v++)for(let u=Math.floor(x-w);u<=x+w;u++){
      const a=(u-x)/w,b=(v-y)/h;
      if(a*a+b*b<=1)dot(u,v,c);
    }
  }
  function polygon(points,c){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let inside=false;
      for(let i=0,j=points.length-1;i<points.length;j=i++){
        const [a,b]=points[i],[d,e]=points[j];
        if((b>y)!==(e>y) && x<(d-a)*(y-b)/(e-b)+a)inside=!inside;
      }
      if(inside)dot(x,y,c);
    }
  }
  return {data,dot,rect,ellipse,polygon,width,height};
}

function portrait(){
  const image=draw(112,86), {dot,rect,ellipse,polygon}=image;
  for(let y=0;y<86;y++)for(let x=0;x<112;x++){
    const ridge=Math.hypot((x-35)/71,(y-30)/59);
    dot(x,y,ridge<.5?3:ridge<.8?2:1);
    if(((x*37+y*53+x*y*3)%59)<2 && y<56)dot(x,y,ridge<.6?4:3);
  }
  ellipse(20,24,19,19,2);
  ellipse(20,24,17,17,4);
  ellipse(18,23,15,15,6);
  ellipse(14,20,14,15,3);
  for(const [x,y] of [[5,8],[9,33],[32,13],[26,37],[38,22],[12,41],[3,41],[94,19],[102,10],[91,36]]){
    dot(x,y,5);dot(x+1,y,4);dot(x,y+1,4);
  }
  polygon([[0,63],[17,56],[27,62],[37,57],[50,65],[74,55],[94,61],[112,54],[112,86],[0,86]],2);
  rect(0,65,112,2,3);
  rect(4,62,18,2,3);rect(3,64,20,12,0);rect(4,65,18,8,2);
  rect(6,66,10,1,4);rect(6,68,11,1,4);rect(7,70,4,1,5);rect(18,67,2,3,21);
  polygon([[87,56],[108,56],[110,59],[110,71],[87,71]],0);
  rect(89,58,17,10,2);rect(93,60,9,1,4);rect(93,62,9,1,4);rect(102,64,2,2,21);

  polygon([[25,86],[27,76],[35,69],[45,66],[50,58],[71,58],[77,66],[89,72],[97,86]],0);
  polygon([[29,85],[33,76],[46,70],[72,68],[84,73],[93,85]],3);
  polygon([[51,66],[69,64],[74,70],[67,74],[52,75],[43,70]],4);
  polygon([[33,81],[39,74],[47,72],[52,79],[53,86],[31,86]],4);
  polygon([[71,73],[79,71],[90,77],[94,86],[82,86]],2);
  rect(37,78,6,2,21);
  rect(38,80,4,1,22);
  rect(63,76,14,6,1);rect(66,78,7,2,5);dot(75,78,21);
  polygon([[52,53],[67,54],[69,64],[72,66],[66,69],[53,68],[50,64]],11);
  polygon([[54,55],[66,58],[66,65],[61,67],[54,65]],13);

  polygon([[37,24],[43,17],[53,13],[66,13],[79,17],[85,23],[87,34],[84,49],[76,57],[43,56],[36,49],[34,36]],0);
  polygon([[36,28],[42,19],[54,15],[65,15],[76,19],[82,25],[85,35],[80,48],[74,53],[42,52],[37,48]],4);
  polygon([[41,27],[45,21],[55,18],[67,17],[76,21],[81,27],[79,33],[41,34]],5);
  polygon([[45,22],[55,19],[66,19],[73,22],[74,25],[43,27]],6);
  polygon([[40,34],[45,27],[52,25],[69,25],[76,31],[79,39],[75,50],[69,57],[63,61],[54,60],[47,56],[43,51]],8);
  polygon([[45,35],[49,29],[54,27],[70,29],[74,34],[75,46],[71,53],[65,59],[55,59],[48,54],[45,48]],11);
  polygon([[47,35],[52,31],[67,31],[71,34],[73,41],[72,49],[68,55],[62,58],[56,57],[51,54],[47,48]],13);
  polygon([[49,38],[53,33],[63,33],[67,37],[68,42],[64,45],[64,49],[61,52],[54,52],[50,49]],14);
  polygon([[59,38],[61,38],[62,43],[65,45],[63,47],[58,47],[57,46]],12);
  rect(59,43,2,2,15);rect(61,46,3,1,10);
  polygon([[47,31],[51,28],[66,27],[72,30],[73,33],[67,33],[61,30],[54,33],[47,36]],9);
  rect(49,38,7,2,9);rect(64,37,7,2,9);
  rect(50,41,7,2,20);rect(64,40,7,2,20);
  rect(53,41,3,2,1);rect(67,40,3,2,1);
  dot(53,41,25);dot(67,40,25);
  rect(48,46,6,1,15);rect(68,45,4,1,14);
  polygon([[35,35],[40,33],[44,35],[44,48],[40,51],[35,49],[34,45]],0);
  polygon([[35,36],[40,35],[42,36],[42,46],[39,49],[35,48]],3);
  rect(37,37,2,9,5);rect(41,38,1,6,21);
  polygon([[76,35],[80,32],[85,34],[86,40],[84,48],[79,51],[76,48]],0);
  polygon([[78,35],[83,34],[84,37],[83,45],[80,48],[77,46]],4);
  rect(80,37,2,6,5);
  polygon([[79,46],[80,49],[76,52],[71,54],[68,54],[68,52],[73,52]],1);
  rect(68,52,4,2,3);
  rect(69,52,2,1,21);
  for(const [x,y,c] of [[42,21,5],[44,20,5],[50,16,6],[69,17,6],[81,27,5],[29,75,5],[88,76,5],[75,84,4]])dot(x,y,c);
  return image;
}

const glyphs={
  rest:['         ..       ','      rr..rr      ','        ss        '],
  seal:['       rrrr       ','     rrrrrrrr     ','      sssss       '],
  teeth:['      rrrrrr      ','     xwwwwwxr     ','      xssssr      ','       rrrr       '],
  tongue:['       rrrrr      ','     xxwwxxxr     ','     xxtttxxr     ','       ssss       '],
  hiss:['     rrrrrrrr     ','    xwwwwwwwwxr   ','      sssssss     '],
  round:['       rrrr       ','      rxwwxr      ','      rxxxxr      ','      rxssxr      ','       rrrr       '],
  spread:['    rrrrrrrrrr    ','   xwwwwwwwwwwxr  ','    rxxxssxxxr    ','      rrrrrr      '],
  open:['      rrrrrr      ','     xwwwwwwxr    ','     xxxxxxxxr    ','      xtttxxr     ','       ssss       '],
  narrow:['       rrrr       ','      xwwwxr      ','       ssss       '],
  'open-accent':['     rrrrrrrr     ','    xwwwwwwwwxr   ','   rxxxxxxxxxxr   ','   rxxxtttxxxxr   ','    rxtttttxxr    ','     rsssssr      '],
  'round-accent':['       rrrr       ','      rxwwxr      ','     rxxxxxxr     ','     rxxxxxxr     ','      rxttxr      ','       ssss       ']
};
function cel(name){
  const result=draw(18,10), tones={'.':16,r:17,s:18,x:9,t:19,w:20};
  const rows=glyphs[name], first=Math.floor((10-rows.length)/2);
  rows.forEach((row,y)=>[...row].forEach((symbol,x)=>{if(symbol!==' ')result.dot(x,y+first,tones[symbol]);}));
  return result;
}

module.exports={portrait,cel,poses:Object.keys(glyphs)};
