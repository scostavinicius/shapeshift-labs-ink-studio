# Pinned binaural profiles

Choose a head-related impulse-response (HRIR) dataset for the soundtrack's spatial preview and WAV export. Each direction stores a left- and right-ear impulse. Ink uses the listener's position, forward vector, and up vector to select a response in head-relative space. Neighboring directions interpolate over the sphere, with a short transition when the listener or source moves. Chrome preview and headless export share the response interpolation, resampler, and stereo filtering code.

## Pin the dataset in the soundtrack

Put a profile file beside `soundtrack.json`. Store its SHA-256 alongside its relative path under `spatial.binauralProfile`.

```json
{
  "file": "headphones/approved-hrir.json",
  "sha256": "<64 lowercase hex characters from the exact file bytes>"
}
```

The CLI checks the bytes against the pin and records the verified SHA-256 and profile ID in the render report. Commit the profile beside the project so others can load the same bytes. An in-memory soundtrack or spatial mixer can also receive the profile object directly.

For Web Audio, resolve the same file relative to the soundtrack URL and pass the verified object to the normal spatial planner. Host preview on HTTPS or on localhost so the browser can load the AudioWorklet and verify the digest.

```js
import { createSpatialAudioPlayer, decodeBinauralProfile } from './webgl.mjs';

const { file, sha256 } = soundtrack.spatial.binauralProfile;
const response = await fetch(new URL(file, soundtrackURL));
if (!response.ok) throw new Error('Cannot load the project binaural profile');
const binauralProfile = await decodeBinauralProfile(await response.arrayBuffer(), { sha256 });
const mixer = KIT.world.spatialAudio.create({ ...soundtrack.spatial, binauralProfile });
const player = createSpatialAudioPlayer(context, { resolveAsset });
await player.update(mixer.frame({ query, listener, time, events }));
```

Positioned cues, sustained voices, and geometry-driven early reflections use the profile. Each voice's left and right channels feed the binaural filter as a mono source so the profile supplies the sound at each ear. Existing unpositioned music and editorial tracks use their regular stereo routing. Room responses can still add a room return after spatialization. The headless renderer includes available pre-roll to preserve the filter history at crop boundaries. A seek resets browser voice history.

The pin controls the headphone transfer function. Source decoding, playback timing, level automation, and export post processing still follow their respective playback and delivery paths. Use matching sample rates and aligned frame updates for a sample comparison.

## Profile format

```json
{
  "format": "ink-studio/binaural-profile",
  "version": 1,
  "id": "approved-headphones-v1",
  "sampleRate": 48000,
  "transition": 0.012,
  "directions": [
    { "azimuth": -90, "elevation": 0, "left": [0.75, 0, 0], "right": [0, 0, 0.31] },
    { "azimuth": 90, "elevation": 0, "left": [0, 0, 0.31], "right": [0.75, 0, 0] }
  ]
}
```

Use degrees. Azimuth zero is forward, positive angles point toward the listener's right, and positive elevation points up. Each direction needs the same number of samples in each ear. Include the measured interaural timing in the impulses. Convert measurement files such as SOFA to the JSON representation and bake any separate ear delays into the PCM. Use consistent levels and coverage around the listener. Ink accepts up to 1,024 directions and 512 source samples per ear, with up to 196,608 samples across one ear of the dataset and 1,024 samples per response after resampling.

The Signal Room demo uses the compact KEMAR measurements by Bill Gardner and Keith Martin, copyright 1994 MIT Media Laboratory. Download `compact.zip` from the measurement archive, then run `node examples/pinned-binaural/demo.cjs <archive> <output-directory> <Chrome executable>`. [KEMAR measurement archive](https://sound.media.mit.edu/resources/KEMAR.html)
