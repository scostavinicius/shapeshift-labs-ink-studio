# Sound design inserts

Put these processors on a clip strip, send, or return in an
[offline mixer session](audio-mixer.md). Every insert works with
`music mix render` and `audio.renderMixer`. The existing `wet` lane blends
the processed and latency-aligned dry paths. Use separate strips and
taps to print individual treatments or combine them in parallel.

## Echo and space

```json
{
  "echo": {
    "type": "tempo-delay", "beats": {"numerator": 3, "denominator": 4},
    "feedback": 0.62, "lowHz": 300, "highHz": 3300, "driveDb": 15,
    "crossfeed": 0.8, "wet": 0.55
  },
  "cabinet": {
    "type": "convolution", "impulse": "metal-cabinet",
    "preDelayMs": 16, "gainDb": -3, "wet": 0.72
  }
}
```

With `tempo-delay`, each repeat reads a division of a beat earlier on
the session's tempo and swing map. `lowHz` is the feedback high-pass
and `highHz` is the feedback low-pass. They and `driveDb` act inside the
loop, so the first echo stays clean and each pass changes the next.
`crossfeed` blends the feedback toward opposite channels. These controls
and feedback level accept automation. The beat division is fixed.

With `convolution`, pass the impulse response as an audio asset in the
same table as the clips. A CLI asset can point to a WAV, and a graph
asset can come from an audio node. Use a mono impulse for both channels
or stereo for separate left and right responses. `fromSample` and
`toSample` select a half-open range on the original impulse. `reverse`
reverses the resampled response. `preDelayMs` adds an artistic offset,
and `gainDb` accepts automation. Impulses can use up to eight seconds
and 262,144 frames after resampling. The offline FFT convolver preserves
the full impulse tail when the mixer retains tails. [Wefers on partitioned convolution](https://publications.rwth-aachen.de/record/466561/files/466561.pdf)

## Move the read head

| Insert | Controls |
| --- | --- |
| `modulation` | Choose `chorus`, `flanger`, or `vibrato`. Set its center `delayMs` and stereo LFO phase offset `spread` in cycles. Automate `rateHz`, `depthMs`, and signed `feedback`. |
| `tape-drift` | Set fixed `wowHz`, `flutterHz`, stereo `spread`, and `seed`. Automate the depth in `wowCents` and `flutterCents`. The desk compensates the center delay, leaving the pitch motion around it. |
| `granular` | Set `grainMs`, grains per second with `density`, and `start` on the strip's input timeline. Automate `scanRate` and `semitones` separately. Negative scan moves through the source backward and zero holds one position. `sprayMs`, `jitterCents`, `reverse` probability, and stereo `spread` vary grains according to the `seed`. |

Grains overlap under a Hann window. Use `wrap: true` to scan the strip
input as a loop. `extendSeconds` adds room to the processor's output when
tails are kept. The `start` position can use the same beat, second, or
sample addresses as mixer clips. Trim or position a source clip before
the insert to scan a particular recording range. [Puckette on audio transformations](https://msp.ucsd.edu/~msp/Publications/artmath-reprint.dir/)

## Hold a spectrum

```json
{
  "type": "spectral-freeze",
  "at": {"beat": 3.5},
  "until": {"beat": 8},
  "size": 2048,
  "fadeMs": 90
}
```

The freeze captures a window centered at `at`. It holds magnitudes,
advances each spectral bin at the frequency estimated from its phase,
and preserves the phase offset between channels. Crossfades return to
the input at `until`. Use `length` with `beats`, `seconds`, or `samples`
to specify a duration instead. FFT sizes range from 256 to 8192 in
powers of two. The insert reports its capture and release samples.

## Separate the retro controls

```json
{
  "type": "retro-sampler",
  "rateHz": 3500,
  "bits": 5,
  "interpolation": "cubic",
  "retriggers": [
    {
      "at": {"beat": 1.75}, "from": {"beat": 1.25},
      "length": {"beats": 0.2}, "every": {"beats": 0.25}, "count": 4
    }
  ]
}
```

Use `rateHz` for the capture clock, `bits` for quantization, and
`interpolation` to reconstruct the captured values with `hold`, `linear`,
or `cubic`. The default clock is the session rate. Bit depth zero keeps
full precision. Lower the clock alone for sample-and-hold texture or
choose a low bit depth at the original rate to hear amplitude steps.

Retriggers replay a window from an earlier point on the strip input.
The replay length and optional repeat interval can use beats, seconds,
or samples. A later event takes over an overlapping replay. The capture
clock keeps running through retriggers, and reconstruction still acts
on the resulting captured samples. Linear and cubic reconstruction
declare the lookahead they use at a reduced rate. At the native rate,
retrigger timing works at individual samples.

## Demo

Run [Signal Cabinet](../examples/music-production/sound-design-workshop.cjs)
with `node examples/music-production/sound-design-workshop.cjs output`.
It runs the same keys and recorded percussion through each processor
and writes the editable session, WAV and report for each pass. The
convolution pass imports a stereo WAV built from a recorded brake-drum
ring and authored reflections. The final four passes isolate the retro
capture clock, bit depth, reconstruction choice, and replay timing.
