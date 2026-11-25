/* Print the same picture and sound streams into isolated or combined excerpts. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PNG = require('./png.js');
const WAV = require('./wav.js');
const { readTakePicture } = require('./take-picture.js');

const supportedRates = [8000,11025,12000,16000,22050,24000,32000,44100,48000,64000,88200,96000];
const integer = (value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const MB = 1024*1024;
const check = (condition,message)=>{ if (!condition) throw new RangeError(message); };

function print(raw, owner, kit, directory, ffmpeg) {
  const {rate,fps,firstFrame,frames,exportAudio} = readTakePicture(raw.picture,owner,kit);
  const T = kit.KIT.procedural.takeTime;
  const [numerator,denominator] = rate;
  check(numerator<=2147483647n&&denominator<=2147483647n,'The review frame rate exceeds the video encoder precision');
  const from = raw.window?.from??firstFrame, to = raw.window?.to??firstFrame+frames.length;
  check(integer(from,firstFrame,firstFrame+frames.length-1)&&integer(to,from+1,firstFrame+frames.length)&&
    to-from<=720&&(to-from)/T.seconds(rate)<=30,'Choose a review excerpt up to 720 frames and 30 seconds');
  check(!raw.audio||!exportAudio,'Use the native export audio or supply picture frames and a WAV');
  const audio = raw.audio
    ? {file:path.resolve(path.dirname(owner),raw.audio.file),startSample:raw.audio.startSample} : exportAudio;
  check(audio,'The review needs a WAV or an audiovisual export with sound');
  const {size} = fs.statSync(audio.file);
  check(size<=64*MB,'The review source WAV exceeds 64 MiB');
  const pcm = WAV.read(audio.file);
  const {sampleRate,channels} = pcm;
  check(supportedRates.includes(sampleRate)&&integer(channels,1,2),'Review WAV needs mono or stereo at an AAC sample rate');
  // MP4 edit lists use a movie timescale. Keep both frame and sample boundaries
  // exact when the AAC encoder's priming and final padding are trimmed.
  const audioRate = BigInt(sampleRate);
  let gcd = numerator, divisor = audioRate;
  while (divisor) [gcd,divisor] = [divisor,gcd%divisor];
  const timescale = numerator/gcd*audioRate;
  check(timescale<=2147483647n,'Use a standard exact frame rate for a sample-aligned MP4 review');
  const container = ['-map_metadata','-1','-movie_timescale',String(timescale),'-movflags','+faststart'];
  const clock = kit.KIT.timeDomains.take({fps,sampleRate});
  const firstSample = clock.at(from).firstSample, endSample = clock.at(to).firstSample;
  const audioStart = audio.startSample??clock.at(firstFrame).firstSample;
  check(integer(audioStart,0,Number.MAX_SAFE_INTEGER)&&audioStart<=firstSample&&endSample-audioStart<=pcm.samples.length/channels,
    'The WAV must cover the entire review window on the picture clock');
  const samples = pcm.samples.subarray((firstSample-audioStart)*channels,(endSample-audioStart)*channels);
  for (const sample of samples) check(Number.isFinite(sample)&&Math.abs(sample)<=1,'Review PCM exceeds full scale');
  const scratch = fs.mkdtempSync(path.join(directory,'.encoding-'));
  function encode(args) {
    const result = spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe',
      ...args],{encoding:'utf8',maxBuffer:1024*1024});
    if (result.status!==0) throw new Error('Review media encoding failed. '+(result.error?.message??result.stderr.trim()));
  }
  try {
    let dimensions, total = 0;
    for (let frame=from;frame<to;frame++) {
      const file = frames[frame-firstFrame], size = fs.statSync(file).size;
      total += size;
      check(size<=8*MB&&total<=256*MB,'The review PNGs exceed their size budget');
      const bytes = fs.readFileSync(file), {w,h} = PNG.layout(bytes);
      dimensions ??= {w,h};
      check(w<=1920&&h<=1080&&w===dimensions.w&&h===dimensions.h,
        'Review frames must use a fixed raster within 1920 by 1080');
      fs.writeFileSync(path.join(scratch,String(frame-from).padStart(4,'0')+'.png'),bytes);
    }
    const video = path.join(scratch,'picture.mp4'), wave = path.join(scratch,'window.wav');
    const sound = path.join(scratch,'sound.m4a'), both = path.join(scratch,'combined.mp4');
    fs.writeFileSync(wave,WAV.encode({...pcm,samples},{encoding:'pcm24'}));
    encode(['-framerate',numerator+'/'+denominator,'-start_number','0','-i',path.join(scratch,'%04d.png'),
      '-map','0:v:0','-an','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-crf','17',
      '-pix_fmt','yuv420p','-threads','1',...container,video]);
    encode(['-i',wave,'-map','0:a:0','-vn','-c:a','aac','-b:a',channels===1?'128k':'192k',
      ...container,sound]);
    encode(['-i',video,'-i',sound,'-map','0:v:0','-map','1:a:0','-c','copy',
      ...container,both]);
    const media = {};
    for (const [mode,file] of [['picture',video],['sound',sound],['combined',both]]) {
      check(fs.statSync(file).size<=8*MB,'A review excerpt exceeds the 8 MiB browser limit');
      media[mode] = fs.readFileSync(file).toString('base64');
    }
    return {media,window:{from,to,fps:T.pack(rate),firstSample,endSample,sampleRate,seconds:(to-from)/T.seconds(rate)}};
  } finally {
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}

module.exports = {print};
