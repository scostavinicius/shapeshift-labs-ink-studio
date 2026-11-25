# Performance-driven mouth cels

Compile an isolated scratch or final voice read into an editable exposure
sheet. Ink uses supplied pronunciation as the phone order and measures
energy, periodicity, and high-frequency changes in the recording to
propose timing. Change the read and run the compiler again before approving
the holds. Supply the words as a transcript or IPA. Alignment runs locally.

```sh
ink-studio take mouth-cels plan.json --out take
```

## Author a read and a cel bank

```json
{
  "format": "ink-studio/mouth-cel-plan",
  "version": 1,
  "id": "moon-relay",
  "audio": "read.wav",
  "fps": 16,
  "rig": {
    "grid": [112, 86],
    "origin": [51, 48],
    "size": [18, 10],
    "rest": "rest",
    "poses": ["rest", "seal", "teeth", "open", "open-accent"],
    "accents": {"open": "open-accent"}
  },
  "utterances": [
    {"id": "dispatch", "speech": {
      "kind": "text",
      "text": "Mark five.",
      "symbols": ["aɪ"],
      "lexicon": {"mark": "mɑɹk", "five": "fˈaɪv"}
    }}
  ],
  "art": {
    "face": "art/portrait.png",
    "cels": {
      "rest": "art/rest.png",
      "seal": "art/seal.png",
      "teeth": "art/teeth.png",
      "open": "art/open.png",
      "open-accent": "art/open-accent.png"
    }
  }
}
```

- Use a mono or stereo PCM WAV at 8–96 kHz. Set the zero-based `channel`
  to select an isolated voice on a stereo file. Multiple utterances can
  supply ascending, nonoverlapping `fromSample` and `toSample` windows
  from the read. A window accepts up to 20 seconds of audio. A single
  utterance can omit its window to cover the read.
- Use Ink's [input compiler](input-compilers.md) pronunciation settings.
  `kind: "ipa"` accepts Unicode IPA in `text`. `kind: "text"` uses a
  lowercase lexicon. `fallback: "english"` opts into the existing
  heuristic for words absent from the lexicon and reports the guesses.
- Draw cels on a common transparent patch. `grid` is the full character
  image size, `origin` is the top-left attachment in whole pixels, and
  `size` is the cel patch size. `fps` can be an exact ratio, such as
  `{"numerator":24000,"denominator":1001}`. The compiler holds one
  pose at a time without scaling or interpolation.
- Ink groups phones into `seal`, `teeth`, `tongue`, `hiss`, `round`,
  `spread`, `open`, or `narrow`. The matching pose name is used when
  present. Use optional `rig.bindings` to map classes to other pose IDs
  and `rig.phones` to override individual IPA symbols. Classes without
  a binding can use `narrow` when supplied, then the rest cel.
- `rig.accents` maps a base pose to a more emphatic drawing. A vowel can
  take an accent from primary IPA stress, measured energy above the
  phrase's reference level (`accentDb`, default 2 dB), or a longer voiced
  hold. Short phones compete for whole frames. The sheet keeps their
  sample estimates and tells you whether each phone gets an exposure.

## Review and render

The command writes `mouth-holds.json`. Adding the optional PNG art table
also writes a standalone page with the recorded read, face, and cels
embedded. Scrub or play the read, click an exposure, swap its pose or
shift its start frame one frame at a time. Approve each hold when ready.
A pose edit reopens its approval and a boundary edit reopens both
affected holds. Download the revised sheet to keep the changes. Open a
review from a trusted local project with a browser that supports WAV
playback.

Each hold has the stable fields `id`, inclusive `from`, exclusive
`to`, `pose`, and `approval` (`proposed` or `approved`). Edit the
JSON directly for larger changes. The holds must cover every frame
exactly once. The source phone rows record the original audio analysis
and stay with the edits. Listen and verify the short stops and emphases
before approving, especially on noisy reads or when the spoken words
differ from the pronunciation guide.

In a render graph, load the revised sheet with `jsonAsset` and the face
and mouth cels with `pngAsset`. Collect the cel rasters by name with
`data.record` and connect them to `raster.mouthCels.cels`. The node
uses the graph time or exact take-frame time, composites the selected
cel onto the face, and returns the active `hold` for inspection.
Set `approvedOnly: true` to reject any sheet with proposed holds.
Custom hosts can use `KIT.world.mouthCels.open(sheet)`.

## Moon Relay example

The example draws a pixel-art relay operator and cues “Mark five. Blue
moon.” Mouth shapes include labial closures, teeth on /f/, a wide
emphasized /aɪ/, and a rounded stressed /uː/.

```sh
node examples/performance-mouth-cels/demo.cjs /path/to/moon-relay-review
```

The script includes a render graph that loads the editable sheet and PNG
cel bank. It uses Node, FFmpeg, and the macOS Samantha voice for the
scratch read. On another platform pass a compatible WAV of the same
line as the second argument.
