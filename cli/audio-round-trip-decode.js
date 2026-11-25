/* Decode the selected delivery audio to its native floating-point sample grid. */
const {execFileSync} = require('node:child_process');
const {decodeFloatAudio} = require('./patch-media.js');

const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const check = (condition,message)=>{if (!condition) throw new RangeError(message);};
const maxSamples = 12000000;

function probe(file,executable,track) {
  let result;
  try {
    result=JSON.parse(execFileSync(executable,['-v','error','-protocol_whitelist','file,pipe',
      '-select_streams','a:'+track,'-show_streams','-show_frames','-show_packets','-show_format',
      '-show_entries','stream=index,codec_name,time_base,start_pts,sample_rate,channels:format=format_name:packet=pts,duration:packet_side_data=skip_samples,discard_padding:frame=best_effort_timestamp,nb_samples,duration,pkt_duration,channels,sample_rate',
      '-of','json',file],{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}));
  } catch (error) {
    throw Error('Delivery audio probe failed. '+(error.stderr?.toString().trim()||error.message));
  }
  const stream=result.streams?.[0], rows=result.packets_and_frames;
  check(stream&&Array.isArray(rows)&&rows.length>0&&typeof stream.codec_name==='string',
    'Delivery needs a decodable audio track at the selected index');
  const sampleRate=Number(stream.sample_rate), {channels}=stream;
  check(integer(sampleRate,8000,192000)&&integer(channels,1,8),'Delivery needs 1–8 channels at 8000–192000 Hz');
  const timeBase=/^([1-9]\d{0,9})\/([1-9]\d{0,9})$/.exec(stream.time_base);
  check(timeBase,'Delivery audio has no usable time base');
  const ns=BigInt(timeBase[1])*BigInt(sampleRate), ds=BigInt(timeBase[2]);
  const packets=rows.filter(row=>row.type==='packet'), frames=rows.filter(row=>row.type==='frame');
  check(frames.length>0&&packets.length>0,'Delivery track contains no playable audio');
  const first=frames[0].best_effort_timestamp, last=frames.at(-1), lastPacket=packets.at(-1);
  let decodedFrames=0, skipSamples=0, discardPadding=0;
  for (const row of frames) {
    const pts=row.best_effort_timestamp;
    check(integer(row.nb_samples,1,maxSamples)&&(row.channels===undefined||row.channels===channels)&&
      (row.sample_rate===undefined||Number(row.sample_rate)===sampleRate)&&Number.isSafeInteger(pts),
    'Delivery audio has missing timestamps or a changing sample grid');
    const drift=(BigInt(pts)-BigInt(first))*ns-BigInt(decodedFrames)*ds;
    check(drift>=-ns&&drift<=ns,'Delivery audio has a timestamp gap or overlap at decoded sample '+decodedFrames);
    decodedFrames+=row.nb_samples;
    check(decodedFrames*channels<=maxSamples,'Delivery exceeds the approval sample budget');
  }
  for (const packet of packets) for (const side of packet.side_data_list??[]) {
    const head=side.skip_samples??0, tail=side.discard_padding??0;
    check(integer(head,0,maxSamples)&&integer(tail,0,maxSamples),'Invalid encoder skip or padding metadata');
    skipSamples+=head; discardPadding+=tail;
  }

  // Codec priming and explicit discard padding are handled by the decoder.
  // Some containers shorten the last packet without marking its padding.
  const duration=last.duration??last.pkt_duration, packetDuration=lastPacket.duration;
  let timestampPadding=0;
  if (ns<=ds&&integer(duration,1,Number.MAX_SAFE_INTEGER)&&integer(packetDuration,1,Number.MAX_SAFE_INTEGER)&&
      Number.isSafeInteger(lastPacket.pts)) {
    const end=BigInt(last.best_effort_timestamp)+BigInt(duration);
    if (end===BigInt(lastPacket.pts)+BigInt(packetDuration)) {
      const span=BigInt(duration)*ns;
      if (span%ds===0n&&span/ds<BigInt(last.nb_samples)) timestampPadding=last.nb_samples-Number(span/ds);
    }
  }
  return {streamIndex:stream.index,audioTrack:track,codec:stream.codec_name,container:result.format?.format_name??null,
    sampleRate,channels,timeBase:stream.time_base,firstPts:first,lastPts:last.best_effort_timestamp,decodedFrames,
    packetSkipSamples:skipSamples,packetDiscardPadding:discardPadding,timestampPadding};
}

async function decode(file,track,trim,{ffmpeg='ffmpeg',ffprobe='ffprobe'}={}) {
  const info=probe(file,ffprobe,track);
  const samples=await decodeFloatAudio(file,{track,executable:ffmpeg,maxSamples:info.decodedFrames*info.channels});
  check(samples.length===info.decodedFrames*info.channels,'Decoded audio length differs from its probed sample grid');
  const {leading,trailing}=trim, stop=info.decodedFrames-info.timestampPadding-trailing;
  check(stop>leading,'Padding and additional trim remove the entire delivery audio');
  return {sampleRate:info.sampleRate,channels:info.channels,
    samples:samples.subarray(leading*info.channels,stop*info.channels),
    info:{...info,additionalTrim:{leading,trailing},playableFrames:stop-leading}};
}

module.exports = {decode,maxSamples};
