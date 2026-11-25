# Room impulse capture

Play a logarithmic sweep through the room speaker and record it at the position
where you want a [room response probe](room-response.md). Ink deconvolves the
recording against the emitted sweep. An electrical loopback measures the
interface delay, so the corrected response keeps the sound's travel time from
speaker to microphone.

Serve the repository on localhost and open
`/examples/room-impulse-capture/`. Use a secure origin for Web Audio capture.
The page requests audio with echo cancellation, automatic gain control, and
noise suppression disabled.

- For a single calibrated pass, connect the microphone to input 1 and patch the
  sweep output into line input 2. Choose **Mic left · loopback right**.
- For a separate loopback pass, record the electrical reference first. Then
  connect the room microphone or stereo pair and leave the interface, output
  routing, sample rate, and buffer settings in place. Use the same clock for
  playback and recording. Leave time for the room to decay after the sweep.
- Use a clean line-level reference and leave headroom on the room input. Ink
  rejects clipping and reports when it cannot locate a clear loopback peak.

The editor shows interface delay and the detected direct arrival. Move the
arrival marker if the automatic estimate picked a stronger reflection. The
direct cut keeps the return wet-only so Ink can play the dry source separately.
The early and tail masks overlap with a complementary crossfade. Both retain
their place on the corrected sample grid. Move the split or shorten and fade
the end of the response, then set independently how much early and late
energy to send back. The edit keeps the original latency-corrected response
WAV alongside the editable JSON.

## Capture from WAVs

```sh
ink-studio room-impulse sweep --out sweep.wav
ink-studio room-impulse measure room.wav --loopback loopback.wav --out stairwell
ink-studio room-impulse split stairwell/room-impulse.json --out stairwell
```

The defaults produce a 48 kHz, 3-second sweep with 250 ms of leading silence
and 2 seconds for decay. If you changed the sweep options, pass the same
values to `measure`. Record the original sweep without lossy encoding or
dynamics processing. The room file can be mono or stereo and the electrical
reference must be mono at the same sample rate. The default alignment assumes
the recordings start when the sweep WAV is launched. For recordings on a DAW
timeline, use `--room-start` and `--loopback-start` for the frame at which
the rising sweep begins in each file. Count any recorded lead-in in that frame index. Supply
`--latency-ms` instead of `--loopback` when you have a measured delay from
the same interface setup. `--max-latency-ms` sets the peak search window and
defaults to 250 ms. The automatic direct-arrival search covers the first
160 ms after correction. The room capture supports 8–96 kHz. The room mixer applies
its existing impulse length and sample limits.

## Use the edit in a soundtrack

Keep `room-impulse.json` and `response.wav` together. Headless soundtracks can
derive both layers directly from the edit. Browser hosts can use the baked
layer WAVs with the existing room asset resolver. The editor and the
`room-impulse split` command bake saved layer levels into those WAVs.

```json
{
  "assets": {
    "stairwell-early": { "roomImpulse": "stairwell/room-impulse.json", "layer": "early" },
    "stairwell-tail": { "roomImpulse": "stairwell/room-impulse.json", "layer": "tail" }
  },
  "spatial": {
    "roomResponse": {
      "wet": 0.6,
      "rooms": {
        "stairwell": {
          "min": [-3, 0, -3],
          "max": [3, 4, 3],
          "probes": [{
            "at": [0, 1.5, 0],
            "impulse": {
              "early": "stairwell-early",
              "tail": "stairwell-tail",
              "earlyGain": 0.9,
              "tailGain": 0.6
            }
          }]
        }
      }
    }
  }
}
```

Probe gains multiply the saved edit levels. Each layer uses one of the
mixer's eight impulse slots. Regular single-WAV probes can share the same
room or doorway with captured probes. Use the same rate for capture and
audition when comparing exact levels.

Generate the self-contained browser audition, stereo fixture, and Ink
soundtrack with
`node examples/room-impulse-capture/demo.cjs <output-directory>`.
The fixture simulates a measured stairwell with a 37.5 ms interface delay and
14 ms of acoustic travel. You can download the edit, reopen it, and audition
the early reflections and tail independently.

The measurement uses regularized frequency-domain inversion of an exponential
sine sweep. [Angelo Farina, Impulse Response Measurements](https://www.angelofarina.it/Public/NordicSound-2007/NordicSound-Farina_paper.pdf)
