import { createRollingAudio } from './rolling-audio.mjs';

class InkSampleCapture extends AudioWorkletProcessor {
  constructor({processorOptions}) {
    super();
    this.recording = createRollingAudio({...processorOptions,sampleRate});
    this.active = true;
    this.port.onmessage = ({data}) => {
      const {id, operation, options} = data;
      if (operation === 'stop') { this.active = false; return; }
      try {
        if (operation === 'range') this.port.postMessage({id, result:this.recording.range()});
        else if (operation === 'capture') {
          const result = this.recording.capture(options);
          this.port.postMessage({id, result}, [result.value.samples.buffer]);
        }
      } catch (error) {
        this.port.postMessage({id, error:error.message});
      }
    };
  }
  process(inputs, outputs) {
    if (!this.active) return false;
    this.recording.write(inputs[0], currentFrame, outputs[0][0].length);
    return true;
  }
}

registerProcessor('ink-sample-capture', InkSampleCapture);
