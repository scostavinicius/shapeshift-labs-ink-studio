# Independent signal analysis

Use `signal-compare` in an existing [measurement plan](simulation-measurements.md) to compare time-domain and frequency-domain estimates from one sample window. The result is their absolute difference in Hz. The two individual estimates, signed difference, and method diagnostics remain available under `evidence`. For resonance and pitch, the report also includes a signed difference in cents.

```json
{
  "format": "ink-studio/simulation-measurement-run",
  "version": 1,
  "sources": { "pickup": { "file": "pickup.wav" } },
  "plan": {
    "format": "ink-studio/simulation-measurement-plan",
    "version": 1,
    "id": "verify-ring",
    "measurements": {
      "width": {
        "kind": "signal-compare",
        "source": "pickup",
        "metric": "bandwidth",
        "band": [385, 490],
        "window": { "from": 0, "to": 24000 }
      }
    },
    "assertions": {
      "matches": { "measurement": "width", "unit": "Hz", "max": 0.04 }
    }
  }
}
```

| Metric | Time domain | Frequency domain |
| --- | --- | --- |
| `resonance` | Fit a second-order recurrence with a constant baseline. Convert the complex pole's phase advance to Hz. | Find a local peak in a Hann-windowed FFT and interpolate its location in log magnitude. |
| `bandwidth` | From the fitted pole radius, estimate the amplitude decay coefficient and divide by π for the high-Q ring-down linewidth. | Measure the distance between the two half-power crossings around the peak in a rectangular-window FFT. |
| `pitch` | Use Ink's YIN lag estimator on a short span centred in the selected window. Refine the chosen lag against the sample differences. | Fit an integer harmonic series to salient peaks from the full Hann-windowed FFT. The root can be absent if the observed harmonics give a unique period. |

Isolate the mode of interest before comparing resonance or bandwidth. The time fit uses the original samples in the window. For bandwidth, capture a freely decaying response and place both half-power crossings inside `band`. The measured width must be at least twice the reciprocal of the observation length. The FFT is zero-padded for interpolation, and the observation length sets the resolution. The time estimate also requires a decaying pole with a quality factor of at least 5.

For pitch, use a stable monophonic note and a band around the expected fundamental. The spectral search can inspect partials above the fundamental band. A changing note or a weak harmonic series can produce disagreement or an unavailable path. The FFT evidence lists the strongest partial and the harmonics used. The time evidence includes the actual sample span and the lag confidence.

`band` is an increasing pair of positive Hz values within Nyquist. A comparison accepts at most 65,536 samples. Set optional `minRms` in the input's unit to reject weak evidence. Resonance and bandwidth accept `minFit` for the recurrence R², defaulting to 0.99. Pitch accepts a YIN `pitchThreshold` from 0 to 1, exclusive, defaulting to 0.16.

Read native wave, modal, or sensor outputs, a named sample trace, or interleaved PCM audio. A WAV source uses the existing normalized decoder and appears as `ch1`, `ch2`, and so on, with full-scale units (`FS`) and an initial sample index of 0. Select a channel explicitly for multichannel inputs. A measurement is unavailable if either estimate is unavailable, and the report still includes both paths and their reasons. Assertions return exit code 2 on an unavailable estimate or a difference outside the authored bound.

```sh
ink-studio sim measure bench.json --out report.json
node examples/simulation-signal-comparison/demo.cjs ./studio/out/signal-comparison
```

The library and `sim.measure` graph node accept the same plan and already-loaded sources. The demo writes the editable bench files, plots, and WAVs. It compares the shipped damped oscillator, an isolated mode from the shipped membrane mesh, a note with a missing fundamental, and a note that changes inside the analysis window.
