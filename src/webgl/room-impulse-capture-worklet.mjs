class InkRoomCapture extends AudioWorkletProcessor {
  constructor({processorOptions:{first,frames,channels}}){
    super();
    this.first=first;
    this.end=first+frames;
    this.channels=channels;
    this.samples=new Float32Array(frames*channels);
    this.written=0;
  }
  process([input],[output]){
    const begin=Math.max(this.first,currentFrame), end=Math.min(this.end,currentFrame+output[0].length);
    if(end<=begin)return currentFrame<this.end;
    if(input.length<this.channels||begin!==this.first+this.written){
      this.port.postMessage({error:'The selected input did not supply every requested recording channel.'});
      return false;
    }
    for(let i=begin;i<end;i++)for(let ch=0;ch<this.channels;ch++)
      this.samples[(i-this.first)*this.channels+ch]=input[ch][i-currentFrame];
    this.written+=end-begin;
    if(end!==this.end)return true;
    this.port.postMessage({samples:this.samples},[this.samples.buffer]);
    return false;
  }
}
registerProcessor('ink-room-impulse-capture',InkRoomCapture);
