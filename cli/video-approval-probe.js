/* Match decoded presentation timestamps without resampling or frame duplication. */
const {execFileSync} = require('node:child_process');
const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const check = (condition,message)=>{if (!condition) throw new RangeError(message);};
const unknown = ['unknown','unspecified',undefined];
const sdrTransfer = [...unknown,'bt709','smpte170m','smpte240m','iec61966-2-1','bt470m','bt470bg','gamma22','gamma28'];
const sdrPrimaries = [...unknown,'bt709','bt470m','bt470bg','smpte170m','smpte240m'];

function probe(file, executable, rate, count) {
  let result;
  try {
    result = JSON.parse(execFileSync(executable,['-v','error','-protocol_whitelist','file,pipe','-select_streams','v:0',
      '-show_entries','stream=codec_name,pix_fmt,width,height,sample_aspect_ratio,time_base,color_range,color_space,color_transfer,color_primaries:stream_disposition=attached_pic:stream_side_data=rotation:frame=best_effort_timestamp,width,height',
      '-show_streams','-show_frames','-of','json',file],{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));
  } catch (error) {
    throw Error('Delivery video probe failed. '+(error.stderr?.toString().trim()||error.message));
  }
  const stream = result.streams?.[0], frames = result.frames;
  check(stream&&Array.isArray(frames)&&frames.length>0&&!stream.disposition?.attached_pic,
    'Delivery needs a decodable first video track');
  const {width,height} = stream;
  check(integer(width,1,4096)&&integer(height,1,2160)&&width*height<=4200000,'Delivery raster exceeds the approval pixel budget');
  check(!stream.side_data_list?.some(row=>Number(row.rotation)!==0&&row.rotation!==undefined)&&
    [undefined,'N/A','0:1','1:1'].includes(stream.sample_aspect_ratio),
    'Delivery must use an unrotated square-pixel raster');
  check(sdrTransfer.includes(stream.color_transfer)&&sdrPrimaries.includes(stream.color_primaries)&&
    !/^bt2020|^ictcp/i.test(stream.color_space??''),'Video approval needs SDR delivery in the sRGB/Rec. 709 family');
  check(frames.length===count,'Delivery has '+frames.length+' decoded frames. The source window has '+count+'.');
  const timeBase = /^(\d{1,10})\/([1-9]\d{0,9})$/.exec(stream.time_base);
  check(timeBase&&BigInt(timeBase[1])>0n,'Delivery has no usable video time base');
  const tick=[BigInt(timeBase[1]),BigInt(timeBase[2])], [rn,rd]=rate;
  check(4n*tick[0]*rn<=tick[1]*rd,'Delivery timestamps are too coarse for the source frame rate');
  const first=frames[0].best_effort_timestamp;
  const timestamps = frames.map((frame,index)=>{
    const time=frame.best_effort_timestamp;
    check(Number.isSafeInteger(time)&&frame.width===width&&frame.height===height&&
      (index===0||time>frames[index-1].best_effort_timestamp),'Delivery has missing or repeated timestamps or a changing raster');
    const offset=BigInt(time)-BigInt(first);
    const error=offset*tick[0]*rn-BigInt(index)*rd*tick[1];
    check(error>=-tick[0]*rn&&error<=tick[0]*rn,'Delivery timing diverges at decoded frame '+index);
    return time;
  });
  return {width,height,timestamps,timeBase:stream.time_base,codec:stream.codec_name??null,pixelFormat:stream.pix_fmt??null,
    color:{range:stream.color_range??null,matrix:stream.color_space??null,
      transfer:stream.color_transfer??null,primaries:stream.color_primaries??null}};
}

module.exports = {probe};
