/* Whole-piece form families and their musical clocks. */
(function (P) {
  const {check,fields,finite,integer,hash}=P.musicInstruments;
  const H=P.musicHarmony;
  const round=(n,digits=6)=>Number(n.toFixed(digits));
  const role=(bass=true,keys=true,lead=true)=>({bass,keys,lead});
  const full=role(), keys=role(false,true,false), noBass=role(false,true,true), noLead=role(true,true,false);
  const scene=(id,label,min,weight,pulse,pace,chords,roles,melody)=>({id,label,min,weight,pulse,pace,chords,roles,melody});
  const forms={
    afterimage:{
      label:'Afterimage',ending:'dissolve',
      idea:'Open with the hook alone. Bring in the pulse underneath it, then return over new chords and dissolve.',
      sections:[
        scene('exposure','Exposed hook',3,1.3,'free',.93,[0,0,5],keys,'none'),
        scene('stride','Pulse underneath',5,2.3,'broken',1.03,[0,5,2,6,0],full,'answer'),
        scene('drift','Familiar notes in the bass',4,1.8,'half',.96,[3,5,1,4],full,'sustained'),
        scene('breath','Withhold the floor',2,.6,'free',.90,[4,4],keys,'none'),
        scene('refraction','Reharmonized return',5,3.0,'drive',1.07,[5,3,6,0,1,4,0],full,'answer'),
        scene('ember','Dissolve',3,1.0,'free',.91,[3,0,0],full,'ending')
      ]},
    withheld:{
      label:'Withheld',ending:'cut',
      idea:'Set up the hook as a rhythm, withhold the lead, and accelerate into its first statement and a hard ending.',
      sections:[
        scene('contact','A rhythm before a tune',4,1.4,'free',.95,[0,3,0],keys,'none'),
        scene('pressure','Build without the lead',5,2.7,'broken',1.00,[0,5,3,0,6],noLead,'none'),
        scene('compression','Thin the pulse',4,1.9,'half',.97,[1,5,4,4],noLead,'none'),
        scene('vacuum','Empty bar before the reveal',2,.55,'free',.92,[4],keys,'none'),
        scene('reveal','First full statement',5,2.9,'drive',1.10,[0,0,5,3,6,0],full,'answer'),
        scene('lock','Tighten, then cut',4,1.6,'double',1.15,[0,3,4,0],full,'ending')
      ]},
    exchange:{
      label:'Exchange',ending:'suspend',
      idea:'Let the bass state the hook. Pass it to the lead, leave the pulse behind, then end on a held question.',
      sections:[
        scene('anchor','The bass owns the hook',4,1.4,'half',.93,[0,0,3],noLead,'none'),
        scene('trade','Trade places',5,2.1,'broken',1.04,[3,6,0,5,1,0],full,'answer'),
        scene('float','Lose the backbeat',4,1.7,'free',.94,[5,2,3,4],noBass,'sustained'),
        scene('echo','Call across the gap',4,1.9,'half',.98,[3,5,0,6],full,'answer'),
        scene('crossing','Two registers return',5,2.7,'drive',1.06,[0,6,3,5,0,4],full,'answer'),
        scene('question','Suspend the answer',3,1.3,'free',.91,[3,1,7],full,'ending')
      ]}
  };
  const styles=Object.freeze(['minor','major','dorian','mixolydian']);
  const palettes=Object.freeze(['chamber','electric']);
  const formNames=Object.keys(forms);
  const publicForms=P.data.freeze(Object.fromEntries(Object.entries(forms).map(([id,{label,ending,idea}])=>[id,{label,ending,idea}])));
  const pc=n=>(n%12+12)%12;
  const draw=(seed,...at)=>(hash([seed,...at])>>>0)/4294967296;

  function stockHook(root,steps,seed) {
    const ideas=[
      {at:[.38,1.31,2.16,3.45,4.18,5.60,6.64],degree:[0,2,4,3,2,1,0],gate:[.54,.65,1.12,.56,1.06,.67,.98]},
      {at:[.18,.97,2.30,3.31,4.61,5.41,6.87],degree:[2,4,5,4,1,2,0],gate:[.61,.61,.70,.93,.58,1.13,.84]},
      {at:[.51,1.00,2.46,3.49,4.23,5.37,6.52],degree:[4,3,4,6,5,2,0],gate:[.33,1.12,.80,.62,.96,.79,1.14]}
    ];
    const idea=ideas[Math.floor(draw(seed,'hook')*ideas.length)];
    return {length:8,events:idea.at.map((beat,i)=>({id:'tone-'+i,beat,duration:idea.gate[i],
      midi:root+steps[idea.degree[i]],velocity:round([.61,.68,.79,.65,.70,.59,.77][i]+(draw(seed,'accent',i)-.5)*.09)}))};
  }

  function brief(raw={}) {
    check(fields(raw,['title','goal','seed','duration','tempo','key','palette','forms','hook']),'Invalid whole-piece brief fields');
    const {title='Untitled cue',goal='',seed=0,duration=104,tempo=106,key={},palette='chamber',forms:requested=formNames}=raw;
    check(typeof title==='string' && title.trim().length>0 && title.length<=120 && typeof goal==='string' && goal.length<=400 &&
      Number.isSafeInteger(seed) && finite(duration,90,120) && finite(tempo,80,136) && fields(key,['root','mode']) &&
      styles.includes(key.mode ?? 'minor') && palettes.includes(palette) &&
      Array.isArray(requested) && integer(requested.length,1,formNames.length) && new Set(requested).size===requested.length &&
      Array.from(requested).every(name=>formNames.includes(name)),'Invalid whole-piece title, duration, tempo, key, palette or forms');
    const root=60+H.pitchClass(key.root ?? 'D'), mode=key.mode ?? 'minor', steps=H.scaleSteps(mode);
    const source=P.musicMotif.motif(raw.hook ?? stockHook(root,steps,seed));
    check(finite(source.length,2,8) && integer(source.events.length,3,12) &&
      source.events.every(event=>event.velocity>0),'A whole-piece hook needs 3–12 audible notes across 2–8 beats');
    const hook={length:source.length,events:source.events.map(row=>({...row,
      midi:row.midi ?? root+steps[(row.degree-1+70)%7]+12*Math.floor((row.degree-1)/7)}))};
    check(hook.events.every(row=>integer(row.midi,0,127)) &&
      Math.max(...hook.events.map(row=>row.midi))-Math.min(...hook.events.map(row=>row.midi))<=36,
    'A whole-piece hook must fit inside a three-octave register');
    return {title,goal,seed,duration,tempo,root,mode,steps,palette,forms:requested.slice(),hook};
  }

  function arrange(id,brief) {
    const source=forms[id], {duration,tempo,seed}=brief;
    const minimum=source.sections.reduce((n,row)=>n+row.min,0);
    const bars=Math.max(minimum,Math.round(tempo*duration/240));
    const weights=source.sections.map(row=>row.weight*(.82+.36*draw(seed,id,row.id,'span')));
    const available=bars-minimum, weight=weights.reduce((a,b)=>a+b,0);
    const wanted=weights.map(w=>available*w/weight), allocation=wanted.map(Math.floor);
    const remainders=wanted.map((n,index)=>({index,remainder:n-allocation[index]})).sort((a,b)=>b.remainder-a.remainder);
    const extra=available-allocation.reduce((a,b)=>a+b,0);
    for (const {index} of remainders.slice(0,extra)) allocation[index]++;
    const spans=source.sections.map((row,i)=>({...row,bars:row.min+allocation[i]}));
    const base=240*spans.reduce((sum,row)=>sum+row.bars/row.pace,0)/duration;
    let beat=0;
    const sections=spans.map(row=>{
      const from=beat;
      beat+=row.bars*4;
      return {...row,from,to:beat,bpm:round(base*row.pace),swing:row.pulse==='broken' ? .548 : .5};
    });
    const map={tempo:sections[0].bpm,swing:sections[0].swing,changes:sections.slice(1).map(row=>
      ({beat:row.from,tempo:row.bpm,swing:row.swing}))};
    return {id,...publicForms[id],bars,sections,map};
  }

  P.musicWholeForm=Object.freeze({brief,arrange,publicForms,palettes,draw,round,pc});
})(KIT.procedural);
