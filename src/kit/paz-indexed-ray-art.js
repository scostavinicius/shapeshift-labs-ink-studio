/* Shared indexed textures, light ramps and pixel-snapped directional sprites. */
const IndexedRayArt = (() => {
  const finite = Number.isFinite;
  const index = (n,length) => Number.isInteger(n) && n>=0 && n<length;
  const record = value => value && [Object.prototype,null].includes(Object.getPrototypeOf(value));
  const tuple = (a,n) => Array.isArray(a) && a.length===n && Array.from(a).every(finite);

  function swatch(color) {
    return typeof color==='string' && /^#[\da-f]{6}$/i.test(color) ? parseInt(color.slice(1),16) : color;
  }

  function lights(definition,palette,check) {
    const { distances = [], ramps = {}, sideBias = {} } = definition;
    check(Array.isArray(distances) && distances.length<=15 && Array.from(distances).every((d,i) =>
      finite(d) && d>0 && (!i || d>distances[i-1])) && record(ramps) && record(sideBias) &&
      Object.keys(sideBias).every(key => ['x','z'].includes(key) && index(sideBias[key],distances.length+1)),
      'shade needs increasing positive distances and a nonnegative wall side bias');
    const keys = distances.slice();
    const table = palette.map((_,color) => {
      const ramp = Object.hasOwn(ramps,color) ? ramps[color] : undefined;
      if (ramp===undefined) return keys.map(() => color).concat(color);
      check(Array.isArray(ramp) && ramp.length===keys.length+1 && Array.from(ramp).every(n=>index(n,palette.length)),
        'each shade ramp needs one palette index per distance band');
      return ramp.slice();
    });
    check(Object.keys(ramps).every(key => /^(0|[1-9]\d*)$/.test(key) && index(+key,palette.length)), 'shade ramp index is outside the palette');
    const bias = { x:sideBias.x??0,z:sideBias.z??0 };
    return { table,bias,band(depth) {
      let band=0;
      while (band<keys.length && depth>=keys[band]) band++;
      return band;
    } };
  }

  function palette(source,check) {
    check(Array.isArray(source) && index(source.length-1,256) &&
      Array.from(source).every(value => index(swatch(value),0x1000000)), 'supply 1–256 RGB palette swatches');
    return source.map(swatch);
  }

  function textures(K,swatches,check) {
    const images = new WeakMap();
    let artPixels=0;
    const opaque=slot=>slot>=0;
    return function picture(source, solid) {
      check(record(source), 'provide an indexed stamp for each texture');
      if (!images.has(source)) {
        const {width,height,entries,at,palette:colors} = K.pixelStamps.prepare(source);
        artPixels += width*height*entries.length;
        check(artPixels<=8*1024*1024,'textures exceed the art-pixel budget');
        const remap = colors?.map(color => {
          const target=typeof color==='string'?swatches.indexOf(swatch(color)):color;
          check(index(target,swatches.length),'texture palette colors must reference the scene palette');
          return target;
        });
        const frames=entries.map(({slots}) => Int16Array.from(slots,slot => {
          if (slot===null) return -1;
          const value=remap?remap[slot]:slot;
          check(index(value,swatches.length),'texture has a slot outside the scene palette');
          return value;
        }));
        images.set(source,{width,height,frames,at,solid:frames.every(pixels=>pixels.every(opaque))});
      }
      const texture=images.get(source);
      check(!solid || texture.solid,'wall, door and plane paint must cover every texel');
      return texture;
    };
  }

  function sprites(entries,picture,owner,check) {
    function pose(value,what) {
      check(typeof value==='function' || (what==='position'?tuple(value,3):finite(value)), 'invalid sprite '+what);
      return Array.isArray(value)?value.slice():value;
    }
    return Array.from(entries, ({id,at,yaw=0,height=1,views}={}) => {
      check(finite(height) && height>0 && Array.isArray(views) && index(views.length-1,32),
        'sprites need a positive height and 1–32 directional views');
      const directions=Array.from(views, ({yaw=0,paint,pivot}={}) => {
        const texture=picture(paint,false);
        const pin=pivot??[texture.width/2,texture.height];
        check(finite(yaw) && tuple(pin,2),'sprite view needs a finite yaw and pixel pivot');
        return {yaw,texture,pivot:pin.slice()};
      });
      return {id:owner(id,'sprite'),at:pose(at,'position'),yaw:pose(yaw,'yaw'),height,directions};
    });
  }

  function drawSprites(actors, options) {
    const { time,at:[ox,oy,oz],forward,right,width,height,center,horizon,focal,near,far,
      paint,write,shade,owners,placements,check,locate,visible } = options;
    let work=0;
    const sprites=actors.map(actor => {
      const point=typeof actor.at==='function'?actor.at(time):actor.at;
      check(tuple(point,3),'sprite position callback must return XYZ');
      const x=point[0]-ox,z=point[2]-oz;
      return {actor,point,x,z,distance:x*forward[0]+z*forward[2]};
    }).sort((a,b)=>a.distance-b.distance);
    for (const {actor,point,x,z,distance} of sprites) {
      if (distance<near || distance>far) continue;
      const heading=typeof actor.yaw==='function'?actor.yaw(time):actor.yaw;
      check(finite(heading),'sprite yaw callback must return a finite angle');
      const angle=Math.atan2(-x,-z)-heading;
      const view=actor.directions.reduce((best,cel)=>
        Math.cos(cel.yaw-angle)>Math.cos(best.yaw-angle)+1e-12?cel:best);
      const {texture,pivot}=view;
      const scale=actor.height*focal/distance/texture.height;
      if (!(scale*texture.height>=.5)) continue;
      const h=Math.max(1,Math.round(texture.height*scale)),w=Math.max(1,Math.round(texture.width*scale));
      const left=Math.round(center+(x*right[0]+z*right[2])*focal/distance-pivot[0]*w/texture.width);
      const top=Math.round(horizon-(point[1]-oy)*focal/distance-pivot[1]*h/texture.height);
      check([left,top,w,h].every(finite),'sprite exceeds the finite screen range');
      const x0=Math.max(0,left),x1=Math.min(width,left+w),y0=Math.max(0,top),y1=Math.min(height,top+h);
      if (x0>=x1 || y0>=y1) continue;
      work+=(x1-x0)*(y1-y0);
      check(work<=32*1024*1024,'sprites exceed the frame work budget');
      const art=paint(texture), sector=locate?.(point);
      if (locate && !sector) continue;
      const band=shade(sector,distance);
      let visiblePixels=0;
      for (let col=x0;col<x1;col++) for (let row=y0;row<y1;row++) {
        if ((!visible || visible(sector,col,row,distance)) &&
            write(row*width+col,distance,actor.id,(col+.5-left)/w,(row+.5-top)/h,texture,art,band,sector)) visiblePixels++;
      }
      placements.push({id:owners[actor.id].id,yaw:view.yaw,rect:[left,top,w,h],visiblePixels});
    }
  }
  return Object.freeze({palette,lights,textures,sprites,drawSprites,index,record,tuple});
})();
