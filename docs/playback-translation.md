# Audition playback translation through measured devices

Use measured impulse responses to listen to the same mix through phone, laptop, and small-speaker playback chains. Ink writes a reference, a WAV for each target, a listening page, and a report of cues at risk of losing their bass.

```sh
ink-studio music mix translate translation.json --out translation-review
```

Open `translation-review/index.html` and switch targets during playback to keep the same position in the mix. Click a cue to jump to its window.

## Supply measured responses

Record a sweep from each physical device at the position where you want to audition it. Use the [impulse capture tool](room-impulse-capture.md) to remove interface latency, or provide a measured impulse WAV. Each target uses the response supplied for that device.

```json
{
  "format": "ink-studio/playback-translation",
  "version": 1,
  "title": "Relay cue",
  "mix": "mix.wav",
  "targets": [
    {"id": "phone", "label": "Phone speaker", "device": "phone", "response": "phone.wav"},
    {"id": "laptop", "label": "Laptop speakers", "device": "laptop", "input": "stereo", "response": "laptop/room-impulse.json", "window": {"fromSample": 0, "toSample": 12000}},
    {"id": "small", "label": "Small speaker", "device": "small-speaker", "response": "small.wav"}
  ],
  "cues": [
    {"id": "relay", "label": "Relay engages", "stem": "relay-stem.wav", "fromSample": 48000, "toSample": 72000}
  ]
}
```

Paths follow the plan. Mixes, stems and responses are mono or stereo WAVs from 8 to 96 kHz. If needed, Ink resamples the measured response to the mix rate before using it for both convolution and analysis. Select a response `window` of up to 500 ms when the capture is longer. `directSample` uses the original response sample address and must fall inside that window. It defaults to the capture's direct arrival for a room-impulse asset and zero for a WAV. For a capture, translation uses the response including its direct arrival. The room-send layer settings serve a different mix path.

Targets default to half-sum mono input. Set `input: "stereo"` to keep the channels separate. A mono response applies to both output channels. With a stereo response, the corresponding response channel applies to each side. Acquire diagonal responses for this stereo mode and use the two response channels as the two listening outputs after a mono fold.

Ink aligns the direct arrivals, calibrates each target to unity mean power in the 500–2,000 Hz reference band, and applies one shared headroom gain to the reference and every preview. It preserves relative levels between frequency regions. Each output includes the aligned convolution tail and shares the same sample count. Results describe the measured linear response at the capture position.

## Identify cue risk

Use a stem containing the cue at the same sample rate, duration and placement as the mix. An unisolated window can show a possible problem in the mix. The report marks it for isolation so bass from a competing part does not count as evidence about the cue itself.

A cue–target pair flags when at least 76% of the source and routed spectral power lies in the 25–180 Hz bass band, the calibrated device attenuates that bass by at least 10 dB, and the cue loses at least 4 dB overall. The cue must reach −54 dBFS RMS before and after routing. Power comes from overlapping windowed spectra and the measured response. The report shows routing loss separately, including bass that cancels in the mono fold. Audition the result to judge whether the cue remains recognizable.

Override these defaults with `thresholds.bassHz`, `referenceHz`, `minBassShare`, `minBassLossDb`, `minCueLossDb` and `minCueRmsDbFS`. Cue windows are 25 ms to eight seconds. A plan supports up to eight target profiles and 32 cue windows. Use a shorter mix excerpt if the previews exceed the combined sample budget.

`report.json` includes the measured file hashes, response windows and direct arrival offsets, calibration gain, shared preview gain, and the per-device bass and cue losses. The command writes to a new output directory and leaves the mix and captures intact.
