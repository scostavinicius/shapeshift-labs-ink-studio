/* Resolve a numbered take deliverable without touching its picture bytes. */
const fs=require('node:fs'), path=require('node:path');

function readTakePicture(value,owner,kit,onFile){
  const P=kit.KIT.procedural, T=P.takeTime, {fields,finite,integer,check}=P.musicInstruments;
  const maxFrames=12000, maxFrame=1e9;
  function source(owner,name){
    check(typeof name==='string' && name.trim(),'Take picture needs a file path');
    const file=path.resolve(path.dirname(owner),name);
    onFile?.(file);
    return file;
  }
  let fps, firstFrame, frames, exportAudio, hashes, cuts=[];
  if(typeof value==='string'){
    const manifest=source(owner,value), report=JSON.parse(fs.readFileSync(manifest,'utf8'));
    const av=report?.format==='ink-studio/audiovisual-export', clip=av ? report.picture : report;
    check(report?.version===1 && clip?.format==='ink-studio/graph-clip' && Array.isArray(clip.frames) &&
      integer(clip.frames.length,1,maxFrames) && clip.to===clip.from+clip.frames.length &&
      clip.frames.every((row,i)=>row?.frame===clip.from+i && typeof row.file==='string'),
    'Use a graph clip report or an audiovisual export with numbered picture frames');
    ({fps,from:firstFrame}=clip);
    frames=clip.frames.map(row=>source(manifest,row.file));
    hashes=clip.frames.map(row=>row.sha256);
    cuts=clip.frames.filter(row=>row.cut===true).map(row=>row.frame);
    if(av)exportAudio={file:source(manifest,report.audio?.file),startSample:report.audio?.startSample};
  }else{
    check(fields(value,['fps','firstFrame','frames']) && Array.isArray(value.frames) &&
      integer(value.frames.length,1,maxFrames),'Take picture needs numbered PNGs and a frame rate');
    fps=value.fps;
    firstFrame=value.firstFrame ?? 0;
    frames=Array.from(value.frames,name=>source(owner,name));
  }
  const rate=T.read(fps);
  check(finite(T.seconds(rate),1,240) && integer(firstFrame,0,maxFrame-frames.length),
    'Take picture needs 1 to 240 fps and a bounded first frame');
  return {fps,rate,firstFrame,frames,exportAudio,cuts,hashes};
}

module.exports={readTakePicture};
