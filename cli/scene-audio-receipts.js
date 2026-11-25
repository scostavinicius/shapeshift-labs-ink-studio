/* Playback evidence collected on the absolute scene sample grid. */
const {playbackStart}=require('./scene-audio-mix.js');
const {direction}=require('../src/directional-captions.js');

const format='ink-studio/audio-playback-receipts';
function positionAt(track,sample,fallback) {
  const points=track?.points;
  if (!points?.length) return fallback;
  const index=indexAt(points,sample);
  const a=points[index], b=points[index+1];
  if (!a?.position || !b?.position) return a?.position ?? b?.position ?? fallback;
  const progress=(sample-a.sample)/(b.sample-a.sample);
  return a.position.map((value,k)=>value+(b.position[k]-value)*progress);
}
function indexAt(points,sample) {
  let first=0, end=points.length;
  while (first<end) {
    const middle=(first+end)>>1;
    if (points[middle].sample<=sample) first=middle+1;
    else end=middle;
  }
  return first-1;
}
function arrival(track,sample,earPath) {
  const points=track?.points??[], index=indexAt(points,sample);
  const a=points[index], b=points[index+1], active=a?.gain>0?a:b??a;
  const aggregate=track?.aggregationMember;
  let at=aggregate?.position??active?.apparentSource??null;
  if (!aggregate&&a?.apparentSource&&b?.apparentSource&&a.opening===b.opening&&a.sample<=sample) {
    const fraction=(sample-a.sample)/(b.sample-a.sample);
    at=a.apparentSource.map((value,k)=>value+(b.apparentSource[k]-value)*fraction);
  }
  const ear=earPath&&earPath[indexAt(earPath,sample)]?.ear;
  return {sample,direction:direction(at,ear),opening:aggregate ? null : active?.opening??null};
}
function createPlaybackReceipts({sampleRate,start=0,end,post,earPath}) {
  const candidates=[];
  function add(source,{cue,asset,stem,bus,requestedSample,plannedSample,observedSample,
    voice,track,audit,reason,placed}) {
    if (!source?.beatId || requestedSample>=end) return;
    if (candidates.length>=16384) throw new RangeError('Story audio exceeds its playback receipt budget');
    const selection=voice?.selection;
    const receipt={
      beatId:source.beatId,cue,asset,requestedSample,plannedSample,observedSample,
      bus:post ? bus ?? (stem==='music' ? 'music' : 'effects') : stem,
      variant:selection ? {family:selection.family,take:selection.take,binding:selection.binding,rule:selection.rule,
        ...(selection.layer && {layer:selection.layer.at}),...selection.variation} : null,
      spatialSource:voice?.sourceAt===undefined && !voice?.position ? null : {
        selector:voice.sourceAt ?? null,position:voice.position ?? null,
        apparentSource:voice.apparentSource ?? voice.position ?? null
      }
    };
    candidates.push({receipt,track,audit,reason,placed});
  }
  function finish(resolve,gain) {
    return candidates.map(({receipt,track,audit,reason,placed})=>{
      const {plannedSample}=receipt, allocation=audit?.voiceBudget;
      let actualSample=null, outcome, audio;
      if (plannedSample>=end) {
        outcome='outside-window';
        reason='past-render-end';
      } else if (allocation?.action==='dropped') {
        outcome='dropped';
        reason=allocation.reason;
      } else if (reason) {
        outcome=reason==='outside-production-window' ? 'outside-window' :
          ['unavailable','out-of-range','blocked','zero-gain'].includes(reason) ? 'muted' : 'dropped';
      } else if (!gain) {
        outcome='muted';
        reason='zero-gain';
      } else {
        if (placed) actualSample=plannedSample;
        else if (track?.aggregationMember?.end>track?.aggregationMember?.start) actualSample=track.aggregationMember.start;
        else if (track) actualSample=playbackStart(track,audio=resolve(track.asset),sampleRate,end);
        if (actualSample===null) {
          outcome='muted';
          reason=track && (track.gain===0 || track.points?.length && track.points.every(point=>point.gain===0)) ?
            'zero-gain' : 'no-playable-samples';
        } else outcome=actualSample>plannedSample ? 'late' : 'played';
      }
      const spatialSource=receipt.spatialSource && {...receipt.spatialSource,
        ...(actualSample!==null && {actualPosition:track?.aggregationMember?.position??positionAt(track,actualSample,receipt.spatialSource.position)})};
      let printed=actualSample;
      if (printed!==null&&printed<start) {
        const aggregate=track?.aggregationMember;
        printed=aggregate ? aggregate.end>start ? start : null :
          audio ? playbackStart(track,audio,sampleRate,end,start) : null;
      }
      const result={...receipt,...(printed!==null&&{caption:arrival(track,printed,earPath)}),...(post&&track?.aggregationMember&&{bus:track.aggregationMember.bus}),spatialSource,actualSample,lateBySamples:actualSample===null ? null : actualSample-plannedSample,outcome,
        ...(reason && {reason}),...(allocation && {voiceBudget:allocation})};
      if (audit) {
        const {beatId,cue,asset,...evidence}=result;
        audit.playback=evidence;
      }
      return result;
    });
  }
  return {add,finish};
}

module.exports={format,createPlaybackReceipts};
