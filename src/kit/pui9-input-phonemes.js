/* Editable word timing and Unicode IPA transcription without a language service. */
(function(K){
  const W=K.world,{check,record}=W.data,T=K.procedural.takeTime;
  const {fields,positive,nonnegative}=W.boundarySignals;
  const stress=new Map([['ˈ','primary'],['ˌ','secondary']]);
  const tie=new Set(['͡','͜']);
  const letter=/\p{L}/u, modifier=/[\p{M}\p{Lm}ːˑ]/u;
  const punctuation=/^[.!?,;:—–|‖]+$/u;
  const normalize=text=>text.normalize('NFC');

  function tokenize(text,symbols){
    const tokens=[];
    const character=i=>i<text.length?String.fromCodePoint(text.codePointAt(i)):'';
    let at=0,prefix=null;
    while(at<text.length){
      const start=at, first=character(at);
      at+=first.length;
      if(stress.has(first)){
        check(!prefix,'Repeated IPA stress at offset '+start);
        prefix={kind:stress.get(first),start};continue;
      }
      if(/\s/u.test(first)||punctuation.test(first)||'/[]().'.includes(first)){
        check(!prefix,'IPA stress needs a following symbol at offset '+(prefix?.start??start));
        if(first==='.')continue;
        if(punctuation.test(first))tokens.push({kind:'pause',text:first,start,end:at});
        if(/\s/u.test(first)&&tokens.length&&tokens.at(-1).kind!=='gap'&&tokens.at(-1).kind!=='pause')
          tokens.push({kind:'gap',start,end:at});
        continue;
      }
      check(letter.test(first)&&!modifier.test(first),'Expected an IPA symbol at offset '+start);
      const grouped=symbols.find(symbol=>text.startsWith(symbol,start));
      if(grouped)at=start+grouped.length;
      while(at<text.length){
        const mark=character(at);
        if(stress.has(mark)||!modifier.test(mark))break;
        at+=mark.length;
        if(tie.has(mark)){
          const joined=character(at);
          check(letter.test(joined)&&!modifier.test(joined),'IPA tie needs a following symbol at offset '+(at-mark.length));
          at+=joined.length;
        }
      }
      tokens.push({kind:'phoneme',symbol:normalize(text.slice(start,at)),start:prefix?.start??start,end:at,
        ...(prefix&&{stress:prefix.kind})});
      prefix=null;
    }
    check(!prefix,'IPA ended after a stress mark');
    if(tokens.at(-1)?.kind==='gap')tokens.pop();
    return tokens;
  }

  const digraphs={tch:'t͡ʃ',dge:'d͡ʒ',sh:'ʃ',ch:'t͡ʃ',ph:'f',th:'θ',ng:'ŋ',qu:'kw',
    ee:'i',oo:'u',ai:'eɪ',ay:'eɪ',oa:'oʊ',ow:'aʊ',oy:'ɔɪ',oi:'ɔɪ',ou:'aʊ',er:'ɚ'};
  const letters={a:'æ',e:'ɛ',i:'ɪ',o:'ɑ',u:'ʌ',c:'k',g:'ɡ',j:'d͡ʒ',q:'k',r:'ɹ',x:'ks',y:'j'};
  function guess(word){
    if(!/^[a-z]+$/u.test(word))return null;
    let ipa='';
    for(let i=0;i<word.length;){
      const three=word.slice(i,i+3),two=word.slice(i,i+2),single=word[i];
      if(three.length===3&&Object.hasOwn(digraphs,three)){ipa+=digraphs[three];i+=3;continue;}
      if(two.length===2&&Object.hasOwn(digraphs,two)){ipa+=digraphs[two];i+=2;continue;}
      ipa+=letters[single]??single;i++;
    }
    return ipa;
  }

  function compile(source,emit){
    check(fields(source,['kind','text','offset','channel','lexicon','fallback','symbols','durations','targets','phoneSeconds','wordSeconds',
      'gap','pause']), 'Invalid speech input source');
    const {kind,text,channel='speech',lexicon={},fallback='word',symbols=[],durations={},targets={},
      phoneSeconds=.09,wordSeconds=.22,gap=.035,pause=.14}=source;
    check(typeof text==='string'&&text.length<=16000&&['word','english'].includes(fallback)&&
      Array.isArray(symbols)&&symbols.length<=128&&Array.from(symbols).every(s=>
        typeof s==='string'&&s.length<=32&&/^\p{L}[\p{L}\p{M}ːˑ]*$/u.test(s))&&
      [phoneSeconds,wordSeconds,pause].every(n=>positive(n)&&n<=60)&&nonnegative(gap)&&gap<=60,
    'Invalid speech text, token inventory, or timing');
    const inventory=[...new Set(symbols)].sort((a,b)=>b.length-a.length);
    function table(raw,valid,label,max){
      check(record(raw)&&Object.keys(raw).length<=max&&Object.entries(raw).every(([key,value])=>
        key.length>0&&key.length<=96&&valid(value)), 'Invalid speech '+label);
      return new Map(Object.entries(raw).map(([key,value])=>[normalize(key),value]));
    }
    const times=table(durations,v=>positive(v)&&v<=60,'durations',512);
    const shapes=table(targets,v=>record(v)&&Object.keys(v).length<=32&&Object.values(v).every(Number.isFinite),'targets',512);
    const words=table(lexicon,v=>typeof v==='string'&&v.length>0&&v.length<=256,'lexicon',4096);
    let cursor=T.read(0),id=0;
    const next=()=>String(id++);
    const move=seconds=>{const before=cursor;cursor=T.add(cursor,Array.isArray(seconds)?seconds:T.read(seconds));return before;};

    function phones(tokens,method,word){
      for(const token of tokens){
        if(token.kind==='gap'){move(gap);continue;}
        const {symbol,stress,start,end}=token, sourceSpan=word?.sourceSpan??[start,end];
        if(token.kind==='pause'){
          const start=move(pause);
          emit.add({key:next(),kind:'pause',channel,start,end:cursor,value:{text:token.text,sourceSpan}});
          continue;
        }
        const bare=symbol.replace(/[ːˑ]/gu,''), length=symbol.includes('ː')?1.7:symbol.includes('ˑ')?1.25:1;
        const duration=times.get(symbol);
        const seconds=duration??T.mul(T.mul(T.read(times.get(bare)??phoneSeconds),T.read(length)),
          T.read(stress==='primary'?1.12:stress==='secondary'?1.06:1));
        const startTime=move(seconds);
        emit.add({key:next(),kind:'phoneme',channel,start:startTime,end:cursor,
          value:{symbol,pronunciation:method,sourceSpan,...(stress&&{stress}),...(word&&{word:word.id})},
          controls:{[emit.name+':phoneme']:1,...(shapes.get(symbol)??shapes.get(bare)??{})}});
      }
    }
    if(kind==='ipa'){
      phones(tokenize(text,inventory),'ipa');
    }else{
      let prior=null,estimated=0,unresolved=0;
      for(const token of text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{M}]+)*|[^\s]/gu)){
        const word=token[0], sourceSpan=[token.index,token.index+word.length];
        if(punctuation.test(word)){
          if(prior?.pause)continue;
          const start=move(pause);
          emit.add({key:next(),kind:'pause',channel,start,end:cursor,value:{text:word,sourceSpan}});
          prior={pause:true};continue;
        }
        if(!/^[\p{L}\p{N}]/u.test(word))continue;
        if(prior&&!prior.pause)move(gap);
        const key=next(), start=cursor, normalized=normalize(word.toLowerCase()), known=words.get(normalized);
        const guessed=known===undefined&&fallback==='english'?guess(normalized):null;
        const transcription=known??guessed, method=known!==undefined?'lexicon':guessed?'heuristic':'unresolved';
        if(transcription){
          const tokens=tokenize(transcription,inventory);
          check(tokens.some(row=>row.kind==='phoneme'),'Pronunciation has no IPA symbols for '+word);
          phones(tokens,method,{id:emit.id(key),sourceSpan});
          if(guessed)estimated++;
        }else{move(wordSeconds);unresolved++;}
        emit.add({key,kind:'word',channel,start,end:cursor,value:{text:word,pronunciation:method,sourceSpan},
          controls:{[emit.name+':word']:1}});
        prior={pause:false};
      }
      if(estimated)emit.warn({code:'heuristic-pronunciation',count:estimated});
      if(unresolved)emit.warn({code:'unresolved-pronunciation',count:unresolved});
    }
    return cursor;
  }

  W.inputPhonemes=Object.freeze({compile});
})(KIT);
