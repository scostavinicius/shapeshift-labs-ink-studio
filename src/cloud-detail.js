/* Bake depth-aware cloud projections from the same bounded density used by the near view. */
const CloudDetail = (() => {
  const modes = Object.freeze(['auto','card','impostor','volume','off']);
  const tau = Math.PI*2, halfPi = Math.PI*.5;
  const mix = (a,b,t) => a + (b-a)*t;
  const clamp = (n,a=0,b=1) => Math.max(a,Math.min(b,n));
  function ease(a,b,n) {
    const u=clamp((n-a)/(b-a));
    return u*u*(3-2*u);
  }
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const angles = (x,y,z) => [Math.atan2(x,z),Math.atan2(y,Math.hypot(x,z))];
  function basis(yaw,pitch) {
    const s=Math.sin(yaw), c=Math.cos(yaw), v=Math.sin(pitch), h=Math.cos(pitch);
    return { normal:[s*h,v,c*h], right:[c,0,-s], up:[-s*v,h,-c*v] };
  }

  function compile({ min,max,density,steps }, descriptor={}) {
    if (!descriptor || Object.getPrototypeOf(descriptor)!==Object.prototype ||
        Object.keys(descriptor).some(key=>!['volume','card','resolution','directions','cardYaw'].includes(key)))
      throw new TypeError('Cloud LOD needs volume, card, resolution, directions or cardYaw settings');
    const { volume=[1.35,2.4], card=[4.6,6.8], resolution=64, directions=8, cardYaw=0 } = descriptor;
    if (![volume,card].every(range=>Array.isArray(range)&&range.length===2&&
        Array.from(range).every(Number.isFinite)&&range[0]<range[1]) ||
        volume[0]<1 || volume[1]>card[0])
      throw new RangeError('Cloud LOD distance ranges must be ordered, with volume starting at a radius or farther');
    if (!Number.isInteger(resolution)||resolution<16||resolution>128||
        !Number.isInteger(directions)||directions<4||directions>16||!Number.isFinite(cardYaw))
      throw new RangeError('Cloud LOD needs 16–128 pixels, 4–16 headings, and a finite card yaw');
    const [nearFull,nearEnd]=volume, [farStart,farFull]=card;
    const center=min.map((x,i)=>x*.5+max[i]*.5);
    const radius=Math.hypot(...max.map((x,i)=>(x-min[i])*.5));
    const step=2*radius/steps;
    const tiles=new Map();

    function integrate(o,d,start,stop,out,cutRay,counters,shadow) {
      let first=start,last=stop;
      for (let i=0;i<3;i++) {
        if (Math.abs(d[i])<1e-10) {
          if (o[i]<min[i]||o[i]>max[i]) return false;
          continue;
        }
        const a=(min[i]-o[i])/d[i], b=(max[i]-o[i])/d[i];
        first=Math.max(first,Math.min(a,b));
        last=Math.min(last,Math.max(a,b));
      }
      if (!(last>first)) return false;
      const count=Math.min(steps,Math.max(3,Math.ceil((last-first)/step)));
      const length=(last-first)/count;
      let optical=0, from=last, to=first, shadowed=0;
      for (let i=0;i<count;i++) {
        const edge=first+i*length, t=edge+length*.5;
        const occupied=cutRay?.distance(edge,edge+length)??length;
        if (counters) counters.cloudSamples++;
        const x=o[0]+t*d[0], y=o[1]+t*d[1], z=o[2]+t*d[2];
        const mass=occupied*density(x,y,z);
        if (!mass) continue;
        // Weight direct-light loss by each sample's contribution to the camera.
        if (shadow) {
          const weight=Math.exp(-optical)*-Math.expm1(-mass);
          shadowed+=weight*shadow(x,y,z,counters);
        }
        optical+=mass;
        from=Math.min(from,t-length*.5);
        to=t+length*.5;
      }
      if (!optical) return false;
      out[0]=optical; out[1]=from; out[2]=to;
      if (shadow) out[3]=clamp(1-shadowed/-Math.expm1(-optical));
      return true;
    }

    // Sample extinction only along the part of the sun ray inside this cloud.
    function sunShadow(direction, {steps,distance,strength}, offset, cutouts) {
      const [dx,dy,dz]=direction;
      const limits=direction.map((d,i)=>d<0 ? min[i] : max[i]);
      const inverse=direction.map(d=>Math.abs(d)<1e-10 ? 0 : 1/d);
      return (x,y,z,counters) => {
        let reach=distance;
        if (inverse[0]) reach=Math.min(reach,(limits[0]-x)*inverse[0]);
        if (inverse[1]) reach=Math.min(reach,(limits[1]-y)*inverse[1]);
        if (inverse[2]) reach=Math.min(reach,(limits[2]-z)*inverse[2]);
        if (!(reach>0)) return 0;
        if (counters) counters.cloudShadowRays=(counters.cloudShadowRays ?? 0)+1;
        const step=reach/steps;
        let optical=0;
        for (let i=0;i<steps && optical<7;i++) {
          const t=(i+.5)*step, sx=x+t*dx, sy=y+t*dy, sz=z+t*dz;
          const gain=cutouts?.gain(sx+offset[0],sy+offset[1],sz+offset[2])??1;
          if (!gain) continue;
          if (counters) counters.cloudShadowSamples=(counters.cloudShadowSamples ?? 0)+1;
          optical+=step*density(sx,sy,sz)*gain;
        }
        return strength*-Math.expm1(-optical);
      };
    }

    function tile(key,yaw,pitch) {
      if (tiles.has(key)) return tiles.get(key);
      const {normal,right,up}=basis(yaw,pitch);
      const d=normal.map(n=>-n), origin=[0,0,0], hit=[0,0,0];
      const texture=new Float32Array(resolution*resolution*3);
      for (let j=0;j<resolution;j++) for (let i=0;i<resolution;i++) {
        const u=((i+.5)/resolution*2-1)*radius, v=((j+.5)/resolution*2-1)*radius;
        for (let c=0;c<3;c++) origin[c]=center[c]+normal[c]*radius+right[c]*u+up[c]*v;
        if (!integrate(origin,d,0,2*radius,hit)) continue;
        const index=(j*resolution+i)*3;
        texture[index]=hit[0];
        texture[index+1]=hit[0]*(hit[1]-radius);
        texture[index+2]=hit[0]*(hit[2]-radius);
      }
      tiles.set(key,texture);
      return texture;
    }

    function directional(yaw,pitch) {
      const a=((yaw/tau*directions)%directions+directions)%directions;
      const b=clamp((pitch+halfPi)/(Math.PI*.25),0,4);
      const az=Math.floor(a), elevation=Math.min(3,Math.floor(b));
      const atlas=[];
      for (let j=0;j<2;j++) for (let i=0;i<2;i++) {
        const heading=(az+i)%directions, height=elevation+j;
        const weight=(i?a-az:1-(a-az))*(j?b-elevation:1-(b-elevation));
        if (weight>0) atlas.push([tile(heading+'/'+height,heading*tau/directions,height*Math.PI*.25-halfPi),weight]);
      }
      return atlas;
    }

    function texel(texture,u,v,out) {
      const x=Math.floor(u), y=Math.floor(v), a=u-x, b=v-y;
      for (let c=0;c<3;c++) out[c]=0;
      for (let j=0;j<2;j++) for (let i=0;i<2;i++) {
        const ix=x+i, iy=y+j;
        if (ix<0||ix>=resolution||iy<0||iy>=resolution) continue;
        const index=(iy*resolution+ix)*3, scale=(i?a:1-a)*(j?b:1-b);
        for (let c=0;c<3;c++) out[c]+=texture[index+c]*scale;
      }
    }

    function view(eye,parallel,mode,offset,shade,opacity,cutouts,shadow) {
      const localEye=eye.map((x,i)=>x-offset[i]);
      const delta=localEye.map((x,i)=>x-center[i]);
      const distance=Math.hypot(...delta)/radius;
      const weightVolume = mode==='auto' ? 1-ease(nearFull,nearEnd,distance) : Number(mode==='volume');
      const weightCard = mode==='auto' ? ease(farStart,farFull,distance) : Number(mode==='card');
      const weightImpostor = 1-weightVolume-weightCard;
      const weights=Object.freeze({ card:weightCard,impostor:weightImpostor,volume:weightVolume });
      const [yaw,pitch]=angles(...(parallel??delta));
      const frame=(weightImpostor||weightCard) && basis(yaw,pitch);
      const atlas=weightImpostor ? directional(yaw,pitch) : [];
      const billboard=weightCard && tile('card',cardYaw,0);
      const local=[0,0,0], deltaOrigin=[0,0,0], hit=[0,0,0], sampled=[0,0,0], rgb=[0,0,0];
      // Camera reflections and the primary view each get their own scratch state and projection.
      function trace(origin,dir,start,stop,out,counters) {
        if (counters) counters.cloudTraces++;
        out[0]=out[1]=out[2]=0; out[3]=1;
        if (!(stop>start)) return out;
        for (let c=0;c<3;c++) {
          local[c]=origin[c]-offset[c];
          deltaOrigin[c]=center[c]-local[c];
        }
        const cutRay=cutouts?.ray(origin,dir,start,stop);
        const contribute=(optical,depth,weight,visibility) => {
          const alpha=opacity*weight*(-Math.expm1(-optical));
          shade(origin,dir,depth,optical,rgb,visibility);
          for (let c=0;c<3;c++) out[c]+=alpha*rgb[c];
          out[3]-=alpha;
        };
        if (weightVolume && integrate(local,dir,start,stop,hit,cutRay,counters,shadow))
          contribute(hit[0],(hit[1]+hit[2])*.5,weightVolume,hit[3]);
        if (!frame) return out;
        const d=-dot(dir,frame.normal);
        if (d<=1e-8) return out;
        const plane=-dot(deltaOrigin,frame.normal)/d;
        const u=(.5+.5*(plane*dot(dir,frame.right)-dot(deltaOrigin,frame.right))/radius)*resolution-.5;
        const v=(.5+.5*(plane*dot(dir,frame.up)-dot(deltaOrigin,frame.up))/radius)*resolution-.5;
        if (u<-1||v<-1||u>resolution||v>resolution) return out;
        const project=(texture,weight) => {
          texel(texture,u,v,sampled);
          if (!sampled[0]) return;
          const near=plane+sampled[1]/(sampled[0]*d), far=plane+sampled[2]/(sampled[0]*d);
          const lo=Math.max(start,near), hi=Math.min(stop,far);
          if (hi>lo) {
            const length=cutRay?.distance(lo,hi)??hi-lo;
            if (length>0) contribute(sampled[0]*length/((far-near)*d),(lo+hi)*.5,weight);
          }
        };
        if (billboard) project(billboard,weightCard);
        for (const [texture,weight] of atlas) project(texture,weight*weightImpostor);
        out[3]=clamp(out[3]);
        return out;
      }
      const card = weightCard === 1 ? { pixels:billboard, resolution, radius, ...frame,
        center:center.map((n,i)=>n+offset[i]), opacity } : null;
      return { weights, trace, card, horizon: origin => Math.hypot(...origin.map((x,i)=>x-offset[i]-center[i]))+radius };
    }
    return { view, sunShadow };
  }

  return Object.freeze({ compile, modes });
})();
if (typeof module !== 'undefined') module.exports = CloudDetail;
