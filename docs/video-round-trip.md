# Approve a video codec round trip

Compare a delivery video with the numbered source frames that fed the encode. Ink decodes the first video track at its stored dimensions and reads its presentation timestamps. A damaged delivery produces a labeled side-by-side review at the earliest affected source frame, plus a map of the flagged pixels.

```sh
ink-studio take approve-video approval.json --out review
```

`review/index.html` opens the comparison and provides fit, native-pixel and enlarged views. `comparison.png` puts the source to the left of the decoded frame. `damage.png` marks amber palette failures, pink accent failures and cyan flicker. `report.json` includes the exact delivery hash, codec, pixel format, comparison settings, scan coverage and flagged frames. It includes detailed observations for the first 512 flagged frames.

## Match the input frames

```json
{
  "format": "ink-studio/video-round-trip",
  "version": 1,
  "delivery": "release.mp4",
  "picture": "published/export.json",
  "window": {"from": 24, "to": 144},
  "scale": 3,
  "cuts": [84],
  "palette": {
    "pairs": [
      {"id": "switch-and-panel", "colors": ["#be2d37", "#22601a"]}
    ]
  },
  "accents": {"colors": ["#f5c569"]},
  "flicker": {"minChange": 12}
}
```

`picture` accepts a [graph clip report](graph-clips.md), a [synchronized audiovisual export](audiovisual-takes.md), or numbered PNGs specified as `{"fps":24,"firstFrame":0,"frames":["0000.png","0001.png"]}`. Use opaque display-referred source PNGs. Paths are relative to the approval plan. `window` selects an optional absolute source frame range with an exclusive `to`. The full delivery track must cover exactly that selection.

The decoder uses the delivered raster. Set `scale` to the integer enlargement from the source artwork to the delivery, with a default of 1. At larger scales the checks average each corresponding delivery block, while the preview shows the original decoded pixels and a nearest-neighbor source. Ink requires unrotated square-pixel SDR, up to 4,200,000 pixels per frame and 540,000,000 pixels per review. The command uses local FFmpeg and FFprobe. Use `--ffmpeg` and `--ffprobe` to specify their executable paths.

A constant container timestamp offset is allowed. After that offset, frame count and cadence must agree with the source clock within one container tick. Missing, duplicate, irregular or mismatched frames make the input invalid.

## Read the findings

- **Palette separation.** Protect individual pairs by listing their source swatches in `palette.pairs`. Ink measures retained contrast along each pair's original OKLab color axis. It checks adjacent pixels and, for protected pairs, the average decoded color at areas painted with each swatch. The default minimum retention is 0.50. For edges the defaults are at least two contacts and a maximum damaged share of 0.12. Without protected pairs, Ink tests neighboring pairs among up to 12 frequent exact source swatches per frame. Set `minRetained`, `minContacts` or `maxDamagedShare` to change those thresholds.
- **One-pixel accents.** Ink looks for high-contrast pixels between matching source colors across either axis. A thin accent flags when its contrast against the adjacent pixels falls below `minRetained` or its color leaks into those neighbors beyond `maxBleed`. Chroma is also checked on its own when source chroma contrast reaches `minChromaContrast` (default 0.08 OKLab), so a thin colored accent can fail even when its brightness holds. Leakage uses a second pair of matching source pixels as the local baseline. The defaults are `minSourceContrast: 0.10` in OKLab, `minRetained: 0.55` and `maxBleed: 0.24`. Use `colors` to focus on named accent swatches.
- **New flicker.** Across three consecutive frames, Ink looks for a decoded error that jumps and reverses at an art pixel where the source stayed steady. It marks the middle frame. The defaults are `minChange: 12`, `sourceTolerance: 2`, `returnTolerance: 5` in 8-bit channel values, and `minPixels: 2`. The check skips triplets across cuts. Ink reads graph clip cut markers and accepts additional absolute source frame numbers in `cuts`.

Any check can be disabled with `false`. Approval covers the checks and thresholds selected for the excerpt. The command exits with status 0 for an approved video, 2 after writing a flagged or inconclusive review, and 1 for invalid inputs. A protected palette pair that never appears together in a source frame, no matching protected thin accent, or no held source pixels in an uninterrupted flicker triplet is recorded as unchecked. Use a new review directory for each pass.
