# Check sync in delivered picture and sound

A scheduled cue can land at the right point on the timeline while the
visible contact arrives on a later frame or the sound has lead-in silence.
Use `take check-sync` to measure the delivered picture and rendered stem.

```sh
ink-studio take check-sync check.json --out sync-report.json --fail-on-flags
```

## Describe the evidence

```json
{
  "format": "ink-studio/delivered-sync-check",
  "version": 1,
  "picture": "publish/export.json",
  "stems": {"latch": {"file": "publish/latch.wav", "startSample": 0}},
  "checks": [
    {
      "id": "latch-strike",
      "window": {"from": 17, "to": 35},
      "scheduled": {"frame": 24, "sample": 48000},
      "picture": {
        "region": [162, 111, 33, 13],
        "separated": "reference-gap.png",
        "contact": "reference-contact.png",
        "holdFrames": 2
      },
      "audio": {"stem": "latch"},
      "toleranceMs": 25
    }
  ]
}
```

- `picture` can name a `graph clip` report or `take render-av` export with
  numbered PNGs. An independent delivery can use
  `{"fps":24,"firstFrame":0,"frames":["0000.png","0001.png"]}`.
  The frames are contiguous, and rates can be exact fractions such as
  `{"numerator":30000,"denominator":1001}`.
- `stems` names the rendered WAVs. `startSample` places each WAV's sample
  zero on that stem's take clock at its own sample rate. It defaults to
  the Broadcast Wave time reference when present, then zero. Use the
  reserved stem name `export` to check the WAV in an audiovisual export,
  unless the recipe supplies its own stem under that name.
- `window` uses absolute frame indices and excludes `to`. The WAV must
  cover the same interval. Include a frame that clearly shows separation
  and leave room for either an early or a late attack. Use one window per
  contact. `scheduled` is optional. Its frame and absolute sample are
  reported separately from the measured offset.
- `region` is `[left, top, width, height]` in delivered pixels. Choose a
  tight area around the point of contact. Supply two full-size PNG
  exemplars with the same framing and dimensions as the inspected frames.
  The check compares visible pixels that distinguish the gap from contact.
  Use a stable crop through the event so a camera move or another action
  does not dominate the match.
- `holdFrames` defaults to 1. Higher values require a continuous match
  and still report the first frame of the run. `maxError` defaults to
  0.14 on normalized, premultiplied display channels. Smaller settings
  demand a closer match. Keep it tight when the last visible gap is small.
- For audio, use an isolated rendered stem for the contact. The native
  transient detector estimates the onset on that stem's sample grid.
  `channel` defaults to `all` and can be a zero-based channel or `mix`.
  `minStrength` defaults to 0.035. The shortly following peak must meet
  `minPeakDbFS` (default −42) and rise by `minRiseDb` (default 6) above
  its local baseline. These thresholds characterize the specified stem.

The report lists the first visible contact frame, the measured onset
sample, and the signed audio-minus-picture offset in milliseconds. It uses
the start of the visible frame as the picture timestamp. A frame supplies
no finer timing than its display interval. The report includes the
per-frame match scores and competing detector candidates. Multiple hits,
missing evidence, an uncovered stem window, and contact already present
when the scan opens produce `needs-review`. The measured offset is left
blank when either measurement is unresolved.

Offsets outside `toleranceMs` (default 25) are labeled `audio-early` or
`audio-late`. With `--fail-on-flags`, a flagged or unresolved check writes
its report and exits with status 2.

If the lead or delay is an editorial choice, use an
[attention handoff audition](attention-handoff.md) to compare intentional
placements against one fixed picture.

## Relay Press example

Both versions schedule the relay at 1.000 seconds. The native picture
first shows contact on frame 26 at 1.083 seconds. The original stem
attacks at 1.225 seconds. Slipping the sound's lead-in moves its measured
attack to frame 26 while leaving the scheduled cue in place.

From an Ink checkout with Node and FFmpeg, render the picture and both
stems, then build the interactive comparison.

```sh
node examples/delivered-sync/demo.cjs /path/to/relay-press-review
```
