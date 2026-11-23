/* Painted diagnostic plates on separate camera-facing sprite planes. */
module.exports=({KIT:K,makeBuilder})=>({
  id:'signal-relay',name:'Signal Relay',seed:51,
  build(seed) {
    const B=makeBuilder(seed,[0x101922,0x344b54,0x76c9c4,0xe6ab60]);
    const cards=[];
    function plate({id,z,center,span,grid,angle=0,paint}) {
      const [gw,gh]=grid, c=Math.cos(angle), s=Math.sin(angle);
      const width=Math.ceil(gw*Math.abs(c)+gh*Math.abs(s)), height=Math.ceil(gh*Math.abs(c)+gw*Math.abs(s));
      const color=new Uint8Array(width*height*4);
      for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const dx=x-(width-1)/2,dy=y-(height-1)/2;
        const ix=Math.round(dx*c-dy*s+(gw-1)/2),iy=Math.round(dx*s+dy*c+(gh-1)/2);
        if(ix<0||ix>=gw||iy<0||iy>=gh) continue;
        const sample=paint(ix,iy);
        if(!sample) continue;
        const [rgb,alpha=255]=sample;
        color.set([rgb>>16,(rgb>>8)&255,rgb&255,alpha],(y*width+x)*4);
      }
      const atlas=K.sprite.atlas({metadata:{width,height,unitsPerPixel:span/gw,
        frames:[{rect:{x:0,y:0,width,height}}]},images:{color}});
      cards.push(K.sprite.placeAtlas({atlas,at:[...center,z],mode:'card',lighting:false,objectId:id,materialId:id+' finish'}));
    }

    plate({id:'instrument housing',z:-2.15,center:[0,0],span:5.67,grid:[174,108],paint(x,y){
      const edge=Math.min(x,173-x,y,107-y), diagonal=Math.min(x,173-x)+Math.min(y,107-y);
      if(diagonal<6) return;
      if(edge<2)return [0x121b26];
      if(edge<4)return [y<53?0x849994:0x34485a];
      if(edge<7)return [0x364b5c];
      if(edge===7)return [0x273a49];
      for(const x0 of [13,160])for(const y0 of [13,94]){
        const r=Math.hypot(x-x0,y-y0);
        if(r<2)return [x-x0===y-y0?0xb4bca8:0x605b5a];
        if(r<4)return [0x161f2a];
      }
      if(x>18&&x<152&&y>17&&y<91){
        const gx=(x-18)%14,gy=(y-17)%14;
        if(gx<1||gy<1)return [0x334a58];
        if(gx===7&&gy===7)return [0x668181];
        return [0x263b49];
      }
      if(y>96&&y<100&&x>23&&x<131&&x%6<4) return [x%18<6?0xb28a60:0x62777a];
      if(y>7&&y<11&&x>35&&x<145&&x%7<4) return [0x77989a];
      return [(x*11+y*7)%23===0?0x354859:0x2c3e4c];
    }});
    plate({id:'amber rear sheet',z:-.84,center:[.53,-.10],span:3.98,grid:[121,73],angle:-.10,paint(x,y){
      const dx=Math.min(x,120-x),dy=Math.min(y,72-y),edge=Math.min(dx,dy);
      if(dx+dy<7)return;
      if(edge<2)return [0x492f36,225];
      if(edge<4)return [0xf9be7b,220];
      if(edge<6)return [0x995944,192];
      if(y>54&&y<59&&x>64&&x<107) return [x%6<3?0xffdc9d:0xad6445,196];
      if(x>85&&x<106&&y>14&&y<44){
        if(x===86||x===105||y===15||y===43)return [0xffd395,188];
        if(x%5===0||y%7===0)return [0xed9462,148];
      }
      const hollow=Math.hypot((x-36)*.92,(y-37)*1.07);
      if(hollow>22&&hollow<24)return [0xffc389,196];
      if((x+2*y)%24===0)return [0xd88855,161];
      return [(x+y)%8===0?0xe7a25f:0xda8b58,125];
    }});
    plate({id:'teal front sheet',z:1.1,center:[-.57,.19],span:3.88,grid:[118,67],angle:.105,paint(x,y){
      const dx=Math.min(x,117-x),dy=Math.min(y,66-y),edge=Math.min(dx,dy);
      if(dx+dy<9)return;
      if(edge<2)return [0x143e50,232];
      if(edge<4)return [y<35?0x8df5df:0x3f8b89,228];
      if(edge<6)return [0x256c79,195];
      const ring=Math.hypot((x-35),(y-30)*1.1);
      if(ring>17&&ring<18.4)return [0x9fecce,171];
      if(ring>22&&ring<23.4&&(x<29||y>32))return [0x89d7cd,223];
      if(x>12&&x<27&&y>48&&y<56&&x%4<2)return [0xbafbe0,225];
      if(y>10&&y<14&&x>67&&x<107&&x%9<6)return [0xa8f2dd,204];
      if(y%10===0||x%12===0)return [0x80e4dc,122];
      if((x+3*y)%41===0)return [0x9be9dc,121];
      return [0x56b6b5,107];
    }});
    return B.finish({cam:{target:[0,0,0],yaw:0,pitch:0,dist:6.22,ortho:true,sway:0},radius:4,
      dither:0,spriteAtlases:cards,look:{splatCoverage:'continuous'}});
  }
});
