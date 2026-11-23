/* Premix admitted overflow into bounded mono sector tracks on the scene clock. */
const mix=require('../src/crowd-audio.js');

function createSceneCrowd(config,sampleRate,path){
  const streams=new Map(), pending=new Set();
  const sources=new WeakMap();
  let latest=0, total=0, work=0;
  function sourceFor(audio){
    if(!sources.has(audio)){
      const {channels,samples,sampleRate}=audio;
      sources.set(audio,{sampleRate,duration:samples.length/channels/sampleRate,sample(at){
        let output=0;
        for(let i=0;i<channels;i++)output+=samples[at*channels+i]??0;
        return output/channels;
      }});
    }
    return sources.get(audio);
  }
  function indexAt(sample){
    let lo=0, hi=path.length;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(path[mid].sample<=sample)lo=mid;else hi=mid;}
    return lo;
  }
  function active(sample){
    for(const row of pending)if(row.end<=sample)pending.delete(row);
    return latest>sample && pending.size>0;
  }
  function cut(sample){
    for(const row of pending)row.end=Math.min(row.end,sample);
    pending.clear();latest=sample;
  }
  function add(track,audio,sample,stop,seats){
    const ear=path[indexAt(sample)]?.ear;
    if(!ear)return;
    const source=sourceFor(audio), point=track.points[0];
    const length=mix.grainFrames(track,source,sampleRate,config.grain), end=Math.min(stop,sample+length);
    if(end<=sample)return;
    const sector=mix.sector(track.aggregationAt,ear.position,seats), key=seats+':'+sector;
    if(!streams.has(key))streams.set(key,{sector,seats,members:[]});
    const row={start:sample,end,length,source,bus:config.bus,voice:{offset:track.offset,rate:track.rate,
      gain:point.gain*config.gain,cutoff:point.cutoff},sector,position:mix.point(ear.position,mix.direction(sector,seats))};
    work+=length*audio.channels;
    if(work>160e6)throw new RangeError('Scene voice aggregation exceeds its grain processing budget');
    latest=Math.max(latest,row.end);total++;
    pending.add(row);streams.get(key).members.push(row);
    track.aggregationMember=row;
    return row;
  }
  function tracks(register){
    const tracks=[];
    let frames=0;
    for(const {sector,seats,members} of streams.values()){
      const used=members.filter(row=>row.end>row.start);
      if(!used.length)continue;
      const first=used[0].start, last=used.reduce((end,row)=>Math.max(end,row.end),first);
      frames+=last-first;
      if(frames>32e6)throw new RangeError('Scene voice aggregation exceeds its PCM budget');
      const samples=new Float32Array(last-first);
      for(const row of used)mix.addGrain(samples,row.start-first,row.end-row.start,row.source,row.voice,sampleRate,row.length);
      for(let i=0;i<samples.length;i++)samples[i]=mix.shape(samples[i]);
      const direction=mix.direction(sector,seats), point=({sample,ear})=>({sample,gain:1,cutoff:22000,delay:0,pan:0,
        ...(ear&&{
          pan:Math.max(-1,Math.min(1,direction.reduce((sum,n,i)=>sum+n*ear.right[i],0))),
          hrirAt:mix.point(ear.position,direction)
        })});
      const from=indexAt(first), points=[point({sample:first,ear:path[from]?.ear})];
      for(let i=from+1;i<path.length&&path[i].sample<last;i++)points.push(point(path[i]));
      const asset=register({samples,channels:1,sampleRate});
      tracks.push({asset,first,end:last,points,stem:'spatial',bus:config.bus,cue:'procedural/voice-aggregation'});
    }
    return tracks;
  }
  return {active,cut,add,tracks,count:()=>total,streams:()=>streams.size};
}
module.exports={createSceneCrowd};
