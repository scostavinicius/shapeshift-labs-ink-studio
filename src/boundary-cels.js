/* Place indexed drawings along visible, oriented seams on the native art grid. */
const BoundaryCels = (() => {
  const S=typeof TargetSelectors==='undefined'?require('./target-selectors.js'):TargetSelectors;
  const Stamps=typeof PixelStamps==='undefined'?require('./pixel-stamps.js'):PixelStamps;
  const kinds=['straight','inside','outside','taper','gap'];
  const priorities={straight:1,inside:2,outside:2,taper:3,gap:4};
  const directions=[[0,-1],[1,0],[0,1],[-1,0]];
  const startCorners=[[0,0],[1,0],[1,1],[0,1]];
  const record=value=>value && Object.getPrototypeOf(value)===Object.prototype;
  const integer=(value,lo,hi)=>Number.isSafeInteger(value)&&value>=lo&&value<=hi;
  const finite=(value,lo,hi)=>Number.isFinite(value)&&value>=lo&&value<=hi;
  const idOK=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(value);
  const check=(ok,message)=>{if(!ok)throw new RangeError('Boundary cels: '+message);};
  const hasOnly=(raw,keys)=>record(raw)&&Object.keys(raw).every(key=>keys.includes(key));
  const cache=new WeakMap();

  function preset(name, {swatches}={}){
    check(name==='frost','unknown preset '+name);
    const sizes=[['chip',0,3],['hook',28,5],['drift',76,7]];
    return {sizes:sizes.map(([id,minPixels,spacing])=>({id,minPixels,spacing,
      cels:Object.fromEntries(kinds.map(kind=>[kind,Stamps.clip('boundary-frost-'+id+'-'+kind,{swatches})]))}))};
  }

  function paintSource(raw){
    check(hasOnly(raw,['select','swatches','luma','background']),'expected a selector, swatches, luma range or background');
    const {select,swatches,luma,background=false}=raw;
    check(typeof background==='boolean' && (!background||Object.keys(raw).length===1) &&
      (swatches===undefined||Array.isArray(swatches)&&integer(swatches.length,1,256)&&
        Array.from(swatches).every(color=>typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color))) &&
      (luma===undefined||Array.isArray(luma)&&luma.length===2&&Array.from(luma).every(v=>finite(v,0,1))&&luma[0]<=luma[1]),
    'invalid material, palette or luma source');
    return {select:select===undefined?null:S.prepare(select),background,luma,
      swatches:swatches&&new Set(swatches.map(color=>parseInt(color.slice(1),16)))};
  }

  function prepare(raw,{scenePalette,paletteRoles}={}){
    if(raw===undefined||raw===false)return null;
    const saved=cache.get(raw);
    if(saved&&saved.palette===scenePalette&&saved.roles===paletteRoles)return saved.plan;
    check(hasOnly(raw,['rules'])&&Array.isArray(raw.rules)&&integer(raw.rules.length,1,16),'expected 1–16 boundary rules');
    const ids=new Set(), families=new Map();
    let texels=0;
    function family(input){
      if(families.has(input))return families.get(input);
      const value=typeof input==='string'?preset(input):input;
      check(hasOnly(value,['sizes'])&&Array.isArray(value.sizes)&&integer(value.sizes.length,1,8),'expected a family with 1–8 sizes');
      let prior=-1;
      const names=new Set();
      const sizes=Array.from(value.sizes,band=>{
        check(hasOnly(band,['id','minPixels','spacing','cels']),'invalid size');
        const {id,minPixels,spacing,cels}=band;
        check(idOK(id)&&!names.has(id)&&integer(minPixels,0,262144)&&minPixels>prior&&
          (prior>=0||minPixels===0)&&integer(spacing,1,32)&&hasOnly(cels,kinds),
        'expected named sizes, increasing contour lengths starting at zero, and spacing from 1 to 32');
        prior=minPixels; names.add(id);
        const draws={};
        for(const kind of kinds){
          const entry=cels[kind];
          if(entry===null){draws[kind]=null;continue;}
          check(entry!==undefined,'size '+id+' needs a '+kind+' cel or null');
          const {stamp=entry,pivot}=record(entry)&&Object.hasOwn(entry,'stamp')?entry:{stamp:entry};
          const source=typeof stamp==='string'?Stamps.clip(stamp):stamp;
          check(source&&integer(source.width,1,31)&&integer(source.height,1,31)&&
            (source.frames===undefined||Array.isArray(source.frames)&&integer(source.frames.length,1,16)),
          'cels must be at most 31×31 pixels and 16 frames');
          const {width,height,entries,palette,at}=Stamps.prepare(source);
          const pin=pivot??[width>>1,height>>1];
          check(Array.isArray(pin)&&pin.length===2&&integer(pin[0],0,width-1)&&integer(pin[1],0,height-1),
            'pivot must be a texel in the cel');
          texels+=width*height*entries.length;
          check(texels<=262144,'family art exceeds its scene budget');
          const frames=entries.map(({slots})=>Stamps.image({width,height,slots,palette},{scenePalette,paletteRoles}).rgba);
          draws[kind]={w:width,h:height,pin:[...pin],rgba:time=>frames[at(time)]};
        }
        return {id,minPixels,spacing,draws};
      });
      families.set(input,sizes);
      return sizes;
    }
    const rules=Array.from(raw.rules,rule=>{
      check(hasOnly(rule,['id','inside','outside','family','gaps','paint','cornerRun']),'invalid rule properties');
      const {id,inside,outside={background:true},family:source='frost',gaps=[],paint='inside',cornerRun=2}=rule;
      check(idOK(id)&&!ids.has(id)&&inside?.background!==true&&Array.isArray(gaps)&&gaps.length<=32 &&
        ['inside','outside','both'].includes(paint)&&integer(cornerRun,1,8),'invalid rule ID, gaps, paint side or corner run');
      ids.add(id);
      return {id,inside:paintSource(inside),outside:paintSource(outside),sizes:family(source),
        gaps:Array.from(gaps,S.prepare),paint,cornerRun};
    });
    const plan={rules};
    cache.set(raw,{palette:scenePalette,roles:paletteRoles,plan});
    return plan;
  }

  function apply(frame,{splatId}={},plan,world,{time=0,captureSites=false}={}){
    const {w,h,rgb,alpha}=frame, count=w*h;
    const report={changedPixels:0,placed:0,byKind:{straight:0,inside:0,outside:0,taper:0,gap:0},bySize:{},
      ...(captureSites&&{sites:[]})};
    const swatches=new Set();
    if(!plan||!splatId)return {rgb,swatches,report};
    check(count<=1048576 && splatId.length===count,'expected aligned ownership at up to 1,048,576 art pixels');
    const ownerAt=S.index(world).row, stride=w+1;
    let output=rgb, edgeBudget=262144, texelBudget=8000000;

    for(const rule of plan.rules){
      const classes=new Uint8Array(count), owners=new Uint32Array(count), targetClasses=new Map(), orgIds=new Map();
      const {inside,outside,gaps}=rule;
      function profiles(target){
        if(!targetClasses.has(target)){
          const matches=s=>!s.background && (!s.select||S.matches(s.select,target));
          const object=target.entity??target.object??target;
          if(!orgIds.has(object))orgIds.set(object,orgIds.size+1);
          targetClasses.set(target,{inside:matches(inside),outside:matches(outside),
            gap:gaps.some(selector=>S.matches(selector,target)),id:orgIds.get(object)});
        }
        return targetClasses.get(target);
      }
      function colorMatches(source,r,g,b){
        if(source.swatches&&!source.swatches.has((r<<16)|(g<<8)|b))return false;
        if(source.luma){
          const luma=(.2126*r+.7152*g+.0722*b)/255;
          return luma>=source.luma[0]&&luma<=source.luma[1];
        }
        return true;
      }
      for(let p=0;p<count;p++){
        const id=splatId[p];
        if(id===0){
          if(outside.background)classes[p]=2;
          continue;
        }
        if(id>world.count||alpha?.[p]===0)continue;
        const target=profiles(ownerAt(id-1)), i=p*3, r=rgb[i],g=rgb[i+1],b=rgb[i+2];
        owners[p]=target.id;
        if(target.gap)classes[p]=3;
        else if(target.inside&&colorMatches(inside,r,g,b))classes[p]=1;
        else if(target.outside&&colorMatches(outside,r,g,b))classes[p]=2;
      }

      const edges=[], begins=new Map();
      for(let p=0;p<count;p++){
        if(classes[p]!==1)continue;
        const x=p%w,y=Math.floor(p/w);
        for(let dir=0;dir<4;dir++){
          const [dx,dy]=directions[dir], nx=x+dx,ny=y+dy;
          if(nx<0||ny<0||nx>=w||ny>=h)continue;
          const q=ny*w+nx;
          if(classes[q]!==2)continue;
          const [sx,sy]=startCorners[dir], [ex,ey]=startCorners[(dir+1)%4];
          const start=(y+sy)*stride+x+sx,end=(y+ey)*stride+x+ex;
          check(--edgeBudget>=0,'visible contours exceed their edge budget');
          const edge={p,q,x,y,start,end,dir,prev:-1,next:-1};
          if(!begins.has(start))begins.set(start,[]);
          begins.get(start).push(edges.length);
          edges.push(edge);
        }
      }
      if(!edges.length)continue;
      for(const [i,edge] of edges.entries()){
        const candidates=begins.get(edge.end);
        if(!candidates)continue;
        // At diagonal pinches follow the turn that keeps the inside island four-connected.
        for(const turn of [1,0,3]){
          const next=candidates.find(j=>edges[j].dir===(edge.dir+turn)%4);
          if(next===undefined)continue;
          edge.next=next; edges[next].prev=i;
          break;
        }
      }

      const priority=new Uint8Array(count), visited=new Uint8Array(edges.length);
      function gap(vertex){
        const x=vertex%stride,y=Math.floor(vertex/stride);
        for(const j of [y-1,y])for(const i of [x-1,x])
          if(i>=0&&i<w&&j>=0&&j<h&&classes[j*w+i]===3)return true;
        return false;
      }
      function longEnough(edge,key,dir){
        for(let i=1;i<rule.cornerRun;i++){
          edge=edges[edge[key]];
          if(!edge||edge.dir!==dir)return false;
        }
        return true;
      }
      function pick(edge){
        if(edge.prev<0||edge.next<0){
          const atHead=edge.prev<0, mirror=!atHead;
          return {kind:gap(atHead?edge.start:edge.end)?'gap':'taper',mirror};
        }
        const prev=edges[edge.prev], turn=(edge.dir-prev.dir+4)%4;
        if(turn && longEnough(prev,'prev',prev.dir) && longEnough(edge,'next',edge.dir))
          return {kind:turn===1?'outside':'inside',mirror:false};
        return null;
      }

      function stamp(edge,kind,mirror,size){
        const {p,q,x,y,dir}=edge, draw=size.draws[kind], rank=priorities[kind];
        report.placed++;
        report.byKind[kind]++;
        const category=rule.id+'/'+size.id;
        report.bySize[category]=(report.bySize[category]??0)+1;
        if(captureSites)report.sites.push({rule:rule.id,size:size.id,kind,at:[x,y],turn:dir,mirror});
        if(!draw)return;
        const {w:dw,h:dh,pin}=draw, image=draw.rgba(time);
        texelBudget-=dw*dh;
        check(texelBudget>=0,'visible cels exceed their texel budget');
        for(let v=0;v<dh;v++)for(let u=0;u<dw;u++){
          const from=(v*dw+u)*4;
          if(!image[from+3])continue;
          const dx=(u-pin[0])*(mirror?-1:1),dy=v-pin[1];
          const sx=x+[dx,-dy,-dx,dy][dir], sy=y+[dy,dx,-dy,-dx][dir];
          if(sx<0||sx>=w||sy<0||sy>=h)continue;
          const to=sy*w+sx, label=classes[to];
          const valid=label===1?rule.paint!=='outside'&&owners[to]===owners[p]:
            label===2&&rule.paint!=='inside'&&owners[to]===owners[q];
          if(!valid||alpha?.[to]===0||priority[to]>=rank)continue;
          priority[to]=rank;
          if(output===rgb)output=rgb.slice();
          output.set(image.subarray(from,from+3),to*3);
          swatches.add(image[from]*65536+image[from+1]*256+image[from+2]);
        }
      }

      function visit(first){
        const chain=[];
        let i=first;
        while(i>=0&&!visited[i]){
          visited[i]=1;
          chain.push(edges[i]);
          i=edges[i].next;
        }
        const length=chain.length, closed=i===first, size=rule.sizes.findLast(row=>row.minPixels<=length);
        const features=chain.map(pick), spaced=new Uint8Array(length), buffer=Math.floor(size.spacing/2);
        for(let i=0;i<length;i++){
          if(!features[i])continue;
          for(let d=-buffer;d<=buffer;d++){
            const j=closed?(i+d+buffer*length)%length:i+d;
            if(j>=0&&j<length)spaced[j]=1;
          }
        }
        for(let i=0;i<length;i++){
          const feature=features[i];
          if(feature)stamp(chain[i],feature.kind,feature.mirror,size);
          else if(i%size.spacing===0&&!spaced[i])stamp(chain[i],'straight',false,size);
        }
      }
      for(let i=0;i<edges.length;i++)if(edges[i].prev<0)visit(i);
      for(let i=0;i<edges.length;i++)if(!visited[i])visit(i);
    }
    if(output!==rgb)for(let p=0;p<rgb.length;p+=3)
      report.changedPixels+=Number(rgb[p]!==output[p]||rgb[p+1]!==output[p+1]||rgb[p+2]!==output[p+2]);
    return {rgb:report.changedPixels?output:rgb,swatches,report};
  }

  return Object.freeze({preset,prepare,apply});
})();
if (typeof module !== 'undefined') module.exports = BoundaryCels;
