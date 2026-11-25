/* Pick a short line of fresh destination tones from the pitch of a sounding voice. */
(function(P){
  const {check,fields,id,finite,integer}=P.musicInstruments;
  const pitchClass=midi=>midi%12;

  function compile(raw){
    check(fields(raw,['track','lead','steps','velocity','range']) && id(raw.track),'A harmonic bridge needs a pitched track');
    const {track,lead=.28,steps=2,velocity=.48,range=[48,84]}=raw;
    check(finite(lead,.08,.8)&&integer(steps,1,3)&&finite(velocity,.05,1)&&Array.isArray(range)&&range.length===2&&
      integer(range[0],12,108)&&integer(range[1],range[0]+5,115),'Invalid harmonic bridge lead, steps, velocity or playable range');
    return {track,lead,steps,velocity,range:range.slice()};
  }

  function chord(score,entry){
    const changes=score.program.events, at=changes.findLastIndex(row=>row.time<=entry+1e-8);
    const row=changes[at];
    if(!row)return null;
    const pitches=row.voices.map(voice=>voice.midi).filter(pitch=>pitch!==null);
    if(!pitches.length)return null;
    return {name:row.harmony,root:row.root,quality:row.quality,pitches,classes:new Set(pitches.map(pitchClass)),
      until:changes[at+1]?.time??score.end};
  }

  function line(sounding,target,{track,range,steps}){
    const source=new Set(sounding.map(voice=>pitchClass(voice.pitch)));
    const moving=sounding.filter(voice=>!target.classes.has(pitchClass(voice.pitch)));
    const anchors=moving.length ? moving : sounding;
    if(!anchors.length)return [];
    const sameTrack=anchors.filter(voice=>voice.part===track);
    let previous=Math.max(...(sameTrack.length?sameTrack:anchors).map(voice=>voice.pitch));
    const fresh=new Set([...target.classes].filter(tone=>!source.has(tone)));
    const pitches=[];
    for(let midi=range[0];midi<=range[1];midi++)if(fresh.has(pitchClass(midi)))pitches.push(midi);
    const notes=[];
    while(notes.length<steps && fresh.size){
      const nearest=pitches.filter(midi=>fresh.has(pitchClass(midi)))
        .sort((a,b)=>Math.abs(a-previous)-Math.abs(b-previous)||a-b)[0];
      if(nearest===undefined||Math.abs(nearest-previous)>(notes.length?7:12))break;
      notes.push(nearest);
      fresh.delete(pitchClass(nearest));
      previous=nearest;
    }
    return notes;
  }

  P.musicHarmonicBridge=Object.freeze({compile,chord,line,pitchClass});
})(KIT.procedural);
