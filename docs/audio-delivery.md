# Audio delivery and handoff

Print a scene soundtrack or mixer session as a package for editorial.
It contains the printed master, a separate premaster, six aligned
premaster stems, music-and-effects versions, a cue sheet, and an
OpenTimelineIO timeline of the stems and cue markers.

```sh
ink-studio music deliver delivery-setup.json --out delivery --strict
```

## Choose the source and time range

A recipe with `take` reads a native [take](take-clock.md) and its
soundtrack. It uses the take's picture rate and the world timeline end
unless `delivery.fps` or `delivery.to` overrides them. Provide a
`soundtrack` path to override the take soundtrack, or use that path
on its own with an explicit `delivery.to`. The soundtrack needs
[scene post routing](foley-perspective.md#route-a-soundtrack-by-role).
The world may be supplied by the take or named by the soundtrack.

```json
{
  "take": "take.json",
  "delivery": {
    "id": "inner-gate",
    "title": "Inner Gate",
    "fps": {"numerator": 24000, "denominator": 1001},
    "from": {"frame": 12},
    "to": {"frame": 144},
    "profile": "ebu-r128",
    "bwf": {"timeReference": "172800000", "originator": "Ink Studio"},
    "cues": [
      {"id": "hold", "label": "Pressure hold", "at": {"frame": 40}, "until": {"frame": 65}, "role": "dialogue"},
      {"id": "inside", "label": "Cut to inside gate", "at": {"frame": 87}}
    ],
    "loops": [{"id": "gate", "label": "Gate hold", "from": {"frame": 87}, "to": {"frame": 126}}]
  }
}
```

A [mixer recipe](audio-mixer.md) uses the same `delivery` object
alongside its ordinary `mixer` and `assets` fields. If it has no
`delivery.to`, the programme includes the mixer's authored end and tail
setting. An explicit `to` fixes the programme endpoint. `from` crops the
printed audio after processing the preceding timeline, so earlier
tails and dynamics reach the edit. A cue, loop or endpoint can use
`{samples}`, `{seconds}`, a musical address, or `{frame}` with an FPS.
All endpoints are converted to the output sample grid.

## Master, premaster, and M&E

- **Printed master** includes the complete master strip. Its compressor,
  saturation, limiting, fader, and automation are baked into the WAV.
- **Premaster stems** represent the compensated contributions at the
  master input. They include dialogue, music, Foley, effects, ambience,
  and returns. Processing on the source strips, groups and returns
  is baked into these stems. Play them at unity to get
  `audio/premaster.wav` exactly at 24-bit PCM precision. Ink applies
  shared premaster headroom if needed and reconciles integer rounding
  across the stems. The manifest records that gain.
- **Returns** contains shared or unassigned feeds and clips placed
  directly on the master. A mixer recipe can set
  `delivery.roles: {"footsteps":"foley","murmur":"dialogue"}` to assign
  custom strips. Assign the strips that feed the master, since a
  subgroup that already mixes different roles prints as one contribution.
- **Music and effects** has a master print and a premaster print. Ink
  rerenders the mix with audio clips removed from the dialogue source
  strips. Dialogue-driven sends and sidechains follow that edit.
  Declare every dialogue source strip in `delivery.dialogueSources`
  if the dialogue passes through an upstream routing group. The default
  is the strips named or assigned `dialogue`. Keep replaceable dialogue
  on its own source strips.

A loop folder contains the region's body and a `with-tail.wav` that
continues into the declared processing tails. If there is a tail, the
same decay is available separately as `tail.wav` at the loop-out
timestamp. The loop render stops new source audio at its endpoint
and lets downstream processors ring out. Repeat the body and play
the tail on release, or use the combined file as a one-shot. The
body boundaries follow the authored cut.

## Broadcast Wave and editorial interchange

Each WAV is stereo 24-bit PCM with a BWF v1 Broadcast Audio Extension.
`bwf.timeReference` is the sample address of session time zero at the
output rate. An hour at 48 kHz is 172800000 samples. Each file adds its
own export start. Use a decimal string for a 64-bit reference.
Optional metadata includes `originator`, `originatorReference`,
`date` (YYYY-MM-DD), and `time` (HH:MM:SS). The delivery manifest
stores each file's actual starting reference. [EBU Tech 3285](https://tech.ebu.ch/docs/tech/tech3285.pdf)

Open `premaster.otio` from the package directory in an OTIO reader.
The audio media references are relative and the timeline carries the
same global start. Its audio tracks hold the delivered premaster stems.
The JSON and CSV cue sheets include authored markers and regions, loop
regions, and sources spotted by the mix or scene. Cue positions include
the absolute sample, offset from the package start, and picture frame
when a picture rate is known. [OpenTimelineIO serialized schema](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/docs/tutorials/otio-serialized-schema.md)

## Quality check

`quality.json` measures the actual encoded WAVs with Ink's stereo
K-weighted gated loudness and oversampled true-peak meter. The
`ebu-r128` preset uses a 48 kHz delivery rate, a −23 LUFS programme
target with ±0.5 LU tolerance, and a −1 dBTP ceiling. A custom profile
can specify `id`, `sampleRate`, `targetLufs`, `toleranceLu`, and
`maxTruePeakDbTP`. Programme loudness applies to the printed master.
The M&E and combined loop prints are metered and checked for rate and
true peak. The check preserves the delivered levels. With `--strict`,
a failed check returns exit status 1 and keeps the package and report
for review. [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I) · [EBU R 128](https://tech.ebu.ch/docs/r/r128.pdf)

[Inner Gate](../examples/music-production/delivery-workshop.cjs)
builds a native take with dialogue, score, Foley, effects, and ambience.
It delivers a nonlinear master, verifies the PCM stem sum, and prints
a gate cue with its reverb tail.

```sh
node examples/music-production/delivery-workshop.cjs spoken-line.wav review
```
