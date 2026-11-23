/* Shared HRIR validation, head-relative interpolation and stereo FIR. */
const InkBinaural=(()=>{
  const format='ink-studio/binaural-profile', maxBytes=12*1024*1024;
  const compiled=new WeakSet(), radians=Math.PI/180;
  const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  const range=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&range(n,min,max);
  const fields=(row,allowed)=>row&&[Object.prototype,null].includes(Object.getPrototypeOf(row))&&
    Object.keys(row).every(key=>allowed.includes(key));
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=v=>{const d=Math.hypot(...v);return d ? v.map(n=>n/d) : [0,0,0];};
  function axis(azimuth,elevation){
    const a=azimuth*radians, e=elevation*radians, c=Math.cos(e);
    return [Math.sin(a)*c,Math.sin(e),Math.cos(a)*c];
  }
  function direction(listener,point){
    if(!listener||!point)return [0,0,1];
    const forward=norm(listener.forward), right=norm(cross(forward,listener.up)), up=cross(right,forward);
    const relative=norm(point.map((n,i)=>n-listener.position[i]));
    return dot(relative,relative)>0 ? [dot(relative,right),dot(relative,up),dot(relative,forward)] : [0,0,1];
  }
  function compile(raw){
    if(compiled.has(raw))return raw;
    if(!fields(raw,['format','version','id','sampleRate','directions','transition','credit','sha256'])||
      raw.format!==format||raw.version!==1||typeof raw.id!=='string'||!/^[-\w.]{1,128}$/.test(raw.id)||
      !integer(raw.sampleRate,8000,96000)||!Array.isArray(raw.directions)||!integer(raw.directions.length,1,1024)||
      !range(raw.transition??.012,0,.1)||raw.credit!==undefined&&(typeof raw.credit!=='string'||raw.credit.length>512)||
      raw.sha256!==undefined&&!hash(raw.sha256))throw new TypeError('Invalid binaural impulse profile');
    const axes=[], length=raw.directions[0]?.left?.length;
    if(!integer(length,1,512)||length*raw.directions.length>196608)
      throw new RangeError('Binaural impulse profile exceeds its PCM budget');
    const directions=Array.from(raw.directions,row=>{
      const valid=pcm=>Array.isArray(pcm)&&pcm.length===length&&Array.from(pcm).every(n=>range(n,-4,4));
      if(!fields(row,['azimuth','elevation','left','right'])||!range(row.azimuth,-180,180)||!range(row.elevation,-90,90)||
        !valid(row.left)||!valid(row.right)||!row.left.some(Boolean)&&!row.right.some(Boolean))
        throw new TypeError('Invalid binaural impulse direction or ear samples');
      const vector=axis(row.azimuth,row.elevation);
      if(axes.some(other=>dot(other,vector)>1-1e-10))throw new RangeError('Coincident binaural impulse directions');
      axes.push(vector);
      return Object.freeze({azimuth:row.azimuth,elevation:row.elevation,left:Object.freeze([...row.left]),right:Object.freeze([...row.right])});
    });
    const profile=Object.freeze({...raw,transition:raw.transition??.012,directions:Object.freeze(directions)});
    compiled.add(profile);
    return profile;
  }
  function decode(bytes,sha256){
    if(!bytes.byteLength||bytes.byteLength>maxBytes)throw new RangeError('Binaural profile exceeds its byte budget');
    return compile({...JSON.parse(new TextDecoder().decode(bytes)),sha256});
  }
  function describe(profile){
    const {id,sampleRate,directions,transition,sha256,credit}=profile;
    return {id,sampleRate,directions:directions.length,frames:directions[0].left.length,transition,
      ...(sha256&&{sha256}),...(credit&&{credit})};
  }
  const sinc=x=>Math.abs(x)<1e-9?1:Math.sin(Math.PI*x)/(Math.PI*x);
  function resample(pcm,step,length){
    if(step===1)return Float32Array.from(pcm);
    const output=new Float32Array(length), cutoff=Math.min(1,.94/step), radius=Math.min(48,Math.ceil(8/cutoff));
    for(let i=0;i<length;i++){
      const at=i*step, base=Math.floor(at);
      let sum=0, weight=0;
      for(let j=base-radius+1;j<=base+radius;j++){
        const x=j-at, w=sinc(x*cutoff)*sinc(x/radius);
        sum+=(pcm[j]??0)*w;
        weight+=w;
      }
      output[i]=sum/weight*step;
    }
    return output;
  }
  function prepare(profile,rate){
    if(!integer(rate,8000,192000))throw new RangeError('Invalid binaural render sample rate');
    const step=profile.sampleRate/rate, length=Math.ceil(profile.directions[0].left.length/step);
    if(length>1024)throw new RangeError('Resampled binaural impulse exceeds 1024 samples');
    const rows=profile.directions.map(({azimuth,elevation,left,right})=>({axis:axis(azimuth,elevation),
      left:resample(left,step,length),right:resample(right,step,length)}));
    function kernel(vector){
      const distances=new Float64Array(rows.length), smallest=[Infinity,Infinity,Infinity,Infinity];
      for(let i=0;i<rows.length;i++){
        const d=distances[i]=Math.max(0,2-2*dot(rows[i].axis,vector));
        if(d<1e-10||rows.length===1){const {left,right}=rows[i];return {left,right};}
        for(let j=0;j<4;j++)if(d<smallest[j]){smallest.splice(j,0,d);smallest.pop();break;}
      }
      // A compact radius beyond the fourth neighbor includes ties and fades entrants in continuously.
      const radius=Math.min(5,smallest[3]*1.25+.00001), left=new Float32Array(length), right=new Float32Array(length);
      let sum=0;
      for(let i=0;i<rows.length;i++){
        const d=distances[i];
        if(d>=radius)continue;
        const weight=((1-d/radius)/d)**2;
        sum+=weight;
        for(let n=0;n<length;n++){left[n]+=rows[i].left[n]*weight;right[n]+=rows[i].right[n]*weight;}
      }
      for(let n=0;n<length;n++){left[n]/=sum;right[n]/=sum;}
      return {left,right};
    }
    return {kernel,length,transition:Math.round(profile.transition*rate)};
  }
  function createFilter(initial,transition,rate){
    const length=initial.left.length, history=new Float32Array(length*2);
    const left=new Float32Array(length), right=new Float32Array(length), out=new Float32Array(2);
    let target=initial, remaining=0, head=0, low=0, alpha=1, lastCutoff;
    function set(kernel){
      if(transition){
        const t=1-remaining/transition;
        for(let i=0;i<length;i++){
          left[i]+=t*(target.left[i]-left[i]);
          right[i]+=t*(target.right[i]-right[i]);
        }
        remaining=transition;
      }
      target=kernel;
    }
    function process(sample,cutoff){
      if(lastCutoff!==cutoff){alpha=cutoff>=22000?1:1-Math.exp(-2*Math.PI*cutoff/rate);lastCutoff=cutoff;}
      low+=alpha*(sample-low);
      head=head?head-1:length-1;
      history[head]=history[head+length]=low;
      let l=0,r=0;
      if(remaining){
        const t=1-remaining--/transition;
        for(let i=0;i<length;i++){
          const input=history[head+i];
          l+=input*(left[i]+t*(target.left[i]-left[i]));
          r+=input*(right[i]+t*(target.right[i]-right[i]));
        }
      }else for(let i=0;i<length;i++){
        const input=history[head+i];
        l+=input*target.left[i];r+=input*target.right[i];
      }
      out[0]=l;out[1]=r;
      return out;
    }
    return {set,process};
  }
  return Object.freeze({format,maxBytes,hash,axis,direction,compile,decode,describe,prepare,createFilter});
})();
if (typeof module !== 'undefined') module.exports = InkBinaural;
else globalThis[Symbol.for('ink-studio.binaural-profile')] = InkBinaural;
