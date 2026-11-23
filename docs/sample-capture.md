# Capture and catalog audio

Ink can recover a live PCM window, capture a headless render, or import a
WAV. Each library entry carries the original sample interval and searchable
metadata. The entry resolves to a WAV that can go into a production patch,
soundtrack, or graph.

Use [audio prints](audio-prints.md) to capture related dry and wet graph taps
with their processing paths, exact ranges, seed, and reusable markers.

Use [sample editing](sample-edit.md) to mark and audition transients,
split recordings into reusable regions, and assemble crossfaded takes.

Use the [gesture bank](gesture-bank.md) to group recordings into sessions with
aligned perspectives, search slices by acoustic descriptors, and keep
selected gestures as catalog samples.

## Recover a live take

Start `ink-studio show-bridge` and open **Sample capture** from Signal Room.
Start the test instrument, click **Strike**, then click **Recover last 1.6 s**.
Audition the result and download both the WAV and catalog recipe to the same
folder. **Use microphone** records from the browser's chosen input after the
browser grants permission. Both sources use the same rolling recorder.

```js
import { createLiveSampleCapture, sampleCaptureFiles } from './show-control.mjs';

const recorder = await createLiveSampleCapture(context, {
  router, bus: 'music', historySeconds: 8, channels: 2
});
const take = await recorder.capture({ seconds: 1.6 });
const files = sampleCaptureFiles(take, {
  id: 'music-strike', label: 'Music strike', material: 'metal',
  articulation: 'struck', pitch: 'A4',
  license: { id: 'CC0-1.0', credit: 'Artist name' }
});
recorder.close();
```

Pass `node` and `source: {kind, name, reference?}` in place of `router`
and `bus` to capture an existing Web Audio source such as a microphone
`MediaStreamAudioSourceNode`, instrument node, or spatial world source.
The router tap records after the selected bus's gain and pan. The recording
process emits silence to the monitor. The host owns the audio context and any
microphone stream.

The rolling buffer is addressed in audio frames on the context's clock.
`range()` reports its current exclusive end. Use `capture({firstSample,
endSample})` to recover a marked interval or `capture({seconds})` for the
most recent retained audio. Requests for an expired interval fail. The default
history is eight seconds, subject to a 30-second and two-million-sample bound.
If a live capture exceeds full scale, a single gain keeps its peaks in range
and is recorded with its source metadata.

## Build and query a sample library

```sh
ink-studio music samples add library capture.json
ink-studio music samples search library filter.json
ink-studio music samples get library bench-strike
node examples/music-production/captured-strike.cjs library demo
```

A recipe contains `input` and `sample`. Live downloads also carry a
`provenance` record with the exact clock range. Here is a headless recipe
that isolates a configured emitter from a soundtrack.

```json
{
  "input": {
    "kind": "world",
    "path": "soundtrack.json",
    "emitter": "vent",
    "from": 1.25,
    "to": 2.75
  },
  "sample": {
    "id": "vent-bed",
    "label": "Vent motor under load",
    "material": "metal",
    "articulation": "running",
    "tags": ["motor", "steady"],
    "license": { "id": "CC0-1.0", "credit": "Artist name" }
  }
}
```

Paths resolve relative to the recipe. Each input uses the normal Ink
rendering path for that source.

| Input | Selection |
|---|---|
| `file` | `path` to a WAV. |
| `graph` | `path` to a graph project and its named audio `output`, with optional `time`, `seed`, and `inputs`. |
| `instrument` | `path` to a music production and a named `track`, including `room`. Set `from` and `to` in seconds and optionally `sampleRate`. |
| `world` | `path` to a soundtrack containing a sound world. Select one `emitter` or a one-shot `cue`. Set `from` and `to` to scene times in seconds or rational timecodes. |
| `stem` | `path` to a soundtrack, a named `stem` such as `spatial` or `music`, and scene times. `mix` captures the whole soundtrack. |

`input.firstSample` and `input.endSample` optionally trim the selected input
on its own sample grid. The library records the adjusted interval on the
source clock. An entry requires `id` and `label`. Material, articulation, pitch,
license and tags are authored. Pitch accepts a note such as `A4` or a MIDI
number with fractional semitones. An omitted license is indexed as
`unknown`. Re-adding identical audio and metadata at the same ID is
idempotent. Different captures can share audio on disk via its content hash.

A search accepts text `query`, `material`, `articulation`, `pitch` and
`cents` tolerance, `minDuration` and `maxDuration` in seconds, `sourceKind`,
`sourceName`, `license`, `offset`, and `limit`. Text filters are
case-insensitive. `get` returns a WAV path suitable for a production's assets
map. Move the complete library directory to transfer entries and their audio.

## Use the tools from code or a graph

- `audio.captureSample` takes a typed audio output and `settings: {sample,
  source, firstSample?, endSample?}`. Its ports return the captured audio and
  the catalog entry. Use `audio.searchSamples` to filter entries carried by a graph.
- `ink.openSampleLibrary(directory)` exposes `add({value,entry})`,
  `search(filters)`, `get(id)`, and `load(id)`. Loading verifies the stored audio
  hash and returns decoded PCM.
- `createSceneAudio` and `readSceneAudio` expose `capture(sequence,
  {source, timeline?, runtime?})`. Set `source` to `{kind:'world',by:'emitter',name}`,
  `{kind:'world',by:'cue',name}`, or `{kind:'stem',name}`. It returns the isolated
  stereo buffer and absolute sample report without a picture export.
