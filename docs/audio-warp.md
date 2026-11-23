# Warp and repitch a recording

`audio.warp` turns a PCM clip into a new clip on the same sample-rate
grid. Fit it to a tempo, specify a length, or pin known source positions
to destinations in picture or audio. The returned report records the
resolved source and destination samples.

```sh
ink-studio music samples warp library break tempo.json --out warp
ink-studio music samples warp library edit.json picture.json --out picture
```

The CLI accepts a [sample catalog](sample-capture.md) ID or a
[sample edit](sample-edit.md) JSON file. For an edit, source coordinates
refer to the rendered edit. It writes `warp.wav` and `report.json`.
The source sample and edit remain addressable.

## Choose the material

| Mode | Processing |
| --- | --- |
| `beats` | Place detected or authored attacks on the new grid and copy their original waveform from each marker. Compression shortens the material between hits with a short tail fade. Expansion leaves space after a slice's recorded decay. |
| `tones` | Stretch sustained material with a phase vocoder, locking neighboring bins to spectral peaks and sharing a channel reference. Use this for held notes, chords and drones. |
| `speech` | Match and blend short waveform grains inside each pinned interval. Use this for isolated speech and dialogue edits. |
| `repitch` | Resample like varispeed tape. Pitch rises as playback speeds up and falls as it slows down. A windowed-sinc low-pass filters accelerated playback. |

Use `beats` for an attack whose original samples need to land on a picture
cut. The tonal and speech modes prioritize the continuity of sustained
sound or words. The tonal mode can spread an attack across its analysis
window. Wide changes in speed can make the processing audible.
See [Laroche and Dolson on phase-vocoder processing](https://doi.org/10.1109/89.759041)
and [Verhelst and Roelands on waveform-similarity overlap-add](https://www.isca-archive.org/eurospeech_1993/roelands93_eurospeech.html).

## Fit a new tempo or speed

```json
{
  "mode": "beats",
  "tempo": { "from": 100, "to": 140 },
  "detect": { "minGap": 0.095, "minStrength": 0.025 }
}
```

Declare the recording's source BPM and the desired BPM. The length
changes in proportion to their ratio. Use `targetFrames` for a specific
PCM length, or `speed` for a playback-speed multiplier. A `speed` of
`0.8` produces a clip 25 percent longer. In `repitch` that also pitches
the clip down. Use one length control per warp.

In `beats`, Ink uses its existing transient detector. Supply detector
settings or set `detect: false` for authored markers alone. Suggestions
within 12 ms of an explicit anchor or source boundary are suppressed
to avoid splitting that same attack twice.

## Pin to picture

```json
{
  "mode": "beats",
  "tempo": { "from": 100, "to": 140 },
  "fps": { "numerator": 30000, "denominator": 1001 },
  "markers": [
    { "id": "cut", "sourceSample": 19200, "targetFrame": 17 },
    { "id": "flash", "sourceSample": 57600, "targetTime": { "numerator": 43, "denominator": 30 } }
  ]
}
```

Markers use zero-based positions relative to the start of the source and
output clips. Choose `targetSample`, `targetFrame` with `fps`, or
`targetTime` in seconds or as a rational timecode. Time and picture pins
use the same floor-to-sample conversion as scene exports. Source and
target positions must each increase. The source start maps to output
zero. An explicit end marker can set the output length when no other
length control is supplied. Each pinned interval supports speeds from
one eighth to eight times the source, within the PCM and processing budgets.
The report lists the output length, authored pins, and any placed transients.

Connect `audio.renderSampleEdit` to `audio.warp` in a graph, export the
result as a WAV, or use the named graph output in a scene soundtrack. In
JavaScript use `KIT.procedural.mediaGraph.warpAudio(source, settings)`.

Run the [Warp Workshop](../examples/music-production/warp-workshop.cjs)
with `node examples/music-production/warp-workshop.cjs output-directory`.
An optional second argument supplies a spoken-word WAV for the speech
comparison.
