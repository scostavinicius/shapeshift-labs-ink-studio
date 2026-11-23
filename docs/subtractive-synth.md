# Subtractive synth voices

A `type: "subtractive"` patch plays in the existing production renderer,
including note clips, performed glide and vibrato, articulation variants,
track gestures, adaptive playback, and graph exports. Each note has its own
amp envelope, filter envelope, filter state, and phase.

```json
{
  "type": "subtractive",
  "saw": 0.34,
  "pulse": 0.71,
  "sub": 0.18,
  "pulseWidth": 0.42,
  "pwm": {"depth": 0.21, "rate": 0.48, "phase": 0.12},
  "env": {"attack": 0.025, "decay": 0.35, "sustain": 0.63, "release": 0.22},
  "filter": {
    "cutoff": 480,
    "resonance": 1.4,
    "keyTrack": 0.85,
    "envAmount": 37,
    "velocity": 8,
    "env": {"attack": 0.04, "decay": 0.31, "sustain": 0.24, "release": 0.25}
  }
}
```

Put the patch under `production.patches` and assign its name to a track.
Render as usual with `music production render` or
`music.renderProduction` in a graph.

## Oscillators

| Control | Meaning |
| --- | --- |
| `saw`, `pulse`, `sub` | Independent levels from 0 to 1. The sub is a sine one octave down. The mix has built-in headroom. |
| `pulseWidth` | Duty fraction. A value of 0.5 gives an even square wave. |
| `pwm` | A note-local sine LFO with `depth` in duty fractions, `rate` in Hz, and initial `phase` in cycles. Duty stays in the 0.02–0.98 range. |
| `env` | The amp ADSR, with attack, decay and release in seconds and sustain as a fraction. |

The saw uses tapered harmonic tables selected for the note's pitch and
modulation range. The pulse subtracts two phase-offset band-limited
saws, with the LFO moving one edge. A guard fades out oscillators near
Nyquist while preserving an in-band sub.

## Filter and performance

The filter is a resonant two-pole low-pass with a separate ADSR. Set
`cutoff` in Hz at middle C, `resonance` as Q (0.5–12), and `keyTrack`
as octaves of cutoff movement per octave on the keyboard. Use `1` for
full key follow and `0` for a fixed cutoff. The cutoff stays below
Nyquist for the chosen export rate.

Set `envAmount` in semitones of cutoff movement at the filter
envelope's peak. Use a negative amount for a downward sweep. Set
`velocity` in semitones per unit of velocity. The velocity offset
is centered at 0.65. A note's `play.brightness` overrides the patch
`color`, with 0.5 neutral and one octave of cutoff movement either side.
Use `filter.bypass: true` to hear the oscillator mix directly.

Articulations can override parts of `pwm`, `env`, `filter`, and
`filter.env`. For example, use
`{"open":{"filter":{"envAmount":46,"env":{"decay":0.55}}}}`
to give selected notes a brighter sweep and a longer decay. Apply
`play.articulation: "open"` on those notes. The other filter settings
come from the base patch. Use Ink's existing chorus or tape effects
on the track or in a downstream mixer for stereo movement.

Oscillator mixing, pulse-width modulation, and a filter envelope with
key follow are classic subtractive controls. [Roland JUNO-60 specifications](https://support.roland.com/hc/en-us/articles/201955179-JUNO-60-Technical-Specifications)

## Hear the difference

Run the [Low Beam workshop](../examples/music-production/subtractive-workshop.cjs)
to print isolated PWM, envelope, and key-follow comparisons and an original
synthwave cue with subtractive bass, pad, and lead patches.

```sh
node examples/music-production/subtractive-workshop.cjs out
ink-studio music production render out/production.json --out replay
```
