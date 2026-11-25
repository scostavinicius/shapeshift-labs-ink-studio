/* Measure visible contact and audible attack from published media on a take clock. */
const fs=require('node:fs'), path=require('node:path');
const PNG=require('./png.js'), WAV=require('./wav.js'), {json}=require('./asset-files.js');
const {readTakePicture}=require('./take-picture.js');
const {measureAttacks}=require('./audio-attacks.js');

const format='ink-studio/delivered-sync-check', reportFormat='ink-studio/delivered-sync-report';
const maxFrame=1e9, maxWindow=720;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

function analyze(file,kit) {
  const P=kit.KIT.procedural, T=P.takeTime;
  const {fields,record,integer,finite,id,check}=P.musicInstruments;
  const recipe=path.resolve(file), spec=read(recipe), inputs=new Set([recipe]);
  const relative=file=>path.relative(path.dirname(recipe),file).split(path.sep).join('/');
  function source(owner,name) {
    check(typeof name==='string' && name.trim(),'Sync evidence needs a file path');
    const file=path.resolve(path.dirname(owner),name);
    inputs.add(file);
    return file;
  }
  check(fields(spec,['format','version','picture','stems','checks']) && spec.format===format && spec.version===1 &&
    Array.isArray(spec.checks) && integer(spec.checks.length,1,64),'Expected a version 1 delivered sync check');
  const stems=spec.stems ?? {};
  check(record(stems) && Object.entries(stems).length<=16 && Object.entries(stems).every(([name,row])=>
    id(name) && fields(row,['file','startSample']) && (row.startSample===undefined ||
      integer(row.startSample,0,Number.MAX_SAFE_INTEGER))),'Invalid sync stem table');

  const {rate,firstFrame,frames,exportAudio}=readTakePicture(spec.picture,recipe,kit,file=>inputs.add(file));
  const frameTime=frame=>T.div(T.read(frame),rate);
  let pixelWork=0, audioWork=0;
  const loadedStems=new Map();

  function raster(file) {
    check(fs.statSync(file).size<=64*1024*1024,'Sync PNG exceeds its input byte budget');
    const bytes=fs.readFileSync(file), {w,h}=PNG.layout(bytes);
    pixelWork+=w*h;
    check(pixelWork<=180e6,'Sync scan exceeds its decoded picture pixel budget');
    return PNG.raster(bytes);
  }
  function stem(name) {
    if (loadedStems.has(name)) return loadedStems.get(name);
    const row=Object.hasOwn(stems,name) ? stems[name] : name==='export' ? exportAudio : undefined;
    check(row,'Unknown sync stem '+name);
    const file=source(recipe,row.file), audio=WAV.read(file,{metadata:true});
    const startSample=row.startSample ?? Number(audio.bwf?.timeReference ?? 0);
    audioWork+=audio.samples.length;
    check(audioWork<=32e6 && integer(audio.sampleRate,8000,192000) && integer(audio.channels,1,8) &&
      integer(startSample,0,Number.MAX_SAFE_INTEGER-audio.samples.length/audio.channels),
    'Sync stems need bounded PCM, placement and a rate of 8 to 192 kHz');
    const value={audio,startSample,file};
    loadedStems.set(name,value);
    return value;
  }

  function pictureEvidence(settings,from,to) {
    const {region,separated,contact,holdFrames=1,maxError=.14}=settings;
    check(fields(settings,['region','separated','contact','holdFrames','maxError']) && Array.isArray(region) &&
      region.length===4 && region.every(n=>integer(n,0,16384)) && region[2]>0 && region[3]>0 &&
      region[2]*region[3]<=262144 && integer(holdFrames,1,12) && holdFrames<to-from && finite(maxError,.01,.5),
    'Invalid sync contact region, error limit, or confirmation length');
    const [x,y,w,h]=region;
    function crop(file) {
      const image=raster(file);
      check(x+w<=image.w && y+h<=image.h,'Sync contact crop is outside '+file);
      return image;
    }
    const low=crop(source(recipe,separated)), high=crop(source(recipe,contact));
    function color(image,dx,dy,out) {
      const i=((y+dy)*image.w+x+dx)*4, scale=1/image.max, a=image.data[i+3]*scale;
      out[0]=image.data[i]*scale*a;
      out[1]=image.data[i+1]*scale*a;
      out[2]=image.data[i+2]*scale*a;
      out[3]=a;
      return out;
    }
    function distance(a,b) {
      return Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]),Math.abs(a[3]-b[3]));
    }
    const points=[];
    let contrast=0;
    for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) {
      const a=color(low,dx,dy,[]), b=color(high,dx,dy,[]), difference=distance(a,b);
      if (difference<.09) continue;
      points.push({dx,dy,a,b});
      contrast+=difference;
    }
    check(points.length>=4,'Contact exemplars must differ by at least four visible pixels in the crop');
    let run=0, armed=false;
    const candidates=[], observations=[], rgba=[];
    for (let frame=from;frame<to;frame++) {
      const image=crop(frames[frame-firstFrame]);
      check(image.w===low.w && image.h===low.h && image.w===high.w && image.h===high.h,
        'Sync frames and contact exemplars need the same dimensions');
      let apart=0,touch=0;
      for (const {dx,dy,a,b} of points) {
        const rgb=color(image,dx,dy,rgba);
        apart+=distance(rgb,a);
        touch+=distance(rgb,b);
      }
      const separation=(apart-touch)/contrast;
      const state=touch/points.length<=maxError && separation>=.25 ? 'contact' :
        apart/points.length<=maxError && separation<=-.25 ? 'separated' : 'unreadable';
      observations.push({frame,state,separation,separatedError:apart/points.length,contactError:touch/points.length});
      if (state==='contact') {
        if (++run===holdFrames) {
          candidates.push({frame:frame-run+1,confirmedAt:frame,bracketed:armed});
          armed=false;
        }
      } else {
        if (state==='separated') armed=true;
        run=0;
      }
    }
    // An unreadable interruption does not establish a second contact.
    const events=candidates.filter((cue,i)=>i===0 || cue.bracketed);
    const hit=events.length===1 && events[0].bracketed ? events[0] : null;
    const status=hit ? 'measured' : !events.length ? 'unobserved' : events.length>1 ? 'ambiguous' : 'unbracketed';
    return {status,hit,candidates:events,changedPixels:points.length,observations};
  }

  function audioEvidence(settings,from,to) {
    const {stem:name,channel='all',minStrength=.035,minPeakDbFS=-42,minRiseDb=6}=settings;
    check(fields(settings,['stem','channel','minStrength','minPeakDbFS','minRiseDb']) && id(name) &&
      finite(minStrength,.000001,100) && finite(minPeakDbFS,-120,0) && finite(minRiseDb,0,60),
    'Invalid sync attack detector settings');
    const {audio,startSample,file}=stem(name), {sampleRate,channels}=audio;
    check(channel==='all' || channel==='mix' || integer(channel,0,channels-1),'Invalid sync detector channel');
    const rate=T.read(sampleRate);
    const ceilAt=frame=>-T.index(T.roundDown(T.mul(frameTime(frame),T.read(-sampleRate))));
    const low=ceilAt(from)-startSample, high=ceilAt(to)-startSample;
    const range={firstSample:low+startSample,endSample:high+startSample};
    const base={stem:name,file:relative(file),sampleRate,startSample,range};
    const {status,candidates:local}=measureAttacks(P.mediaGraph,audio,
      {from:low,to:high,channel,minStrength,minPeakDbFS,minRiseDb});
    const candidates=local.map(({sample:fileSample,...detail})=>{
      const sample=fileSample+startSample;
      return {sample,fileSample,seconds:T.seconds(T.div(T.read(sample),rate)),...detail};
    });
    return {...base,status,hit:candidates.length===1?candidates[0]:null,candidates};
  }

  const used=new Set();
  const checks=Array.from(spec.checks,row=>{
    check(fields(row,['id','window','scheduled','picture','audio','toleranceMs']) && id(row.id) && !used.has(row.id) &&
      fields(row.window,['from','to']) && integer(row.window.from,firstFrame,firstFrame+frames.length-2) &&
      integer(row.window.to,row.window.from+2,Math.min(firstFrame+frames.length,row.window.from+maxWindow)) &&
      record(row.picture) && record(row.audio) && finite(row.toleranceMs ?? 25,0,5000),'Invalid sync check or search window');
    used.add(row.id);
    const {from,to}=row.window, toleranceMs=row.toleranceMs ?? 25;
    const picture=pictureEvidence(row.picture,from,to), audio=audioEvidence(row.audio,from,to);
    const sampleTime=sample=>T.div(T.read(sample),T.read(audio.sampleRate));
    const ms=(sample,frame)=>T.mul(T.sub(sampleTime(sample),frameTime(frame)),T.read(1000));
    let scheduled;
    if (row.scheduled!==undefined) {
      const when=row.scheduled;
      check(fields(when,['frame','sample']) && integer(when.frame,0,maxFrame) &&
        integer(when.sample,0,Number.MAX_SAFE_INTEGER),'Scheduled sync comparison needs a picture frame and absolute stem sample');
      scheduled={...when,deltaMs:T.seconds(ms(when.sample,when.frame))};
    }
    let status='needs-review', deltaMs=null;
    if (picture.hit) {
      const {frame}=picture.hit, time=frameTime(frame);
      picture.hit={...picture.hit,file:relative(frames[frame-firstFrame]),timecode:T.pack(time),seconds:T.seconds(time)};
    }
    if (picture.hit && audio.hit) {
      const delta=ms(audio.hit.sample,picture.hit.frame), limit=T.read(toleranceMs);
      deltaMs=T.seconds(delta);
      status=T.compare(delta,limit)>0 ? 'audio-late' :
        T.compare(delta,T.read(-toleranceMs))<0 ? 'audio-early' : 'in-sync';
    }
    return {id:row.id,status,toleranceMs,deltaMs,...(scheduled && {scheduled}),window:{from,to},picture,audio};
  });
  const passed=checks.every(row=>row.status==='in-sync');
  return {report:{format:reportFormat,version:1,fps:T.pack(rate),firstFrame,passed,checks},inputs};
}

function command(file,opt,{kit}) {
  if (Object.keys(opt).some(key=>!['out','fail-on-flags'].includes(key)) ||
      opt.out!==undefined && (typeof opt.out!=='string' || !opt.out.trim()) ||
      opt['fail-on-flags']!==undefined && opt['fail-on-flags']!==true)
    throw new TypeError('Use take check-sync <recipe.json> [--out report.json] [--fail-on-flags]');
  const {report,inputs}=analyze(file,kit);
  if (opt.out!==undefined) {
    const filename=path.resolve(opt.out), stat=fs.statSync(filename,{throwIfNoEntry:false});
    if (inputs.has(filename) || stat && [...inputs].some(file=>{
      const source=fs.statSync(file,{throwIfNoEntry:false});
      return source?.dev===stat.dev && source?.ino===stat.ino;
    })) throw new RangeError('Sync report must use a separate file from its evidence');
    json(filename,report);
  } else process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if (opt['fail-on-flags'] && !report.passed) process.exitCode=2;
}

module.exports={analyze,command};
