# Automatic multisample alignment

Use the raw mono or stereo microphone WAVs from a recorded instrument
session. Give each file a perspective and mark the take windows on the
reference mic's clock, with the register, dynamics, and articulation
already specified. Leave room around each addressed window for source
offsets. All WAVs use the same sample rate.
[Instrument recording session format](instrument-recording-sessions.md)

```sh
ink-studio music instrument align-session capture.json alignment.json --out aligned
ink-studio music instrument build-session aligned/session.json blend.json --out build
ink-studio music instrument audition-session build/instrument.json audition.json --out listen
```

## Measure and inspect

Ink compares the opening transients across the microphones and looks for a
consistent offset and polarity across the session. It keeps the clock of
the reference mic and applies a single integer shift to the whole track,
including both channels of a stereo perspective. Ambiguous or inconsistent
evidence leaves that mic's original settings in place. The report includes
the measured and applied offsets, the matched attack evidence and polarity,
and incomplete source coverage. Raw files stay intact.
[Cross-correlation for delay estimation](https://ieeexplore.ieee.org/document/1162830)

| Alignment setting | Default and behavior |
| --- | --- |
| `reference` | The session's `analyze` perspective. |
| `maxShiftMs` | 80 ms. Search 1–250 ms around each existing offset. |
| `windowMs` | 24 ms. Compare 8–40 ms of the opening transient. |
| `minCorrelation` | 0.30. Accept strengths from the configured minimum, which can range from 0.15 to 0.95. |
| `correctPolarity` | `true`. Correct consistent polarity reversals across the whole perspective. |
| `channels` | Per-mic zero-based channel overrides for measurement. The default uses the first channel. |
| `syncSamples` | Up to 16 ordered reference-clock positions of a shared slate signal. Uses these positions in place of take attacks. |
| `retainDelaySamples` | Per-mic signed number of samples to retain from measured arrival, up to 50 ms in either direction. Applies after the offset estimate. |

Take attacks measure total arrival difference, including acoustic travel.
Use a slate fed through the recording paths to isolate recorder skew while
keeping the acoustic arrivals in the takes. When you know the intended
arrival difference, set `retainDelaySamples` to leave it in place.
Room reflections, channel balance, and relative gain stay in the
recordings. Review inconsistent evidence for file edits or clock drift
before exporting a blended patch.

## Play the calibrated microphones

In `blend.json`, list the perspectives in order from close to far.
Include `alignment` for a single build directly from the raw capture
recipe. The combined build stops when the measurement is unresolved.
Omit `alignment` when building from a session you already aligned manually
or reviewed using `align-session`.

```json
{
  "perspectives": ["close", "middle", "room"],
  "alignment": {"reference": "close", "syncSamples": [7440]}
}
```

The build plays the full recorded one-shots, including their tails. The
normal key, dynamics, and articulation zones still select the take.
Alternate strikes rotate as a group across the microphones. One shared
gain across the bank provides headroom and preserves recorded level
differences. Use the production note's `play.room` value between 0 and 1
to blend adjacent perspectives. With the three positions above, close is
0, middle is 0.5, and room is 1. This control also accepts note expression
curves.

```json
{
  "cases": [
    {"id":"room-sweep","key":60,"velocity":0.8,"articulation":"glass","gate":0.55,
     "play":{"curves":{"room":[[0,0],[1,1]]}}}
  ]
}
```

JavaScript uses `instrumentSession.align(session, assets, options?)` and
`instrumentSession.build(session, assets, options?)`. The graph nodes
`audio.alignInstrumentSession` and `audio.buildInstrumentSession` accept
the same settings and can be connected directly.

Generate the Glass Room demo with
`node examples/multisample-session/demo.cjs output`. Open
`output/index.html` to move the perspective during playback and compare
raw and calibrated clocks. The original synthesized capture files, normal
production recipe, and built instrument are in the same folder.
