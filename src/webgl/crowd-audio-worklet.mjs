import * as shared from '../crowd-audio.js';
const {shape}=shared.default??globalThis[Symbol.for('ink-studio.crowd-audio')];

class InkCrowdAudio extends AudioWorkletProcessor {
  constructor({processorOptions}){
    super();
    this.pending=processorOptions?.packets??[];
    this.port.onmessage=({data})=>{
      if(data.clear){this.pending.length=0;return;}
      if(this.pending.length>=256)this.pending.shift();
      const {at,samples,marks}=data;
      this.pending.push({at:Math.max(currentFrame,at),samples,marks});
    };
  }
  process(inputs,outputs){
    const [output]=outputs[0], end=currentFrame+output.length;
    const heard=[];
    for(const packet of this.pending){
      const {at,samples,marks}=packet;
      const from=Math.max(at,currentFrame), until=Math.min(end,at+samples.length);
      for(let i=from;i<until;i++)output[i-currentFrame]+=samples[i-at];
      if(marks?.length&&from<until)packet.marks=marks.filter(mark=>{
        const {offset,length,...evidence}=mark, start=at+offset;
        const sample=Math.max(from,start);
        if(sample<Math.min(until,start+length))heard.push({...evidence,sample});
        return start>=until;
      });
    }
    if(heard.length)this.port.postMessage({marks:heard});
    this.pending=this.pending.filter(row=>row.at+row.samples.length>end);
    for(let i=0;i<output.length;i++)output[i]=shape(output[i]);
    return true;
  }
}
registerProcessor('ink-crowd-audio',InkCrowdAudio);
