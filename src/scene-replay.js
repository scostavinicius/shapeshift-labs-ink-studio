const format = 'ink-studio/scene-replay';
const maxFrames = 600, maxPixels = 120_000_000, maxImagePixels = 16_777_216;
const maxReplayBytes = 128 * 1024 * 1024;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const dimensions = (width, height) => [width, height].every(n => integer(n, 1, 8192)) && width * height <= maxImagePixels;

function replayDocument(document) {
  const { version, width, height, start, fps, frameRate, frames, title } = document ?? {};
  const validRate = frameRate === undefined ? integer(fps, 1, 120) :
    Number.isFinite(fps) && fps >= 1 && fps <= 120 &&
    integer(frameRate?.numerator, 1, Number.MAX_SAFE_INTEGER) && integer(frameRate?.denominator, 1, Number.MAX_SAFE_INTEGER) &&
    fps === frameRate.numerator / frameRate.denominator;
  if (document?.format !== format || version !== 1 || !dimensions(width, height) ||
      !Number.isFinite(start) || !validRate || typeof title !== 'string' ||
      !Array.isArray(frames) || !integer(frames.length, 1, maxFrames) || frames.length * width * height > maxPixels)
    throw new TypeError('Invalid Ink Studio scene replay');
  return document;
}

function pngSource(data, width, height) {
  if (typeof data !== 'string' || data.length > maxReplayBytes || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new TypeError('Scene replay frames need base64 PNG data');
  const header = atob(data.slice(0, 32));
  const u32 = at => header.charCodeAt(at) * 0x1000000 + header.charCodeAt(at + 1) * 0x10000 +
    header.charCodeAt(at + 2) * 0x100 + header.charCodeAt(at + 3);
  if (data.length * .75 - (data.endsWith('==') ? 2 : Number(data.endsWith('='))) < 45 ||
      !header.startsWith('\x89PNG\r\n\x1a\n') || header.slice(12, 16) !== 'IHDR' || u32(16) !== width || u32(20) !== height)
    throw new TypeError('Scene replay PNG dimensions must match its recording');
  return 'data:image/png;base64,' + data;
}

function validateSceneReplay(document) {
  const { width, height, frames } = replayDocument(document);
  let bytes = 0;
  for (const frame of frames) {
    bytes += typeof frame === 'string' ? frame.length : 0;
    if (bytes > maxReplayBytes) throw new RangeError('Scene replay exceeds the file size budget');
    pngSource(frame, width, height);
  }
  return document;
}

function frameIndex(count, fps, seconds, loop) {
  const duration = count / fps;
  const time = loop ? ((seconds % duration) + duration) % duration : Math.max(0, seconds);
  return Math.min(count - 1, Math.floor(time * fps + 1e-9));
}

function sampleReplayFrame(document, seconds = 0, { loop = false } = {}) {
  const { frames, fps, start, width, height } = replayDocument(document);
  if (!Number.isFinite(seconds)) throw new RangeError('Replay time must be finite');
  const index = frameIndex(frames.length, fps, seconds, loop);
  return { index, time: start + index / fps, width, height, src: pngSource(frames[index], width, height) };
}

function mount(root, recording, settings, indexAt) {
  const image = root.querySelector('img');
  if (!image) throw new TypeError('A scene replay host needs an img element');
  const button = root.querySelector('button');
  const slider = root.querySelector('input');
  const status = root.querySelector('output');
  const { frames, fps } = recording, duration = frames.length / fps;
  let origin = null, offset = 0, animation = 0, index = -1, disposed = false;

  function show(time) {
    const next = indexAt(frames.length, fps, time, false);
    if (next === index) return;
    index = next;
    const source = 'data:image/png;base64,' + frames[index];
    if (image.src !== source) image.src = source;
    if (slider) {
      slider.value = index;
      slider.setAttribute('aria-valuetext', 'Frame ' + (index + 1) + ' of ' + frames.length);
    }
    if (status) status.value = (index / fps).toFixed(2) + ' s / ' + duration.toFixed(2) + ' s';
  }
  const position = now => offset + (origin === null ? 0 : (now - origin) / 1000);
  function label() {
    if (button) button.textContent = origin === null ? 'Play' : 'Pause';
  }
  function seek(seconds) {
    if (!Number.isFinite(seconds)) throw new RangeError('Replay time must be finite');
    if (disposed) return;
    offset = Math.max(0, Math.min(duration, seconds));
    if (origin !== null) origin = performance.now();
    show(offset);
  }
  function pause() {
    if (origin === null) return;
    const time = position(performance.now());
    offset = settings.loop ? time % duration : Math.min(duration, time);
    origin = null;
    cancelAnimationFrame(animation);
    show(offset);
    label();
  }
  function tick(now) {
    if (origin === null) return;
    let time = Math.max(0, position(now));
    if (time >= duration) {
      if (!settings.loop) {
        pause();
        seek(duration);
        return;
      }
      offset = time %= duration;
      origin = now;
    }
    show(time);
    animation = requestAnimationFrame(tick);
  }
  function play() {
    if (disposed || origin !== null || frames.length < 2) return;
    if (offset >= duration) seek(0);
    origin = performance.now();
    animation = requestAnimationFrame(tick);
    label();
  }
  const toggle = () => origin === null ? play() : pause();
  const scrub = () => {
    pause();
    seek(Number(slider.value) / fps);
  };
  button?.addEventListener('click', toggle);
  slider?.addEventListener('input', scrub);
  if (slider) Object.assign(slider, { min: 0, max: frames.length - 1, step: 1 });
  if ('width' in recording) {
    image.width = recording.width;
    image.height = recording.height;
  }
  label();
  show(0);
  if (settings.autoplay && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) play();
  return Object.freeze({ play, pause, seek, duration,
    dispose() {
      if (disposed) return;
      pause();
      disposed = true;
      button?.removeEventListener('click', toggle);
      slider?.removeEventListener('input', scrub);
    },
    get currentTime() {
      const time = position(performance.now());
      return origin !== null && settings.loop ? time % duration : Math.min(time, duration);
    },
    get paused() { return origin === null; }
  });
}

function mountSceneReplay(root, recording, { autoplay = false, loop = true } = {}) {
  if (typeof root?.querySelector !== 'function' || typeof autoplay !== 'boolean' || typeof loop !== 'boolean')
    throw new TypeError('Expected a scene replay host and boolean playback settings');
  return mount(root, validateSceneReplay(recording), { autoplay, loop }, frameIndex);
}

if (typeof module !== 'undefined') module.exports = { format, maxFrames, maxPixels, maxReplayBytes, dimensions, frameIndex, mount, mountSceneReplay, sampleReplayFrame, validateSceneReplay };
