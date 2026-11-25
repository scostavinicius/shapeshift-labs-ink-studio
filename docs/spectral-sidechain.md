# Spectral sidechain

Add `spectral-sidechain` to the competing strip and key it from the foreground
strip. The insert compares the spectrum of both signals at each analysis hop.
It reduces gain in frequency bins where both parts are active, with deeper cuts
as the foreground grows stronger relative to the competing part. Both channels
receive the same gain per bin, so the competing strip keeps its stereo image.
The chosen foreground tap supplies the detector and continues along its own
route. [Masking reduction in multitrack mixing](https://aes.org/publications/elibrary-page/?id=17637)

```json
{
  "strips": {
    "lead": {"clips": [{"id": "take", "source": "lead"}]},
    "keys": {
      "clips": [{"id": "take", "source": "keys"}],
      "inserts": [{"processor": "space", "sidechain": {"strip": "lead", "tap": "post"}}]
    },
    "master": {}
  },
  "processors": {
    "space": {"type": "spectral-sidechain", "maxCutDb": 8, "lowHz": 250, "highHz": 6500}
  }
}
```

Use `tap: "post"` to follow the foreground fader and balance, `pre` to hear
the foreground inserts at unity, or `input` to key from the foreground before
its inserts. The mixer aligns both signals on the session grid and compensates
the insert's half-window latency in the export. The processor runs in the
offline mixer and adds zero tail samples.

| Control | Default | Range and behavior |
| --- | --- | --- |
| `maxCutDb` | 8 | 0–24 dB. Hard ceiling on the cut applied to each FFT bin. Use 0 for bypass. |
| `thresholdDb` | −48 | −90 to −6 dBFS per bin. Both signals must clear this floor. Overlap ramps in over the next 10 dB. |
| `attackMs` | 12 | 0–500 ms to follow growing overlap. |
| `releaseMs` | 85 | 0–2000 ms to let the cut decay. Both timing controls are one-pole time constants. |
| `lowHz`, `highHz` | 0, Nyquist | Inclusive processing limits in Hz. |
| `size` | Power of two nearest 43 ms | 256–4096 samples. Larger windows resolve closer frequencies and react over a longer window. Analysis hops by one quarter window. |
| `wet` | 1 | 0–1. Supports mixer automation. Other controls are fixed for a render. |

The mixer insert report records `peakCutDb`, the number of analysis hops with
overlap, and a bounded `trace`. Each row in `trace` covers `traceStepSamples`
from sample zero and gives the deepest mask cut in each band delimited by
`frequencyEdgesHz`. These values describe the mask before the wet blend.

## Audition

```sh
node examples/spectral-sidechain/demo.cjs sidechain-demo
ink-studio music mix render sidechain-demo/project.json --out sidechain-print
ink-studio music mix audition sidechain-demo/project.json --strip rival --insert space --out sidechain-check
```

Open `sidechain-demo/index.html` in a browser. Switch between bypass and
processed during playback, solo the backing keys, or change the ceiling to
rerender the excerpt and see where Ink applied the cut. The same folder
contains the recipe, source WAVs, and the before/after exports.
