/* Shared validation for pad triggers, captured performances and sample playback. */
(function (P) {
  const {fields,record,finite,integer,id,check}=P.musicInstruments;
  const triggerFields=['pad','note','velocity','articulation','play'];
  const eventFields=['id','time','duration','until',...triggerFields];
  const playFields=['sample','layer','startSample','tune','filter','gate','pan','sends'];
  const noPlay=Object.freeze({});

  function readPlay(play=noPlay) {
    const allowed=(key,test)=>play[key]===undefined || test(play[key]);
    check(fields(play,playFields) && allowed('sample',id) && allowed('layer',id) &&
      (play.layer===undefined || play.sample!==undefined) && allowed('startSample',n=>integer(n,0,32000000)) &&
      allowed('tune',n=>finite(n,-4800,4800)) && allowed('gate',n=>n===true) && allowed('pan',n=>finite(n,-1,1)) &&
      allowed('filter',filter=>fields(filter,['type','hz']) && ['lowpass','highpass'].includes(filter.type) &&
        finite(filter.hz,20,24000)) &&
      allowed('sends',sends=>record(sends) && Object.keys(sends).length<=12 &&
        Object.entries(sends).every(([bus,level])=>id(bus) && finite(level,0,1))),
    'Invalid per-hit sample, offset, tuning, filter, gate, pan or send');
    return play;
  }

  function trigger(row) {
    check((row.pad===undefined ? row.note!==undefined : id(row.pad)) &&
      (row.articulation===undefined || id(row.articulation)) &&
      (row.velocity===undefined || finite(row.velocity,0,1)),'Invalid pad trigger');
    if (row.note!==undefined) P.musicHarmony.midi(row.note);
    return readPlay(row.play);
  }

  P.mediaGraphSupport.padEvent={eventFields,triggerFields,trigger,maxEvents:24576};
})(KIT.procedural);
