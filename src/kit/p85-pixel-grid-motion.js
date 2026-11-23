/* Shared, seekable cues for square-grid artwork. */
const PixelGridMotion = (() => {
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const check = (ok, message) => { if (!ok) throw new RangeError('Pixel grid: ' + message); };
  const epsilon=1e-9;
  const bytes = value => value instanceof Uint8Array || value instanceof Uint8ClampedArray;
  const mod4 = n => ((n % 4) + 4) % 4;

  function clock(width, height, cues, period) {
    check(integer(width,1,4096) && integer(height,1,4096) && width*height<=4096,
      'expected a grid of up to 4096 cells');
    check(Array.isArray(cues) && cues.length<=64 &&
      (period===undefined || Number.isFinite(period) && period>=.0001), 'expected up to 64 cues and a positive optional period');
    const count = width*height;
    const coords = index => [index % width, Math.floor(index / width)];
    const address = ([x,y] = []) => {
      check(integer(x,0,width-1) && integer(y,0,height-1), 'cell coordinate is outside the grid');
      return y*width+x;
    };
    const rows = Array.from({length:count},()=>[]);
    for (const [id,cue] of cues.entries()) {
      check(cue && Object.getPrototypeOf(cue)===Object.prototype, 'expected a cue record');
      const { time=0, duration=.25, cells, rect, wave } = cue;
      check(Number.isFinite(time) && time>=0 && Number.isFinite(duration) && duration>=.0001 &&
        (cells===undefined || rect===undefined), 'expected finite cue timing and either cells or a rectangle');
      let selected;
      if (cells!==undefined) {
        check(Array.isArray(cells) && integer(cells.length,1,count) && Array.from(cells).every(v=>Array.isArray(v)&&v.length===2),
          'expected selected XY cells');
        selected=Array.from(cells,address);
        check(new Set(selected).size===selected.length,'selected cells must be distinct');
      } else {
        check(rect===undefined || Array.isArray(rect)&&rect.length===4,'expected an XYWH rectangle');
        const [x,y,w,h]=rect ?? [0,0,width,height];
        check(integer(x,0,width-1) &&
          integer(y,0,height-1) && integer(w,1,width-x) && integer(h,1,height-y), 'expected a rectangle inside the grid');
        selected=Array.from({length:w*h},(_,i)=>address([x+i%w,y+Math.floor(i/w)]));
      }
      let offsets;
      if (wave!==undefined) {
        check(wave && Object.getPrototypeOf(wave)===Object.prototype && Number.isFinite(wave.speed) && wave.speed>0,
          'a wave needs a positive speed in cells per second');
        const { from, direction, speed }=wave;
        const vector = v => Array.isArray(v) && v.length===2 && Array.from(v).every(Number.isFinite);
        check((from===undefined)!==(direction===undefined), 'a wave needs either a radial origin or a direction');
        if (direction!==undefined) {
          check(vector(direction) && Math.hypot(...direction)>0 && Number.isFinite(Math.hypot(...direction)),
            'a directional wave needs a nonzero XY direction');
          const length=Math.hypot(...direction);
          const dots=selected.map(index=>{const [x,y]=coords(index);return x*(direction[0]/length)+y*(direction[1]/length);});
          const first=Math.min(...dots);
          offsets=dots.map(distance=>(distance-first)/speed);
        } else {
          check(vector(from),'a radial wave needs an XY origin');
          offsets=selected.map(index=>{const [x,y]=coords(index);return Math.hypot(x-from[0],y-from[1])/speed;});
        }
      }
      selected.forEach((index,i)=>{
        const start=time+(offsets?.[i]??0), end=start+duration;
        check(Number.isFinite(end) && end>start && (period===undefined || end<=period+epsilon),
          'cue must fit inside the clock period');
        rows[index].push({id,cue,start,end});
      });
    }
    for (const row of rows) {
      row.sort((a,b)=>a.start-b.start);
      check(row.every((entry,i)=>i===0 || row[i-1].end<=entry.start+epsilon), 'cues must not overlap on the same cell');
    }
    function time(value) {
      check(Number.isFinite(value),'sample time must be finite');
      if (period===undefined) return value;
      const local=value%period;
      const phase=local<0 ? local+period : local;
      return period-phase<=epsilon ? 0 : phase;
    }
    function at(row, local) {
      let lo=0,hi=row.length;
      while(lo<hi) {
        const mid=(lo+hi)>>1;
        if (row[mid].start<=local+epsilon) lo=mid+1;
        else hi=mid;
      }
      return row[lo-1];
    }
    return {rows,coords,address,time,at};
  }

  function matchSockets(slots, size, ports) {
    const last=size-1, mid=size/2;
    const edges=[i=>i,i=>i*size+last,i=>last*size+i,i=>i*size];
    for (let side=0;side<4;side++) for (let i=0;i<size;i++) {
      const socket=ports.includes('NESW'[side]) && (i===mid-1 || i===mid);
      if ((slots[edges[side](i)]!==null)!==socket) return false;
    }
    return true;
  }

  function blit(image, { rgba,width }, size, x, y, turn=0, mirror=false) {
    const last=size-1;
    if (!turn && !mirror) {
      for(let v=0;v<size;v++) rgba.set(image.subarray(v*size*4,(v+1)*size*4),((y+v)*width+x)*4);
      return;
    }
    for(let v=0;v<size;v++) for(let u=0;u<size;u++) {
      const sx=mirror?last-u:u;
      let tx=sx,ty=v;
      if(turn===1){tx=last-v;ty=sx;}
      if(turn===2){tx=last-sx;ty=last-v;}
      if(turn===3){tx=v;ty=last-sx;}
      const at=(v*size+u)*4;
      rgba.set(image.subarray(at,at+4),((y+ty)*width+x+tx)*4);
    }
  }

  function turnGrid({width,height,cell=[8,8],period,cues=[],between} = {}) {
    check(Array.isArray(cell)&&cell.length===2&&Array.from(cell).every(n=>integer(n,1,64)) &&
      (between===undefined || typeof between==='function'),'expected cell dimensions and an optional in-between painter');
    const timeline=clock(width,height,cues,period), [cw,ch]=cell, size=Math.max(cw,ch), w=width*size,h=height*size;
    check(w*h<=1048576,'turn raster exceeds its pixel budget');
    const rows=timeline.rows.map(row=>{
      let turn=0;
      const events=row.map(entry=>{
        const turns=entry.cue.turns ?? 1;
        check(integer(turns,-16,16)&&turns!==0,'expected a nonzero signed number of quarter turns');
        const from=turn;
        turn=mod4(turn+turns);
        return {...entry,from,to:turn,turns};
      });
      check(period===undefined || turn===0,'looping turns must return every cell to its original orientation');
      return events;
    });
    function state(index,local) {
      const entry=timeline.at(rows[index],local);
      if (!entry) return { turn:0,active:false };
      if (local+epsilon>=entry.end) return { turn:entry.to,active:false };
      const direction=Math.sign(entry.turns), phase=Math.max(0,(local-entry.start)/(entry.end-entry.start)*Math.abs(entry.turns));
      const segment=Math.min(Math.abs(entry.turns)-1,Math.floor(phase)), progress=Math.min(1,phase-segment);
      const from=mod4(entry.from+direction*segment), to=mod4(from+direction);
      return {turn:progress<.5?from:to,active:true,from,to,direction,progress,cue:entry.id};
    }
    function raster(source,time=0){
      const local=timeline.time(time);
      check(source?.w===width*cw && source.h===height*ch && bytes(source.rgba) &&
        source.rgba.length===source.w*source.h*4,'source raster must match the declared cell grid');
      const rgba=new Uint8Array(w*h*4), image=new Uint8Array(size*size*4), target={rgba,width:w};
      const padX=(size-cw)>>1,padY=(size-ch)>>1;
      for(let i=0;i<rows.length;i++){
        const [x,y]=timeline.coords(i), pose=state(i,local);
        const art=pose.active && pose.progress>0 && between?.({x,y,size,time:local,...pose});
        if(art){
          check(art.w===size && art.h===size && bytes(art.rgba) && art.rgba.length===image.length,
            'authored turn cels must match the padded square');
          blit(art.rgba,target,size,x*size,y*size,pose.from);
          continue;
        }
        for(let v=0;v<ch;v++){
          const p=((y*ch+v)*source.w+x*cw)*4;
          image.set(source.rgba.subarray(p,p+cw*4),((padY+v)*size+padX)*4);
        }
        blit(image,target,size,x*size,y*size,pose.turn);
      }
      return {w,h,rgba};
    }
    return Object.freeze({w,h,size,raster,sample:(x,y,time=0)=>state(timeline.address([x,y]),timeline.time(time))});
  }

  return Object.freeze({ clock, matchSockets, blit, turnGrid });
})();
KIT.pixelGrid = Object.freeze({ turn: PixelGridMotion.turnGrid });
