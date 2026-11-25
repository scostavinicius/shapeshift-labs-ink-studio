# Approve a compressed audio round trip

Compare a local compressed delivery with the approved WAV that fed the encoder. Ink decodes the selected audio track to floating-point PCM on its own sample grid. It checks playable length, peak level and any named transient or loop regions.

```sh
ink-studio take approve-audio approval.json --out audio-approval.json
```

The report keeps hashes of both files, the codec and track index, sample counts, padding evidence and the results for each named check. The command exits with status 0 for approval, 2 after writing a flagged or inconclusive report, and 1 for an invalid input.

## Describe the check

```json
{
  "format": "ink-studio/audio-round-trip",
  "version": 1,
  "source": "approved-loop.wav",
  "delivery": "release.m4a",
  "maxTruePeakDbTP": -1,
  "transients": [
    {"id": "latch", "window": {"from": 18000, "to": 24000}, "toleranceMs": 2}
  ],
  "loops": [
    {"id": "body", "from": 0, "to": 96000}
  ]
}
```

Paths follow the plan file. Choose `audioTrack` to select another track by its zero-based audio index. The source and delivery must have the same sample rate and channel count. Ink does not resample, downmix or clip the decoded float samples. The sample budget is 12 million interleaved values per file. The command requires local FFmpeg and FFprobe, with executable overrides available through `--ffmpeg` and `--ffprobe`.

## Read the measurements

- **Priming and padding.** FFmpeg handles packet skip and discard metadata. If an exact final packet duration describes a partial frame, Ink removes the residual padding that remains in the decoded PCM. The report shows the decoded length, declared packet skips and discards, any timestamp-based tail trim, and the resulting playable length. The playable length must match the source WAV.
- **Transient placement.** Use a sample window with one identifiable attack in the source. Ink measures the attack in the same window of both files and reports the signed displacement in samples and milliseconds. A missing or ambiguous delivery attack or displacement beyond `toleranceMs` (default 2 ms) is flagged. A source window with no unique attack is inconclusive. Optional settings are `channel` (all channels, `"mix"`, or a zero-based index), `minStrength` (0.035), `minPeakDbFS` (−42), and `minRiseDb` (6).
- **True peaks.** Ink uses its native eightfold reconstruction on the playable signal at the original decoded level. Both sample peak and true peak are reported. The delivery is compared with `maxTruePeakDbTP` (default −1 dBTP). Samples over digital full scale stay visible to the meter.
- **Loop seams.** Ink checks the wrap from `to - 1` back to `from`, plus the first and last few milliseconds of the loop. It compares the step against the source seam and checks for extra RMS error at the boundary relative to adjacent audio, using the worst channel. Defaults are `maxJumpErrorDbFS: -40`, `maxExcessRmsDbFS: -38` and a five-millisecond `windowSamples` limited to one quarter of the region. Omit `from` and `to` for a whole-file loop. A whole-file loop must match the exact playable length.

Windows and loop endpoints are zero-based on the playable file, with exclusive ends. Container timestamps are checked for gaps and overlaps and reported for provenance. Sample comparisons start at the track's first playable sample.

For a headerless or otherwise unmarked file, supply known player-side trim in `additionalTrim`, for example `{"leading":1024,"trailing":253}`. These are sample counts **after** the automatic metadata trim. Ink uses no reference-derived offset and does not infer missing padding from the expected length.
