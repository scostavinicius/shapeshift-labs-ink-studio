/* Calibrated sine-sweep deconvolution and complementary wet-only room layers. */
const InkRoomImpulseCapture=(()=>{
  const fft=typeof module==='object'&&module.exports?require('./fft.js'):globalThis[Symbol.for('ink-studio.fft')];
  const format='ink-studio/room-impulse-capture';
  const tau=2*Math.PI, unit=n=>Math.max(0,Math.min(1,n)), ease=n=>.5-.5*Math.cos(Math.PI*unit(n));
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const integer=(n,min,max)=>Number.isInteger(n)&&finite(n,min,max);
  const record=o=>o&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
  const fields=(o,keys)=>record(o)&&Object.keys(o).every(key=>keys.includes(key));
  const maxImpulse=rate=>Math.min(262144,rate*8);
  const rateOK=rate=>integer(rate,8000,96000);
  const frame=(ms,rate)=>Math.round(ms*rate/1000);
  const pcm=(sampleRate,channels,samples)=>({sampleRate,channels,samples});

  function sweep(options={}){
    if(!fields(options,['sampleRate','seconds','startHz','endHz','gain','lead','tail']))
      throw new TypeError('Unknown room sweep settings');
    const {sampleRate=48000,seconds=3,startHz=30,endHz=Math.min(20000,sampleRate*.46),gain=.2,lead=.25,tail=2}=options;
    if(!rateOK(sampleRate)||!finite(seconds,.5,5)||!finite(startHz,15,200)||!finite(endHz,Math.max(1000,8*startHz),sampleRate*.48)||
      !finite(gain,.005,.5)||!finite(lead,.1,1)||!finite(tail,.25,5))
      throw new RangeError('Invalid room sweep rate, frequency range, level or recording window');
    const start=Math.round(lead*sampleRate), length=Math.round(seconds*sampleRate), ring=Math.round(tail*sampleRate);
    if(start+length+ring+frame(25,sampleRate)>1048576)throw new RangeError('Room sweep exceeds the capture frame budget');
    const samples=new Float32Array(start+length+ring), fade=Math.round(.012*sampleRate);
    const k=Math.log(endHz/startHz)/length, phase=tau*startHz/sampleRate/k;
    for(let i=0;i<length;i++){
      const window=ease(Math.min(i,length-1-i)/fade);
      samples[start+i]=gain*window*Math.sin(phase*Math.expm1(k*i));
    }
    return {...pcm(sampleRate,1,samples),start,length,ring,settings:{sampleRate,seconds,startHz,endHz,gain,lead,tail}};
  }

  function validatePCM(input,rate,maxFrames,description,clip=false){
    if(!input||input.sampleRate!==rate||![1,2].includes(input.channels)||
      !(input.samples instanceof Float32Array||input.samples instanceof Float64Array)||
      !integer(input.samples.length/input.channels,1,maxFrames))
      throw new TypeError(description+' needs bounded mono or stereo PCM at the sweep sample rate');
    let peak=0;
    for(const n of input.samples){
      if(!finite(n,-1,1))throw new RangeError(description+' contains invalid PCM');
      peak=Math.max(peak,Math.abs(n));
    }
    if(clip&&peak>=.999)throw new RangeError(description+' clipped. Lower the input gain and record again');
    if(peak<1e-6)throw new RangeError(description+' is silent');
    return peak;
  }

  function deconvolver(stimulus,size){
    const transform=fft.axis(size), xr=new Float64Array(size), xi=xr.slice(), yr=xr.slice(), yi=xr.slice();
    xr.set(stimulus.samples.subarray(stimulus.start,stimulus.start+stimulus.length));
    transform(xr,xi,0,1,-1);
    const {sampleRate,settings:{startHz,endHz}}=stimulus;
    let maxPower=0;
    for(let i=0;i<size;i++)maxPower=Math.max(maxPower,xr[i]**2+xi[i]**2);
    for(let i=0;i<size;i++){
      const hz=Math.min(i,size-i)*sampleRate/size;
      const band=ease((hz-startHz)/(startHz*.35))*ease((endHz-hz)/(endHz*.09));
      const scale=band/(xr[i]**2+xi[i]**2+maxPower*1e-7);
      xr[i]*=scale;xi[i]*=-scale;
    }
    return function recover(input,channel,offset){
      yr.fill(0);yi.fill(0);
      for(let i=0;i<input.samples.length/input.channels;i++)yr[i]=input.samples[i*input.channels+channel];
      transform(yr,yi,0,1,-1);
      for(let i=0;i<size;i++){
        const a=yr[i], b=yi[i];
        yr[i]=a*xr[i]-b*xi[i];yi[i]=a*xi[i]+b*xr[i];
      }
      transform(yr,yi,0,1,1);
      return lag=>yr[(offset+lag+size)%size]/size;
    };
  }

  function peakAt(read,first,last){
    let at=first, peak=0, sum=0;
    for(let i=first;i<=last;i++){
      const n=Math.abs(read(i));
      sum+=n*n;
      if(n>peak){at=i;peak=n;}
    }
    return {at,peak,rms:Math.sqrt(sum/(last-first+1))};
  }

  function measure(room,{sweep:settings,loopback,latencySamples,recordingStart,loopbackStart,maxLatencyMs=250}={}){
    const stimulus=sweep(settings), {sampleRate,start,length,ring}=stimulus, channels=room?.channels;
    const roomStart=recordingStart??start, referenceStart=loopbackStart??start, maxLag=frame(maxLatencyMs,sampleRate);
    if(!finite(maxLatencyMs,5,500)||!integer(roomStart,0,sampleRate*2)||!integer(referenceStart,0,sampleRate*2)||
      (loopback===undefined ? !integer(latencySamples,0,maxLag) : latencySamples!==undefined))
      throw new RangeError('Supply a loopback recording or a known interface latency in samples and valid sweep offsets');
    const frames=room?.samples?.length/channels, referenceFrames=loopback?.samples?.length/loopback?.channels;
    const pad=frame(25,sampleRate), cap=Math.min(sampleRate*11,1048576-pad);
    const roomPeak=validatePCM(room,sampleRate,cap,'Room recording',true);
    if(frames<roomStart+length+frame(80,sampleRate))throw new RangeError('Room recording is missing the sweep end or its decay');
    if(loopback!==undefined){
      validatePCM(loopback,sampleRate,cap,'Loopback recording',true);
      if(referenceFrames<referenceStart+length+maxLag||loopback.channels!==1)
        throw new RangeError('Loopback needs one channel and the full calibration window');
    }
    const size=2**Math.ceil(Math.log2(Math.max(frames,referenceFrames||0)+pad));
    const recover=deconvolver(stimulus,size);
    let calibration;
    if(loopback!==undefined){
      const result=peakAt(recover(loopback,0,referenceStart),0,maxLag);
      if(result.at===maxLag||result.peak<Math.max(.0001,8*result.rms))
        throw new RangeError('No clear loopback peak inside the interface latency window');
      latencySamples=result.at;
      calibration=result.peak;
    }
    const available=Math.min(ring-latencySamples,frames-roomStart-length-latencySamples,maxImpulse(sampleRate));
    if(available<frame(80,sampleRate))throw new RangeError('Leave at least 80 ms for the room decay after interface latency');
    const samples=new Float32Array(available*channels);
    let recoveredPeak=0;
    for(let ch=0;ch<channels;ch++){
      const read=recover(room,ch,roomStart+latencySamples);
      for(let i=0;i<available;i++){
        const n=read(i);
        samples[i*channels+ch]=n;
        recoveredPeak=Math.max(recoveredPeak,Math.abs(n));
      }
    }
    const envelope=i=>channels===1?Math.abs(samples[i]):Math.max(Math.abs(samples[i*2]),Math.abs(samples[i*2+1]));
    const scan=peakAt(envelope,0,Math.min(available-1,frame(160,sampleRate)));
    if(scan.peak<Math.max(.00003,4*scan.rms))throw new RangeError('No clear direct arrival in the first 160 ms after latency correction');
    let directSample=scan.at;
    const threshold=Math.max(scan.peak*.18,4*scan.rms);
    for(let i=0;i<scan.at;i++)if(envelope(i)>=threshold&&envelope(i)>envelope(i+1)&&(i===0||envelope(i)>=envelope(i-1))){
      directSample=peakAt(envelope,i,Math.min(available-1,i+frame(.14,sampleRate))).at;
      break;
    }
    if(available-directSample<frame(20,sampleRate))throw new RangeError('Leave more decay after the direct arrival');
    const scale=Math.min(1,.98/recoveredPeak);
    if(scale<1)for(let i=0;i<samples.length;i++)samples[i]*=scale;
    const edit=defaultEdit(directSample,available,sampleRate);
    return {response:pcm(sampleRate,channels,samples),edit,report:{sampleRate,channels,frames:available,latencySamples,
      latencyMs:1000*latencySamples/sampleRate,calibration:loopback!==undefined?'loopback':'known',...(calibration!==undefined&&{loopbackPeak:calibration}),
      directSample,directMs:1000*directSample/sampleRate,recordingPeak:roomPeak,scale,sweep:stimulus.settings}};
  }

  function defaultEdit(directSample,count,rate){
    const usable=(count-directSample)*1000/rate;
    return {directSample,directEndMs:1.5,splitMs:Math.min(55,usable/2),crossfadeMs:Math.min(8,usable/5),
      lengthMs:1000*count/rate,endFadeMs:Math.min(35,usable/4)};
  }

  function split(response,edit){
    const {sampleRate,channels,samples}=response??{}, length=samples?.length/channels;
    if(!rateOK(sampleRate))throw new TypeError('Invalid captured impulse rate');
    validatePCM(response,sampleRate,maxImpulse(sampleRate),'Captured impulse');
    if(!fields(edit,['directSample','directEndMs','splitMs','crossfadeMs','lengthMs','endFadeMs']))
      throw new TypeError('Invalid room impulse edit');
    const {directSample,directEndMs,splitMs,crossfadeMs,lengthMs,endFadeMs}=edit;
    const end=frame(lengthMs,sampleRate), cut=directSample+frame(directEndMs,sampleRate), center=directSample+frame(splitMs,sampleRate);
    const half=frame(crossfadeMs/2,sampleRate), first=center-half, last=center+half, fade=frame(endFadeMs,sampleRate);
    if(!integer(directSample,0,length-1)||!finite(directEndMs,0,30)||!finite(splitMs,5,500)||
      !finite(crossfadeMs,0,100)||!finite(endFadeMs,0,1000)||!finite(lengthMs,5,8000)||
      !integer(end,last+1,length)||first<=cut||fade>=end-cut)
      throw new RangeError('Keep the early/tail crossfade between the direct-sound cut and the end of the impulse');
    const early=new Float32Array(last*channels), tail=new Float32Array(end*channels), wet=new Float32Array(end*channels);
    const attack=Math.max(1,frame(.5,sampleRate));
    for(let i=cut+1;i<end;i++){
      const level=ease((i-cut)/attack)*(fade?ease((end-1-i)/fade):1);
      const late=half?ease((i-first)/(last-first)):Number(i>=center);
      for(let ch=0;ch<channels;ch++){
        const n=i*channels+ch, value=samples[n]*level;
        if(i<last)early[n]=value*(1-late);
        tail[n]=value*late;
        wet[n]=value;
      }
    }
    return {early:pcm(sampleRate,channels,early),tail:pcm(sampleRate,channels,tail),wet:pcm(sampleRate,channels,wet)};
  }

  function mixSettings(options={}){
    if(!fields(options,['earlyGain','tailGain']))throw new TypeError('Invalid captured room levels');
    const {earlyGain=1,tailGain=1}=options;
    if(!finite(earlyGain,0,1)||!finite(tailGain,0,1))throw new RangeError('Captured room levels must be between zero and one');
    return {earlyGain,tailGain};
  }
  function level(layer,gain){
    return gain===1?layer:{...layer,samples:layer.samples.map(n=>n*gain)};
  }
  function asset(result,settings){
    return {format,version:1,response:'response.wav',edit:{...result.edit},measurement:{...result.report},probeMix:mixSettings(settings)};
  }
  return Object.freeze({format,sweep,measure,split,asset,mixSettings,level});
})();
if(typeof module==='object'&&module.exports)module.exports=InkRoomImpulseCapture;
else globalThis[Symbol.for('ink-studio.room-impulse-capture')]=InkRoomImpulseCapture;
