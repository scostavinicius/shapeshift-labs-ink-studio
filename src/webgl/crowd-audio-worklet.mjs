import '../crowd-audio.js';
const {shape}=globalThis[Symbol.for('ink-studio.crowd-audio')];

class InkCrowdAudio extends AudioWorkletProcessor {
  constructor({processorOptions}){
    super();
    this.pending=processorOptions?.packets??[];
    this.port.onmessage=({data})=>{
      if(data.clear){this.pending.length=0;return;}
      if(this.pending.length>=256)this.pending.shift();
      const {at,samples}=data;
      this.pending.push({at:Math.max(currentFrame,at),samples});
    };
  }
  process(inputs,outputs){
    const [output]=outputs[0], end=currentFrame+output.length;
    for(const {at,samples} of this.pending){
      const from=Math.max(at,currentFrame), until=Math.min(end,at+samples.length);
      for(let i=from;i<until;i++)output[i-currentFrame]+=samples[i-at];
    }
    this.pending=this.pending.filter(row=>row.at+row.samples.length>end);
    for(let i=0;i<output.length;i++)output[i]=shape(output[i]);
    return true;
  }
}
registerProcessor('ink-crowd-audio',InkCrowdAudio);
