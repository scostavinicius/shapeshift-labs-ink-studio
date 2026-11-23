/* Record the same Web Audio player used for live preview on an exact sample grid. */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');

async function renderPreview(chrome,input){
  const root=path.resolve(__dirname,'../..'), directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-pinned-binaural-'));
  let finish, fail, timer, child;
  const result=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  const page=`<!doctype html><meta charset="utf-8"><script type="module">
    import {createSpatialAudioPlayer} from '/src/webgl/spatial-audio-player.mjs';
    import {decodeBinauralProfile} from '/src/webgl/spatial-binaural.mjs';
    const input=${JSON.stringify(input).replaceAll('<','\\u003c')};
    const send=body=>fetch('/report',{method:'POST',body:JSON.stringify(body)});
    try {
      const {rate,length,frames,source,channels=1,sources,profile,sha256,panning,smoothing=0,expectedStarts}=input;
      const context=new OfflineAudioContext(2,length,rate);
      let starts=0;
      if(expectedStarts!==undefined){
        const create=context.createBufferSource.bind(context);
        context.createBufferSource=()=>{
          const node=create(), start=node.start.bind(node);
          node.start=(...args)=>{starts++;return start(...args);};
          return node;
        };
      }
      function makeBuffer(samples,channels){
        const sound=context.createBuffer(channels,samples.length/channels,rate);
        for(let ch=0;ch<channels;ch++){
          const destination=sound.getChannelData(ch);
          for(let i=0;i<destination.length;i++)destination[i]=samples[i*channels+ch];
        }
        return sound;
      }
      const sound=source&&makeBuffer(source,channels), assets=new Map(Object.entries(sources??{})
        .map(([id,{samples,channels=1}])=>[id,makeBuffer(samples,channels)]));
      const binauralProfile=profile===undefined?undefined:
        await decodeBinauralProfile(new TextEncoder().encode(profile),{sha256});
      const player=createSpatialAudioPlayer(context,{resolveAsset:id=>assets.get(id)??sound,panning,smoothing});
      const update=frame=>player.update({...frame,binauralProfile});
      await update(frames[0]);
      const updates=frames.slice(1).map(frame=>context.suspend(frame.time).then(async()=>{
        try { await update(frame); } finally { await context.resume(); }
      }));
      const [audio]=await Promise.all([context.startRendering(),...updates]);
      if(expectedStarts!==undefined&&expectedStarts!==starts)throw Error('Expected '+expectedStarts+' audio starts, got '+starts);
      const buffer=new Float32Array(length*2);
      for(let ch=0;ch<2;ch++){
        const samples=audio.getChannelData(ch);
        for(let i=0;i<length;i++)buffer[i*2+ch]=samples[i];
      }
      const bytes=new Uint8Array(buffer.buffer), chunks=[];
      for(let i=0;i<bytes.length;i+=24576)chunks.push(String.fromCharCode(...bytes.subarray(i,i+24576)));
      player.dispose();
      await send({audio:btoa(chunks.join(''))});
    } catch(error) { await send({error:error.stack}); }
    </script>`;
  const server=http.createServer((req,res)=>{
    if(req.url==='/report'&&req.method==='POST'){
      let body='';
      req.setEncoding('utf8');
      req.on('data',chunk=>{body+=chunk;});
      req.on('end',()=>{
        try{const report=JSON.parse(body);res.end('ok');finish(report);}
        catch(error){res.writeHead(400).end();fail(error);}
      });
    }else if(req.url==='/')res.setHeader('content-type','text/html').end(page);
    else if(/^\/src\/(?:webgl\/)?[A-Za-z0-9_-]+\.m?js$/.test(req.url)){
      const file=path.join(root,req.url);
      if(fs.existsSync(file)){
        res.setHeader('content-type','application/javascript');
        fs.createReadStream(file).pipe(res);
      }else res.writeHead(404).end();
    }else res.writeHead(404).end();
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    child=spawn(chrome,['--headless','--no-first-run','--disable-background-networking',
      '--user-data-dir='+directory,'http://127.0.0.1:'+server.address().port],{stdio:'ignore'});
    child.once('error',fail);
    child.once('exit',code=>fail(Error('Preview browser exited with code '+code)));
    timer=setTimeout(()=>fail(Error('Timed out waiting for the spatial audio browser render')),25000);
    const {audio,error}=await result;
    if(error)throw Error(error);
    const bytes=Buffer.from(audio,'base64');
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
  }finally{
    clearTimeout(timer);
    if(child?.pid&&child.exitCode===null&&child.signalCode===null){
      const closed=new Promise(resolve=>child.once('exit',resolve));
      child.kill();await closed;
    }
    server.closeAllConnections();server.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
module.exports={renderPreview};
