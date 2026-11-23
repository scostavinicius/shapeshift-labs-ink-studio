import '../binaural-profile.js';
const {createFilter}=globalThis[Symbol.for('ink-studio.binaural-profile')];

class InkBinauralProcessor extends AudioWorkletProcessor {
  constructor({processorOptions:{kernel,transition,cutoff}}){
    super();
    this.filter=createFilter(kernel,transition,sampleRate);
    this.cutoff=cutoff;
    this.queue=[];
    this.last=Infinity;
    this.tail=kernel.left.length-1;
    this.port.onmessage=({data})=>{
      if(data.end){this.last=currentFrame+this.tail;return;}
      if(this.queue.at(-1)?.at===data.at){
        const prior=this.queue.pop();
        data.kernel??=prior.kernel;
      }
      this.queue.push(data);
    };
  }
  process(inputs,outputs){
    const input=inputs[0]?.[0], [left,right]=outputs[0];
    for(let i=0;i<left.length;i++){
      while(this.queue[0]?.at<=currentFrame+i){
        const {kernel,cutoff}=this.queue.shift();
        if(kernel)this.filter.set(kernel);
        this.cutoff=cutoff;
      }
      const pair=this.filter.process(input?.[i]??0,this.cutoff);
      left[i]=pair[0];right[i]=pair[1];
    }
    if(currentFrame+left.length>=this.last){this.port.postMessage('ended');return false;}
    return true;
  }
}

registerProcessor('ink-binaural-profile',InkBinauralProcessor);
