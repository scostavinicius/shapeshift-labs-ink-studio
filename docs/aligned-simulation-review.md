# Aligned simulation review

Use `sim review` to compare two simulation outputs over one take interval. Ink writes the same audio and picture range for both sides, native traces and event logs, plots, and a report that links the earliest observed difference to the matching cutaway frame and a detail plot.

```sh
ink-studio sim review comparison.review.json --out review --require-match
```

```json
{
  "format": "ink-studio/aligned-simulation-review",
  "version": 1,
  "id": "valve-timing",
  "clock": { "fps": { "numerator": 30000, "denominator": 1001 }, "sampleRate": 24000 },
  "from": 2,
  "to": 28,
  "reference": {
    "ring": { "file": "reference.resonator.json" },
    "switch": { "file": "reference.contact.json" }
  },
  "candidate": {
    "ring": { "file": "candidate.resonator.json" },
    "switch": { "file": "candidate.contact.json" }
  },
  "traces": {
    "pickup": { "source": "ring", "channel": "tip", "tolerance": { "absolute": 0.000001 } }
  },
  "events": { "strike": { "source": "switch" } },
  "audio": { "tracks": ["pickup"], "gain": 900 },
  "picture": {
    "graph": "valve-picture.json",
    "output": "picture",
    "format": "both",
    "warmup": 2,
    "bindings": {
      "lift": {
        "source": { "kind": "trace", "name": "pickup", "stat": "peak" },
        "input": [0, 0.0006],
        "output": [0, 0.35]
      }
    }
  }
}
```

`reference` and `candidate` use the [simulation measurement source descriptors](simulation-measurements.md) for saved JSON, WAV, or executable native runs. References are relative to their owning file. Each `traces` or `events` entry selects the same named source on both sides. At least one trace or event track is required.

## Compare on the native clocks

The take clock uses absolute picture frames and an exclusive `to`. The start and end of each frame are floored onto each trace's sample clock, as they are for audiovisual take export. Each pair must share a native sample rate and unit. Different pairs may use different rates. Use optional `trace` settings to select a native output such as wave flow or a named contact track.

Sample tolerance is the greater of the explicit `absolute` error and `relative × max(abs(reference), abs(candidate))`. Both default to zero. The report stores the first sample beyond tolerance, along with counts and maximum error. It also detects a sample present on only one side. A common gap or a window with no native sample addresses leaves an incomplete comparison.

Events retain their exact fractional occurrence times. The shared frame range filters them by exact time. Use optional event adapter `options` to select a nested log by `path` or attach a rate or tick period. Ink compares the retained sequence in occurrence order and preserves source order at ties. The report keeps the first different occurrence, payload, or missing event. A log reporting dropped events leaves coverage incomplete.

`firstSample` and `firstEvent` preserve both findings. The overall `first` is the earlier exact time, with events taking precedence on a tie. Each finding includes the take frame and sample address. Sample findings also keep the native rate and address. The status is `exact`, `within-tolerance`, `incomplete`, or `diverged`.

## Artifacts

- The `reference` and `candidate` folders contain native trace and event JSON. Both use the same requested window. Empty or partial traces retain their coverage metadata.
- Each selected track gets a PNG plot with a shared scale or time axis. The first difference adds `plots/focus.png` and links to the matching cutaway frame in `review.json`. When both an event and a sample differ, the report also links a detail plot for the second finding.
- Optional `audio` exports two 24-bit Broadcast WAV files with identical sample boundaries, channel order, and gain. Selected tracks must use the take sample rate. The BWF time reference stores the absolute start sample. Missing PCM coverage is padded with silence and listed in the report. Excessive gain produces a clipping error.
- Optional `picture` runs the same graph, camera, inputs, seed, frame range, and warm-up on each side. It exports numbered PNGs or numbered PNGs plus APNG with `format: "both"`. Use [picture controls](audiovisual-takes.md) to drive a cut plane or geometry from native trace statistics or from the exported audio bus named `mix`. Bindings feed the graph's `controls` record input by default. Native trace controls can read samples before the exported window during warm-up. Both sides must render at the same art dimensions.

`--require-match` writes the review before returning exit code 2 for divergence, incomplete coverage, or a failed picture graph assertion. The library comparator is available as `KIT.world.alignedReview.compare(settings, {reference, candidate})` with already loaded source tables.

```sh
node examples/aligned-simulation-review/demo.cjs ./studio/out/aligned-review
```

The demo compares two strikes on the same cutaway resonator. Moving the second strike changes the exact event time before the first differing displacement sample. It also repeats the review with the same run on both sides.
