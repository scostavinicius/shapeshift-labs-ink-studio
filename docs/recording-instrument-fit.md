# Recording-to-instrument fitting

Fit one audible gesture and compare several playable ways to reconstruct
it. The output patches use the same [instrument graph](music-instrument-graphs.md)
as handwritten instruments. They can go into an ordinary production, a
score edit session, or a headless graph.

```sh
ink-studio music instrument fit recording.json --out fitted
ink-studio music instrument audition-fit fitted/instrument-fit.json --out audition
```

Use one WAV, WAV slice, catalog take, edit slice, or print reference.
The fitter accepts mono and stereo recordings between 20 ms and six
seconds at 8–96 kHz.

```json
{
  "assets": {
    "strike": {"wav": "bench.wav", "fromSample": 22400, "toSample": 38400}
  },
  "options": {"root": "C4", "partials": 4, "modes": 6, "attackMs": 55}
}
```

Omit `root` to use the detected note if there is enough voiced evidence.
C4 is the default audition key for unpitched material. A root override
retunes the harmonic synth to the new key and places the measured
resonances at that key on the modal candidate. `analysis` accepts the
pitch settings from the [sample builder](sample-instrument-builder.md).
Set `partials` to 1–5, `modes` to 1–8 and `attackMs` to 8–180.

| Candidate | What Ink fits | What to edit |
| --- | --- | --- |
| `synth` | Pitch contour and time-varying harmonic levels for a voiced source, or stable inharmonic partials when present. A small filter bank renders shaped residual noise. | Oscillator ratios, pitch and level curves, and air-band gains and cutoff. |
| `modal` | Persistent spectral peaks give frequency ratios and relative gains. A logarithmic level slope estimates each measurable T60. The exciter uses a short noise burst for a ringing decay or a shaped source for sustained gestures. | Mode ratios, decay, level, and the exciter. Use per-note damping to shorten the ring. |
| `hybrid` | The preferred model with an added sample layer from the opening of the recording. The synthetic body fades in under the fixed-length attack. | The sample zone, its level and tuning, the blend curve, and all the model nodes. |

An aperiodic sound can yield only `synth` and `hybrid`. The report
identifies the fitted channel, exact source range, root estimate,
partial and mode evidence, estimated decay or missing decay, and
the attack length. The comparison includes the original cropped
recording in its original channel layout. Fitting selects the
higher-energy channel for synthesis and the captured attack.

These are compact models of a single performance. A breath can stay
unpitched across the keyboard, and a struck resonator rings according
to damping even if its note is held longer. The fitter estimates
dynamics from the gesture's envelope. To author different physical
strikes at different velocities, edit the graph or combine several
recorded takes using [sample zones](sample-instrument-builder.md).
The analysis uses short-window spectral peaks, residual band energy,
and approximate modal decay. [Spectral Modeling Synthesis](https://mtg.upf.edu/node/251) · [Modal Expansion](https://dsprelated.com/freebooks/pasp/Modal_Expansion.html)

## Edit, audition, and play

The fit command writes `instrument-fit.json`, `reference.wav`, and the
attack asset under `samples/`. The manifest holds ordinary patches under
`fit.patches` and a relative asset table. Change the nodes inline or copy
a patch into a production and resolve its assets relative to the manifest.

Add an optional `audition` block alongside `fit` in the manifest:

```json
{
  "candidates": ["synth", "hybrid"],
  "sampleRate": 32000,
  "gapSeconds": 0.2,
  "cases": [
    {"id": "match", "midi": 60, "velocity": 0.8, "gate": 0.4},
    {"id": "higher", "midi": 67, "velocity": 0.8, "gate": 0.4},
    {"id": "soft", "midi": 60, "velocity": 0.27, "gate": 0.4},
    {"id": "held", "midi": 60, "velocity": 0.8, "gate": 1.1, "play": {"breath": 0.7}}
  ]
}
```

Notes accept MIDI pitch, seconds of gate, velocity, and optional per-note
expression. Omitting cases auditions the root, a fifth below and above,
the root at lower velocity, and a held note. The default per-candidate
match derives one gain at the case named `match` or at the first case.
The same gain applies to every note of that candidate, so changes in
velocity remain audible. Use `levelMatch: "shared"` to compare the
patches at their written relative gains. All clips share the final
headroom adjustment. The report gives exact cue sample ranges.

In a graph, connect `audio.fitInstrument`'s `value`, `assets`, and
`reference` outputs to `audio.auditionInstrumentFit`. JavaScript uses
`KIT.procedural.mediaGraph.instrumentFit.fit(source, options)` and
`audition(fit, assets, options, reference)`.
