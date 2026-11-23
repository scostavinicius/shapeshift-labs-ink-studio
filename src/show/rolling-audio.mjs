const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/** Retain a bounded PCM window addressed by absolute audio frames. */
export function createRollingAudio({sampleRate, channels = 2, seconds = 8} = {}) {
  const capacity = Math.round(seconds * sampleRate);
  if (!integer(sampleRate, 1, 768000) || !integer(channels, 1, 2) ||
      !Number.isFinite(seconds) || seconds <= 0 || seconds > 30 || !integer(capacity, 1, 2e6 / channels))
    throw new RangeError('Invalid rolling PCM capacity');
  const ring = new Float32Array(capacity * channels);
  let firstSample = 0, endSample = 0;
  const range = () => ({sampleRate, channels, firstSample, endSample});
  return {
    range,
    write(input, first, frames = input[0]?.length ?? 0) {
      if (!integer(frames, 1, 8e6) || !integer(first, 0, Number.MAX_SAFE_INTEGER - frames) ||
          input.length > channels || input.some(lane => lane.length !== frames))
        throw new RangeError('Invalid PCM capture block');
      // A discontinuity starts a new window on the incoming clock.
      if (first !== endSample) firstSample = first;
      endSample = first + frames;
      firstSample = Math.max(firstSample, endSample - capacity);
      for (let i = Math.max(0, frames - capacity); i < frames; i++) {
        const at = ((first + i) % capacity) * channels;
        for (let channel = 0; channel < channels; channel++) ring[at+channel] = input[channel]?.[i] ?? 0;
      }
    },
    capture(options = {}) {
      const latest = options.seconds !== undefined;
      const {firstSample: begin = firstSample, endSample: end = endSample, seconds} = options;
      if (latest && (options.firstSample !== undefined || options.endSample !== undefined ||
          !Number.isFinite(seconds) || seconds <= 0 || seconds > 30))
        throw new RangeError('Choose a capture range or a recent duration');
      const start = latest ? Math.max(firstSample, end - Math.round(seconds * sampleRate)) : begin;
      if (!integer(start, firstSample, endSample - 1) || !integer(end, start + 1, endSample))
        throw new RangeError('Capture range is outside the retained PCM window');
      const samples = new Float32Array((end - start) * channels);
      const split = Math.min(samples.length, (capacity - start % capacity) * channels);
      const offset = (start % capacity) * channels;
      samples.set(ring.subarray(offset, offset + split));
      if (split < samples.length) samples.set(ring.subarray(0, samples.length - split), split);
      return {value:{sampleRate,channels,samples}, range:{firstSample:start, endSample:end, sampleRate}};
    }
  };
}

export function normalizeCapture(samples) {
  let peak = 1;
  for (const value of samples) {
    if (!Number.isFinite(value)) throw new RangeError('Capture contains nonfinite PCM');
    peak = Math.max(peak, Math.abs(value));
  }
  const gain = 1 / peak;
  if (gain < 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return gain;
}
