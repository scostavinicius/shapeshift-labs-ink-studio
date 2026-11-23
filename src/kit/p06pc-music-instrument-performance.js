/* Playable stock performances and controlled rhythm/timing comparisons. */
(function (P) {
  const A=P.musicProduction,{check,fields,record}=P.musicInstruments;
  const presets=P.data.freeze({
    'glass-reed':{type:'subtractive',saw:.40,pulse:.58,sub:.13,pulseWidth:.39,pwm:{rate:.62,depth:.095},
      filter:{cutoff:1400,resonance:2.7,keyTrack:.47,envAmount:14,velocity:12,
        env:{attack:.12,decay:.6,sustain:.44,release:.31}},
      env:{attack:.142,decay:.39,sustain:.78,release:.2},
      articulations:{
        tap:{env:{attack:.012,decay:.19,sustain:.48,release:.11},filter:{cutoff:1960}},
        rise:{env:{attack:.018,decay:.38,sustain:.80,release:.22},filter:{cutoff:2440}},
        fall:{env:{attack:.020,decay:.37,sustain:.69,release:.23},filter:{cutoff:760,resonance:1.65}}
      },
      performance:{connect:{gap:.09,interval:12,fade:.024},repeatGap:.18,rules:[
        {when:'attack',attackLead:.142,curves:{gainDb:[[0,-8],[.18,0],[.73,-.9],[1,-4]],
          cutoffHz:[[0,2200],[.3,5600],[1,1750]]}},
        {when:'repeat',articulation:'tap',attackLead:.012,level:.86},
        {when:'legato',interval:[1,12],articulation:'rise',glide:.088,
          curves:{pitchCents:[[0,0],[.27,18],[1,0]],gainDb:[[0,-2.2],[.23,0],[1,-2.2]]}},
        {when:'legato',interval:[-12,-1],articulation:'fall',glide:.105,
          curves:{cutoffHz:[[0,2900],[.4,1800],[1,840]]}}
      ]}},
    'smoked-tines':{type:'keys',tine:.81,bite:.54,dust:.095,wear:.24,color:.41,drive:1.42,
      env:{attack:.011,decay:.61,sustain:.21,release:.26},
      articulations:{
        damped:{bite:.26,color:.33,dust:.061,env:{attack:.004,decay:.16,sustain:.08,release:.10}},
        join:{bite:.18,color:.54,dust:.041,env:{attack:.018,decay:.37,sustain:.29,release:.25}}
      },
      performance:{connect:{gap:.03,interval:5,fade:.016},repeatGap:.25,rules:[
        {when:'attack',attackLead:.01,curves:{cutoffHz:[[0,8900],[.22,4150],[1,1700]]}},
        {when:'repeat',articulation:'damped',level:.79},
        {when:'legato',articulation:'join',glide:.033}
      ]}},
    'coast-bass':{type:'subtractive',saw:.31,pulse:.47,sub:.47,pulseWidth:.35,filter:{
      cutoff:510,resonance:1.42,keyTrack:.48,envAmount:19,velocity:9,env:{attack:.009,decay:.24,sustain:.28,release:.14}},
      env:{attack:.008,decay:.26,sustain:.63,release:.08},
      articulations:{
        muted:{sub:.45,saw:.22,filter:{cutoff:390},env:{attack:.007,decay:.13,sustain:.48,release:.052}},
        slide:{filter:{cutoff:680},env:{attack:.014,decay:.24,sustain:.72,release:.10}}
      },
      performance:{connect:{gap:.034,interval:9,fade:.014},repeatGap:.21,rules:[
        {when:'attack',attackLead:.008},
        {when:'repeat',articulation:'muted',level:.9},
        {when:'legato',articulation:'slide',glide:.055,
          curves:{gainDb:[[0,-1],[.29,0],[1,-2]]}}
      ]}}
  });

  function timingOnly(groove) {
    const {tracks,roles,ensemble,...body}=P.data.clone(groove);
    const trim=routes=>Object.fromEntries(Object.entries(routes).map(([name,{articulations,...route}])=>
      [name,{...route,accent:0,length:0,...(articulations && {
        articulations:Object.fromEntries(Object.entries(articulations).map(([key,value])=>[key,{...value,accent:0,length:0}]))
      })}]));
    if (ensemble?.players) ensemble.players=Object.fromEntries(Object.entries(ensemble.players)
      .map(([name,{offset}])=>[name,{offset}]));
    if (ensemble?.transfers) ensemble.transfers=ensemble.transfers.map(row=>({...row,accent:0,length:0,articulation:false}));
    return {...body,...(tracks && {tracks:trim(tracks)}),...(roles && {roles:trim(roles)}),...(ensemble && {ensemble})};
  }
  function planPocket(source,brief,assets={}) {
    check(fields(brief,['rhythm','groove']) && fields(brief.rhythm,['edits','tracks']) && record(brief.groove) &&
      (brief.rhythm.edits===undefined || Array.isArray(brief.rhythm.edits) &&
        Array.from(brief.rhythm.edits).every(row=>record(row) && row.part!==undefined && row.harmony===undefined && row.binding===undefined)) &&
      (brief.rhythm.tracks===undefined || record(brief.rhythm.tracks) &&
        Object.values(brief.rhythm.tracks).every(row=>fields(row,['clips']) && Array.isArray(row.clips))) &&
      Object.keys(brief.rhythm).length>0,'A pocket comparison needs written part or clip edits and a groove map');
    const groove=timingOnly(brief.groove), reset=source.grooveMap===undefined ? {} : {grooveMap:null};
    const variants=[{id:'reference',...reset},{id:'written',...brief.rhythm,...reset},
      {id:'timing',grooveMap:groove},{id:'combined',...brief.rhythm,grooveMap:groove}];
    const takes=variants.map(row=>A.compile(Object.keys(row).length===1 ? source : A.revise(source,row,assets),assets));
    const layout=notes=>notes.map(n=>JSON.stringify([n.beat,n.midi,n.voice])).sort().join('|');
    function evidence(before,after) {
      return Object.fromEntries(Object.keys(before.events).map(name=>{
        const compare=(a,b)=>a.beat-b.beat || a.midi-b.midi || a.time-b.time;
        const originals=before.events[name].slice().sort(compare), variants=after.events[name].slice().sort(compare);
        check(layout(originals)===layout(variants),'Microtiming changes the written attacks on '+name);
        const moves=variants.map((note,i)=>note.time-originals[i].time).filter(delta=>Math.abs(delta)>1e-7);
        return [name,{attacks:variants.length,moved:moves.length,
          maxMs:moves.length ? Number((Math.max(...moves.map(Math.abs))*1000).toFixed(3)) : 0}];
      }));
    }
    check(Object.keys(takes[0].events).some(name=>layout(takes[0].events[name])!==layout(takes[1].events[name])),
      'Written rhythm needs to change at least one part attack');
    const timing=evidence(takes[0],takes[2]), combined=evidence(takes[1],takes[3]);
    check(Object.values(timing).some(row=>row.moved) || Object.values(combined).some(row=>row.moved),
      'The groove makes no timing changes in either rhythm');
    return P.data.freeze(P.data.clone({variants,report:{timing,combined}}));
  }
  P.musicProduction=Object.freeze({...A,instrumentPresets:presets,inspectInstrumentGraph:P.musicInstrumentGraph.inspect,planPocket});
})(KIT.procedural);
