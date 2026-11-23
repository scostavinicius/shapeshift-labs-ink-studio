/* Bake finite impulse responses and fit damped sinusoidal modes to measured samples. */
(function(K){
  const W=K.world, {check,endpoint,own}=W.data, finite=Number.isFinite;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const maxSamples=65536, tau=2*Math.PI;
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  const list=v=>Array.isArray(v)||ArrayBuffer.isView(v)&&typeof v.length==='number';

  function shape(source){
    const {sampleRate,samples}=source??{};
    check(finite(sampleRate)&&sampleRate>=1&&sampleRate<=768000&&list(samples)&&integer(samples.length,1,maxSamples)&&
      Array.from(samples).every(value=>finite(value)&&Math.abs(value)<=1e100),'Expected a bounded mono sampled response');
    return {sampleRate,samples};
  }

  function range(a,count,min=1,max=maxSamples){
    check(Array.isArray(a)&&a.length===2&&integer(a[0],0,count-1)&&integer(a[1],a[0]+min,count)&&a[1]-a[0]<=max,
      'Invalid reduction sample interval');
    return a.slice();
  }

  function heldOut(input,fit,count){
    const validation=range(input,count);
    check(validation[0]>=fit[1],'Reduction validation must follow the fit interval');
    return validation;
  }

  function compare(samples,candidate,[start,end]){
    let sum=0,energy=0,peak=0;
    for(let i=start;i<end;i++){
      const actual=samples[i], error=actual-candidate[i];
      sum+=error**2;
      energy+=actual**2;
      peak=Math.max(peak,Math.abs(error));
    }
    check(finite(sum)&&finite(energy),'Response error exceeded numeric range');
    return {samples:end-start,rmse:Math.sqrt(sum/(end-start)),peakError:peak,
      relativeRMSE:energy>0?Math.sqrt(sum/energy):null};
  }

  function render(asset,{samples=asset?.sampleCount}={}){
    check(['response','modes'].includes(asset?.kind)&&integer(samples,1,maxSamples)&&
      finite(asset.sampleRate)&&asset.sampleRate>0&&integer(asset.startSample,0,maxSamples-1),'Invalid reduced response');
    const out=new Float64Array(samples);
    if(asset.kind==='response'){
      check(Array.isArray(asset.taps)&&asset.taps.length<=maxSamples-asset.startSample&&asset.taps.every(finite),'Invalid response taps');
      if(samples>asset.startSample)out.set(asset.taps.slice(0,samples-asset.startSample),asset.startSample);
    }else{
      check(Array.isArray(asset.modes)&&asset.modes.length<=12,'Invalid reduced modal bank');
      for(const mode of asset.modes){
        check([mode.hz,mode.decay,mode.cosine,mode.sine].every(finite)&&mode.hz>0&&mode.hz<asset.sampleRate/2&&mode.decay>=0,
          'Invalid damped mode');
        oscillator(mode.hz,mode.decay,asset.sampleRate,Math.max(0,samples-asset.startSample),(i,x,y)=>{
          out[i+asset.startSample]+=mode.cosine*x+mode.sine*y;
        });
      }
    }
    check(out.every(finite),'Reduced response exceeded numeric range');
    return out;
  }

  function evidence(source,asset,fit,validation){
    const candidate=render(asset);
    const full=[0,source.samples.length];
    return {range:{fitSamples:fit,fitSeconds:fit.map(n=>n/source.sampleRate),
      ...(validation&&{validationSamples:validation,validationSeconds:validation.map(n=>n/source.sampleRate)})},
      error:{fit:compare(source.samples,candidate,fit),full:compare(source.samples,candidate,full),
        ...(validation&&{validation:compare(source.samples,candidate,validation)})}};
  }

  function impulse(raw,{fit,validation,fadeSamples=0}={}){
    const source=shape(raw), {samples,sampleRate}=source;
    const placed=range(fit??[0,samples.length],samples.length);
    if(validation!==undefined)validation=heldOut(validation,placed,samples.length);
    const width=placed[1]-placed[0];
    check(integer(fadeSamples,0,width),'Invalid response fade length');
    const taps=Array.from(Array.prototype.slice.call(samples,...placed),(value,i)=>
      !fadeSamples||i<width-fadeSamples?value:value*(width-1-i)/fadeSamples);
    const asset={kind:'response',sampleRate,sampleCount:samples.length,startSample:placed[0],taps};
    return {...asset,fadeSamples,...evidence(source,asset,placed,validation)};
  }

  function oscillator(hz,decay,rate,count,visit){
    const phase=tau*hz/rate, envelope=Math.exp(-decay/rate);
    const re=Math.cos(phase)*envelope, im=Math.sin(phase)*envelope;
    let x=1,y=0;
    for(let i=0;i<count;i++){
      visit(i,x,y);
      const cosine=re*x-im*y;
      y=im*x+re*y;
      x=cosine;
    }
  }

  function projection(samples,hz,decay,sampleRate){
    let xx=0, xy=0, yy=0, bx=0, by=0;
    oscillator(hz,decay,sampleRate,samples.length,(i,x,y)=>{
      xx+=x*x; xy+=x*y; yy+=y*y;
      bx+=x*samples[i]; by+=y*samples[i];
    });
    const determinant=xx*yy-xy*xy;
    if(!(determinant>1e-12*xx*yy))return {hz,decay,cosine:0,sine:0,score:0};
    const cosine=(yy*bx-xy*by)/determinant,sine=(xx*by-xy*bx)/determinant;
    return {hz,decay,cosine,sine,score:Math.max(0,bx*cosine+by*sine)};
  }

  function seed(samples,sampleRate,band){
    const size=2**Math.ceil(Math.log2(samples.length*2)), transform=InkFFT.axis(size);
    const re=new Float64Array(size), im=new Float64Array(size);
    for(let i=0;i<samples.length;i++)re[i]=samples[i]*(0.5-0.5*Math.cos(tau*i/(samples.length-1)));
    transform(re,im,0,1,-1);
    const spacing=sampleRate/size, first=Math.max(1,Math.ceil(band[0]/spacing));
    const last=Math.min(size/2-1,Math.floor(band[1]/spacing));
    if(first>last)return (band[0]+band[1])/2;
    let hz=first,best=-1;
    for(let i=first;i<=last;i++){
      const power=re[i]**2+im[i]**2;
      if(power>best){best=power;hz=i;}
    }
    return hz*spacing;
  }

  function scan(samples,rate,band,decays,center,frequencyStep,decayStep,first){
    let best=projection(samples,center.hz,center.decay,rate);
    const duration=samples.length/rate;
    if(first)for(const d of [decays[0],2/duration,8/duration,32/duration,decays[1]])for(const f of [-1,0,1]){
      const row=projection(samples,clamp(center.hz+f*frequencyStep,...band),clamp(d,...decays),rate);
      if(row.score>best.score)best=row;
    }
    let stepHz=frequencyStep,stepDecay=decayStep;
    for(let i=0;i<13;i++){
      const current=best;
      for(const df of [-1,0,1])for(const dd of [-1,0,1]){
        if(!df&&!dd)continue;
        const f=clamp(current.hz+df*stepHz,...band), d=clamp(current.decay+dd*stepDecay,...decays);
        if(f===current.hz&&d===current.decay)continue;
        const row=projection(samples,f,d,rate);
        if(row.score>best.score)best=row;
      }
      stepHz*=0.59;stepDecay*=0.64;
    }
    return best;
  }

  function modes(raw,{fit,validation,band,decay=[0,800],maxModes=6}={}){
    const source=shape(raw), {samples,sampleRate}=source;
    const placement=range(fit??[0,Math.min(samples.length,16384)],samples.length,32,16384);
    if(validation!==undefined)validation=heldOut(validation,placement,samples.length);
    band??=[Math.max(0.01,sampleRate/(placement[1]-placement[0])),sampleRate*0.49];
    check(Array.isArray(band)&&band.length===2&&band.every(finite)&&band[0]>0&&band[1]>band[0]&&band[1]<sampleRate/2&&
      Array.isArray(decay)&&decay.length===2&&decay.every(finite)&&decay[0]>=0&&decay[1]>=decay[0]&&decay[1]<=1e5&&
      integer(maxModes,1,12),'Invalid modal fitting band, decay limits, or rank');
    const residual=Float64Array.from(Array.prototype.slice.call(samples,...placement));
    let peak=0;
    for(const value of residual)peak=Math.max(peak,Math.abs(value));
    const selected=[], width=residual.length;
    const apply=(row,sign)=>oscillator(row.hz,row.decay,sampleRate,width,(i,x,y)=>{
      residual[i]+=sign*(row.cosine*x+row.sine*y);
    });
    if(peak>0){
      for(let i=0;i<width;i++)residual[i]/=peak;
      const hz=sampleRate/width;
      for(let i=0;i<maxModes;i++){
        const guess={hz:seed(residual,sampleRate,band),decay:clamp(2*hz,...decay)};
        const mode=scan(residual,sampleRate,band,decay,guess,hz*0.58,Math.min(8*hz,(decay[1]-decay[0])/4),true);
        if(mode.score<width*1e-14)break;
        selected.push(mode);
        apply(mode,-1);
      }
      for(let pass=0;pass<2;pass++)for(let i=0;i<selected.length;i++){
        const mode=selected[i];
        apply(mode,1);
        selected[i]=scan(residual,sampleRate,band,decay,mode,hz*0.28,Math.min(4*hz,(decay[1]-decay[0])/8),false);
        apply(selected[i],-1);
      }
    }
    const asset={kind:'modes',sampleRate,startSample:placement[0],sampleCount:samples.length,
      modes:selected.sort((a,b)=>a.hz-b.hz).map(({hz,decay,cosine,sine})=>({hz,decay,cosine:cosine*peak,sine:sine*peak}))};
    const measured=evidence(source,asset,placement,validation);
    return {...asset,range:{...measured.range,bandHz:band.slice(),decayPerSecond:decay.slice()},error:measured.error};
  }

  function capture(model,{input,output,samples,baseline=0,amplitude=1}={}){
    check(typeof input==='string'&&typeof output==='string'&&integer(samples,1,16384)&&finite(baseline)&&
      finite(amplitude)&&baseline+amplitude!==baseline&&finite(baseline+amplitude),'Invalid response capture');
    const forced=W.runtime.create(model), quiet=forced.fork(), {world}=forced.view();
    const aliases=world.simulationModel;
    const source=aliases&&own(aliases.inputs,input)?aliases.inputs[input]:input;
    const target=aliases&&own(aliases.outputs,output)?aliases.outputs[output]:output;
    const [a,b]=endpoint(source), [c,d]=endpoint(target), ports=forced.composition().systems;
    check(ports[a]?.reads.inputs[b]?.type==='number'&&ports[c]?.writes.outputs[d]?.type==='number',
      'Response capture needs numeric model ports');
    check(!forced.checkpoint().pending.some(row=>row.action==='world/input'&&row.args.port===source),
      'Response capture input already has authored commands');
    function level(run,value,tick){
      run.schedule([{tick,action:'world/input',args:{port:source,value}}]);
    }
    level(quiet,baseline,1);
    level(forced,baseline+amplitude,1);
    if(samples>1)level(forced,baseline,2);
    const values=Array.from({length:samples},()=>{
      forced.step();
      quiet.step();
      return (forced.view().signals[target]-quiet.view().signals[target])/amplitude;
    });
    return {...shape({sampleRate:1/world.dt,samples:values}),
      origin:{id:world.id,revision:aliases?.revision??1,seed:world.seed,input:source,output:target,baseline,amplitude}};
  }

  W.reducedResponses=Object.freeze({impulse,modes,render,capture});
})(KIT);
