/* Match score addresses to a continuously running device clock. */
(function (P) {
  const S=P.mediaGraphSupport;
  const {fields}=P.musicInstruments;
  S.sessionMixerTime=(rate,map)=>{
    const score=S.mixerTime(rate,map), grid=score.beatClock();
    const spans=[];
    function find(key,value) {
      let low=1,high=spans.length;
      while (low<high) {
        const middle=(low+high)>>>1;
        if (spans[middle][key]<=value) low=middle+1;
        else high=middle;
      }
      return spans[low-1];
    }
    const local=(span,frame)=>{
      const offset=frame-span.frame;
      return !span.loop || offset<span.firstFrames ? span.start+offset :
        span.from+(offset-span.firstFrames)%span.frames;
    };
    function beatAt(frame) {
      const row=find('frame',frame), offset=frame-row.frame;
      if (!row.loop || offset<row.firstFrames)
        return row.beat+grid.beatAt(row.start+offset)-row.startBeat;
      const extra=offset-row.firstFrames, lap=Math.floor(extra/row.frames);
      return row.beat+row.firstBeats+lap*row.beats+grid.beatAt(row.from+extra%row.frames)-row.fromBeat;
    }
    function sampleAt(beat) {
      const row=find('beat',beat), offset=beat-row.beat;
      if (!row.loop || offset<row.firstBeats)
        return row.frame+grid.sampleAt(row.startBeat+offset)-row.start;
      const extra=offset-row.firstBeats, lap=Math.floor(extra/row.beats);
      return row.frame+row.firstFrames+lap*row.frames+grid.sampleAt(row.fromBeat+extra-lap*row.beats)-row.from;
    }
    function begin(frame,start,loop) {
      const beat=spans.length ? beatAt(frame) : 0, startBeat=grid.beatAt(start);
      const row={frame,beat,start,startBeat,loop:!!loop};
      if (loop) {
        const {from,to}=loop, fromBeat=grid.beatAt(from), toBeat=grid.beatAt(to);
        Object.assign(row,{from,fromBeat,firstFrames:to-start,firstBeats:toBeat-startBeat,
          frames:to-from,beats:toBeat-fromBeat});
      }
      if (spans.at(-1)?.frame===frame) spans.pop();
      spans.push(row);
      // Tempo delay reads at most eight seconds behind the current sample.
      while (spans.length>2 && spans[1].frame<frame-rate*9) spans.shift();
    }
    begin(0,0);
    return {...score,begin,beatClock:()=>({beatAt,sampleAt,maxFrames:grid.maxFrames}),
      lane(raw,fallback,low,high,label,origin) {
        const lane=score.lane(raw,fallback,low,high,label,origin);
        if (!fields(raw,['unit','curve','points']) || origin!==undefined) return lane;
        return {...lane,reader() {
          let previous=-1,span,read=lane.reader();
          return frame=>{
            const row=find('frame',frame), at=local(row,frame);
            if (span!==row || at<previous) {
              read=lane.reader();
              span=row;
            }
            previous=at;
            return read(at);
          };
        }};
      }};
  };
})(KIT.procedural);
