/* Front-to-back height-map columns with independent indexed altitude and distance ramps. */
(function (K) {
  const P=K.procedural, finite=Number.isFinite;
  const tuple=(value,n)=>Array.isArray(value)&&value.length===n&&Array.from(value).every(finite);
  const dimension=n=>Number.isSafeInteger(n)&&n>0&&n<=2048;
  const list=data=>Array.isArray(data)||ArrayBuffer.isView(data)&&Number.isInteger(data.length);
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const rgb=n=>[n>>16,n>>8&255,n&255];

  function check(condition,message) {
    if (!condition) throw new RangeError('Height-map flyover: '+message);
  }

  function swatch(value) {
    const color=typeof value==='string' && /^#[\da-f]{6}$/i.test(value)?
      parseInt(value.slice(1),16):value;
    check(Number.isSafeInteger(color)&&color>=0&&color<=0xffffff,'expected an exact RGB swatch');
    return color;
  }

  function ramp({thresholds=[],swatches={}}={}, name) {
    check(Array.isArray(thresholds)&&thresholds.length<=31&&Array.from(thresholds).every((n,i)=>
      finite(n)&&(!i||n>thresholds[i-1])&&(name!=='distance'||n>0)) &&
      swatches && [Object.prototype,null].includes(Object.getPrototypeOf(swatches)),
      name+' shading needs increasing thresholds and a swatch table');
    const keys=thresholds.slice();
    const rows=new Map(Object.entries(swatches).map(([from,to])=>{
      check(Array.isArray(to)&&to.length===keys.length+1,'each '+name+' ramp needs one swatch per band');
      return [swatch(from),Array.from(to,swatch)];
    }));
    return (color,value)=>{
      const row=rows.get(color);
      if (!row) return color;
      let band=0;
      while (band<keys.length&&value>=keys[band]) band++;
      return row[band];
    };
  }

  function interval(origin,delta,lo,hi) {
    if (delta===0) return origin>=lo&&origin<hi?[-Infinity,Infinity]:null;
    const a=(lo-origin)/delta,b=(hi-origin)/delta;
    return [Math.min(a,b),Math.max(a,b)];
  }

  // At a boundary the first cell lies in the direction the ray will travel.
  function entering(coordinate,step,count) {
    const edge=Math.round(coordinate);
    const p=Math.abs(coordinate-edge)<=1e-9?edge:coordinate;
    return clamp(step<0?Math.ceil(p)-1:Math.floor(p),0,count-1);
  }

  function create({bounds,heights,paint,heightScale=1,heightOffset=0,rowDirection='positive',
    id='terrain',regions,altitude,distance,scenePalette,paletteRoles}={}) {
    check(tuple(bounds,4)&&bounds[0]<bounds[1]&&bounds[2]<bounds[3]&&finite(bounds[1]-bounds[0])&&
      finite(bounds[3]-bounds[2]),'bounds must be increasing [minX, maxX, minZ, maxZ]');
    const [minX,maxX,minZ,maxZ]=bounds,spanX=maxX-minX,spanZ=maxZ-minZ;
    const {width:mapW,height:mapH,data:heightsData,channels=1}=heights??{};
    const count=mapW*mapH;
    check(dimension(mapW)&&dimension(mapH)&&count<=1024*1024&&channels===1&&list(heightsData)&&
      heightsData.length===count&&finite(heightScale)&&heightScale!==0&&finite(heightOffset)&&
      ['positive','negative'].includes(rowDirection),'supply a finite one-channel height raster and a row direction');
    const grid=Float64Array.from(heightsData,n=>{
      const height=n*heightScale+heightOffset;
      check(finite(n)&&finite(height),'height samples and scaled elevations must be finite');
      return height;
    });
    const paintW=paint?.width??paint?.w,paintH=paint?.height??paint?.h;
    check(paintW===mapW&&paintH===mapH,'height and paint maps must be on the same grid');
    const sourceData=paint.data??paint.rgba??paint.rgb;
    const art=sourceData===undefined?K.pixelStamps.image(paint,{scenePalette,paletteRoles}).rgba:
      P.raster.rgba({width:mapW,height:mapH,data:sourceData,channels:paint.channels}).data;
    const names=regions?.names??[id];
    check(Array.isArray(names)&&names.length>=1&&names.length<=1024&&
      Array.from(names).every(name=>typeof name==='string'&&name.trim())&&new Set(names).size===names.length,
      'terrain regions need distinct names');
    const owners=[null,...names.map(name=>({id:name,kind:'terrain'}))];
    let region;
    if (regions!==undefined) {
      check(regions&&list(regions.data)&&regions.data.length===count,'region labels must match the map dimensions');
      region=Uint16Array.from(regions.data,n=>{
        check(Number.isSafeInteger(n)&&n>=0&&n<names.length,'terrain region index is outside the name table');
        return n+1;
      });
    }
    const altitudeColor=ramp(altitude,'altitude'), distanceColor=ramp(distance,'distance');
    const base=new Uint32Array(count), elevated=new Uint32Array(count);
    for (let i=0;i<count;i++) {
      const j=i*4;
      base[i]=art[j]*65536+art[j+1]*256+art[j+2];
      elevated[i]=altitudeColor(base[i],grid[i]);
    }
    const cellX=spanX/mapW, cellZ=spanZ/mapH, reverse=rowDirection==='negative';
    check(cellX>0&&cellZ>0,'map cells are below the finite world resolution');
    const address=(x,z)=>(reverse?mapH-1-z:z)*mapW+x;
    const belongs=(x,z)=>x>=0&&x<mapW&&z>=0&&z<mapH;

    function sample(x,z) {
      if (!(finite(x)&&finite(z)&&x>=minX&&x<maxX&&z>=minZ&&z<maxZ)) return null;
      const u=(x-minX)/spanX, v=(z-minZ)/spanZ;
      const pixel=address(Math.min(mapW-1,Math.floor(u*mapW)),Math.min(mapH-1,Math.floor(v*mapH)));
      if (art[pixel*4+3]<128) return null;
      const id=region?.[pixel]??1;
      return {point:[x,grid[pixel],z],uv:[u,reverse?1-v:v],color:base[pixel],owner:{...owners[id]}};
    }

    function render({width,height,camera,altitudeBands=true,distanceBands=true,background=null}={}) {
      const {at,yaw=0,horizon=height/2,fov=Math.PI/3,near=.05,far=512}=camera??{};
      check(dimension(width)&&dimension(height)&&width*height<=K.renderOutputs.maxPixels&&tuple(at,3)&&
        finite(yaw)&&finite(horizon)&&finite(fov)&&fov>=.03&&fov<Math.PI-.03&&finite(near)&&near>=1e-5&&
        finite(far)&&far>near&&typeof altitudeBands==='boolean'&&typeof distanceBands==='boolean',
        'invalid native canvas, level camera or band switches');
      const forward=[Math.sin(yaw),0,Math.cos(yaw)],right=[forward[2],0,-forward[0]];
      const [ox,oy,oz]=at,focal=height/2/Math.tan(fov/2), center=width/2;
      const length=width*height,data=new Uint8Array(length*4),depth=new Float64Array(length).fill(Infinity);
      const ids=new Uint16Array(length),uv=new Float64Array(length*2);
      const slopes=Float64Array.from({length:height},(_,y)=>(horizon-y-.5)/focal);
      const palette=altitudeBands?elevated:base;
      if (background!==null) {
        const clear=[...rgb(swatch(background)),255];
        for (let p=0;p<length;p++) data.set(clear,p*4);
      }
      for (let column=0;column<width;column++) {
        const offset=(column+.5-center)/focal;
        const dx=forward[0]+right[0]*offset,dz=forward[2]+right[2]*offset;
        const xRange=interval(ox,dx,minX,maxX), zRange=interval(oz,dz,minZ,maxZ);
        if (!xRange||!zRange) continue;
        let entry=Math.max(near,xRange[0],zRange[0]), bottom=height;
        const end=Math.min(far,xRange[1],zRange[1]);
        if (!(entry<end)) continue;
        const sx=Math.sign(dx),sz=Math.sign(dz);
        let x=entering((ox+dx*entry-minX)/cellX,sx,mapW);
        let z=entering((oz+dz*entry-minZ)/cellZ,sz,mapH);
        const stepX=Math.abs(cellX/dx),stepZ=Math.abs(cellZ/dz);
        let nextX=sx?(minX+(x+Number(sx>0))*cellX-ox)/dx:Infinity;
        let nextZ=sz?(minZ+(z+Number(sz>0))*cellZ-oz)/dz:Infinity;
        while (bottom>0&&entry<end&&belongs(x,z)) {
          const exit=Math.min(end,nextX,nextZ), pixel=address(x,z);
          if (exit>entry&&art[pixel*4+3]>=128) {
            const rise=grid[pixel]-oy;
            const top=horizon-rise*focal/(rise>=0?entry:exit);
            const first=clamp(Math.ceil(top-.5-1e-9),0,bottom);
            // Near columns own the rows they cover. A further cell can only raise the silhouette.
            for (let y=first;y<bottom;y++) {
              const p=y*width+column,slope=slopes[y];
              // Upper rows of a below-eye cell may hit its horizontal cap after entering the cell.
              const d=entry*slope<=rise?entry:clamp(rise/slope,entry,exit);
              const color=distanceBands?distanceColor(palette[pixel],d):palette[pixel];
              const dst=p*4;
              data[dst]=color>>16; data[dst+1]=color>>8&255; data[dst+2]=color&255; data[dst+3]=255;
              depth[p]=d;
              ids[p]=region?.[pixel]??1;
              uv[p*2]=clamp((ox+dx*d-minX)/spanX,0,1);
              const v=clamp((oz+dz*d-minZ)/spanZ,0,1);
              uv[p*2+1]=reverse?1-v:v;
            }
            bottom=first;
          }
          if (exit>=end) break;
          // A crossed corner has no width in either of the cells beside it.
          const corner=Math.abs(nextX-nextZ)<=16*Number.EPSILON*Math.max(1,Math.abs(exit));
          if (nextX===exit||corner) { x+=sx; nextX+=stepX; }
          if (nextZ===exit||corner) { z+=sz; nextZ+=stepZ; }
          entry=Math.max(entry,exit);
        }
      }
      return K.renderOutputs.create({width,height,data,depth,ids,uv,owners,
        camera:{origin:at,right,up:[0,1,0],forward,center:[center,horizon],scale:[focal,focal]}});
    }
    return Object.freeze({sample,render});
  }

  K.heightmapFlyover=Object.freeze({create});
})(KIT);
