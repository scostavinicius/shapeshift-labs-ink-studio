# Compose from a recorded gesture

Ink can turn a short recording into an editable pitch contour, a rhythm of
detected attacks, and a tail with its own phrasing. Use the same gesture in
different instruments and keep the performance that works in the cue.

## Listen and measure

Supply a WAV, WAV range, or a sample library reference as `source`. Pick a
slice up to 15 seconds at 8–96 kHz, with one or two channels.

```json
{
  "source": "bird.wav",
  "analysis": {
    "id": "bird",
    "pitch": {"lowHz": 1200, "highHz": 5200},
    "detect": {"minGap": 0.035, "sensitivity": 1.25, "minStrength": 0.01}
  }
}
```

```sh
ink-studio music timbre analyze source.json --out bird-profile.json
ink-studio music timbre project bird-profile.json projection.json --out motif.json
```

The profile keeps sample addresses for measured attacks, the confidence and
pitch of voiced windows, the active and tail ranges, plus a level and
brightness envelope. Use `confidence`, `floorDb` and the pitch probe settings
to adjust which windows are accepted. Set `tailSample` to mark the handoff by
ear. If transient detection has no early hit, the active onset anchors the
rhythm. A recording without reliable pitch still produces attack and tail motifs.

```json
{
  "beats": 1.35,
  "tonic": "A4",
  "scale": "minor",
  "minNoteMs": 10,
  "intervalScale": 1,
  "tailBeats": 1.2
}
```

The first reliable pitch anchors to `tonic`. Ink preserves the relative shape
of the pitch curve, optionally quantizes notes to `scale`, and retains
sub-semitone motion as pitch bends. Use `grid` to quantize onset beats,
`pitchStep` and `minNoteMs` to tune the segmentation, `intervalScale` to
exaggerate or compress its range, or `bend: false` for stepped pitch. Note
gates follow source timing. Curves carry the measured level and brightness
into note gain and filter cutoff. Source attack IDs survive projection so a
take can trigger the exact audio slice for each hit.

Use `music timbre match bird-profile.json candidates.json --out ranks.json`
to rank candidate profile objects in `profiles`. Optional `options` weights
`gain` and `brightness` separately. The distances compare sampled brightness
and relative level trajectories in the attack, body and tail. A smaller
number indicates a closer trajectory. Play the shortlisted sources in context.

## Audition orchestration

Use a normal [music production](music-production.md) recipe with distinct
note-driven tracks for each routed component. Route `attacks` to a percussion
part. The accompaniment, buses and processing come from the original score.
Each placement is relative to its section and must fit inside it.

```json
{
  "source": "bird.wav",
  "production": "cue.json",
  "settings": {
    "analysis": {
      "id": "bird",
      "pitch": {"lowHz": 1200, "highHz": 5200}
    },
    "projection": {"tonic": "A4", "scale": "minor", "beats": 1.35},
    "placements": [
      {"id": "first-call", "section": "opening", "beat": 0.5},
      {"id": "echo", "section": "return", "beat": 1, "roles": ["contour", "tail"], "stretch": 1.3}
    ],
    "takes": [
      {
        "id": "coastal-call",
        "palette": "coastal",
        "contour": {"part": "lead"},
        "attacks": {"part": "answer", "material": "source"},
        "tail": {"part": "air", "material": "source", "transpose": -12}
      },
      {
        "id": "breath-handoff",
        "palette": "metal-breath",
        "contour": {"part": "lead"},
        "attacks": {"part": "answer", "material": "source"},
        "tail": {"part": "air", "transpose": -12}
      }
    ],
    "seed": 539
  },
  "options": {"start": 0, "end": 8, "target": -18}
}
```

Set `patch` on a route to use an authored instrument. Omit the palette and
patch to keep the track's instrument. Source material plays exact attack
slices or a pitched granular print of the selected tail. `sampleRate`,
`tailSeconds` and `seed` govern derived audio. Reuse a measured profile by
embedding it as `settings.profile` in place of `analysis` and supply the
corresponding original recording.

```sh
ink-studio music timbre audition orchestration.json --out audition
ink-studio music timbre arrange orchestration.json keep.json --out chosen
```

The first command renders matched-loudness WAVs and an editable production per
take. The second accepts a `keep.json` such as
`{"take":"breath-handoff","note":"Keep the call rhythm and give the tail to breath."}`.
Both write an analysis and placement report with source offsets and note IDs.
The selected production uses ordinary instruments, motifs and section edits.

Export playable patch and asset banks with
`ink-studio music timbre palette coastal --out palette`. Choices are
`coastal` (reed, pulse and dusty keys), `metal-breath` (inharmonic strikes
and voiced air), and `broken-beat` (dry contact hits, keys and short bass).
Each bank includes gesture voices, accompaniment and percussion.

For direct sample-to-motif audition, add `derive: {analysis, projection, at}`
to the [sample-to-motif settings](sample-motif.md). The recording supplies
lead notes, attack offsets and the texture's source range. An authored
`lead.notes` or `accent.hits` overrides the corresponding projection. Use
a production orchestration to render the full per-note dynamics and filter
curves on a synth or sampler instrument.

The JavaScript APIs are `KIT.procedural.mediaGraph.timbreComposition`
(`extract`, `project`, `compare`, `plan`, `audition`) and `timbrePalettes.load`.
Graph nodes are `music.extractTimbreGesture`, `music.projectTimbreGesture`,
`music.matchTimbreGesture`, `music.timbrePalette` and
`music.planTimbreOrchestration`. Feed a plan's variants and the combined
production and derived assets into `music.auditionProduction`. Use
`ink-studio graph describe <node> --example` for runnable graph recipes.

## Hand a single sound between instruments

Use [evolving orchestration](timbre-evolution.md) to keep one continuous
trajectory while different instruments take over the attack, body and
decay. Edit the handoff markers and decide which measured qualities each
player inherits.
